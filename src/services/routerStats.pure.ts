/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * routerStats.pure.ts — 0.1.33: cuánto cuesta decidir la ruta de cada
 * mensaje (el pre-router determinista) y adónde fue a parar. Sin módulos
 * nativos: se prueba con vitest.
 *
 * PRIVACIDAD: solo números y una etiqueta de desenlace. Nunca el texto del
 * mensaje ni la respuesta.
 */

/**
 * Adónde fue el mensaje:
 * - router: lo resolvió el código determinista, sin el modelo.
 * - model: entró al asistente y respondió el modelo.
 * - notUnderstood: entró al asistente y acabó en «no entendí».
 * - chat: conversación normal (no era una acción ni memoria).
 */
export type RouterOutcome = "router" | "model" | "notUnderstood" | "chat";

export interface RouterSample {
  ts: number;
  /** Tiempo de classifyIntent (la decisión que se paga en CADA mensaje), ms. */
  classifyMs: number;
  outcome: RouterOutcome;
}

export interface RouterSummary {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  outcomes: Record<RouterOutcome, number>;
}

const OUTCOMES: readonly RouterOutcome[] = ["router", "model", "notUnderstood", "chat"];

export function isRouterOutcome(v: unknown): v is RouterOutcome {
  return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);
}

/** Percentil por rango más cercano sobre una lista YA ordenada. */
function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarizeRouterSamples(samples: readonly RouterSample[]): RouterSummary {
  const outcomes: Record<RouterOutcome, number> = { router: 0, model: 0, notUnderstood: 0, chat: 0 };
  const times: number[] = [];
  for (const s of samples) {
    if (!Number.isFinite(s.classifyMs) || s.classifyMs < 0) continue;
    times.push(s.classifyMs);
    if (isRouterOutcome(s.outcome)) outcomes[s.outcome]++;
  }
  times.sort((a, b) => a - b);
  return {
    count: times.length,
    p50Ms: times.length ? percentile(times, 50) : null,
    p95Ms: times.length ? percentile(times, 95) : null,
    maxMs: times.length ? times[times.length - 1] : null,
    outcomes,
  };
}

/** «0,04 ms», «1,2 ms», «12 ms»: sin Intl (Hermes, ver CRASH-2026-10-10). */
export function formatRouterMs(ms: number | null, decimalComma: boolean): string {
  if (ms == null) return "—";
  const s = ms < 0.1 ? ms.toFixed(3) : ms < 10 ? ms.toFixed(2) : ms.toFixed(0);
  return `${decimalComma ? s.replace(".", ",") : s} ms`;
}

/** Porcentaje entero de `part` sobre `total` («—» si no hay total). */
export function percentOf(part: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}
