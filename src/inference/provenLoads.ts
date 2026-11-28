/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.122 — cargas probadas en este aparato (decisión del dueño: «solo
 * informar»).
 *
 * PocketPal aprende un techo por aparato: si un modelo cargó bien una vez,
 * lo deja volver a cargar aunque su cálculo diga que no cabe. NIDO no
 * afloja la regla de memoria (la escalera ya baja el contexto para que el
 * modelo quepa, y el CrashGuard la endurece tras un cierre). Lo que sí
 * aprende es la prueba: por cada modelo, el mayor contexto con el que
 * GENERÓ una respuesta completa en este aparato (una respuesta a la vista
 * que terminó sola: ni cortada, ni parada, ni una generación interna). La
 * tarjeta del modelo lo enseña («Probado en este aparato con 2048
 * tokens»): es una medida real,
 * no una estimación, y nunca cambia qué se deja cargar.
 *
 * Sin datos del usuario: solo nombres de fichero de modelo y números. El
 * fichero muere con el borrado total (appReset.ts).
 */

export const PROVEN_LOADS_FILE = "nido-proven-loads.json";

/** Nombre base del fichero del modelo → mayor contexto confirmado. */
export type ProvenLoads = Record<string, number>;

/** Máximo de modelos recordados (el catálogo es corto; esto es un tope de higiene). */
export const PROVEN_LOADS_MAX = 64;

function baseName(model: string): string {
  const i = model.lastIndexOf("/");
  return i >= 0 ? model.slice(i + 1) : model;
}

/** Lectura tolerante: lo ilegible o raro se descarta, nunca lanza. */
export function parseProvenLoads(raw: string | null | undefined): ProvenLoads {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ProvenLoads = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0 && k.length > 0 && k.length <= 200) {
        out[baseName(k)] = Math.floor(v);
      }
      if (Object.keys(out).length >= PROVEN_LOADS_MAX) break;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Anota una generación completa del modelo con `nCtx`. Devuelve el mismo
 * objeto si no cambia nada (el llamador no escribe), o uno nuevo.
 */
export function recordProvenLoad(loads: ProvenLoads, model: string, nCtx: number): ProvenLoads {
  if (!model || !Number.isFinite(nCtx) || nCtx <= 0) return loads;
  const key = baseName(model);
  const n = Math.floor(nCtx);
  if ((loads[key] ?? 0) >= n) return loads;
  if (!(key in loads) && Object.keys(loads).length >= PROVEN_LOADS_MAX) return loads;
  return { ...loads, [key]: n };
}

/** El contexto probado de un modelo del catálogo («models/<fichero>» o el nombre a secas). */
export function provenContextFor(loads: ProvenLoads, model: string): number | null {
  return loads[baseName(model)] ?? null;
}
