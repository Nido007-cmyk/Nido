/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * M1 del diagnóstico del crash nativo: la puerta que ordena el
 * trabajo nativo entre la generación y el indexado de fondo.
 *
 * La mitad «generate marca la puerta» se prueba contra el motor real
 * en LlamaEngine.test.ts; aquí la generación se representa con las
 * mismas llamadas que hace LlamaEngine.generate (begin/end), y el
 * fondo es el reembedMissing real con su db/embed mockeados como en
 * reembed.test.ts.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isNativeGateTaken, nativeGateBegin, nativeGateEnd, waitForNativeGateFree } from "./nativeGate";

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe("nativeGate: la puerta en sí", () => {
  it("libre: no está tomada y esperar se resuelve en el acto", async () => {
    expect(isNativeGateTaken()).toBe(false);
    await expect(waitForNativeGateFree()).resolves.toBeUndefined();
  });

  it("tomada: quien espera se aparca hasta el end, sin resolver antes", async () => {
    nativeGateBegin();
    try {
      expect(isNativeGateTaken()).toBe(true);
      let woke = false;
      const waiting = waitForNativeGateFree().then(() => {
        woke = true;
      });
      await tick();
      expect(woke).toBe(false);
      nativeGateEnd();
      await waiting;
      expect(woke).toBe(true);
      expect(isNativeGateTaken()).toBe(false);
    } finally {
      // Higiene del singleton: ninguna prueba deja la puerta tomada.
      while (isNativeGateTaken()) nativeGateEnd();
    }
  });

  it("es un contador: dos generaciones encoladas la mantienen tomada hasta que la última se asienta", async () => {
    nativeGateBegin();
    nativeGateBegin();
    let woke = false;
    const waiting = waitForNativeGateFree().then(() => {
      woke = true;
    });
    nativeGateEnd();
    await tick();
    expect(isNativeGateTaken()).toBe(true);
    expect(woke).toBe(false);
    nativeGateEnd();
    await waiting;
    expect(woke).toBe(true);
    expect(isNativeGateTaken()).toBe(false);
  });

  it("end de más no rompe nada: la puerta queda libre", () => {
    nativeGateEnd();
    expect(isNativeGateTaken()).toBe(false);
  });

  it("tomarla es síncrono y no espera a nadie: una segunda generación marca al instante con el fondo aparcado", async () => {
    nativeGateBegin(); // generación 1 en vuelo
    let woke = false;
    const parked = waitForNativeGateFree().then(() => {
      woke = true;
    });
    // La generación 2 llega con el fondo aparcado: marca y sigue,
    // sin aguardar a que el fondo vacíe nada.
    nativeGateBegin();
    expect(isNativeGateTaken()).toBe(true);
    nativeGateEnd(); // se asienta la 2; la 1 sigue en vuelo
    await tick();
    expect(woke).toBe(false);
    nativeGateEnd(); // se asienta la 1: el fondo reanuda
    await parked;
    expect(woke).toBe(true);
  });
});

// --- Integración con el fondo real (reembedMissing) ---

type Chunk = { chunkId: string; title: string; body: string };
type World = {
  chunks: Chunk[];
  vectors: Map<string, string>;
  stamp: string;
  engineSha: string | null;
  epoch: number;
  embedded: string[];
  gateAt: number | null;
};
const W = (): World => (globalThis as unknown as { __gateW: World }).__gateW;
(globalThis as unknown as { __gateW: World }).__gateW = {} as World;

vi.mock("../rag/embed", () => ({
  embeddingEngine: {
    get loadedModelSha256() {
      return W().engineSha;
    },
    embedPassage: async (text: string) => {
      const w = W();
      w.embedded.push(text);
      // El test puede «arrancar una generación» al llegar a N
      // embeddings: la misma llamada que hace LlamaEngine.generate.
      if (w.gateAt !== null && w.embedded.length === w.gateAt) nativeGateBegin();
      return new Float32Array([text.length]);
    },
  },
}));
vi.mock("../rag/db", () => ({
  getDbEpoch: () => W().epoch,
  countChunkVectors: async () => ({
    chunks: W().chunks.length,
    withVector: W().chunks.filter((c) => W().vectors.has(c.chunkId)).length,
  }),
  listChunksWithoutEmbedding: async (limit: number) =>
    W().chunks.filter((c) => !W().vectors.has(c.chunkId)).slice(0, limit),
  insertEmbeddingForModel: async (chunkId: string, _v: Float32Array, sha: string) => {
    if (W().stamp !== sha) return false;
    W().vectors.set(chunkId, sha);
    return true;
  },
}));

let reembed: typeof import("../rag/reembed");
beforeAll(async () => {
  reembed = await import("../rag/reembed");
});

const E5 = "e5sha";
const make = (n: number): Chunk[] =>
  Array.from({ length: n }, (_, i) => ({ chunkId: `c${i}`, title: `T${i}`, body: `B${i}` }));

beforeEach(() => {
  Object.assign(W(), {
    chunks: make(30),
    vectors: new Map(),
    stamp: E5,
    engineSha: E5,
    epoch: 1,
    embedded: [],
    gateAt: null,
  });
});

describe("M1: reembed contra la puerta", () => {
  it("en curso + llega una generación ⇒ no llama a embedPassage mientras la puerta está tomada y reanuda al liberarse", async () => {
    W().gateAt = 5; // la «generación» arranca tras el 5.º embedding
    let settled = false;
    const run = reembed.reembedMissing().then((p) => {
      settled = true;
      return p;
    });
    await tick(30);
    // Aparcado en el chunk 6: ni un embedding más, y la corrida viva.
    expect(W().embedded).toHaveLength(5);
    expect(settled).toBe(false);
    expect(isNativeGateTaken()).toBe(true);
    nativeGateEnd(); // la generación se asienta
    const result = await run;
    expect(settled).toBe(true);
    expect(result).toEqual({ done: 30, total: 30, running: false });
    expect(W().embedded).toHaveLength(30);
    expect(W().vectors.size).toBe(30);
  });
});
