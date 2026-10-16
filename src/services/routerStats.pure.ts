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
 * - stageDropped (0.1.43): una orden preparada como chip cayó sin
 *   ejecutarse; el motivo viaja en `route` (ver STAGE_DROP_REASONS).
 *   Estas filas NO son mensajes: no cuentan en totales, tiempos ni
 *   porcentajes del router; se cuentan aparte, en `drops`.
 */
export type RouterOutcome = "router" | "model" | "notUnderstood" | "chat" | "stageDropped";

/**
 * 0.1.43: por qué cayó un chip preparado sin ejecutarse. Lista cerrada:
 * un motivo fuera de esta lista no se guarda tal cual, jamás (y nunca
 * se guarda texto: solo la etiqueta del motivo). Todos cumplen la forma
 * de safeLabel, así que pasan intactos al guardarlos como `route`.
 */
export const STAGE_DROP_REASONS = [
  "text_edited",
  "lang_changed",
  "mode_changed",
  "new_chat",
  "session_switch",
  "dismissed",
  "stale_on_tap",
] as const;

export type StageDropReason = (typeof STAGE_DROP_REASONS)[number];

export function isStageDropReason(v: unknown): v is StageDropReason {
  return typeof v === "string" && (STAGE_DROP_REASONS as readonly string[]).includes(v);
}

export interface RouterSample {
  ts: number;
  /** Tiempo de classifyIntent (la decisión que se paga en CADA mensaje), ms. */
  classifyMs: number;
  outcome: RouterOutcome;
  /**
   * 0.1.39 (solo turnos del asistente; null en «chat» y en muestras de
   * versiones anteriores): la vía que lo resolvió — una herramienta
   * determinista, «fixed» o «model».
   */
  route?: string | null;
  /** Herramientas que pidió el MODELO, separadas por coma (fallo del router). */
  modelTool?: string | null;
  /** El modelo no llamó a nada a la primera: «constrained» o «nudge». */
  retry?: string | null;
}

/**
 * 0.1.39: lo que el router deja pasar al modelo, sobre los turnos del
 * asistente medidos con la 0.1.39 o posterior.
 */
export interface RouterLeak {
  /** Turnos del asistente con detalle de vía (los anteriores no cuentan). */
  measured: number;
  /** Resueltos por el código, sin el modelo. */
  router: number;
  /** Llegaron al modelo (resuelvan bien o acaben en «no entendí»). */
  toModel: number;
  /** De esos, el modelo pidió una herramienta: el router debió atraparlos. */
  modelAskedTool: number;
  /** De esos, el modelo no llamó a nada a la primera y hubo que reintentar. */
  retried: number;
  /** Herramientas que pidió el modelo, de más a menos. */
  byTool: Array<[string, number]>;
  /** Vías deterministas que resolvieron, de más a menos. */
  byRoute: Array<[string, number]>;
}

export interface RouterSummary {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  outcomes: Record<RouterOutcome, number>;
  leak: RouterLeak;
  /** 0.1.43: chips que cayeron sin ejecutarse, por motivo (aparte de todo lo demás). */
  drops: Record<StageDropReason, number>;
}

function emptyDrops(): Record<StageDropReason, number> {
  return { text_edited: 0, lang_changed: 0, mode_changed: 0, new_chat: 0, session_switch: 0, dismissed: 0, stale_on_tap: 0 };
}

const LABEL_RE = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Una etiqueta de vía o herramienta tal como se guarda: un identificador
 * corto en minúsculas o «other». El nombre de herramienta lo escribe el
 * MODELO y podría traer cualquier cosa (incluso texto del usuario): lo que
 * no tenga forma de identificador no se guarda nunca.
 */
export function safeLabel(v: unknown): string {
  return typeof v === "string" && LABEL_RE.test(v) ? v : "other";
}

/** Lista de herramientas del modelo → «a,b» saneado, o null si no hay. */
export function joinToolLabels(names: readonly string[]): string | null {
  const clean = names.slice(0, 5).map(safeLabel);
  return clean.length ? clean.join(",") : null;
}

function sortedCounts(m: Map<string, number>): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function summarizeLeak(samples: readonly RouterSample[]): RouterLeak {
  let measured = 0, router = 0, toModel = 0, modelAskedTool = 0, retried = 0;
  const byTool = new Map<string, number>();
  const byRoute = new Map<string, number>();
  for (const s of samples) {
    // Un chip caído no resolvió nada: no es un turno resuelto por el código.
    if (!s.route || s.outcome === "chat" || s.outcome === "stageDropped" || !isRouterOutcome(s.outcome)) continue;
    measured++;
    if (s.route !== "model") {
      router++;
      byRoute.set(safeLabel(s.route), (byRoute.get(safeLabel(s.route)) ?? 0) + 1);
      continue;
    }
    toModel++;
    if (s.retry) retried++;
    if (s.modelTool) {
      modelAskedTool++;
      for (const t of s.modelTool.split(",")) byTool.set(safeLabel(t), (byTool.get(safeLabel(t)) ?? 0) + 1);
    }
  }
  return { measured, router, toModel, modelAskedTool, retried, byTool: sortedCounts(byTool), byRoute: sortedCounts(byRoute) };
}

const OUTCOMES: readonly RouterOutcome[] = ["router", "model", "notUnderstood", "chat", "stageDropped"];

export function isRouterOutcome(v: unknown): v is RouterOutcome {
  return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);
}

/** Percentil por rango más cercano sobre una lista YA ordenada. */
function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarizeRouterSamples(samples: readonly RouterSample[]): RouterSummary {
  const outcomes: Record<RouterOutcome, number> = { router: 0, model: 0, notUnderstood: 0, chat: 0, stageDropped: 0 };
  const drops = emptyDrops();
  const times: number[] = [];
  for (const s of samples) {
    if (!Number.isFinite(s.classifyMs) || s.classifyMs < 0) continue;
    // 0.1.43: un chip caído no es un mensaje medido: fuera de count,
    // tiempos y desenlaces; solo suma en su motivo (si es de la lista).
    if (s.outcome === "stageDropped") {
      if (isStageDropReason(s.route)) drops[s.route]++;
      continue;
    }
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
    leak: summarizeLeak(samples),
    drops,
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
