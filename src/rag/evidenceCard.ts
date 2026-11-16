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

import { primarySourceIndex, splitSentences, stem } from "./grounding";
import { parsePackChunkId } from "./packSource";
import type { SentenceProvenance } from "./provenance";
import type { RetrievedChunk } from "./retrieve";

export interface EvidenceCardData {
  /** Chunk de la fuente principal (para abrir el lector de la guía). */
  chunkId: string;
  /**
   * Posición de esta fuente en la lista de citas del turno (0-based):
   * su número de cita es index + 1. La tarjeta se etiqueta y se tiñe
   * con ese número, el mismo que la lista de notas y que el [n] del
   * texto — antes el disco decía siempre «1» aunque la tarjeta
   * llevara dentro otra fuente.
   */
  index: number;
  title: string;
  /** La frase del pasaje que mejor responde a la pregunta. */
  highlight: string;
  /** El pasaje alrededor de la frase resaltada, acotado. */
  excerpt: string;
  /**
   * Adversaria H-07: la fuente principal es un resto truncado por el
   * presupuesto de contexto — el pasaje que la tarjeta enseña es el que
   * el modelo vio, y este dato lo dice, para que la tarjeta no lo
   * presente como la fuente entera.
   */
  truncated: boolean;
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
 * La fuente en la que la respuesta SERVIDA se basa, según la
 * procedencia del turno: las frases con origen «source» votan por su
 * [n] (y las de «guide» con chunkId, por su chunk en la lista). Gana
 * la que sostiene más frases; en empate, la primera citada en la
 * respuesta. null cuando la procedencia no nombra ninguna fuente
 * (turno detenido, creativo, guía literal, texto fijo): quien llama
 * cae entonces a la fuente de mayor rango, como siempre.
 *
 * Por qué existe (foto del dueño, 0.1.104, 2026-11-15): el juez
 * fundamenta cada frase en SU chunk (argmax de apoyo), pero la
 * tarjeta se construía solo desde la lista, con el rango 1 de la
 * recuperación. Cuando la recuperación rankeaba una guía irrelevante
 * (la crecida) por encima de la buena (el atragantamiento), la
 * respuesta salía citada a la [2] y la tarjeta enseñaba la [1] — y
 * «Leer la guía entera» abría la guía equivocada en una emergencia.
 */
export function servedSourceIndex(
  provenance: readonly SentenceProvenance[] | undefined,
  chunks: readonly RetrievedChunk[],
): number | null {
  if (!provenance || chunks.length === 0) return null;
  const votes = new Map<number, { count: number; firstAt: number }>();
  provenance.forEach((s, at) => {
    let idx: number | null = null;
    if (s.origin.kind === "source") {
      const i = s.origin.n - 1;
      if (i >= 0 && i < chunks.length) idx = i;
    } else if (s.origin.kind === "guide" && s.origin.chunkId) {
      const guideChunkId = s.origin.chunkId;
      const i = chunks.findIndex((c) => c.chunkId === guideChunkId);
      if (i >= 0) idx = i;
    }
    if (idx === null) return;
    const v = votes.get(idx);
    if (v) v.count++;
    else votes.set(idx, { count: 1, firstAt: at });
  });
  let best: number | null = null;
  for (const [idx, v] of votes) {
    if (best === null) {
      best = idx;
      continue;
    }
    const b = votes.get(best)!;
    if (v.count > b.count || (v.count === b.count && v.firstAt < b.firstAt)) best = idx;
  }
  return best;
}

/**
 * La tarjeta de evidencia de una respuesta: la fuente en la que la
 * respuesta servida se basa (preferredIndex, el de servedSourceIndex)
 * o, sin ella, la de mayor rango de la recuperación; su frase que
 * mejor responde y el pasaje que la rodea. null sin fuentes o con la
 * fuente elegida vacía — la tarjeta no finge lo que no hay.
 */
export function buildEvidenceCard(
  chunks: readonly RetrievedChunk[],
  query: string,
  preferredIndex?: number | null,
  opts?: { servedFixedText?: boolean },
): EvidenceCardData | null {
  // 0.1.106 (Defecto B, foto del dueño 07:39): lo servido es un texto
  // fijo de la casa (el texto seguro de salud que sustituye a la
  // respuesta): no tiene fuente principal, y coronar la guía de
  // mayor rango de la recuperación sobre él (la crecida, en la foto)
  // presenta como fuente de ese texto una guía que no responde a la
  // pregunta. Sin tarjeta: la respuesta es de la casa, no de una guía.
  if (opts?.servedFixedText) return null;
  // Auditoría 0.1.79: un apartado de cierre («… — Importante») no es la
  // fuente principal de nada; si va primero, la tarjeta usa la siguiente.
  let index = primarySourceIndex(chunks);
  // La fuente servida manda sobre el rango — salvo que su cuerpo esté
  // vacío, en cuyo caso manda la de siempre (que si también está
  // vacía, no hay tarjeta).
  if (
    preferredIndex != null &&
    preferredIndex >= 0 &&
    preferredIndex < chunks.length &&
    chunks[preferredIndex]?.body?.trim()
  ) {
    index = preferredIndex;
  }
  const top = chunks[index];
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
  return { chunkId: top.chunkId, index, title: top.title, highlight, excerpt, truncated: top.truncated ?? false };
}

/**
 * 0.1.106 (Defecto A, foto del dueño 07:36): la guía que la respuesta
 * de ABSTENCIÓN cita en su extracto, para que el mensaje ofrezca
 * «Abrir la guía completa» igual que una respuesta fundamentada. La
 * abstención marca las frases de su extracto con origen «source» y
 * `replaced: true` sobre la fuente de la que el extracto salió (la
 * marca de T-17: la frase del modelo fue sustituida por la de la
 * fuente). Se devuelve el chunkId de ESA fuente solo si es un
 * fragmento de guía de pack (lo que el lector de guías sabe abrir);
 * en cualquier otro caso — texto seguro (procedencia toda «fixed»),
 * fundamentada sin sustitución, fuente que no es de pack — null:
 * no se ofrece abrir lo que no hay.
 */
export function abstentionGuideChunkId(
  provenance: readonly SentenceProvenance[] | undefined,
  chunks: readonly RetrievedChunk[],
): string | null {
  if (!provenance) return null;
  for (const s of provenance) {
    if (s.origin.kind === "source" && s.origin.replaced === true) {
      const chunk = chunks[s.origin.n - 1];
      return chunk && parsePackChunkId(chunk.chunkId) ? chunk.chunkId : null;
    }
  }
  return null;
}
