import type { ChunkRecord } from "./db";

export interface RetrievedChunk extends ChunkRecord {
  score: number;
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
}
