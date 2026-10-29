/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.59 — Reads the guide for guideAnswer.ts: retrieval, the whole guide
 * from the pack, and the sources to show (only that guide's parts, so an
 * unrelated section never appears as source 1). Never throws.
 */
import { retrieve } from "./retrieve";
import { readPackSource } from "./packs";
import { guideTitleOf } from "./packSource";
import { ANSWER_CONTEXT_CHUNKS } from "./pure";
import type { RetrievedChunk } from "./retrieve.types";
import type { GroundingLang } from "./grounding";
import { composeGuideAnswer, pickGuideChunk } from "./guideAnswer";

export interface GuideAnswer {
  text: string;
  /** Sources to show: the parts of the guide that matched. */
  chunks: RetrievedChunk[];
}

/**
 * Retrieves once. Returns the guide answer when a NIDO Essentials guide is
 * the clear best match, else null plus the retrieved chunks so the normal
 * path can reuse them instead of searching again.
 */
export async function answerFromGuide(
  query: string,
  lang: GroundingLang,
): Promise<{ answer: GuideAnswer | null; retrieved: RetrievedChunk[] | null }> {
  let retrieved: RetrievedChunk[] | null = null;
  try {
    retrieved = await retrieve(query, ANSWER_CONTEXT_CHUNKS);
    const pick = pickGuideChunk(retrieved, lang);
    if (!pick) return { answer: null, retrieved };
    const doc = await readPackSource(pick.chunkId);
    if (!doc) return { answer: null, retrieved };
    const sameGuide = retrieved.filter((c) => c !== pick && guideTitleOf(c.title) === doc.title);
    return { answer: { text: composeGuideAnswer(doc, lang), chunks: [pick, ...sameGuide] }, retrieved };
  } catch (e) {
    console.warn("[guideAnswer]", e instanceof Error ? e.message : String(e));
    return { answer: null, retrieved };
  }
}
