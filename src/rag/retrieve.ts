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
  filterByMinScore,
  filterByTermCoverage,
  fuseRetrievalResults,
  MIN_SEMANTIC_SIMILARITY,
  MIN_SEMANTIC_SIMILARITY_SINGLE_TERM,
  pruneSemanticByMargin,
} from "./pure";
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
    rank: number;
  }>(
    `SELECT f.chunk_id, f.doc_id, f.title, f.body, bm25(chunks_fts) AS rank
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
    score: -r.rank, // bm25() returns lower-is-better; invert for consistent "higher is better"
    matchType: "lexical" as const,
  }));
}

/** Brute-force cosine search over stored embeddings; fine at knowledge-base scale on-device. */
async function semanticSearch(query: string, queryVec: Float32Array, limit: number): Promise<RetrievedChunk[]> {
  const db = await getDb();

  const rows = await db.getAllAsync<{
    chunk_id: string;
    doc_id: string;
    title: string;
    body: string;
    embedding: Uint8Array;
  }>(
    `SELECT c.chunk_id, c.doc_id, c.title, c.body, e.embedding
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
      score: cosineSimilarity(queryVec, vec),
      matchType: "semantic" as const,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  // H1-2026-10-06: umbral más alto para queries de un solo término.
  const termCount = query.trim().split(/\s+/).filter(Boolean).length;
  const threshold = termCount <= 1 ? MIN_SEMANTIC_SIMILARITY_SINGLE_TERM : MIN_SEMANTIC_SIMILARITY;
  const gated = filterByMinScore(scored, threshold);
  // BUG-2-2026-10-06 (structural): poda por margen sobre cosenos crudos.
  // El gap predice relevancia mejor que el valor absoluto.
  return pruneSemanticByMargin(gated).slice(0, limit);
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
  try {
    queryVec = await embeddingEngine.embed(query);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/native embedding unavailable/i.test(msg)) throw err;
    // Sin embeddings: solo búsqueda léxica (built-in + packs).
  }
  const [lexical, semantic, packs] = await Promise.all([
    lexicalSearch(query, topK * 2),
    queryVec ? semanticSearch(query, queryVec, topK * 2) : [],
    // Downloaded knowledge packs (src/rag/packs.ts); a failing pack is skipped, never fatal.
    searchPacks(query, queryVec, topK * 2).catch(() => ({ lexical: [], semantic: [] })),
  ]);

  const fused = fuseRetrievalResults(
    [...lexical, ...packs.lexical],
    [...semantic, ...packs.semantic],
    topK
  );
  // Dedupe cross-library copies (upstream item 20): same article in multiple
  // sources should appear once, not waste context.
  return dedupeArticleCopies(fused);
}

export { assemblePrompt } from "./pure";
export type { ConversationTurn, ConversationHistory } from "./pure";
