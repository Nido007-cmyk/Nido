/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it, vi } from "vitest";

// ramBudget lee el módulo nativo al importarse: se sustituye como en
// ramBudget.test.ts para que la cadena no arrastre react-native.
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 0,
  getMemoryInfo: () => ({ rssBytes: 0, totalPssBytes: 0 }),
}));

import {
  confirmCrashGuardRecord,
  EMERGENCY_CONTEXT,
  parseCrashGuardRecord,
  planContext,
  safetyForCrashes,
  settleCrashGuardRecord,
  type CrashGuardRecord,
} from "./memoryLadder";
import { checkRamBudget, type RamSnapshot } from "./ramBudget";

// Modelo de 1 GiB con la arquitectura por defecto (Qwen2.5-1.5B).
// Costes estimados (ramBudget): 8192 → 1.846 GB · 4096 → 1.460 GB ·
// 3072 → 1.364 GB · 2048 → 1.267 GB (defecto 2026-11-08: los logits ya
// no se cobran por lote completo). Disponible = total − RSS − 2 GiB.
const SPEC = { fileSizeBytes: 1024 ** 3 };
const snap = (totalRamBytes: number, rssBytes = 0): RamSnapshot => ({ totalRamBytes, rssBytes });

describe("planContext (la escalera)", () => {
  it("con RAM de sobra se queda en el techo pedido, ni un peldaño más arriba", () => {
    const plan = planContext(SPEC, snap(6 * 1024 ** 3), { ceiling: 4096 });
    expect(plan?.nCtx).toBe(4096);
    expect(plan?.verdict.fits).toBe(true);
    expect(plan?.note).toBe("");
  });

  it("si el techo no cabe, baja peldaños hasta el que cabe", () => {
    // Disponible ≈ 1.410 GB: 4096 (1.460) no, 3072 (1.364) sí.
    const plan = planContext(SPEC, snap(3_557_483_648), { ceiling: 4096 });
    expect(plan?.nCtx).toBe(3072);
    expect(plan?.verdict.fits).toBe(true);
    expect(plan?.note).toContain("stepped down from 4096 to 3072");
  });

  it("si ni el peldaño menor cabe, el plan es el menor con fits=false", () => {
    // 3,3 GB es la clase ≤4 GiB: desde la 0.1.84 el menor peldaño que
    // reporta el plan es el de emergencia (1024), no el suelo de 2048.
    const plan = planContext(SPEC, snap(3_300_000_000), { ceiling: 4096 });
    expect(plan?.nCtx).toBe(EMERGENCY_CONTEXT);
    expect(plan?.verdict.fits).toBe(false);
  });

  it("el factor de seguridad del CrashGuard también hace bajar", () => {
    // A safety 1 el 4096 cabe; a 0,8 el presupuesto es 1.400 GB y baja a 3072.
    const plan = planContext(SPEC, snap(3_897_483_648), { ceiling: 4096, safety: 0.8 });
    expect(plan?.nCtx).toBe(3072);
    expect(plan?.note).toContain("80% after a memory crash");
  });

  it("un techo fuera de la escalera manda él (ni se sube ni se baja por la tabla)", () => {
    const plan = planContext(SPEC, snap(8 * 1024 ** 3), { ceiling: 5120 });
    expect(plan?.nCtx).toBe(5120);
    const small = planContext(SPEC, snap(8 * 1024 ** 3), { ceiling: 1024 });
    expect(small?.nCtx).toBe(1024);
  });

  it("lectura de RAM ciega → null (el llamador no rechaza a ciegas)", () => {
    expect(planContext(SPEC, snap(0), { ceiling: 4096 })).toBeNull();
  });
});

