/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * missedPhrases.pure.ts — 0.1.39: registro OPCIONAL de las frases que el
 * router no reconoció (llegaron al modelo o acabaron en «no entendí").
 *
 * Por qué existe: los contadores dicen CUÁNTAS órdenes se cuelan al modelo,
 * pero arreglar el router necesita ver CUÁLES. Solo el usuario decide
 * guardarlas: apagado por defecto, en la base cifrada del dispositivo,
 * nunca se transmite, y apagarlo borra lo guardado.
 *
 * Sin módulos nativos: se prueba con vitest.
 */
import { joinToolLabels, safeLabel } from "./routerStats.pure";

/** Frases que se conservan; las más antiguas se van borrando. */
export const MAX_MISSED_PHRASES = 50;
/** Caracteres de cada frase que se guardan. */
export const MAX_MISSED_CHARS = 300;
/** Clave en la tabla meta de la base de conocimiento. */
export const MISSED_PHRASES_META_KEY = "router.keep_missed";

const FALLBACKS: readonly string[] = ["actionFailed", "memoryFailed", "notUnderstood"];

export interface MissedPhrase {
  ts: number;
  text: string;
  /** «model» o «fixed»/herramienta si acabó en respaldo. */
  route: string;
  /** Herramientas que pidió el modelo, «a,b», o null. */
  modelTool: string | null;
  retry: "constrained" | "nudge" | null;
  fallback: string | null;
}

export interface MissedRoutingLike {
  route: string;
  modelTools: readonly string[];
  retry: string | null;
  fallback: string | null;
}

/**
 * La fila que se guardaría, o null si no hay nada que guardar. El texto se
 * recorta y se le quitan los saltos de línea repetidos; las etiquetas
 * pasan por safeLabel como en los contadores.
 */
export function toMissedPhrase(text: string, routing: MissedRoutingLike, ts: number): MissedPhrase | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const cut = clean.length > MAX_MISSED_CHARS ? clean.slice(0, MAX_MISSED_CHARS - 1) + "…" : clean;
  return {
    ts,
    text: cut,
    route: safeLabel(routing.route),
    modelTool: joinToolLabels(routing.modelTools),
    retry: routing.retry === "constrained" || routing.retry === "nudge" ? routing.retry : null,
    fallback: FALLBACKS.includes(routing.fallback ?? "") ? routing.fallback : null,
  };
}

/**
 * La señal más útil de cada frase: el respaldo en que acabó, la herramienta
 * que pidió el modelo, el reintento o, si nada, la vía.
 */
export function missedSignal(r: MissedPhrase): string {
  return r.fallback ?? (r.modelTool ? `tool:${r.modelTool}` : r.retry ? `retry:${r.retry}` : r.route);
}

/** Texto plano para copiar la lista (una frase por línea, con su señal). */
export function formatMissedForCopy(rows: readonly MissedPhrase[]): string {
  return rows.map((r) => `[${missedSignal(r)}] ${r.text}`).join("\n");
}
