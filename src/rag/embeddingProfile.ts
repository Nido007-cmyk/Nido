/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Per-model settings of the semantic search (docs/design/BUSQUEDA_MULTILINGUE.md).
 *
 * Each embedding model has its own similarity scale: with bge-small-en an
 * unrelated text scores ~0.5, with multilingual-e5-small ~0.8. One global
 * floor cannot serve both, so the floors live with the model, keyed by the
 * catalog SHA-256 of its GGUF (the same identity the knowledge base is
 * stamped with). E5 also needs "query: " / "passage: " prefixes; mixing them
 * up makes retrieval worse than using none.
 *
 * Values for e5 come from scripts/multilingual (CI calibration over the
 * built-in corpus + Wikipedia Vital, report in docs/design/calibration/),
 * chosen so the share of unanswerable questions that still pull in
 * "sources" is not higher than with bge today.
 *
 * Pure, no dependencies.
 */

export interface EmbeddingProfile {
  id: "bge-small-en" | "multilingual-e5-small";
  /** Prepended to questions before embedding. */
  queryPrefix: string;
  /** Prepended to stored texts (articles, documents) before embedding. */
  passagePrefix: string;
  /** Cosine floor for questions of two or more words. */
  minSimilarity: number;
  /** Cosine floor for one-word questions ("hola" must not match a village). */
  minSimilaritySingleTerm: number;
  /** pruneByScoreMargin margin (fraction of the passing range). */
  margin: number;
}

export const BGE_SMALL_EN_SHA256 = "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514";
export const MULTILINGUAL_E5_SMALL_SHA256 = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";

/** Today's behaviour, unchanged (src/rag/pure.ts constants). */
export const BGE_SMALL_EN_PROFILE: EmbeddingProfile = {
  id: "bge-small-en",
  queryPrefix: "",
  passagePrefix: "",
  minSimilarity: 0.6,
  minSimilaritySingleTerm: 0.7,
  margin: 0.4,
};

export const MULTILINGUAL_E5_SMALL_PROFILE: EmbeddingProfile = {
  id: "multilingual-e5-small",
  queryPrefix: "query: ",
  passagePrefix: "passage: ",
  minSimilarity: 0.81,
  minSimilaritySingleTerm: 0.87,
  margin: 0.4,
};

const BY_SHA: Record<string, EmbeddingProfile> = {
  [BGE_SMALL_EN_SHA256]: BGE_SMALL_EN_PROFILE,
  [MULTILINGUAL_E5_SMALL_SHA256]: MULTILINGUAL_E5_SMALL_PROFILE,
};

/**
 * Profile for a catalog embedding model. Unknown models get bge's settings,
 * which is what every build before multilingual search used.
 */
export function embeddingProfileForSha(sha256: string | null | undefined): EmbeddingProfile {
  return (sha256 && BY_SHA[sha256]) || BGE_SMALL_EN_PROFILE;
}

/** Same rule as the calibration: one word (whitespace-separated) or less. */
export function isSingleTermQuery(query: string): boolean {
  return query.trim().split(/\s+/).filter(Boolean).length <= 1;
}

export function semanticFloor(profile: EmbeddingProfile, query: string): number {
  return isSingleTermQuery(query) ? profile.minSimilaritySingleTerm : profile.minSimilarity;
}
