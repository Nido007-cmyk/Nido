/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Evidencia primero (programa «Lo mejor de la bounty», tanda 1).
 *
 * Patrón de Commonplace (0xPD33, Apache-2.0, ver ATTRIBUTION.md): la
 * tarjeta con el mejor pasaje se pinta ENCIMA de la respuesta, no
 * debajo. En hardware modesto el modelo tarda en escribir la primera
 * palabra; la fuente principal ya está recuperada y enseñarla primero
 * — con su frase que mejor responde a la pregunta resaltada — da la
 * respuesta «que se lee» antes que la respuesta escrita.
 *
 * `bestPassageSentence` adapta `best_sentence` de su evidence.rs: la
 * frase del pasaje con más términos de la pregunta en común; en
 * empate gana la primera. La implementación de la UI es propia
 * (React Native); de Commonplace se toma el patrón y esta regla.
 *
 * Puro, sin dependencias de UI, 100% testeable.
 */

import { splitSentences, stem } from "./grounding";
import type { RetrievedChunk } from "./retrieve";

export interface EvidenceCardData {
  /** Chunk de la fuente principal (para abrir el lector de la guía). */
  chunkId: string;
  title: string;
  /** La frase del pasaje que mejor responde a la pregunta. */
  highlight: string;
  /** El pasaje alrededor de la frase resaltada, acotado. */
  excerpt: string;
}

/** Términos de contenido de un texto: minúsculas sin acentos, 4+ letras, raíz aproximada. */
function queryTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s-]/g, " ")
    .split(/[\s-]+/)) {
    if (w.length >= 4) out.add(stem(w));
  }
  return out;
}

/**
 * La frase de `body` que mejor responde a `query` (más términos en
 * común; empate → la primera). Sin solape, la primera frase: el
 * arranque del pasaje es su resumen honesto.
 */
export function bestPassageSentence(body: string, query: string): string {
  const sentences = splitSentences(body.trim());
  if (sentences.length === 0) return "";
  const q = queryTerms(query);
  if (q.size === 0) return sentences[0];
  let best = sentences[0];
  let bestHits = 0;
  for (const s of sentences) {
    const terms = queryTerms(s);
    let hits = 0;
    for (const t of terms) if (q.has(t)) hits++;
    if (hits > bestHits) {
      bestHits = hits;
      best = s;
    }
  }
  return bestHits > 0 ? best : sentences[0];
}

const EXCERPT_MAX_CHARS = 320;

/**
 * La tarjeta de evidencia de una respuesta: la fuente principal
 * (chunks[0], la de mayor rango de la recuperación), su frase que
 * mejor responde y el pasaje que la rodea. null sin fuentes o con la
 * fuente principal vacía — la tarjeta no finge lo que no hay.
 */
export function buildEvidenceCard(chunks: readonly RetrievedChunk[], query: string): EvidenceCardData | null {
  const top = chunks[0];
  if (!top || !top.body || top.body.trim().length === 0) return null;
  const highlight = bestPassageSentence(top.body, query);
  const sentences = splitSentences(top.body.trim());
  const at = Math.max(0, sentences.indexOf(highlight));
  // Ventana alrededor de la frase resaltada, hasta el tope de caracteres.
  let lo = at;
  let hi = at;
  let len = sentences[at]?.length ?? 0;
  while (true) {
    const canLo = lo > 0 && len + 1 + sentences[lo - 1].length <= EXCERPT_MAX_CHARS;
    const canHi = hi < sentences.length - 1 && len + 1 + sentences[hi + 1].length <= EXCERPT_MAX_CHARS;
    if (!canLo && !canHi) break;
    if (canHi && (!canLo || (hi - at) <= (at - lo))) {
      hi++;
      len += 1 + sentences[hi].length;
    } else if (canLo) {
      lo--;
      len += 1 + sentences[lo].length;
    }
  }
  const excerpt = sentences.slice(lo, hi + 1).join(" ");
  return { chunkId: top.chunkId, title: top.title, highlight, excerpt };
}
