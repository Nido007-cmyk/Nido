/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * F3-08 (auditoría 2026-11-13) + m-75/F2-m4: el motor de embeddings
 * entra en el sistema de memoria. Hasta la 0.1.98 vivía fuera: su
 * pre-flight no aplicaba el factor del CrashGuard (que ni siquiera
 * existía para él), su contexto se estimaba con la arquitectura del
 * Qwen2.5-1.5B, su initLlama no llevaba la política de init del LLM
 * (use_mlock / n_gpu_layers) y una muerte suya no dejaba rastro —
 * el bucle de recarga bajo demanda reintentaba la misma carga para
 * siempre. Este banco fija el contrato nuevo con su registro PROPIO
 * (nido-crash-guard-embedding.json): el del LLM no se toca.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

let mockTotalRamBytes = 12 * GiB;
let mockRssBytes = 1 * GiB;
let mockFileSize = 0;
let rejectInit = false;
let initCalls: Array<Record<string, unknown>> = [];
const fsStore = new Map<string, string>();

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => mockTotalRamBytes,
  getMemoryInfo: () => ({ rssBytes: mockRssBytes, totalPssBytes: mockRssBytes }),
  getAvailableMemory: () => null,
  getProcessorCount: () => 8,
}));

vi.mock("llama.rn", () => ({
  initLlama: async (params: Record<string, unknown>) => {
    initCalls.push(params);
    if (rejectInit) throw new Error("Failed to load model");
    return {
      embedding: async (text: string) => ({ embedding: [text.length] }),
      release: async () => {},
    };
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async () => ({ exists: true, size: mockFileSize }),
  readAsStringAsync: async (path: string) => {
    const data = fsStore.get(path);
    if (data === undefined) throw new Error("not found");
    return data;
  },
  writeAsStringAsync: async (path: string, data: string) => {
    fsStore.set(path, data);
  },
}));

vi.mock("../models/modelTrust", () => ({
  assertTrustedModelFileByName: vi.fn(async () => {}),
}));

import { EmbeddingEngine } from "./embed";
import { estimateContextBytes, RamBudgetError } from "../inference/ramBudget";

const EMB_GUARD = "file:///docs/nido-crash-guard-embedding.json";
const LLM_GUARD = "file:///docs/nido-crash-guard.json";
const readEmbGuard = () => JSON.parse(fsStore.get(EMB_GUARD)!) as { crashes: number; pending: unknown; lastCrashAt: unknown };

beforeEach(() => {
  fsStore.clear();
  initCalls = [];
  rejectInit = false;
  mockTotalRamBytes = 12 * GiB;
  mockRssBytes = 1 * GiB;
  mockFileSize = 0;
});

describe("EmbeddingEngine dentro del sistema de memoria (F3-08)", () => {
  it("initLlama lleva la política de init del LLM: use_mlock false y n_gpu_layers 0 (m-75)", async () => {
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    expect(initCalls).toHaveLength(1);
    expect(initCalls[0]).toMatchObject({ embedding: true, n_ctx: 512, use_mlock: false, n_gpu_layers: 0 });
  });

  it("una muerte de carga anterior cuenta en SU registro, y el primer embed bueno lo confirma", async () => {
    fsStore.set(
      EMB_GUARD,
      JSON.stringify({ crashes: 0, pending: { model: "models/embedding.gguf", nCtx: 512, at: 1 } }),
    );
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    const during = readEmbGuard();
    expect(during.crashes).toBe(1);
    expect(during.pending).not.toBeNull();
    await engine.embed("hola");
    await new Promise((r) => setTimeout(r, 0));
    expect(readEmbGuard()).toEqual({ crashes: 0, pending: null, lastCrashAt: null });
  });

  it("el factor de SU CrashGuard juzga su pre-flight: a 0,5 lo que cabía a 1 ya no cabe", async () => {
    // Disponible por total ≈ 51 MiB (3 GiB − 0,95 de RSS − 2 de
    // colchón): el contexto de embeddings sin fichero pesa ~41,5 MiB
    // — cabe a factor 1 y no contra el presupuesto al 50 %.
    mockTotalRamBytes = 3 * GiB;
    mockRssBytes = 0.95 * GiB;
    fsStore.set(EMB_GUARD, JSON.stringify({ crashes: 3, pending: null }));
    const engine = new EmbeddingEngine();
    const err = await engine.load("models/embedding.gguf").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RamBudgetError);
    expect((err as RamBudgetError).crashSafety).toBe(0.5);
    expect(engine.isLoaded).toBe(false);
    // La gemela sin choques: la misma foto carga.
    fsStore.set(EMB_GUARD, JSON.stringify({ crashes: 0, pending: null }));
    const engine2 = new EmbeddingEngine();
    await engine2.load("models/embedding.gguf");
    expect(engine2.isLoaded).toBe(true);
  });

  it("un fallo de initLlama capturado en JS limpia su pendiente sin contar (la lección F3-15, en los dos motores)", async () => {
    rejectInit = true;
    const engine = new EmbeddingEngine();
    await expect(engine.load("models/embedding.gguf")).rejects.toThrow(/Failed to load/);
    const rec = readEmbGuard();
    expect(rec.crashes).toBe(0);
    expect(rec.pending).toBeNull();
  });

  it("el estimado usa la arquitectura REAL del fichero de embeddings, no la del Qwen2.5-1.5B", async () => {
    mockTotalRamBytes = 2 * GiB;
    mockRssBytes = 2 * GiB;
    mockFileSize = 36_806_944; // el bge-small del catálogo
    const engine = new EmbeddingEngine();
    const err = await engine.load("models/embedding.gguf").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RamBudgetError);
    // bge-small: BERT de 12 capas, 12 cabezas KV de 32, vocabulario
    // 30.522 — no las 28 capas / 2 cabezas / 128 del perfil por
    // defecto del estimador.
    const expected = estimateContextBytes({
      fileSizeBytes: 36_806_944,
      nCtx: 512,
      nLayer: 12,
      nKvHeads: 12,
      headDim: 32,
      nVocab: 30_522,
    }).totalBytes;
    expect((err as RamBudgetError).needBytes).toBe(expected);
  });

  it("el registro del LLM queda byte a byte intacto: son dos sistemas con dos ficheros", async () => {
    const before = JSON.stringify({ crashes: 2, pending: { model: "models/x.gguf", nCtx: 2048, at: 7 } });
    fsStore.set(LLM_GUARD, before);
    const engine = new EmbeddingEngine();
    await engine.load("models/embedding.gguf");
    await engine.embed("hola");
    expect(fsStore.get(LLM_GUARD)).toBe(before);
  });
});
