/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock state lives on globalThis: mock factories run before this module body.
type World = {
  log: string[];
  active: string | null;
  loaded: string | null;
  failLoad: string | null;
  failReset: boolean;
  failSetActive: boolean;
};
const W = (): World => (globalThis as unknown as { __swW: World }).__swW;
(globalThis as unknown as { __swW: World }).__swW = {
  log: [],
  active: null,
  loaded: null,
  failLoad: null,
  failReset: false,
  failSetActive: false,
};

vi.mock("../models/settings", () => ({
  getActiveModelId: async () => W().active,
  setActiveModelId: async (_kind: string, id: string) => {
    if (W().failSetActive) throw new Error("disk full");
    W().log.push(`setActive:${id}`);
    W().active = id;
  },
}));
vi.mock("./embed", () => ({
  embeddingEngine: {
    load: async (filename: string) => {
      if (W().failLoad === filename) throw new Error("does not fit in RAM");
      W().log.push(`load:${filename}`);
      W().loaded = filename;
    },
    get loadedModelSha256() {
      return null;
    },
  },
}));
vi.mock("./db", () => ({
  resetEmbeddingsForModel: async (sha: string) => {
    if (W().failReset) throw new Error("db locked");
    W().log.push(`reset:${sha.slice(0, 6)}`);
  },
}));
vi.mock("./packs", () => ({
  closeAllPacks: async () => W().log.push("closePacks"),
  prepareVectorIndexes: async () => W().log.push("prepareIndexes"),
}));
vi.mock("./reembed", () => ({
  reembedMissing: async () => W().log.push("reembed"),
}));

// Imported after the mocks are registered (works the same in every runner).
type Mod = typeof import("./embeddingSwitch");
let m: Mod;
beforeAll(async () => {
  m = await import("./embeddingSwitch");
});
const DEFAULT_EMBEDDING_ID = "bge-small-en-v1.5-q8";
const MULTILINGUAL_EMBEDDING_ID = "multilingual-e5-small-q8";

const e5 = () => m.embeddingModelById(MULTILINGUAL_EMBEDDING_ID)!;
const bge = () => m.embeddingModelById(DEFAULT_EMBEDDING_ID)!;

beforeEach(() => {
  Object.assign(W(), { log: [], active: null, loaded: null, failLoad: null, failReset: false, failSetActive: false });
});

describe("choosing the model", () => {
  it("both catalog models exist; bge stays the required default", () => {
    expect(m.DEFAULT_EMBEDDING_ID).toBe(DEFAULT_EMBEDDING_ID);
    expect(m.MULTILINGUAL_EMBEDDING_ID).toBe(MULTILINGUAL_EMBEDDING_ID);
    expect(bge().required).toBe(true);
    expect(e5().required).toBe(false);
    expect(e5().filename).not.toBe(bge().filename);
  });

  it("new installs: multilingual for Spanish and Portuguese only", () => {
    expect(m.defaultEmbeddingIdForLanguage("es")).toBe(MULTILINGUAL_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage("pt")).toBe(MULTILINGUAL_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage("es-MX")).toBe(MULTILINGUAL_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage("pt-BR")).toBe(MULTILINGUAL_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage("en")).toBe(DEFAULT_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage(null)).toBe(DEFAULT_EMBEDDING_ID);
    expect(m.defaultEmbeddingIdForLanguage("")).toBe(DEFAULT_EMBEDDING_ID);
  });

  it("active model: the Settings choice if it's a catalog model, else the default", async () => {
    expect((await m.activeEmbeddingModel()).id).toBe(DEFAULT_EMBEDDING_ID);
    W().active = MULTILINGUAL_EMBEDDING_ID;
    expect((await m.activeEmbeddingModel()).id).toBe(MULTILINGUAL_EMBEDDING_ID);
    W().active = "gone-model";
    expect((await m.activeEmbeddingModel()).id).toBe(DEFAULT_EMBEDDING_ID);
  });

  it("Vital pack variant follows the model; single-variant packs map to themselves", () => {
    expect(m.packIdForEmbedding("wiki-vital5", MULTILINGUAL_EMBEDDING_ID)).toBe("wiki-vital5-e5");
    expect(m.packIdForEmbedding("wiki-vital5", DEFAULT_EMBEDDING_ID)).toBe("wiki-vital5");
    expect(m.packIdForEmbedding("wiki-vital5-e5", DEFAULT_EMBEDDING_ID)).toBe("wiki-vital5");
    expect(m.packIdForEmbedding("corpus-standard", MULTILINGUAL_EMBEDDING_ID)).toBe("corpus-standard");
    expect(m.embeddingIdForPack("wiki-vital5-e5")).toBe(MULTILINGUAL_EMBEDDING_ID);
    expect(m.embeddingIdForPack("wiki-vital5")).toBe(DEFAULT_EMBEDDING_ID);
    expect(m.embeddingIdForPack("corpus-full")).toBeNull();
  });

  it("the seven packs of the 2026-10-30 programme resolve their e5 twin both ways", () => {
    for (const base of ["nido-ninos", "nido-crisis", "nido-desastres", "nido-sin-servicios", "nido-campo", "nido-viaje", "nido-hogar"]) {
      expect(m.packIdForEmbedding(base, MULTILINGUAL_EMBEDDING_ID)).toBe(`${base}-e5`);
      expect(m.packIdForEmbedding(`${base}-e5`, MULTILINGUAL_EMBEDDING_ID)).toBe(`${base}-e5`);
      expect(m.packIdForEmbedding(`${base}-e5`, DEFAULT_EMBEDDING_ID)).toBe(base);
      expect(m.packIdForEmbedding(base, DEFAULT_EMBEDDING_ID)).toBe(base);
      expect(m.embeddingIdForPack(`${base}-e5`)).toBe(MULTILINGUAL_EMBEDDING_ID);
      expect(m.embeddingIdForPack(base)).toBe(DEFAULT_EMBEDDING_ID);
    }
  });
});

