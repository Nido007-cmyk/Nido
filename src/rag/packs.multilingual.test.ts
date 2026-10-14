/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Pack search with the multilingual model: full vector search through the
 * native index (a Spanish question has no keywords in common with an English
 * article), keyword-only for a pack made with another model, and the
 * original keyword-first path untouched for bge.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: number; title: string; body: string; vec: Uint8Array };
type World = {
  installed: { filename: string; size: number };
  meta: Record<string, string>;
  rows: Row[];
  ftsHits: number[];
  indexReady: boolean;
  searchCalls: Array<{ floor: number; limit: number }>;
  hits: { ids: number[]; scores: number[]; gatedCount: number; gatedMin: number | null };
  /** 0.1.36: lo que devuelve la búsqueda sin piso (fondo para la distintividad). */
  topHits?: { ids: number[]; scores: number[]; gatedCount: number; gatedMin: number | null };
};
const W = (): World => (globalThis as unknown as { __pkW: World }).__pkW;
(globalThis as unknown as { __pkW: World }).__pkW = {} as World;

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async (uri: string) => {
    const i = (globalThis as unknown as { __pkW: World }).__pkW.installed;
    return uri.endsWith(i.filename) ? { exists: true, size: i.size } : { exists: false };
  },
  readDirectoryAsync: async () => [],
}));
vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: async () => ({
    getAllAsync: async (sql: string, params: unknown[] = []) => {
      const w = W();
      if (/FROM meta/.test(sql)) return Object.entries(w.meta).map(([key, value]) => ({ key, value }));
      if (/chunks_fts MATCH/.test(sql))
        return w.ftsHits.map((id, i) => ({ ...w.rows.find((r) => r.id === id)!, rank: -10 + i }));
      if (/WHERE id IN/.test(sql)) return w.rows.filter((r) => (params as number[]).includes(r.id));
      throw new Error(`unexpected SQL ${sql}`);
    },
    closeAsync: async () => {},
  }),
}));
vi.mock("./vectorIndex", () => ({
  releaseAllIndexes: () => {},
  packIndexIfReady: async () => (W().indexReady ? "file:///docs/corpus/wiki-vital5-e5.x.nvi" : null),
  searchPackIndex: async (_uri: string, _q: Float32Array, floor: number, limit: number) => {
    W().searchCalls.push({ floor, limit });
    return floor < 0 ? W().topHits ?? W().hits : W().hits;
  },
}));

let packs: typeof import("./packs");
let profiles: typeof import("./embeddingProfile");
let catalog: typeof import("../models/manifest");
beforeAll(async () => {
  packs = await import("./packs");
  profiles = await import("./embeddingProfile");
  catalog = await import("../models/manifest");
});

const v = (...xs: number[]) => new Uint8Array(new Int8Array(xs).buffer);

beforeEach(async () => {
  const vital = catalog.CORPUS_CATALOG.find((c) => c.id === "wiki-vital5")!;
  Object.assign(W(), {
    installed: { filename: vital.filename, size: vital.sizeBytes },
    // Test vectors are 2-dimensional; real packs declare 384.
    meta: { format: "nido-knowledge-pack", dims: "2", embeddingModelSha256: "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde" },
    rows: [
      { id: 1, title: "Photosynthesis", body: "Plants…", vec: v(10, 0) },
      { id: 2, title: "Black hole", body: "Gravity…", vec: v(0, 10) },
      { id: 3, title: "Inflation", body: "Prices…", vec: v(7, 7) },
    ],
    ftsHits: [],
    indexReady: true,
    searchCalls: [],
    hits: { ids: [1, 3], scores: [0.93, 0.9], gatedCount: 40, gatedMin: 0.81 },
    topHits: undefined,
  });
  await packs.closeAllPacks();
});

const e5Opts = () => ({ profile: profiles.MULTILINGUAL_E5_SMALL_PROFILE, modelSha256: profiles.MULTILINGUAL_E5_SMALL_SHA256 });

