/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.126 (etapa 3) — preguntar sobre una foto, en el teléfono y sin
 * internet.
 *
 * Decisiones del dueño: LFM2-VL-450M para aparatos pequeños (cabe en 4 GB;
 * responde en español e inglés, el portugués no figura en su lista) y el
 * proyector de visión del Gemma 4 E4B para los aparatos donde Gemma 4 ya
 * cabe (mejor calidad, los tres idiomas).
 *
 * Reglas:
 *  - Ruta «adjuntar»: si el modelo de chat activo tiene su proyector
 *    descargado, se le adjunta (initMultimodal) solo para esta pregunta.
 *  - Ruta «cambiar»: si no, y LFM2-VL y su proyector están descargados, se
 *    descarga el modelo de chat, se carga LFM2-VL con su proyector (el plan
 *    de memoria cuenta los dos) y al acabar se descarga: el siguiente turno
 *    de texto vuelve a cargar el modelo de chat, como siempre.
 *  - El proyector pasa por la puerta de confianza y por la memoria de AHORA
 *    (LlamaEngine.attachProjector).
 *  - La copia de la foto vive en la caché y se BORRA al acabar, salga bien
 *    o mal: es un dato del usuario y no se guarda sin cifrar.
 */

import * as FileSystem from "expo-file-system/legacy";
import { MODEL_CATALOG, type CatalogModel } from "../models/manifest";

export type PhotoLang = "es" | "en" | "pt";

/** El proyector de visión de un modelo del catálogo, si existe. */
export function projectorFor(modelId: string, catalog: CatalogModel[] = MODEL_CATALOG): CatalogModel | undefined {
  return catalog.find((m) => m.kind === "projector" && m.projectorFor === modelId);
}

/** El modelo dedicado a fotos (tipo «vision»), si hay. */
export function photoModel(catalog: CatalogModel[] = MODEL_CATALOG): CatalogModel | undefined {
  return catalog.find((m) => m.kind === "vision");
}

export type VisionRoute =
  | { kind: "attach"; model: CatalogModel; projector: CatalogModel }
  | { kind: "swap"; model: CatalogModel; projector: CatalogModel };

/**
 * Qué modelo contesta la foto. `present` dice si un fichero del catálogo
 * está descargado entero. null = no hay ningún modelo de fotos descargado.
 */
export function chooseVisionRoute(
  activeLlm: CatalogModel | undefined,
  present: (asset: CatalogModel) => boolean,
  catalog: CatalogModel[] = MODEL_CATALOG,
): VisionRoute | null {
  if (activeLlm) {
    const proj = projectorFor(activeLlm.id, catalog);
    if (proj && present(activeLlm) && present(proj)) return { kind: "attach", model: activeLlm, projector: proj };
  }
  const vlm = photoModel(catalog);
  if (vlm) {
    const proj = projectorFor(vlm.id, catalog);
    if (proj && present(vlm) && present(proj)) return { kind: "swap", model: vlm, projector: proj };
  }
  return null;
}

/** Instrucción del sistema para una pregunta sobre una foto, en el idioma de la interfaz. */
export function photoSystemPrompt(lang: PhotoLang): string {
  if (lang === "en") {
    return "You are NIDO, an assistant that runs entirely on the user's phone. Answer the question about the image in English, briefly and only with what you can see. If something is not clear in the image, say so instead of guessing. Do not identify real people by name.";
  }
  if (lang === "pt") {
    return "Você é o NIDO, um assistente que funciona inteiro no telefone do usuário. Responda à pergunta sobre a imagem em português, de forma breve e só com o que dá para ver. Se algo não estiver claro na imagem, diga isso em vez de adivinhar. Não identifique pessoas reais pelo nome.";
  }
  return "Eres NIDO, un asistente que funciona entero en el teléfono del usuario. Responde a la pregunta sobre la imagen en español, breve y solo con lo que se ve. Si algo no se ve claro en la imagen, dilo en vez de adivinar. No identifiques a personas reales por su nombre.";
}

/** Presupuesto de escritura de una respuesta sobre una foto. */
export const PHOTO_N_PREDICT = 384;

/** Memoria de trabajo del codificador de visión (la misma que usa el motor al adjuntar). */
export const PHOTO_WORKING_BYTES = 128 * 1024 * 1024;

/** ¿Está el fichero del catálogo descargado entero? */
export async function assetPresent(asset: CatalogModel): Promise<boolean> {
  try {
    const info = (await FileSystem.getInfoAsync(`${FileSystem.documentDirectory}${asset.filename}`)) as {
      exists: boolean;
      size?: number;
    };
    return info.exists && info.size === asset.sizeBytes;
  } catch {
    return false;
  }
}

