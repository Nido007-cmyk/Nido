/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  BGE_SMALL_EN_PROFILE,
  BGE_SMALL_EN_SHA256,
  embeddingProfileForSha,
  isSingleTermQuery,
  MULTILINGUAL_E5_SMALL_PROFILE,
  MULTILINGUAL_E5_SMALL_SHA256,
  semanticFloor,
} from "./embeddingProfile";
import { MIN_SEMANTIC_SIMILARITY, MIN_SEMANTIC_SIMILARITY_SINGLE_TERM } from "./pure";
import { MODEL_CATALOG } from "../models/manifest";

describe("embedding profiles", () => {
  it("bge keeps exactly today's search settings (no behaviour change)", () => {
    expect(BGE_SMALL_EN_PROFILE).toMatchObject({
      queryPrefix: "",
      passagePrefix: "",
      minSimilarity: MIN_SEMANTIC_SIMILARITY,
      minSimilaritySingleTerm: MIN_SEMANTIC_SIMILARITY_SINGLE_TERM,
      margin: 0.4,
    });
  });

  it("e5 uses its required prefixes and its own, higher floors", () => {
    expect(MULTILINGUAL_E5_SMALL_PROFILE.queryPrefix).toBe("query: ");
    expect(MULTILINGUAL_E5_SMALL_PROFILE.passagePrefix).toBe("passage: ");
    expect(MULTILINGUAL_E5_SMALL_PROFILE.minSimilarity).toBeGreaterThan(BGE_SMALL_EN_PROFILE.minSimilarity);
    expect(MULTILINGUAL_E5_SMALL_PROFILE.minSimilaritySingleTerm).toBeGreaterThanOrEqual(
      MULTILINGUAL_E5_SMALL_PROFILE.minSimilarity
    );
    // A big pack needs more evidence than the built-in base.
    expect(MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilarity).toBeGreaterThan(MULTILINGUAL_E5_SMALL_PROFILE.minSimilarity);
    expect(MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilaritySingleTerm).toBeGreaterThan(
      MULTILINGUAL_E5_SMALL_PROFILE.minSimilaritySingleTerm
    );
  });

  it("profiles are keyed by the catalog SHA-256 of each embedding model", () => {
    const shas = MODEL_CATALOG.filter((m) => m.kind === "embedding").map((m) => m.sha256);
    expect(shas).toContain(BGE_SMALL_EN_SHA256);
    expect(shas).toContain(MULTILINGUAL_E5_SMALL_SHA256);
    expect(embeddingProfileForSha(BGE_SMALL_EN_SHA256)).toBe(BGE_SMALL_EN_PROFILE);
    expect(embeddingProfileForSha(MULTILINGUAL_E5_SMALL_SHA256)).toBe(MULTILINGUAL_E5_SMALL_PROFILE);
  });

  it("unknown or missing model → bge settings (what every earlier build used)", () => {
    expect(embeddingProfileForSha("f".repeat(64))).toBe(BGE_SMALL_EN_PROFILE);
    expect(embeddingProfileForSha(null)).toBe(BGE_SMALL_EN_PROFILE);
    expect(embeddingProfileForSha(undefined)).toBe(BGE_SMALL_EN_PROFILE);
  });

  it("single-term rule = one whitespace-separated word, like the calibration", () => {
    expect(isSingleTermQuery("hola")).toBe(true);
    expect(isSingleTermQuery("  fotosíntesis  ")).toBe(true);
    expect(isSingleTermQuery("")).toBe(true);
    expect(isSingleTermQuery("¿qué es la fotosíntesis?")).toBe(false);
    expect(semanticFloor(MULTILINGUAL_E5_SMALL_PROFILE, "hola")).toBe(MULTILINGUAL_E5_SMALL_PROFILE.minSimilaritySingleTerm);
    expect(semanticFloor(MULTILINGUAL_E5_SMALL_PROFILE, "hola qué tal")).toBe(MULTILINGUAL_E5_SMALL_PROFILE.minSimilarity);
  });
});
