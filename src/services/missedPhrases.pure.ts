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

/**
 * 0.1.41 (prueba física, Tab A9+): la mitad de los fallos no pasaban por el
 * asistente. NIDO los tomaba por conversación («que no se te olvide que el
 * martes pago la renta», «por cierto, soy vegetariano») y nunca llegaban a
 * este registro. Con el registro encendido, un mensaje de conversación que
 * TIENE FORMA DE ORDEN o de dato propio también se guarda (vía «chat»).
 *
 * Es un filtro amplio a propósito: aquí un falso positivo solo añade una
 * línea a una lista que el usuario revisa; un falso negativo esconde un fallo.
 */
const COMMAND_SHAPE_RES: RegExp[] = [
  // Verbos de orden y de memoria (es)
  /\b(?:recu[eé]rd|acu[eé]rd|av[ií]s|apunt|anot|guard|memoriz|ll[aá]m|env[ií]|mand|borr|elimin|cre[aá]|agend|program|convier|calcul|despi[eé]rt)\w*/i,
  /\b(?:no se te (?:olvide|pase)|no (?:te )?olvides|ten(?:ga)? en cuenta|a partir de (?:ahora|hoy)|de ahora en adelante|pon(?:me)?|dime)\b/i,
  /\b(?:qu[eé] d[ií]a|cu[aá]nt[oa]s?\b.*\b(?:son|es|hay|faltan)|qu[eé] (?:sabes|recuerdas) de m)/i,
  // Datos propios (es)
  /^(?:\W|por cierto|oye|ah|bueno|,|\s)*(?:soy|tengo|vivo|trabajo|me llamo|no (?:como|bebo|tomo)|mi\s+\S+(?:\s+\S+)?\s+(?:es|son|se llama|cumple))\b/i,
  // en
  /\b(?:remind|remember|note|save|call|text|send|delete|schedule|convert|calculate|wake me|keep in mind|from now on|don't forget|what day|how many)\b/i,
  /^(?:\W|btw|by the way|oh|\s)*(?:i'?m|i am|i have|i live|i work|my\s+\S+(?:\s+\S+)?\s+(?:is|are))\b/i,
  // pt
  /\b(?:lembr|anot|salv|ligu?e?|envi|apag|cri[ae]|agend|convert|calcul|acord|n[aã]o (?:se )?esque[cç]a|a partir de agora|que dia)\w*/i,
  /^(?:\W|ali[aá]s|\s)*(?:sou|tenho|moro|trabalho|me chamo|meu\s+\S+\s+(?:é|e)|minha\s+\S+\s+(?:é|e))\b/i,
];

export function looksLikeMissedCommand(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 4 || t.length > 300) return false;
  return COMMAND_SHAPE_RES.some((re) => re.test(t));
}

/** Texto plano para copiar la lista (una frase por línea, con su señal). */
export function formatMissedForCopy(rows: readonly MissedPhrase[]): string {
  return rows.map((r) => `[${missedSignal(r)}] ${r.text}`).join("\n");
}
