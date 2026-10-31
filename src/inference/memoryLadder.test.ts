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
  parseCrashGuardRecord,
  planContext,
  safetyForCrashes,
  settleCrashGuardRecord,
  type CrashGuardRecord,
} from "./memoryLadder";
import type { RamSnapshot } from "./ramBudget";

// Modelo de 1 GiB con la arquitectura por defecto (Qwen2.5-1.5B).
// Costes estimados (ramBudget): 8192 → 2.157 GB · 4096 → 1.771 GB ·
// 3072 → 1.675 GB · 2048 → 1.578 GB. Disponible = total − RSS − 2 GiB.
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
    // Disponible ≈ 1.720 GB: 4096 (1.771) no, 3072 (1.675) sí.
    const plan = planContext(SPEC, snap(3_867_483_648), { ceiling: 4096 });
    expect(plan?.nCtx).toBe(3072);
    expect(plan?.verdict.fits).toBe(true);
    expect(plan?.note).toContain("stepped down from 4096 to 3072");
  });

  it("si ni el peldaño menor cabe, el plan es el menor con fits=false", () => {
    const plan = planContext(SPEC, snap(3_600_000_000), { ceiling: 4096 });
    expect(plan?.nCtx).toBe(2048);
    expect(plan?.verdict.fits).toBe(false);
  });

  it("el factor de seguridad del CrashGuard también hace bajar", () => {
    // A safety 1 el 4096 cabe; a 0,8 el presupuesto es 1.718 GB y baja a 3072.
    const plan = planContext(SPEC, snap(4 * 1024 ** 3), { ceiling: 4096, safety: 0.8 });
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