describe("switchEmbeddingModel — order and recovery", () => {
  it("load → drop vectors + re-stamp → Settings → packs → background rebuild", async () => {
    await m.switchEmbeddingModel(e5());
    expect(W().log).toEqual([
      `load:${e5().filename}`,
      `reset:${e5().sha256.slice(0, 6)}`,
      `setActive:${MULTILINGUAL_EMBEDDING_ID}`,
      "closePacks",
      "reembed",
      "prepareIndexes",
    ]);
  });

  it("if the new model can't load, nothing changes", async () => {
    W().failLoad = e5().filename;
    await expect(m.switchEmbeddingModel(e5())).rejects.toThrow(/RAM/);
    expect(W().log).toEqual([]);
    expect(W().active).toBeNull();
  });

  it("if re-stamping fails, the previous model is loaded again and vectors are kept", async () => {
    W().failReset = true;
    await expect(m.switchEmbeddingModel(e5())).rejects.toThrow(/db locked/);
    expect(W().log).toEqual([`load:${e5().filename}`, `load:${bge().filename}`]);
    expect(W().active).toBeNull();
  });

  it("if Settings can't be saved, the base is re-stamped back and rebuilt for the previous model", async () => {
    W().failSetActive = true;
    await expect(m.switchEmbeddingModel(e5())).rejects.toThrow(/disk full/);
    expect(W().log).toEqual([
      `load:${e5().filename}`,
      `reset:${e5().sha256.slice(0, 6)}`,
      `reset:${bge().sha256.slice(0, 6)}`,
      `load:${bge().filename}`,
      "reembed",
    ]);
  });

  it("already the active model → only ensures it's loaded, never drops vectors", async () => {
    W().active = MULTILINGUAL_EMBEDDING_ID;
    await m.switchEmbeddingModel(e5());
    expect(W().log).toEqual([`load:${e5().filename}`]);
  });

  it("requests run in order and the LAST one wins (on → off quickly)", async () => {
    const on = m.switchEmbeddingModel(e5());
    const off = m.switchEmbeddingModel(bge());
    await Promise.all([on, off]);
    expect(W().active).toBe(DEFAULT_EMBEDDING_ID);
    expect(W().log.filter((l) => l.startsWith("setActive"))).toEqual([
      `setActive:${MULTILINGUAL_EMBEDDING_ID}`,
      `setActive:${DEFAULT_EMBEDDING_ID}`,
    ]);
  });

  it("the same request twice while waiting is joined, not run twice", async () => {
    const first = m.switchEmbeddingModel(bge()); // no-op (bge active), occupies the queue
    const a = m.switchEmbeddingModel(e5());
    const b = m.switchEmbeddingModel(e5());
    expect(b).toBe(a);
    await Promise.all([first, a, b]);
    expect(W().log.filter((l) => l.startsWith("reset"))).toHaveLength(1);
  });

  it("a failed request doesn't block the next one", async () => {
    W().failLoad = e5().filename;
    await expect(m.switchEmbeddingModel(e5())).rejects.toThrow();
    W().failLoad = null;
    await m.switchEmbeddingModel(e5());
    expect(W().active).toBe(MULTILINGUAL_EMBEDDING_ID);
  });

  it("refuses a non-embedding model", async () => {
    await expect(m.switchEmbeddingModel({ ...e5(), kind: "llm" })).rejects.toThrow(/not an embedding model/);
  });
});