/** La ruta de visión de AHORA, mirando qué ficheros están descargados de verdad. */
export async function photoRouteNow(
  activeLlm: CatalogModel | undefined,
  present: (asset: CatalogModel) => Promise<boolean> = assetPresent,
): Promise<VisionRoute | null> {
  const candidates = [activeLlm, photoModel()].filter((m): m is CatalogModel => !!m);
  const presence = new Map<string, boolean>();
  for (const m of candidates) {
    presence.set(m.id, await present(m));
    const p = projectorFor(m.id);
    if (p) presence.set(p.id, await present(p));
  }
  return chooseVisionRoute(activeLlm, (a) => presence.get(a.id) === true);
}

/** ¿Es una copia de imagen del selector? (para barrer las que quedaron de una sesión cortada) */
export function isImageCopy(name: string): boolean {
  return /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(name);
}

/**
 * Borra las copias de imágenes que el selector dejó en la caché (de una
 * sesión cortada antes de preguntar), salvo `keepUri`. Nunca lanza.
 */
export async function sweepStalePhotoCopies(keepUri?: string | null): Promise<void> {
  try {
    const dir = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}DocumentPicker/` : null;
    if (!dir) return;
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return;
    for (const name of await FileSystem.readDirectoryAsync(dir)) {
      const uri = `${dir}${name}`;
      if (isImageCopy(name) && uri !== keepUri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  } catch {
    // Higiene: el borrado total de la app también se lleva la caché.
  }
}

/** Borra la copia de la foto (URI file://). Nunca lanza. */
export async function deletePhotoCopy(uri: string): Promise<void> {
  const target = uri.startsWith("file://") ? uri : `file://${uri}`;
  await FileSystem.deleteAsync(target, { idempotent: true }).catch(() => {});
}

export interface PhotoEngine {
  isLoaded: boolean;
  getModelInfo(): { filename: string } | null;
  load(filename: string, opts?: { extraResidentBytes?: number }): Promise<void>;
  unload(): Promise<void>;
  attachProjector(filename: string): Promise<void>;
  detachProjector(): Promise<void>;
  generate(o: {
    messages: { role: string; content: string }[];
    imagePath: string;
    onToken?: (t: string) => void;
    nPredict?: number;
    temperature?: number;
    telemetryContext?: { taskType?: string };
  }): Promise<string>;
}

export class NoPhotoModelError extends Error {
  readonly code = "no_photo_model";
  constructor() {
    super("No photo model downloaded");
  }
}

/**
 * Contesta una pregunta sobre una foto. Borra SIEMPRE la copia de la foto
 * al acabar. Lanza NoPhotoModelError si no hay modelo de fotos descargado.
 */
export async function askAboutPhoto(opts: {
  imageUri: string;
  question: string;
  lang: PhotoLang;
  activeLlm: CatalogModel | undefined;
  engine: PhotoEngine;
  onToken?: (t: string) => void;
  present?: (asset: CatalogModel) => Promise<boolean>;
}): Promise<string> {
  const present = opts.present ?? assetPresent;
  try {
    const route = await photoRouteNow(opts.activeLlm, present);
    if (!route) throw new NoPhotoModelError();
    const { engine } = opts;
    const extra = route.projector.sizeBytes + PHOTO_WORKING_BYTES;
    if (route.kind === "swap") {
      if (engine.isLoaded && engine.getModelInfo()?.filename !== route.model.filename) await engine.unload();
      await engine.load(route.model.filename, { extraResidentBytes: extra });
    } else if (!engine.isLoaded || engine.getModelInfo()?.filename !== route.model.filename) {
      await engine.load(route.model.filename, { extraResidentBytes: extra });
    }
    try {
      await engine.attachProjector(route.projector.filename);
      return await engine.generate({
        messages: [
          { role: "system", content: photoSystemPrompt(opts.lang) },
          { role: "user", content: opts.question },
        ],
        imagePath: opts.imageUri,
        onToken: opts.onToken,
        nPredict: PHOTO_N_PREDICT,
        temperature: 0.2,
        telemetryContext: { taskType: "photo" },
      });
    } finally {
      await engine.detachProjector().catch(() => {});
      // El modelo de fotos no se queda residente: el siguiente turno de
      // texto vuelve a cargar el de chat.
      if (route.kind === "swap") await engine.unload().catch(() => {});
    }
  } finally {
    await deletePhotoCopy(opts.imageUri);
  }
}
