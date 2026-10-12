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