describe("planContext: peldaño de emergencia 1024 (0.1.84)", () => {
  const GiB = 1024 ** 3;
  // Qwen2.5-0.5B Q4 con la calibración de su clase (n_ubatch 192):
  // 2048 ≈ 0,501 GiB · 1024 ≈ 0,436 GiB (fp16) / ≈ 0,430 GiB (q8).
  const Q05 = { fileSizeBytes: 397_808_192, nLayer: 24, nKvHeads: 2, headDim: 64, nUbatch: 192 };
  // Foto apretada de la Tab A9+ real: manda el término en vivo,
  // disponible = 1,07 − 0,35 − 0,25 = 0,47 GiB.
  const TIGHT = { totalRamBytes: 3.54 * GiB, rssBytes: 0.95 * GiB, availBytes: 1.07 * GiB, lowMemThresholdBytes: 0.35 * GiB };

  it("si ni el suelo de 2048 cabe, la clase ≤4 GiB prueba 1024 antes de rechazar", () => {
    const plan = planContext(Q05, TIGHT, { ceiling: 4096 })!;
    expect(plan.nCtx).toBe(EMERGENCY_CONTEXT);
    expect(plan.verdict.fits).toBe(true);
    expect(plan.note).toContain("emergency context");
  });

  it("con la KV de q8 el peldaño de emergencia cuesta la mitad de KV", () => {
    const plan = planContext({ ...Q05, kvBytesPerElement: 1 }, TIGHT, { ceiling: 4096 })!;
    expect(plan.nCtx).toBe(EMERGENCY_CONTEXT);
    expect(plan.verdict.fits).toBe(true);
    expect(plan.verdict.kvCacheBytes).toBe(2 * 24 * 1024 * 2 * 64 * 1);
  });

  it("fuera de la clase (8 GiB) el suelo sigue siendo 2048: sin peldaño de emergencia", () => {
    const big: RamSnapshot = { totalRamBytes: 8 * GiB, rssBytes: 1 * GiB, availBytes: 0.9 * GiB, lowMemThresholdBytes: 0.35 * GiB };
    const plan = planContext(Q05, big, { ceiling: 4096 })!;
    expect(plan.verdict.availableBytes).toBeCloseTo(0.3 * GiB, -6);
    expect(plan.nCtx).toBe(2048);
    expect(plan.verdict.fits).toBe(false);
  });

  it("con hueco normal el peldaño de emergencia no se usa: manda el mayor que cabe", () => {
    const roomy: RamSnapshot = { totalRamBytes: 3.54 * GiB, rssBytes: 0.35 * GiB, availBytes: 1.8 * GiB, lowMemThresholdBytes: 0.35 * GiB };
    const plan = planContext(Q05, roomy, { ceiling: 4096 })!;
    expect(plan.nCtx).toBe(4096);
  });

  it("la protección del 06/11 se mantiene en su forma: sin bajar a 1024 el modelo no entra, y a 1024 solo con la KV de q8", () => {
    // TABLET_BUSY de ramBudget.test.ts (total modelado 3,3 GiB,
    // disponible 0,55 GiB). El Qwen3-0.6B cuesta ~0,678 GiB a 2048
    // (el suelo histórico: fuera por mucho) y ~0,524 GiB a 1024 en
    // fp16: el plan fp16 lo admite SOLO en el peldaño de emergencia,
    // nunca a un contexto normal con la tableta ocupada. Con la KV
    // de q8 (la que el primer perfil realmente carga) son ~0,469.
    const QWEN3 = { fileSizeBytes: 396_705_472, nLayer: 28, nKvHeads: 8, headDim: 128, nUbatch: 128 };
    const busy: RamSnapshot = { totalRamBytes: 3.3 * GiB, rssBytes: 0.4 * GiB, availBytes: 1.0 * GiB, lowMemThresholdBytes: 0.2 * GiB };
    const fp16 = planContext(QWEN3, busy, { ceiling: 3072 })!;
    expect(fp16.nCtx).toBe(EMERGENCY_CONTEXT);
    expect(fp16.verdict.fits).toBe(true);
    const q8 = planContext({ ...QWEN3, kvBytesPerElement: 1 }, busy, { ceiling: 3072 })!;
    expect(q8.nCtx).toBe(EMERGENCY_CONTEXT);
    expect(q8.verdict.fits).toBe(true);
  });
});

