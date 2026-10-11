/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * FREEZE-2026-10-10: el benchmark PBKDF2 dejaba la Tab A9+ sin responder.
 * Causa: tramos de 4096 iteraciones entre cesiones al event loop, pensados
 * para un motor con JIT; Hermes no tiene JIT y cada tramo bloqueaba la UI
 * cerca de un segundo o más, durante 6 pasadas de 600k iteraciones.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("ram-monitor", () => ({ getMemoryInfo: () => ({ rssBytes: 0, totalPssBytes: 0 }) }));
// evalHarness arrastra el motor de inferencia (módulos nativos): aquí solo
// hace falta la carpeta de resultados.
vi.mock("./evalHarness", () => ({ EVAL_RESULTS_DIR: "file:///tmp/eval/" }));
vi.mock("expo-file-system/legacy", () => ({
  makeDirectoryAsync: async () => undefined,
  writeAsStringAsync: async () => undefined,
}));

import {
  BENCH_UI_CHUNK_ITERATIONS,
  abortPbkdf2Benchmark,
  runPbkdf2Benchmark,
  Pbkdf2BenchAborted,
} from "./pbkdf2Bench";
import { pbkdf2Sha256Chunked } from "../../scripts/benchmarks/pbkdf2-candidate/pbkdf2";

describe("benchmark PBKDF2: la UI no se congela", () => {
  it("cede el event loop en tramos pequeños (no 4096)", () => {
    expect(BENCH_UI_CHUNK_ITERATIONS).toBeLessThanOrEqual(128);
    expect(BENCH_UI_CHUNK_ITERATIONS).toBeGreaterThanOrEqual(16);
  });

  it("cede con setTimeout, nunca con setImmediate (RN vacía setImmediate en bucle)", async () => {
    const g = globalThis as unknown as { setImmediate?: (cb: () => void) => unknown };
    const original = g.setImmediate;
    const spy = vi.fn((cb: () => void) => setTimeout(cb, 0));
    g.setImmediate = spy;
    try {
      await pbkdf2Sha256Chunked(new Uint8Array([1, 2, 3]), new Uint8Array(16), 300, 32, 64);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      g.setImmediate = original;
    }
  });

  it("avisa el progreso como mucho una vez por punto porcentual", async () => {
    const labels: string[] = [];
    const p = runPbkdf2Benchmark((l) => {
      labels.push(l);
      if (labels.filter((x) => x.includes("cold") && x.endsWith("%")).length >= 3) abortPbkdf2Benchmark();
    });
    await expect(p).rejects.toBeInstanceOf(Pbkdf2BenchAborted);
    const pcts = labels.filter((x) => x.endsWith("%"));
    expect(new Set(pcts).size).toBe(pcts.length);
  }, 60_000);

  it("se puede detener: rechaza con Pbkdf2BenchAborted en el siguiente tramo", async () => {
    let progressCalls = 0;
    const p = runPbkdf2Benchmark(() => {
      progressCalls += 1;
      if (progressCalls === 3) abortPbkdf2Benchmark();
    });
    await expect(p).rejects.toBeInstanceOf(Pbkdf2BenchAborted);
  }, 30_000);
});
