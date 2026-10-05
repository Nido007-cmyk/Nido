import { describe, it, expect } from "vitest";
import {
  MODEL_CATALOG,
  REQUIRED_MODELS,
  CORPUS_CATALOG,
  TIERS,
  STORAGE_BUDGET_BYTES,
  totalManifestBytes,
} from "./manifest";

describe("totalManifestBytes", () => {
  it("sums asset sizes", () => {
    expect(totalManifestBytes(MODEL_CATALOG)).toBe(
      MODEL_CATALOG.reduce((sum, a) => sum + a.sizeBytes, 0)
    );
  });

  it("stays within the 50GB storage budget even if every catalog model were installed", () => {
    expect(totalManifestBytes(MODEL_CATALOG)).toBeLessThanOrEqual(STORAGE_BUDGET_BYTES);
  });
});

describe("REQUIRED_MODELS", () => {
  it("is one small llm (Qwen2.5-1.5B) and one embedding model, so first-run setup is ~1GB", () => {
    // One required LLM keeps the first download short; adaptive routing falls
    // back to it for every role until the user adds more models.
    expect(REQUIRED_MODELS.filter((m) => m.kind === "llm").map((m) => m.id)).toEqual(["qwen2.5-1.5b-instruct-q4km"]);
    expect(REQUIRED_MODELS.filter((m) => m.kind === "embedding")).toHaveLength(1);
    expect(REQUIRED_MODELS.reduce((sum, m) => sum + m.sizeBytes, 0)).toBeLessThan(1.1 * 1024 ** 3);
  });

  it("every required model has a non-empty checksum and filename", () => {
    for (const m of REQUIRED_MODELS) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.filename.length).toBeGreaterThan(0);
    }
  });
});

describe("MODEL_CATALOG", () => {
  it("has unique ids and filenames", () => {
    const ids = MODEL_CATALOG.map((m) => m.id);
    const filenames = MODEL_CATALOG.map((m) => m.filename);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(filenames).size).toBe(filenames.length);
  });

  it("every catalog entry has a non-empty checksum, size, and source URL", () => {
    for (const m of MODEL_CATALOG) {
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.sizeBytes).toBeGreaterThan(0);
      expect(m.sourceUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("TIERS", () => {
  const corpusIds = new Set(CORPUS_CATALOG.map((c) => c.id));

  it("every tier's corpusPackIds reference a real corpus catalog entry", () => {
    for (const tier of TIERS) {
      for (const id of tier.corpusPackIds) {
        expect(corpusIds.has(id)).toBe(true);
      }
    }
  });

  it("higher tiers are supersets of lower tiers' corpus packs (minimum -> standard -> full -> encyclopedia)", () => {
    const byId = Object.fromEntries(TIERS.map((t) => [t.id, new Set(t.corpusPackIds)]));
    for (const id of byId.minimum) expect(byId.standard.has(id)).toBe(true);
    for (const id of byId.standard) expect(byId.full.has(id)).toBe(true);
    for (const id of byId.full) expect(byId.encyclopedia.has(id)).toBe(true);
  });
});
