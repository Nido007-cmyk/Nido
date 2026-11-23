/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  BENCH_CONFIGS,
  buildBenchReport,
  executedLabelFor,
  type RawBenchResult,
} from "./modelBench";

const raw = (speedPp: number, speedTg: number, extra: Partial<RawBenchResult> = {}): RawBenchResult => ({
  speedPp,
  speedTg,
  nGpuLayers: 0,
  nThreads: 4,
  nBatch: 512,
  nUBatch: 256,
  flashAttn: 0,
  ...extra,
});

describe("VEL-5 acto 3: la forma de la medición [PP-MIT]", () => {
  it("las dos configuraciones prefijadas de PocketPal, exactas: 512/128 y 128/32, pl 1, nr 3", () => {
    expect(BENCH_CONFIGS).toEqual([
      { pp: 512, tg: 128, pl: 1, nr: 3 },
      { pp: 128, tg: 32, pl: 1, nr: 3 },
    ]);
  });
});

describe("VEL-5 acto 3: lo ejecutado se dice como lo que fue (la ley de M-41)", () => {
  it("sin perfil acelerado, CPU — aunque la lista viera aceleradores", () => {
    expect(executedLabelFor({ filename: "m.gguf", nCtx: 4096, nThreads: 4, memoryProfile: "kv-q8" })).toBe("CPU");
    expect(executedLabelFor({ filename: "m.gguf", nCtx: 4096, nThreads: 4 })).toBe("CPU");
  });

  it("con «accel» ejecutado: HTP es NPU y lo demás es GPU, con su nombre", () => {
    expect(
      executedLabelFor({ filename: "m.gguf", nCtx: 4096, nThreads: 4, memoryProfile: "accel", accelDevice: "HTP0" }),
    ).toBe("NPU (HTP0)");
    expect(
      executedLabelFor({ filename: "m.gguf", nCtx: 4096, nThreads: 4, memoryProfile: "accel", accelDevice: "Adreno 750" }),
    ).toBe("GPU (Adreno 750)");
  });
});

describe("VEL-5 acto 3: el informe lleva su foto de parámetros pegada", () => {
  it("compone corridas, foto de la carga y pico de memoria", () => {
    const report = buildBenchReport({
      photo: { filename: "models/gemma.gguf", nCtx: 4096, nThreads: 4, memoryProfile: "accel", accelDevice: "HTP0" },
      raw: [raw(900, 40, { nGpuLayers: 42, flashAttn: 0 }), raw(700, 38, { nGpuLayers: 42, flashAttn: 0 })],
      peakRssBytes: 3 * 1024 ** 3,
      wallMs: 12_345,
    });
    expect(report.modelFilename).toBe("models/gemma.gguf");
    expect(report.executed).toBe("NPU (HTP0)");
    expect(report.nCtx).toBe(4096);
    expect(report.nGpuLayers).toBe(42);
    expect(report.peakRssBytes).toBe(3 * 1024 ** 3);
    expect(report.wallMs).toBe(12_345);
    expect(report.runs).toHaveLength(2);
    expect(report.runs[0]).toMatchObject({ pp: 512, tg: 128, speedPp: 900, speedTg: 40 });
    expect(report.runs[1]).toMatchObject({ pp: 128, tg: 32, speedPp: 700, speedTg: 38 });
  });

  it("un pico de memoria no leído queda null y declarado, nunca un cero inventado", () => {
    const report = buildBenchReport({
      photo: { filename: "m.gguf", nCtx: 2048, nThreads: 2, memoryProfile: "kv-q8" },
      raw: [raw(120, 22), raw(110, 21)],
      peakRssBytes: null,
      wallMs: 5_000,
    });
    expect(report.peakRssBytes).toBeNull();
    expect(report.executed).toBe("CPU");
    expect(report.nGpuLayers).toBe(0);
  });
});
