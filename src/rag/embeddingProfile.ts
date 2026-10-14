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
  /**
   * Floors for downloaded knowledge packs (full vector search). A pack such
   * as Wikipedia Vital has ~116k chunks: with that many candidates something
   * is always fairly close, so a pack needs more evidence than the built-in
   * base (calibration: false "sources" 72% → 25% for es/pt at 0.84).
   */
  packMinSimilarity: number;
  packMinSimilaritySingleTerm: number;
  /** pruneByScoreMargin margin (fraction of the passing range). */
  margin: number;
  /**
   * 0.1.35 «distintividad»: el mejor candidato tiene que destacar sobre el
   * fondo (media de los puestos 10–50 de la misma fuente) al menos esto.
   * e5 puntúa alto TODO (una pregunta sin respuesta saca 0.80–0.87), así
   * que el coseno absoluto no separa; la distancia al fondo sí
   * (docs/design/calibration: sin respuesta p90 0.045, con respuesta p10
   * 0.048). 0 = desactivado. Integrado y paquetes por separado.
   */
  distinctGap: number;
  packDistinctGap: number;
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
  // bge searches packs keyword-first, as before (src/rag/packs.ts); these
  // equal its built-in floors and are only used by that unchanged path.
  packMinSimilarity: 0.6,
  packMinSimilaritySingleTerm: 0.7,
  margin: 0.4,
  // bge no se recalibró con esta medida: sin cambios.
  distinctGap: 0,
  packDistinctGap: 0,
};

export const MULTILINGUAL_E5_SMALL_PROFILE: EmbeddingProfile = {
  id: "multilingual-e5-small",
  queryPrefix: "query: ",
  passagePrefix: "passage: ",
  // Calibration (docs/design/calibration/): built-in base es 50→85%,
  // pt 48→90% of questions answered from the right article, false
  // "sources" for es/pt 0–10%.
  minSimilarity: 0.81,
  minSimilaritySingleTerm: 0.87,
  packMinSimilarity: 0.84,
  packMinSimilaritySingleTerm: 0.88,
  margin: 0.4,
  // Calibración 2026-10-14 (run 38506218056, base integrada): con 0.03 los
  // falsos bajan 20 % → 10 % sin perder ninguna respuesta (es 85 %, en
  // 100 %, pt 90 %); con 0.05 bajan a 3 % perdiendo algo de recall.
  distinctGap: 0.03,
  packDistinctGap: 0.03,
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
  const profile = sha256 ? BY_SHA[sha256] : undefined;
  if (sha256 && !profile) {
    // Only catalog models can be loaded, so this means a catalog model was
    // added without a profile: say so instead of failing silently.
    console.warn(`[embeddingProfile] no profile for model ${sha256.slice(0, 12)}…; using bge-small-en settings`);
  }
  return profile ?? BGE_SMALL_EN_PROFILE;
}

/** Same rule as the calibration: one word (whitespace-separated) or less. */
export function isSingleTermQuery(query: string): boolean {
  return query.trim().split(/\s+/).filter(Boolean).length <= 1;
}

export function semanticFloor(profile: EmbeddingProfile, query: string): number {
  return isSingleTermQuery(query) ? profile.minSimilaritySingleTerm : profile.minSimilarity;
}

/** Floor for a downloaded pack's full vector search. */
export function packSemanticFloor(profile: EmbeddingProfile, query: string): number {
  return isSingleTermQuery(query) ? profile.packMinSimilaritySingleTerm : profile.packMinSimilarity;
}
