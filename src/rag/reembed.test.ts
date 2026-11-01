/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isNativeGateTaken, nativeGateBegin, nativeGateEnd } from "../inference/nativeGate";

type Chunk = { chunkId: string; title: string; body: string };
type World = {
  chunks: Chunk[];
  vectors: Map<string, string>; // chunkId → model sha
  stamp: string;
  engineSha: string | null;
  epoch: number;
  embedded: string[];
  failEmbedAt: number | null;
  switchAfter: number | null;
  ignoreWrites: boolean;
};
const W = (): World => (globalThis as unknown as { __reW: World }).__reW;
(globalThis as unknown as { __reW: World }).__reW = {} as World;

vi.mock("./embed", () => ({
  embeddingEngine: {
    get loadedModelSha256() {
      return W().engineSha;
    },
    embedPassage: async (text: string) => {
      const w = W();
      if (w.failEmbedAt !== null && w.embedded.length === w.failEmbedAt) {
        throw new Error("EmbeddingEngine: native embedding unavailable in this build");
      }
      w.embedded.push(text);
      if (w.switchAfter !== null && w.embedded.length === w.switchAfter) w.engineSha = "other";
      return new Float32Array([text.length]);
    },
  },
}));
vi.mock("./db", () => ({
  getDbEpoch: () => W().epoch,
  countChunkVectors: async () => ({
    chunks: W().chunks.length,
    withVector: W().chunks.filter((c) => W().vectors.has(c.chunkId)).length,
  }),
  listChunksWithoutEmbedding: async (limit: number) =>
    W().chunks.filter((c) => !W().vectors.has(c.chunkId)).slice(0, limit),
  insertEmbeddingForModel: async (chunkId: string, _v: Float32Array, sha: string) => {
    if (W().stamp !== sha) return false;
    if (!W().ignoreWrites) W().vectors.set(chunkId, sha);
    return true;
  },
}));

let m: typeof import("./reembed");
beforeAll(async () => {
  m = await import("./reembed");
});

const E5 = "e5sha";
const make = (n: number): Chunk[] =>
  Array.from({ length: n }, (_, i) => ({ chunkId: `c${i}`, title: `T${i}`, body: `B${i}` }));

beforeEach(() => {
  Object.assign(W(), {
    chunks: make(60),
    vectors: new Map(),
    stamp: E5,
    engineSha: E5,
    epoch: 1,
    embedded: [],
    failEmbedAt: null,
    switchAfter: null,
    ignoreWrites: false,
  });
});

describe("reembedMissing", () => {
  it("embeds every chunk without a vector, as `title\\nbody`, and reports progress", async () => {
    W().vectors.set("c0", E5);
    const seen: number[] = [];
    const off = m.onReembedProgress((p) => seen.push(p.done));
    const result = await m.reembedMissing();
    off();
    expect(result).toEqual({ done: 60, total: 60, running: false });
    expect(W().vectors.size).toBe(60);
    expect(W().embedded).toHaveLength(59);
    expect(W().embedded[0]).toBe("T1\nB1");
    expect(seen.at(-1)).toBe(60);
  });

  it("nothing missing → no work", async () => {
    for (const c of W().chunks) W().vectors.set(c.chunkId, E5);
    await m.reembedMissing();
    expect(W().embedded).toHaveLength(0);
  });

  it("no model loaded → no work", async () => {
    W().engineSha = null;
    await m.reembedMissing();
    expect(W().embedded).toHaveLength(0);
  });

  it("concurrent calls share one run", async () => {
    const [a, b] = await Promise.all([m.reembedMissing(), m.reembedMissing()]);
    expect(a).toEqual(b);
    expect(W().embedded).toHaveLength(60);
  });

  it("stops when the base is stamped for another model (never mixes models)", async () => {
    W().stamp = "someone-else";
    await m.reembedMissing();
    expect(W().vectors.size).toBe(0);
    expect(W().embedded).toHaveLength(1);
  });

  it("stops when the loaded model changes mid-run", async () => {
    W().switchAfter = 5;
    await m.reembedMissing();
    expect(W().vectors.size).toBe(4);
  });

  it("stops quietly when native embeddings are unavailable; a later run resumes", async () => {
    W().failEmbedAt = 30;
    const first = await m.reembedMissing();
    expect(first.running).toBe(false);
    expect(W().vectors.size).toBe(30);
    W().failEmbedAt = null;
    await m.reembedMissing();
    expect(W().vectors.size).toBe(60);
  });

  it("never loops forever if vectors don't get stored", async () => {
    W().ignoreWrites = true;
    await m.reembedMissing();
    // one batch, then the same first chunk comes back → stop
    expect(W().embedded.length).toBeLessThanOrEqual(24);
  });

  it("M1: con la puerta tomada desde el primer chunk no incrusta nada; el siguiente arranque completa la deuda", async () => {
    nativeGateBegin(); // una generación en vuelo antes de arrancar
    try {
      const parked = await m.reembedMissing();
      // Termina «aparcado»: sin correr y sin tocar un solo chunk.
      expect(parked.running).toBe(false);
      expect(W().embedded).toHaveLength(0);
      expect(W().vectors.size).toBe(0);
    } finally {
      nativeGateEnd();
    }
    expect(isNativeGateTaken()).toBe(false);
    const done = await m.reembedMissing();
    expect(done).toEqual({ done: 60, total: 60, running: false });
    expect(W().embedded).toHaveLength(60);
    expect(W().vectors.size).toBe(60);
  });
});
