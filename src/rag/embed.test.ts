/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";

let busy = false;

let mockTotalRamBytes = 12 * 1024 ** 3;
let mockRssBytes = 1024 ** 3;
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => mockTotalRamBytes,
  getMemoryInfo: () => ({ rssBytes: mockRssBytes, totalPssBytes: mockRssBytes }),
}));

vi.mock("llama.rn", () => ({
  initLlama: async () => ({
    // Like llama.rn: a second call while one is running is rejected.
    embedding: async (text: string) => {
      if (busy) throw new Error("Context is busy");
      busy = true;
      await new Promise((r) => setTimeout(r, 5));
      busy = false;
      return { embedding: [text.length] };
    },
    release: async () => {},
  }),
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async () => ({ exists: true }),
}));
// The integrity gate is covered by src/models/modelTrust.test.ts; here it
// is stubbed so engine behavior is tested in isolation.
vi.mock("../models/modelTrust", () => ({
  assertTrustedModelFileByName: vi.fn(async () => {}),
}));

import { EmbeddingEngine } from "./embed";

describe("EmbeddingEngine", () => {
  it("runs overlapping embed calls one at a time", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    const results = await Promise.all(["a", "bb", "ccc"].map((t) => engine.embed(t)));
    expect(results.map((r) => r[0])).toEqual([1, 2, 3]);
  });

  it("waits for a load that's still in progress before embedding", async () => {
    const engine = new EmbeddingEngine();
    const load = engine.load("models/embedding.gguf");
    const embedded = engine.embed("abcd");
    await load;
    expect((await embedded)[0]).toBe(4);
  });

  it("refuses to load with a clear RAM error when the device cannot fit it", async () => {
    // 2 GiB device fully crowded: nothing fits, not even the small embedding context.
    mockTotalRamBytes = 2 * 1024 ** 3;
    mockRssBytes = 2 * 1024 ** 3;
    try {
      const engine = new EmbeddingEngine();
      await expect(engine.load("models/embedding.gguf")).rejects.toThrow(/RAM/);
    } finally {
      mockTotalRamBytes = 12 * 1024 ** 3;
      mockRssBytes = 1024 ** 3;
    }
  });
});

describe("EmbeddingEngine — residencia bajo demanda (optimización 2026-11-08, fase 4)", () => {
  it("tras descargar, el siguiente uso recarga solo con la memoria de la sesión", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    await engine.unload();
    expect(engine.isLoaded).toBe(false);
    expect((await engine.embed("ab"))[0]).toBe(2);
    expect(engine.isLoaded).toBe(true);
  });

  it("sin memoria ni proveedor, ensureLoaded devuelve false y embed sigue lanzando «model not loaded»", async () => {
    const engine = new EmbeddingEngine();
    await expect(engine.ensureLoaded()).resolves.toBe(false);
    await expect(engine.embed("ab")).rejects.toThrow(/model not loaded/);
  });

  it("el proveedor registrado resuelve el fichero la primera vez", async () => {
    const engine = new EmbeddingEngine();
    engine.setEnsureLoadedProvider(async () => "models/embedding.gguf");
    await expect(engine.ensureLoaded()).resolves.toBe(true);
    expect(engine.isLoaded).toBe(true);
    expect((await engine.embedQuery("ab"))[0]).toBe(2);
  });

  it("las recargas concurrentes comparten un solo vuelo", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    await engine.unload();
    const [a, b] = await Promise.all([engine.embed("a"), engine.embed("bb")]);
    expect([a[0], b[0]]).toEqual([1, 2]);
    expect(engine.isLoaded).toBe(true);
  });

  it("la marca de último uso vive en el motor y la renueva cada búsqueda (0.1.84)", async () => {
    // Cierre de la desviación de la fase 4: antes la marca solo la
    // ponía ChatScreen al arrancar y las búsquedas no la renovaban,
    // así que el pulso descargaba el motor pese a uso reciente.
    const engine = new EmbeddingEngine();
    expect(engine.lastUsedAtMs).toBeNull();
    await engine.load("models/embedding.gguf");
    const afterLoad = engine.lastUsedAtMs;
    expect(afterLoad).not.toBeNull();
    const realNow = Date.now;
    let fake = afterLoad! + 60_000;
    Date.now = () => fake;
    try {
      await engine.embed("ab");
      expect(engine.lastUsedAtMs).toBe(fake);
      fake += 60_000;
      await engine.embedQuery("ab");
      expect(engine.lastUsedAtMs).toBe(fake);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("EmbeddingEngine — per-model prefixes (multilingual search)", () => {
  it("e5: questions get 'query: ', stored texts 'passage: ', tagged with the model", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding-multilingual.gguf");
    expect((await engine.embedQuery("ab"))[0]).toBe("query: ab".length);
    expect((await engine.embedPassage("ab"))[0]).toBe("passage: ab".length);
    const tagged = await engine.embedPassageTagged("ab");
    expect(tagged.modelSha256).toBe("802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde");
    expect(engine.profile.id).toBe("multilingual-e5-small");
  });

  it("bge: no prefixes, exactly as before", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    expect((await engine.embedQuery("ab"))[0]).toBe(2);
    expect((await engine.embedPassage("ab"))[0]).toBe(2);
    expect((await engine.embedQueryTagged("ab")).modelSha256).toBe(
      "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514"
    );
    expect(engine.profile.id).toBe("bge-small-en");
  });

  it("unloaded → no model tag", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    await engine.unload();
    expect(engine.loadedModelSha256).toBeNull();
  });
});
