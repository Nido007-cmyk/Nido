/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  EMPTY_NATIVE_SESSION_RECORD,
  crossNativeSessionRecord,
  holdBackgroundIndexingForSession,
  isBackgroundIndexingHeld,
  parseNativeSessionRecord,
  resetBackgroundIndexingHold,
  type NativeSessionRecord,
} from "./nativeSession";
import type { ExitInfoLike } from "./crashReport";

function exit(reason: string, timestamp: number): ExitInfoLike {
  return {
    timestamp,
    reason,
    description: null,
    status: reason === "CRASH_NATIVE" ? 11 : 0,
    importance: 100,
    pssKb: 0,
    rssKb: 526 * 1024,
    trace: null,
  };
}

/** El registro que el Crash B de la ronda habría dejado: generando, con el re-indexado en curso. */
function crashBRecord(overrides: Partial<NativeSessionRecord> = {}): NativeSessionRecord {
  return {
    at: 1_000,
    model: "models/qwen3-0.6b-q4_k_m.gguf",
    nCtx: 3072,
    nThreads: 4,
    memoryProfile: "kv-q8",
    reembed: { running: true, done: 120, total: 900 },
    generating: true,
    backend: "CPU/cpu/Unknown",
    crossedExitAt: null,
    verdict: null,
    ...overrides,
  };
}

describe("parseNativeSessionRecord", () => {
  it("lo ilegible o ausente es el registro vacío", () => {
    expect(parseNativeSessionRecord(null)).toEqual(EMPTY_NATIVE_SESSION_RECORD);
    expect(parseNativeSessionRecord("")).toEqual(EMPTY_NATIVE_SESSION_RECORD);
    expect(parseNativeSessionRecord("{roto")).toEqual(EMPTY_NATIVE_SESSION_RECORD);
    expect(parseNativeSessionRecord("42")).toEqual(EMPTY_NATIVE_SESSION_RECORD);
  });

  it("conserva los campos buenos y sanea los malos", () => {
    const parsed = parseNativeSessionRecord(
      JSON.stringify({
        at: 123,
        model: "m.gguf",
        nCtx: "mucho",
        memoryProfile: 7,
        reembed: { running: true, done: "x", total: 10 },
        generating: true,
        verdict: { exitAt: 999, diedGenerating: true, model: "m.gguf", nCtx: 2048 },
      }),
    );
    expect(parsed.at).toBe(123);
    expect(parsed.model).toBe("m.gguf");
    expect(parsed.nCtx).toBe(0);
    expect(parsed.memoryProfile).toBeNull();
    expect(parsed.reembed).toEqual({ running: true, done: 0, total: 10 });
    expect(parsed.generating).toBe(true);
    expect(parsed.verdict).toEqual({
      exitAt: 999,
      diedGenerating: true,
      reembedRunning: false,
      model: "m.gguf",
      nCtx: 2048,
      memoryProfile: null,
    });
  });
});

describe("crossNativeSessionRecord (M2: la próxima muerte se auto-identifica)", () => {
  it("CRASH_NATIVE con generación en vuelo: veredicto «murió generando», choque contado y fondo apagado", () => {
    const cross = crossNativeSessionRecord(crashBRecord(), exit("CRASH_NATIVE", 2_000));
    expect(cross.countedNativeCrash).toBe(true);
    expect(cross.holdBackground).toBe(true);
    expect(cross.record.generating).toBe(false);
    expect(cross.record.crossedExitAt).toBe(2_000);
    expect(cross.record.verdict).toEqual({
      exitAt: 2_000,
      diedGenerating: true,
      reembedRunning: true,
      model: "models/qwen3-0.6b-q4_k_m.gguf",
      nCtx: 3072,
      memoryProfile: "kv-q8",
    });
  });

  it("CRASH_NATIVE sin generación en vuelo: hay veredicto, pero ni choque ni apagado (M3 solo castiga generando)", () => {
    const record = crashBRecord({ generating: false, reembed: { running: true, done: 5, total: 900 } });
    const cross = crossNativeSessionRecord(record, exit("CRASH_NATIVE", 2_000));
    expect(cross.countedNativeCrash).toBe(false);
    expect(cross.holdBackground).toBe(false);
    expect(cross.record.verdict?.diedGenerating).toBe(false);
    expect(cross.record.verdict?.reembedRunning).toBe(true);
    expect(cross.record.crossedExitAt).toBe(2_000);
  });

  it("LOW_MEMORY con la misma bandera puesta: sin conteo, sin apagado, sin veredicto (fenómeno aparte)", () => {
    const cross = crossNativeSessionRecord(crashBRecord(), exit("LOW_MEMORY", 2_000));
    expect(cross.countedNativeCrash).toBe(false);
    expect(cross.holdBackground).toBe(false);
    expect(cross.record.verdict).toBeNull();
    // El registro sí se asienta: aquel proceso ya no existe y su
    // bandera no puede seguir diciendo «generando» para siempre.
    expect(cross.record.generating).toBe(false);
    expect(cross.record.crossedExitAt).toBe(2_000);
  });

  it("USER_REQUESTED tampoco dispara la reacción M3", () => {
    const cross = crossNativeSessionRecord(crashBRecord(), exit("USER_REQUESTED", 2_000));
    expect(cross.countedNativeCrash).toBe(false);
    expect(cross.holdBackground).toBe(false);
    expect(cross.record.verdict).toBeNull();
  });

  it("un cierre anterior al inicio de la generación registrada no es su muerte: no se cruza", () => {
    const record = crashBRecord();
    const cross = crossNativeSessionRecord(record, exit("CRASH_NATIVE", 500));
    expect(cross.record).toBe(record);
    expect(cross.countedNativeCrash).toBe(false);
  });

  it("el mismo cierre no se cruza dos veces (idempotente entre arranques)", () => {
    const first = crossNativeSessionRecord(crashBRecord(), exit("CRASH_NATIVE", 2_000));
    expect(first.countedNativeCrash).toBe(true);
    const second = crossNativeSessionRecord(first.record, exit("CRASH_NATIVE", 2_000));
    expect(second.record).toBe(first.record);
    expect(second.countedNativeCrash).toBe(false);
    expect(second.holdBackground).toBe(false);
  });

  it("sin cierre registrado, nada", () => {
    const record = crashBRecord();
    const cross = crossNativeSessionRecord(record, null);
    expect(cross.record).toBe(record);
    expect(cross.countedNativeCrash).toBe(false);
  });

  it("un cruce posterior sin crash no pisa el veredicto de la muerte nativa anterior", () => {
    const first = crossNativeSessionRecord(crashBRecord(), exit("CRASH_NATIVE", 2_000));
    // Una generación nueva en la sesión siguiente y una cosecha de fondo después.
    const nextGen: NativeSessionRecord = { ...first.record, at: 3_000, generating: true, verdict: first.record.verdict };
    const cross = crossNativeSessionRecord(nextGen, exit("LOW_MEMORY", 4_000));
    expect(cross.record.verdict?.exitAt).toBe(2_000);
    expect(cross.record.verdict?.diedGenerating).toBe(true);
    expect(cross.countedNativeCrash).toBe(false);
  });
});

describe("la bandera de sesión de M3", () => {
  beforeEach(() => {
    resetBackgroundIndexingHold();
  });

  it("arranca libre, se levanta y se olvida", () => {
    expect(isBackgroundIndexingHeld()).toBe(false);
    holdBackgroundIndexingForSession();
    expect(isBackgroundIndexingHeld()).toBe(true);
    resetBackgroundIndexingHold();
    expect(isBackgroundIndexingHeld()).toBe(false);
  });
});
