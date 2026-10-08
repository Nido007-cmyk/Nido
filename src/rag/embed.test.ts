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
