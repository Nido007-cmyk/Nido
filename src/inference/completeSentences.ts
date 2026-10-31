/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Nunca enseñar una frase cortada (programa «Lo mejor de la
 * bounty», tanda 8; práctica de Pocket Scholar descrita con
 * palabras propias e implementada desde cero — de ese repo no se
 * copia código: su README dice MIT pero no tiene fichero LICENSE).
 *
 * Cuando una generación se corta — el usuario pulsa detener, o se
 * agota el presupuesto de tokens — el texto puede acabar a media
 * frase («…y por eso el río se»). Enseñar eso parece un aparato
 * roto. La regla: si la generación se cortó y el texto no termina
 * una frase, se muestra hasta la última frase completa.
 *
 * Conservadora a propósito, porque un recorte equivocado es peor
 * que el defecto:
 *  - Sin corte declarado, no se toca nada (el modelo también puede
 *    terminar sin punto una lista o una cifra, y es su respuesta).
 *  - Con código (```) no se toca: dentro de un bloque, «frase» no
 *    significa nada.
 *  - Si la cola es una lista (la última línea empieza con viñeta o
 *    número), no se toca: una lista cortada se lee como lista.
 *  - Si no hay NINGUNA frase completa, se deja el texto entero:
 *    una respuesta incompleta vale más que una respuesta vacía.
 *
 * Puro, sin dependencias, 100% testeable.
 */

const SENTENCE_END = /[.!?…]+["»”’)]*(?=\s|$)/g;

function endsWithSentence(text: string): boolean {
  const trimmed = text.replace(/\s+$/, "");
  return /[.!?…]["»”’)]*$/.test(trimmed);
}

function lastLineStartsList(text: string): boolean {
  const lastLine = text.replace(/\s+$/, "").split("\n").pop() ?? "";
  return /^\s*(?:[-*•·]|\d+[.)])\s/.test(lastLine);
}

/**
 * El texto recortado a su última frase completa — solo cuando la
 * generación se cortó (`wasCut`) y el texto no la termina.
 */
export function trimToCompleteSentences(text: string, wasCut: boolean): string {
  if (!wasCut || !text) return text;
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.length === 0) return text;
  if (endsWithSentence(trimmed)) return text;
  if (trimmed.includes("```")) return text;
  if (lastLineStartsList(trimmed)) return text;

  let lastEnd = -1;
  for (const match of trimmed.matchAll(SENTENCE_END)) {
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastEnd <= 0) return text; // ninguna frase completa: no vaciar la respuesta
  return trimmed.slice(0, lastEnd);
}