describe("searchPacks — multilingual (full vector search)", () => {
  it("finds English articles for a Spanish question with no shared keywords", async () => {
    const r = await packs.searchPacks("¿cómo hacen las plantas su comida?", new Float32Array([1, 0]), 12, e5Opts());
    expect(r.lexical).toEqual([]);
    // Range 0.93-0.81 → cutoff 0.93 - 0.4*0.12 = 0.882: both hits stay.
    expect(r.semantic.map((c) => c.title)).toEqual(["Photosynthesis", "Inflation"]);
    expect(r.semantic.map((c) => c.score)).toEqual([0.93, 0.9]);
    expect(r.semantic[0].chunkId).toBe("pack:wiki-vital5:1");
  });

  it("uses e5's (higher) pack floor and the app's per-source limit", async () => {
    await packs.searchPacks("¿qué es la inflación?", new Float32Array([1, 0]), 12, e5Opts());
    // 0.1.36: primero el fondo (sin piso, 50), luego la búsqueda real.
    expect(W().searchCalls).toEqual([
      { floor: -1, limit: 51 },
      { floor: profiles.MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilarity, limit: 12 },
    ]);
    await packs.searchPacks("inflación", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls[3].floor).toBe(profiles.MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilaritySingleTerm);
  });

  it("a question made only of stopwords still gets the vector search", async () => {
    const r = await packs.searchPacks("¿qué es?", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls.filter((c) => c.floor >= 0)).toHaveLength(1);
    expect(r.semantic.length).toBeGreaterThan(0);
  });

  it("0.1.36 distintividad: si nada destaca del fondo, el piso sube y no hay fuentes falsas", async () => {
    // Pregunta sin respuesta: los 50 mejores son todos parecidos (0.86–0.85).
    const flat = Array.from({ length: 51 }, (_, i) => 0.86 - i * 0.0002);
    W().topHits = { ids: flat.map((_, i) => i + 1), scores: flat, gatedCount: 51, gatedMin: flat[50] };
    await packs.searchPacks("¿dónde dejé las llaves del coche?", new Float32Array([1, 0]), 12, e5Opts());
    const real = W().searchCalls[1];
    expect(real.floor).toBeGreaterThan(0.86); // fondo ≈ 0.853 + 0.03
  });

  it("0.1.36 distintividad: si el mejor destaca, sigue pasando", async () => {
    const peaked = [0.93, 0.91, ...Array.from({ length: 49 }, (_, i) => 0.84 - i * 0.0005)];
    W().topHits = { ids: peaked.map((_, i) => i + 1), scores: peaked, gatedCount: 51, gatedMin: peaked[50] };
    await packs.searchPacks("¿qué es la inflación?", new Float32Array([1, 0]), 12, e5Opts());
    // El piso sube con el fondo (≈0.826 + 0.03) pero el mejor (0.93) pasa de sobra.
    expect(W().searchCalls[1].floor).toBeLessThan(0.93);
    expect(W().searchCalls[1].floor).toBeGreaterThanOrEqual(profiles.MULTILINGUAL_E5_SMALL_PROFILE.packMinSimilarity);
  });

  it("index not built yet → keyword-first fallback for this question (no wait)", async () => {
    W().indexReady = false;
    W().ftsHits = [1];
    const r = await packs.searchPacks("photosynthesis plants", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls).toHaveLength(0);
    expect(r.lexical.map((c) => c.title)).toEqual(["Photosynthesis"]);
    expect(r.semantic.map((c) => c.title)).toEqual(["Photosynthesis"]); // cosine 1.0 ≥ floor
  });

  it("pack made with another model → keyword search only, never its vectors", async () => {
    W().meta.embeddingModelSha256 = catalog.MODEL_CATALOG.find((m) => m.id === "bge-small-en-v1.5-q8")!.sha256;
    W().ftsHits = [1];
    const r = await packs.searchPacks("photosynthesis plants", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls).toHaveLength(0);
    expect(r.lexical.map((c) => c.title)).toEqual(["Photosynthesis"]);
    expect(r.semantic).toEqual([]);
  });

  it("a pack declaring another vector size → keyword search only", async () => {
    W().meta.dims = "384";
    W().ftsHits = [1];
    const r = await packs.searchPacks("photosynthesis plants", new Float32Array([1, 0]), 12, e5Opts());
    expect(W().searchCalls).toHaveLength(0);
    expect(r.lexical.map((c) => c.title)).toEqual(["Photosynthesis"]);
    expect(r.semantic).toEqual([]);
  });

  it("not a knowledge pack → skipped", async () => {
    W().meta = { format: "something-else" };
    const r = await packs.searchPacks("inflación precios", new Float32Array([1, 0]), 12, e5Opts());
    expect(r).toEqual({ lexical: [], semantic: [] });
  });
});

describe("searchPacks — bge keeps the original keyword-first search", () => {
  beforeEach(() => {
    W().meta.embeddingModelSha256 = catalog.MODEL_CATALOG.find((m) => m.id === "bge-small-en-v1.5-q8")!.sha256;
  });

  it("never calls the native index; vectors only re-rank keyword candidates", async () => {
    W().ftsHits = [1, 2];
    const r = await packs.searchPacks("photosynthesis plants", new Float32Array([1, 0]), 12);
    expect(W().searchCalls).toHaveLength(0);
    expect(r.semantic.map((c) => c.title)).toEqual(["Photosynthesis"]);
  });

  it("no content words → nothing (as before)", async () => {
    const r = await packs.searchPacks("what is", new Float32Array([1, 0]), 12);
    expect(r).toEqual({ lexical: [], semantic: [] });
  });
});
