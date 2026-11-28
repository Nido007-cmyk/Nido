/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.122 — caché del prompt en disco, SOLO con texto público.
 *
 * El problema: al cargar el modelo, el primer turno del agente lee unos
 * 1700 tokens de catálogo de herramientas antes de escribir nada. En un
 * procesador de gama media eso son segundos de espera en cada arranque en
 * frío. PocketPal y ChatterUI guardan el estado del modelo en disco para no
 * repetir esa lectura; NIDO hace lo mismo con una regla más estricta,
 * decidida por el dueño: «reordenar y guardar solo lo público».
 *
 * La garantía de privacidad es por construcción, no por recorte:
 *  1. El prompt del agente pone primero el tramo público (texto fijo de la
 *     app) y detrás la memoria y la fecha (buildSystemPromptParts).
 *  2. El texto que se procesa para guardar se obtiene formateando un chat
 *     hecho SOLO de texto público: el tramo público como mensaje del
 *     sistema y un marcador fijo como mensaje del usuario, y cortando justo
 *     al final del tramo público (publicSliceFromFormatted). Ningún dato del
 *     usuario se le pasa a esa función.
 *  3. Se guarda únicamente en un contexto recién creado, después de que ese
 *     contexto haya procesado SOLO ese texto público, y antes de que vea el
 *     mensaje real. llama.cpp serializa la memoria entera del contexto
 *     (llama_state_save_file), así que guardar tras una conversación habría
 *     escrito también la memoria del usuario: por eso nunca se guarda ahí.
 *
 * La corrección también es por construcción: tras cargar el estado, el
 * motor compara token a token el prompt nuevo con el guardado y solo
 * reutiliza el prefijo común (find_common_prefix_length en llama.rn). Un
 * fichero que no encaje solo cuesta volver a leer el prompt.
 *
 * El fichero vive en la carpeta de caché, que el borrado total y el botón
 * de pánico eliminan (appReset.ts, verificado allí).
 */

/** Mensaje del usuario fijo del chat de sondeo: nunca un dato real. */
export const PROMPT_CACHE_PROBE_USER = ".";

/** Ficheros que se conservan; el resto, los más viejos, se borran. */
export const PROMPT_CACHE_MAX_FILES = 6;

/** Nombre de la carpeta dentro de la caché de la app. */
export const PROMPT_CACHE_DIRNAME = "prompt-cache";

/**
 * Chat de sondeo: solo texto público. El mensaje del usuario existe porque
 * algunas plantillas (Gemma) meten el sistema dentro del primer turno del
 * usuario y otras fallan sin él.
 */
export function probeMessages(publicPrefix: string): { role: string; content: string }[] {
  return [
    { role: "system", content: publicPrefix },
    { role: "user", content: PROMPT_CACHE_PROBE_USER },
  ];
}

/**
 * El chat formateado hasta el final del tramo público, o null si la
 * plantilla no lo contiene tal cual (entonces no hay caché).
 */
export function publicSliceFromFormatted(formatted: string, publicPrefix: string): string | null {
  if (!publicPrefix) return null;
  const at = formatted.indexOf(publicPrefix);
  if (at < 0) return null;
  return formatted.slice(0, at + publicPrefix.length);
}

/** FNV-1a de 32 bits en dos semillas: un nombre corto y estable. */
export function textFingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = (0x01000193 ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193 + 2) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

export interface PromptCacheKeyInput {
  modelFile: string;
  nCtx: number;
  /** Perfil de memoria con que cargó (tipo de KV y acelerador). */
  profile: string;
  engineVersion: string;
  appVersion: string;
  /** El texto público formateado que se guarda. */
  publicSlice: string;
}

/**
 * Nombre del fichero. Todo lo que cambia el estado guardado entra en la
 * llave: modelo, contexto, perfil (KV q8 o f16, CPU o acelerador), versión
 * del motor y de la app, y la huella del texto.
 */
export function promptCacheFileName(k: PromptCacheKeyInput): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const versions = textFingerprint(`${k.engineVersion}|${k.appVersion}`).slice(0, 8);
  return `${safe(k.modelFile)}-${Math.floor(k.nCtx)}-${safe(k.profile)}-${versions}-${textFingerprint(k.publicSlice)}.bin`;
}

/** Ficheros a borrar para quedarse con los `keep` más recientes. */
export function filesToPrune(files: { name: string; mtime: number }[], keep = PROMPT_CACHE_MAX_FILES): string[] {
  return [...files]
    .sort((x, y) => y.mtime - x.mtime)
    .slice(Math.max(0, keep))
    .map((f) => f.name);
}

/** Lo que pasó con la caché en el último arranque en frío (para Uso y pruebas). */
export type PromptCacheOutcome =
  | { kind: "loaded"; tokens: number }
  | { kind: "saved"; tokens: number }
  | { kind: "skipped"; reason: "no-prefix" | "not-fresh" | "unsupported" | "template" | "mismatch" | "aborted" }
  | { kind: "failed"; stage: "load" | "save" };
