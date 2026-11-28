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
 * 0.1.123 (auditoría E-2): la tasa de escritura que se guarda y se enseña
 * vuelve a la VARA SELLADA de la casa (0.1.118): tokens menos uno sobre el
 * tiempo de generación, que empieza en el primer token. La 0.1.121 la
 * cambió en silencio por la del motor (predicted_per_second: todos los
 * tokens sobre su tiempo de decodificación), que en respuestas cortas da
 * casi el doble (2 tokens: 2/t frente a 1/t) y que se mezclaba sin marca
 * con la serie anterior en la mediana de «Medido en este aparato».
 *
 * Lo que sí queda del motor es la CUENTA de tokens (predicted_n), que es
 * exacta; la de la app cuenta llamadas de onToken y llama.rn las retiene
 * en saltos de línea y UTF-8 a medias. La tasa del motor sigue guardada
 * aparte (inference_telemetry_timings) para quien la quiera comparar.
 */
export function generatedTokens(timings: NativeTimings | null, appCount: number): number {
  return timings && timings.predictedN > 0 ? timings.predictedN : appCount;
}

/** La vara sellada: (tokens − 1) / tiempo de generación; null sin tramo que medir. */
export function sealedWriteRate(tokens: number, genMs: number): number | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(genMs) || tokens <= 1 || genMs <= 0) return null;
  return ((tokens - 1) / genMs) * 1000;
}
