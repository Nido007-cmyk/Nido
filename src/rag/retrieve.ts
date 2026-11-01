/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { getDb } from "./db";
import { embeddingEngine } from "./embed";
import {
  buildLexicalQuery,
  cosineSimilarity,
  distinctFloor,
  filterByMinScore,
  filterByTermCoverage,
  fuseRetrievalResults,
  pruneSemanticByMargin,
} from "./pure";
import { BGE_SMALL_EN_PROFILE, embeddingProfileForSha, semanticFloor, type EmbeddingProfile } from "./embeddingProfile";
import type { RetrievedChunk } from "./retrieve.types";
import { searchPacks } from "./packs";
import { dedupeArticleCopies } from "./dedupe";

export type { RetrievedChunk } from "./retrieve.types";

// Extra BM25 candidates fetched so the term-coverage gate has something to
// choose from; the result is still capped at `limit`.
const LEXICAL_CANDIDATE_MULTIPLIER = 4;

/**
 * BM25-ranked FTS5 lexical search over the local knowledge base. The query
 * is reduced to its content words, OR-ed (buildLexicalQuery), and hits
 * must cover enough of those words to count (filterByTermCoverage). That
 * coverage rule is this search's relevance gate. No numeric bm25 floor is
 * applied: bm25's scale depends on the corpus and query.
 */
async function lexicalSearch(query: string, limit: number): Promise<RetrievedChunk[]> {
  const lexicalQuery = buildLexicalQuery(query);
  if (!lexicalQuery) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<{
    chunk_id: string;
    doc_id: string;
    title: string;
    body: string;
    collection_id: string | null;
    rank: number;
  }>(
    `SELECT f.chunk_id, f.doc_id, f.title, f.body, c.collection_id, bm25(chunks_fts) AS rank
     FROM chunks_fts f
     JOIN chunks c ON c.chunk_id = f.chunk_id
     LEFT JOIN custom_collections cc ON cc.id = c.collection_id
     WHERE chunks_fts MATCH ? AND (c.collection_id IS NULL OR cc.active = 1)
     ORDER BY rank LIMIT ?`,
    [lexicalQuery.match, limit * LEXICAL_CANDIDATE_MULTIPLIER]
  );
  return filterByTermCoverage(rows, lexicalQuery.terms).slice(0, limit).map((r) => ({
    chunkId: r.chunk_id,
    docId: r.doc_id,
    title: r.title,
    body: r.body,
    // R-03: provenance for the fusion's personal-corpus reserve.
    sourceKind: r.collection_id ? ("user" as const) : ("builtin" as const),
    score: -r.rank, // bm25() returns lower-is-better; invert for consistent "higher is better"
    matchType: "lexical" as const,
  }));
}

/** Brute-force cosine search over stored embeddings; fine at knowledge-base scale on-device. */
async function semanticSearch(
  query: string,
  queryVec: Float32Array,
  limit: number,
  profile: EmbeddingProfile
): Promise<RetrievedChunk[]> {
  const db = await getDb();

  const rows = await db.getAllAsync<{
    chunk_id: string;
    doc_id: string;
    title: string;
    body: string;
    collection_id: string | null;
    embedding: Uint8Array;
  }>(
    `SELECT c.chunk_id, c.doc_id, c.title, c.body, c.collection_id, e.embedding
     FROM chunk_embeddings e
     JOIN chunks c ON c.chunk_id = e.chunk_id
     LEFT JOIN custom_collections cc ON cc.id = c.collection_id
     WHERE c.collection_id IS NULL OR cc.active = 1`
  );

  const scored = rows.map((r) => {
    const vec = new Float32Array(
      r.embedding.buffer,
      r.embedding.byteOffset,
      r.embedding.byteLength / 4
    );
    return {
      chunkId: r.chunk_id,
      docId: r.doc_id,
      title: r.title,
      body: r.body,
      // R-03: provenance for the fusion's personal-corpus reserve.
      sourceKind: r.collection_id ? ("user" as const) : ("builtin" as const),
      score: cosineSimilarity(queryVec, vec),
      matchType: "semantic" as const,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  // H1-2026-10-06: umbral más alto para queries de un solo término.
  // 0.2.0: los umbrales son del modelo cargado (embeddingProfile.ts); para
  // bge son los mismos de siempre (0.60 / 0.70, margen 0.4).
  // 0.1.36: además del piso absoluto, el mejor tiene que destacar sobre el
  // fondo (distintividad; 0 en bge = sin cambio).
  const floor = distinctFloor(
    semanticFloor(profile, query),
    scored.map((s) => s.score),
    profile.distinctGap
  );
  const gated = filterByMinScore(scored, floor);
  // BUG-2-2026-10-06 (structural): poda por margen sobre cosenos crudos.
  // El gap predice relevancia mejor que el valor absoluto.
  return pruneSemanticByMargin(gated, profile.margin).slice(0, limit);
}

/**
 * Hybrid retrieval: union lexical (BM25, exact-phrase-gated) + semantic
 * (cosine, MIN_SEMANTIC_SIMILARITY-gated) results, re-ranked by a simple
 * weighted-sum fusion (fuseRetrievalResults, src/rag/pure.ts - extracted
 * there so the fusion/threshold mechanics are unit-testable without a real
 * device; see retrieve.relevance.test.ts). No network calls. If neither
 * source has anything relevant, this returns [] - never a forced top-K of
 * whatever happened to be least-irrelevant.
 */
export async function retrieve(query: string, topK = 6): Promise<RetrievedChunk[]> {
  // F4-2026-10-06: degradación graceful a FTS-only cuando el JSI de
  // embedding no está disponible. seedCorpus ya soporta indexar sin
  // embeddings; retrieve() no debe fallar en duro en ese mismo build.
  let queryVec: Float32Array | null = null;
  let profile: EmbeddingProfile = BGE_SMALL_EN_PROFILE;
  let modelSha256: string | null = null;
  try {
    const tagged = await embeddingEngine.embedQueryTagged(query);
    queryVec = tagged.vector;
    modelSha256 = tagged.modelSha256;
    profile = embeddingProfileForSha(modelSha256);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/native embedding unavailable/i.test(msg)) throw err;
    // Sin embeddings: solo búsqueda léxica (built-in + packs).
  }
  const [lexical, semantic, packs] = await Promise.all([
    lexicalSearch(query, topK * 2),
    queryVec ? semanticSearch(query, queryVec, topK * 2, profile) : [],
    // Downloaded knowledge packs (src/rag/packs.ts); a failing pack is skipped, never fatal.
    searchPacks(query, queryVec, topK * 2, { profile, modelSha256 }).catch(() => ({ lexical: [], semantic: [] })),
  ]);

  const fused = fuseRetrievalResults(
    [...lexical, ...packs.lexical],
    [...semantic, ...packs.semantic],
    topK,
    undefined,
    profile.minSimilarity
  );
  // Dedupe cross-library copies (upstream item 20): same article in multiple
  // sources should appear once, not waste context.
  return dedupeArticleCopies(fused);
}

export { assemblePrompt } from "./pure";
export type { ConversationTurn, ConversationHistory } from "./pure";
