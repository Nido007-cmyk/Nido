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
  cosineSimilarityInt8,
  distinctFloor,
  dropUnfoundedCorpus,
  filterByMinScore,
  filterByTermCoverage,
  fuseRetrievalResults,
  normalizeCorpusScores,
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
  // C-05: presence signals over the gate's output — if this corpus does
  // not contain the topic (or the datum type asked for), it serves
  // nothing, so the honest no-source fall downstream can be reached
  // instead of a plausible neighbour being cited. Signal B exempts the
  // user's own documents: they can carry the datum without naming it.
  const gated = filterByTermCoverage(rows, lexicalQuery.terms);
  const founded = dropUnfoundedCorpus(rows, gated, lexicalQuery.terms, {
    query,
    servedFromUser: gated.map((r) => r.collection_id !== null),
  });
  // C-02: this index is ONE corpus — normalize its BM25 scores against
  // its own distribution (z-score + sigmoid) before the list is merged
  // with the packs' lists, whose raw BM25 scales are not comparable.
  return normalizeCorpusScores(
    founded.slice(0, limit).map((r) => ({
      chunkId: r.chunk_id,
      docId: r.doc_id,
      title: r.title,
      body: r.body,
      // R-03: provenance for the fusion's personal-corpus reserve.
      sourceKind: r.collection_id ? ("user" as const) : ("builtin" as const),
      score: -r.rank, // bm25() returns lower-is-better; invert for consistent "higher is better"
      matchType: "lexical" as const,
    }))
  );
}

/**
 * Brute-force cosine search over stored embeddings; fine at knowledge-base
 * scale on-device.
 *
 * P-01 paso 1: el formato almacenado se autodescribe por la longitud de la
 * fila — `dim * 4` bytes = float32, `dim` bytes = int8 — y cada fila se
 * decodifica con su precisión. La base mixta (migración a medias) es un
 * estado válido y permanente, no un error: el lector sirve igual sobre
 * ella. La consulta queda siempre en float32; en el brazo int8 la escala
 * por vector se cancela en el coseno (cosineSimilarityInt8).
 */
async function semanticSearch(
  query: string,
  queryVec: Float32Array,
  limit: number,
  profile: EmbeddingProfile
): Promise<RetrievedChunk[]> {
  const db = await getDb();

  // P-01 paso 1 (cuerpos desacoplados): la pasada de puntuación NO trae
  // title/body — arrastrar el texto de cada fila para puntuar vectores
  // multiplicaba el coste de cruzar el puente por consulta. Se puntúa
  // sobre (chunk_id, doc_id, collection_id, embedding) y el texto de los
  // supervivientes se hidrata después, por chunk_id.
  const rows = await db.getAllAsync<{
    chunk_id: string;
    doc_id: string;
    collection_id: string | null;
    embedding: Uint8Array;
  }>(
    `SELECT e.chunk_id, c.doc_id, c.collection_id, e.embedding
     FROM chunk_embeddings e
     JOIN chunks c ON c.chunk_id = e.chunk_id
     LEFT JOIN custom_collections cc ON cc.id = c.collection_id
     WHERE c.collection_id IS NULL OR cc.active = 1`
  );

  const dim = queryVec.length;
  const scored: Array<{
    chunkId: string;
    docId: string;
    sourceKind: "user" | "builtin";
    score: number;
    matchType: "semantic";
  }> = [];
  for (const r of rows) {
    const len = r.embedding.byteLength;
    let score: number;
    if (len === dim * 4) {
      const vec = new Float32Array(r.embedding.buffer, r.embedding.byteOffset, dim);
      score = cosineSimilarity(queryVec, vec);
    } else if (len === dim) {
      score = cosineSimilarityInt8(queryVec, r.embedding);
    } else {
      // Ni float32 ni int8 para la dimensión vigente: la fila está
      // corrupta. Se excluye con aviso — jamás un coseno calculado sobre
      // una longitud equivocada, que puntuaría basura en silencio.
      console.warn(
        `[rag] vector excluido: chunk ${r.chunk_id} trae ${len} B; se esperaban ${dim * 4} B (float32) o ${dim} B (int8).`
      );
      continue;
    }
    scored.push({
      chunkId: r.chunk_id,
      docId: r.doc_id,
      // R-03: provenance for the fusion's personal-corpus reserve.
      sourceKind: r.collection_id ? ("user" as const) : ("builtin" as const),
      score,
      matchType: "semantic" as const,
    });
  }

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
  // El gap predice relevancia mejor que el valor absoluto. La poda y el
  // corte trabajan sobre puntuaciones: la lógica no cambia por no
  // arrastrar el texto.
  const survivors = pruneSemanticByMargin(gated, profile.margin).slice(0, limit);
  if (survivors.length === 0) return [];
  // Hidratación: solo los supervivientes cruzan con su texto.
  const ids = survivors.map((s) => s.chunkId);
  const textRows = await db.getAllAsync<{ chunk_id: string; title: string | null; body: string }>(
    `SELECT chunk_id, title, body FROM chunks WHERE chunk_id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  const textById = new Map(textRows.map((t) => [t.chunk_id, t]));
  return survivors.map((s) => ({
    ...s,
    title: textById.get(s.chunkId)?.title ?? "",
    body: textById.get(s.chunkId)?.body ?? "",
  }));
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
    // Optimización 2026-11-08 (fase 4): «model not loaded» también
    // degrada a léxico — con la residencia bajo demanda puede pasar
    // si la recarga no fue posible (sin proveedor y sin memoria de
    // la sesión); la búsqueda no debe romperse por ello.
    if (!/native embedding unavailable/i.test(msg) && !/model not loaded/i.test(msg)) throw err;
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
