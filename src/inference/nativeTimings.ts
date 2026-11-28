/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.121 (etapa 1, comparación con PocketPal y AI Edge Gallery): los
 * tiempos que mide el propio motor en cada respuesta. llama.rn devuelve
 * en `result.timings` la lectura del prompt (prompt_n, prompt_per_second),
 * la escritura (predicted_n, predicted_per_second) y los tokens del prompt
 * que reutilizó de la caché (cache_n). Hasta aquí NIDO calculaba la tasa
 * en la app contando llamadas de onToken, que llama.rn retiene en saltos
 * de línea y UTF-8 a medias; el motor cuenta tokens de verdad.
 *
 * Pura: valida y normaliza. Cualquier campo que no sea un número finito
 * y no negativo invalida el conjunto (null): mejor la cuenta de la app
 * que una cifra rota del nativo.
 */
export interface NativeTimings {
  /** Tokens del prompt evaluados en esta respuesta (sin los de caché). */
  promptN: number;
  /** Velocidad de lectura del prompt, tokens/s. */
  promptPerSec: number;
  /** Tokens del prompt reutilizados de la caché (no se evaluaron). */
  cacheN: number;
  /** Tokens escritos. */
  predictedN: number;
  /** Velocidad de escritura, tokens/s. */
  predictedPerSec: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

export function fromNativeTimings(raw: unknown): NativeTimings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const promptN = num(r.prompt_n);
  const promptPerSec = num(r.prompt_per_second);
  const cacheN = num(r.cache_n);
  const predictedN = num(r.predicted_n);
  const predictedPerSec = num(r.predicted_per_second);
  if (promptN === null || promptPerSec === null || predictedN === null || predictedPerSec === null) return null;
  return { promptN, promptPerSec, cacheN: cacheN ?? 0, predictedN, predictedPerSec };
}

/**
 * La tasa de escritura que se guarda y se enseña: la del motor cuando hay
 * al menos dos tokens escritos (con uno no hay tramo que medir); si no,
 * la cuenta de la app (`fallback`).
 */
export function writeRate(timings: NativeTimings | null, fallback: number | null): number | null {
  if (timings && timings.predictedN > 1 && timings.predictedPerSec > 0) return timings.predictedPerSec;
  return fallback;
}
