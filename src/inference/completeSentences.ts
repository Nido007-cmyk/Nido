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
 *  - Si la cola es una lista, el recorte va por puntos de la lista:
 *    se cae el último punto si quedó a medias y se conservan los
 *    completos (F2-m6: hasta la 0.1.98 la exención dejaba la media
 *    frase intacta). Si el punto cortado es el único, no se toca.
 *  - Una abreviatura («Dr.», «etc.») o una inicial («J. R.») NO
 *    cuentan como cierre de frase (F2-m6: contaban, y el recorte
 *    amputaba un paso de emergencia justo en la abreviatura). Si el
 *    único «cierre» es una abreviatura, no se recorta nada: una
 *    respuesta incompleta vale más que una amputada en falso.
 *  - Si no hay NINGUNA frase completa, se deja el texto entero:
 *    una respuesta incompleta vale más que una respuesta vacía.
 *
 * Puro, sin dependencias, 100% testeable.
 */

const SENTENCE_END = /[.!?…]+["»”’)]*(?=\s|$)/g;

/**
 * Abreviaturas habituales en es/en cuyo punto no cierra frase. La lista
 * es corta a propósito: ante la duda, no contar el cierre (el error
 * queda del lado de no recortar, nunca del de amputar).
 */
const ABBREVIATIONS = new Set([
  "dr", "dra", "sr", "sra", "srta", "mr", "mrs", "ms", "st", "vs", "etc",
  "aprox", "fig", "vol", "cap", "núm", "num", "ej", "inc", "ltd", "jr",
  "univ", "ed", "al", "pág", "pag",
]);

/**
 * ¿El «cierre» que SENTENCE_END encontró en `index` es en realidad una
 * abreviatura o una inicial? Se mira la palabra pegada a la puntuación.
 */
function isFalseEnd(text: string, index: number): boolean {
  const word = /([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)$/.exec(text.slice(0, index))?.[1];
  if (!word) return false;
  if (word.length === 1) return true; // inicial o resto de «p. ej.» / «a. m.»
  return ABBREVIATIONS.has(word.toLowerCase());
}

function endsWithSentence(text: string): boolean {
  const trimmed = text.replace(/\s+$/, "");
  return /[.!?…]["»”’)]*$/.test(trimmed);
}

const LIST_ITEM = /^\s*(?:[-*•·]|\d+[.)])\s/;

function lastLineStartsList(text: string): boolean {
  const lastLine = text.replace(/\s+$/, "").split("\n").pop() ?? "";
  return LIST_ITEM.test(lastLine);
}

/**
 * Recorte por puntos de lista: si la última línea es un punto a medias
 * y hay al menos un punto completo antes, el texto llega hasta el fin
 * de ese punto. Si el punto cortado es el único, null (no tocar).
 */
function trimListTail(text: string): string | null {
  const lines = text.split("\n");
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === "") last--;
  if (last < 0 || !LIST_ITEM.test(lines[last])) return null;
  let offset = 0;
  let completeItems = 0;
  let prevItemEnd = -1;
  for (let i = 0; i < last; i++) {
    if (LIST_ITEM.test(lines[i]) && lines[i].trim() !== "") {
      completeItems++;
      prevItemEnd = offset + lines[i].length;
    }
    offset += lines[i].length + 1;
  }
  if (completeItems === 0 || prevItemEnd < 0) return null;
  return text.slice(0, prevItemEnd);
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
  if (lastLineStartsList(trimmed)) {
    // Cola de lista: manda el recorte por puntos; sin punto completo
    // previo, la lista se deja entera (nunca vaciar la respuesta).
    return trimListTail(trimmed) ?? text;
  }

  let lastEnd = -1;
  for (const match of trimmed.matchAll(SENTENCE_END)) {
    if (isFalseEnd(trimmed, match.index ?? 0)) continue;
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  if (lastEnd <= 0) return text; // ninguna frase completa: no vaciar la respuesta
  return trimmed.slice(0, lastEnd);
}