describe("CrashGuard", () => {
  it("los factores por choques: 1, 0,8, 0,65 y suelo 0,5", () => {
    expect(safetyForCrashes(0)).toBe(1);
    expect(safetyForCrashes(1)).toBe(0.8);
    expect(safetyForCrashes(2)).toBe(0.65);
    expect(safetyForCrashes(3)).toBe(0.5);
    expect(safetyForCrashes(9)).toBe(0.5);
  });

  it("un pendiente sin modelo vivo cuenta como choque", () => {
    const rec: CrashGuardRecord = { crashes: 0, pending: { model: "a.gguf", nCtx: 4096, at: 1 } };
    const { record, safety, countedCrash } = settleCrashGuardRecord(rec, { modelAlive: false });
    expect(countedCrash).toBe(true);
    expect(record).toEqual({ crashes: 1, pending: null });
    expect(safety).toBe(0.8);
  });

  it("un pendiente con el modelo vivo se confirma, no se castiga", () => {
    const rec: CrashGuardRecord = { crashes: 2, pending: { model: "a.gguf", nCtx: 2048, at: 1 } };
    const { record, safety, countedCrash } = settleCrashGuardRecord(rec, { modelAlive: true });
    expect(countedCrash).toBe(false);
    expect(record).toEqual({ crashes: 0, pending: null });
    expect(safety).toBe(1);
  });

  it("sin pendiente no pasa nada; la confirmación deja el contador a cero", () => {
    const rec: CrashGuardRecord = { crashes: 1, pending: null };
    expect(settleCrashGuardRecord(rec, { modelAlive: false }).record).toEqual(rec);
    expect(confirmCrashGuardRecord({ crashes: 3, pending: { model: "a", nCtx: 1, at: 1 } })).toEqual({
      crashes: 0,
      pending: null,
    });
  });

  it("el registro persistido se lee con tolerancia", () => {
    expect(parseCrashGuardRecord(null)).toEqual({ crashes: 0, pending: null });
    expect(parseCrashGuardRecord("no es json")).toEqual({ crashes: 0, pending: null });
    expect(parseCrashGuardRecord('{"crashes":2,"pending":{"model":"a.gguf","nCtx":2048,"at":5}}')).toEqual({
      crashes: 2,
      pending: { model: "a.gguf", nCtx: 2048, at: 5 },
    });
    expect(parseCrashGuardRecord('{"crashes":-4,"pending":{"model":7}}')).toEqual({ crashes: 0, pending: null });
  });
});

describe("planContext: SIN la vía de emergencia la foto de las 19:54 no cabe (la cuenta de la 0.1.84, fijada)", () => {
  const MiB = 1024 ** 2;
  // La regresión que fija el efecto de la vía: la cuenta que juzgaba
  // en la 0.1.84 (checkRamBudget sin emergencyLive, que es también lo
  // que planContext aplica a todo peldaño normal) rechaza la foto en
  // todos los peldaños, incluido el más barato posible.
  const PHOTO: RamSnapshot = {
    totalRamBytes: 3416 * MiB,
    rssBytes: 367 * MiB,
    availBytes: 842 * MiB,
    lowMemThresholdBytes: 216 * MiB,
  };
  const Q05 = { fileSizeBytes: 397_808_192, nLayer: 24, nKvHeads: 2, headDim: 64, nUbatch: 128 };

  it("ningún peldaño cabe con la cuenta normal, ni siquiera el suelo q8 sin freno", () => {
    for (const safety of [1, 0.65]) {
      const budget = Math.floor(370 * MiB * safety);
      for (const nCtx of [4096, 3072, 2048, 1024]) {
        const v = checkRamBudget({ ...Q05, nCtx }, PHOTO)!;
        expect(v.availableBytes).toBe(370 * MiB);
        expect(v.totalBytes).toBeGreaterThan(budget);
      }
      const q8Floor = checkRamBudget({ ...Q05, nCtx: 1024, kvBytesPerElement: 1 }, PHOTO)!;
      expect(q8Floor.totalBytes).toBe(452_352_576);
      expect(q8Floor.totalBytes).toBeGreaterThan(budget);
    }
  });

  it("y con la vía el MISMO plan elige 1024 y cabe: el contraste es la prueba del efecto", () => {
    const plan = planContext(Q05, PHOTO, { ceiling: 4096, safety: 0.65 })!;
    expect(plan.nCtx).toBe(EMERGENCY_CONTEXT);
    expect(plan.verdict.fits).toBe(true);
  });
});
