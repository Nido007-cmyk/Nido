/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.87 — the guide pick's candidate list. It lives apart from
 * guideAnswerRun.ts on purpose: importing that module drags the
 * retrieval engine (llama.rn via embed.ts) into any test that only
 * wants the pick's pure helpers, and vitest's transform of that
 * chain fails in this environment (SyntaxError: Unexpected token
 * 'typeof' from an untransformed dependency build). Pure; its only
 * dependency is the chunk type.
 */
import type { RetrievedChunk } from "./retrieve.types";

/**
 * How many chunks the guide PICK looks at, against the
 * ANSWER_CONTEXT_CHUNKS (4) the model's prompt receives. The
 * dirimen of the gas turn (2026-11-09) measured that the fusion's
 * cut to 4 could veto a guide retrieval had in fact found (the
 * guide landed at rank 5 or 6, behind its own cluster and the
 * Essentials field): picking looks wider than the prompt context,
 * without giving the model more context. The second retrieval only
 * runs when the first picked nothing, and the `retrieved` the
 * normal path reuses stays the prompt list, untouched.
 */
export const GUIDE_PICK_CHUNKS = 10;

/**
 * The pick's candidates: the prompt list first (its order wins
 * ties), then the rest of the wide list, deduplicated.
 */
export function buildGuidePickCandidates(promptChunks: RetrievedChunk[], wideChunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set(promptChunks.map((c) => c.chunkId));
  return [...promptChunks, ...wideChunks.filter((c) => !seen.has(c.chunkId))];
}
