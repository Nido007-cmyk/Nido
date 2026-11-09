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
 * Pure; its only dependency is the lexical tokenizer in ./pure (which does
 * not import this module).
 */

import { buildLexicalQuery } from "./pure";

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
   * 0.1.36 «distintividad»: el mejor candidato tiene que destacar sobre el
   * fondo (media de los puestos 10–50 de la misma fuente) al menos esto.
   * e5 puntúa alto TODO (una pregunta sin respuesta saca 0.80–0.87), así
   * que el coseno absoluto no separa; la distancia al fondo sí
   * (docs/design/calibration: sin respuesta p90 0.045, con respuesta p10
   * 0.048). 0 = desactivado. Integrado y paquetes por separado.
   */
  distinctGap: number;
  packDistinctGap: number;
  /**
   * 0.1.87: la vara de la vía literal (guideAnswer.ts) para packs que
   * entran por la puerta firmada, POR PERFIL. Hasta la 0.1.86 la vía
   * juzgaba toda guía con una constante (0,8) medida solo con guías
   * del Esencial en la era de un solo modelo; el dirimen del turno
   * del gas (2026-11-09) midió que la guía correcta de un pack
   * importado compite en otra banda y la perdió. El método de
   * medida de estos valores es el de los pisos ya calibrados del
   * propio perfil: la vara es el piso semántico de packs del perfil
   * (`packMinSimilarity`, la calibración CI de la casa sobre el
   * corpus real), porque una guía que la recuperación de packs no
   * consideraría evidencia tampoco puede ser la respuesta literal, y
   * una que sí lo es no debe perder contra una vara heredada de otro
   * corpus. La medición fina con pares reales pregunta→guía de
   * packs importados (el instrumento de la casa corre sobre el
   * corpus integrado, no sobre packs importados) queda pendiente de
   * aparato y nombrada en el checkpoint del paquete: estos valores
   * son la transmisión del piso medido, no una cifra a ojo.
   */
  guideMinScore: number;
  guideMinScoreSingleTerm: number;
  /**
   * Cuánto puede quedar el mejor fragmento literal por debajo del
   * mejor fragmento global y seguir sirviéndose (0.1.87): la guía se
   * juzga contra su vara, no contra el mejor de otro corpus, pero un
   * literal muy por debajo del mejor global sigue vetado — la
   * distancia declara que la pregunta casa con otra cosa. 0,15 es la
   * banda en la que el campo real del dirimen se mueve (el mejor
   * global del turno del gas y el fragmento correcto distaban
   * ~0,06); se mide de nuevo con los pares de aparato.
   */
  guidePickMargin: number;
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
  // 0.1.87: transmitidos del piso medido de packs de este perfil
  // (packMinSimilarity 0,6 / single-term 0,7); ver el comentario del
  // campo en la interfaz.
  guideMinScore: 0.6,
  guideMinScoreSingleTerm: 0.7,
  guidePickMargin: 0.15,
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
  // Con el paquete Vital (unos 50 000 artículos, 116 000 fragmentos, mismo run) 0.03 baja los falsos
  // 33 % → 22 % sin perder recall (en sube 90 % → 100 %); 0.04 ya pierde.
  distinctGap: 0.03,
  packDistinctGap: 0.03,
  // 0.1.87: transmitidos del piso medido de packs de este perfil
  // (packMinSimilarity 0,84 / single-term 0,88): en la escala de e5
  // una guía a 0,76 es fondo, no evidencia (ver el comentario del
  // campo en la interfaz).
  guideMinScore: 0.84,
  guideMinScoreSingleTerm: 0.88,
  guidePickMargin: 0.15,
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

/**
 * Weak-query rule: at most one CONTENT term.
 *
 * R-03 (physical round 0.1.68): this used to count raw whitespace-separated
 * words — the calibration's shorthand — so "¿En qué sala?" counted as a
 * 3-word query and the reinforced single-term floors never applied, even
 * though the question carries exactly one content term (`sala`) and the
 * semantic gate is precisely what must be strictest there. The count now
 * comes from buildLexicalQuery (stopwords and question framing removed,
 * the same terms the lexical gate uses). The calibration's intent is
 * unchanged — a weak query needs stronger evidence — only its measure
 * stopped counting "¿", "en" and "qué" as signal.
 */
export function isSingleTermQuery(query: string): boolean {
  return (buildLexicalQuery(query)?.terms.length ?? 0) <= 1;
}

export function semanticFloor(profile: EmbeddingProfile, query: string): number {
  return isSingleTermQuery(query) ? profile.minSimilaritySingleTerm : profile.minSimilarity;
}

/** Floor for a downloaded pack's full vector search. */
export function packSemanticFloor(profile: EmbeddingProfile, query: string): number {
  return isSingleTermQuery(query) ? profile.packMinSimilaritySingleTerm : profile.packMinSimilarity;
}

/**
 * 0.1.87: the literal route's bar for the active profile — the same
 * single-term discipline as the pack floors (a weak query needs
 * stronger evidence before a guide is served word for word).
 */
export function guideMinScore(profile: EmbeddingProfile, query: string): number {
  return isSingleTermQuery(query) ? profile.guideMinScoreSingleTerm : profile.guideMinScore;
}
