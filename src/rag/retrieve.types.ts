/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import type { ChunkRecord } from "./db";

/**
 * Which corpus a chunk came from. R-03 (physical round 0.1.68): until now
 * RetrievedChunk carried no provenance — the SQL mappings knew
 * (collection_id, pack file) and discarded it — so the fusion ranker
 * could not prefer the user's own document even in principle. "user" =
 * imported into a personal collection, "builtin" = the bundled/downloaded
 * base corpus, "pack" = a knowledge pack.
 */
export type ChunkSourceKind = "user" | "builtin" | "pack";

export interface RetrievedChunk extends ChunkRecord {
  score: number;
  /**
   * Corpus of origin, filled by every retrieval mapping (retrieve.ts,
   * packs.ts). Optional only so older fixtures keep compiling; a chunk
   * without it is treated as non-user by the fusion's personal-corpus
   * reserve (see fuseRetrievalResults in pure.ts).
   */
  sourceKind?: ChunkSourceKind;
  /**
   * Absolute pre-fusion score where one exists on a bounded scale: the raw
   * cosine similarity for semantic (and hybrid) chunks. Left undefined for
   * lexical-only chunks — BM25 is unbounded, so no honest percentage exists
   * for them. `score` remains the fused RELATIVE rank used for sorting; the
   * UI renders rawScore, never score, so a lone weak match can no longer
   * display a weight-scheme-constant "50%".
   */
  rawScore?: number;
  matchType: "lexical" | "semantic" | "hybrid";
  /**
   * 0.1.87: the v2 pack format's indexed real questions for this
   * section (chunks.keys). The pack search reads them for its
   * coverage gate; the guide pick's lexical path (piece 4) needs
   * them on the chunk itself — a mapped chunk that drops them
   * silently narrows that path to title+body.
   */
  keys?: string;
  /**
   * Adversaria H-07: este fragmento es un RESTO — fitChunksToBudget lo
   * truncó por frases para que el prompt cupiera en la ventana. Sin la
   * marca, el resto viajaba como si fuera la fuente entera: la pantalla
   * lo enseñaba completo (enseñaba otro objeto, en realidad) y el
   * verificador juzgaba contra el cuerpo entero que el modelo nunca
   * vio. Solo lo pone fitChunksToBudget, sobre la copia que devuelve;
   * el fragmento de la recuperación nunca lleva esta marca.
   */
  truncated?: boolean;
}
