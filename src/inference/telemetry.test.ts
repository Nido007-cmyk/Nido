/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

// Fake de la base persistida para el lector de resúmenes de velocidad
// (G-1): captura los INSERT de persistEvent y los sirve como filas.
// dbx.fail simula «sin base»: getDatabase lanza y el lector debe
// devolver vacío sin lanzar.
const dbx = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  fail: false,
  reset() {
    this.rows = [];
    this.fail = false;
  },
}));

vi.mock("../security/databaseManager", () => ({
  getDatabase: async () => {
    if (dbx.fail) throw new Error("sin base");
    return {
      execAsync: async () => {},
      runAsync: async (sql: string, params: unknown[]) => {
        if (sql.includes("telemetry_rejections")) return { lastInsertRowId: 0 };
        const [
          ts, model_id, task_type, deterministic, prompt_chars, prompt_tokens_est,
          completion_tokens, ttft_ms, total_ms, tokens_per_sec, stop_reason,
          sampling_preset, temperature, n_predict,
        ] = params;
        dbx.rows.push({
          id: dbx.rows.length + 1, ts, model_id, task_type, deterministic,
          prompt_chars, prompt_tokens_est, completion_tokens, ttft_ms, total_ms,
          tokens_per_sec, stop_reason, sampling_preset, temperature, n_predict,
        });
        return { lastInsertRowId: dbx.rows.length };
      },
      getAllAsync: async () => [...dbx.rows].sort((a, b) => (b.id as number) - (a.id as number)),
    };
  },
  closeDatabase: async () => {},
}));

import {
  clearTelemetry,
  getRecentTelemetry,
  modelSpeedSummaries,
  parseStoredRamRejection,
  ramRejectionEvent,
  recordInferenceEvent,
  recordRamRejection,
  summarizeModelSpeeds,
  type InferenceTelemetryEvent,
  type ModelSpeedRow,
} from "./telemetry";

const base: InferenceTelemetryEvent = {
  ts: 1234567890,
  modelId: "models/qwen2.5-0.5b-instruct-q4km.gguf",
  taskType: "test",
  promptChars: 100,
  promptTokensEst: 34,
  completionTokens: 10,
  ttftMs: 50,
  totalMs: 200,
  tokensPerSec: 50,
  stopReason: "completed",
  nPredict: 512,
};

beforeEach(() => clearTelemetry());

describe("telemetry ring buffer", () => {
  it("records and returns events", () => {
    recordInferenceEvent(base);
    const events = getRecentTelemetry(10);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ taskType: "test", completionTokens: 10 });
  });

  it("respects the limit", () => {
    recordInferenceEvent({ ...base, taskType: "a" });
    recordInferenceEvent({ ...base, taskType: "b" });
    recordInferenceEvent({ ...base, taskType: "c" });
    expect(getRecentTelemetry(2).map((e) => e.taskType)).toEqual(["b", "c"]);
  });

  it("caps the ring at 500 (oldest evicted)", () => {
    for (let i = 0; i < 600; i++) recordInferenceEvent({ ...base, ts: i });
    const events = getRecentTelemetry(1000);
    expect(events).toHaveLength(500);
    expect(events[0].ts).toBe(100);
  });

  it("never throws, even on malformed input", () => {
    expect(() => recordInferenceEvent(undefined as never)).not.toThrow();
    expect(() => recordInferenceEvent(null as never)).not.toThrow();
  });

  it("marks deterministic (canned) events", () => {
    recordInferenceEvent({ ...base, deterministic: true, completionTokens: 0, modelId: null });
    const [e] = getRecentTelemetry(1);
    expect(e.deterministic).toBe(true);
    expect(e.modelId).toBeNull();
  });
});

describe("telemetry: rechazos del pre-flight (fase 2, reapertura 2026-11-08)", () => {
  const GiB = 1024 ** 3;

  it("el evento de rechazo lleva stopReason rejected y todas las cifras que vio el pre-flight", () => {
    const e = ramRejectionEvent(
      {
        modelId: "models/qwen3-0.6b-q4km.gguf",
        totalRamBytes: 3.54 * GiB,
        rssBytes: 0.4 * GiB,
        availBytes: 1.2 * GiB,
        thresholdBytes: 0.35 * GiB,
        availableBytes: 0.6 * GiB,
        neededBytes: 0.714 * GiB,
        nCtxChosen: 2048,
        nCtxRequested: 3072,
        crashSafety: 0.5,
      },
      4242,
    );
    expect(e.ts).toBe(4242);
    expect(e.stopReason).toBe("rejected");
    expect(e.taskType).toBe("model-load");
    expect(e.modelId).toBe("models/qwen3-0.6b-q4km.gguf");
    expect(e.completionTokens).toBe(0);
    expect(e.ttftMs).toBeNull();
    expect(e.ramRejection).toEqual({
      totalRamBytes: 3.54 * GiB,
      rssBytes: 0.4 * GiB,
      availBytes: 1.2 * GiB,
      thresholdBytes: 0.35 * GiB,
      availableBytes: 0.6 * GiB,
      neededBytes: 0.714 * GiB,
      nCtxChosen: 2048,
      nCtxRequested: 3072,
      crashSafety: 0.5,
      readFailure: null,
    });
  });

  it("0.1.85: un rechazo juzgado sin la lectura en vivo lo dice (readFailure live), no pasa por memoria insuficiente a secas", () => {
    const e = ramRejectionEvent({
      modelId: "models/qwen2.5-0.5b-instruct-q4km.gguf",
      totalRamBytes: 3.54 * GiB,
      rssBytes: 0.4 * GiB,
      availableBytes: 0.3 * GiB,
      neededBytes: 0.519 * GiB,
      nCtxChosen: 2048,
      nCtxRequested: 4096,
      crashSafety: null,
      readFailure: "live",
    });
    expect(e.ramRejection?.readFailure).toBe("live");
    const stored = {
      totalRamBytes: 3800000000,
      rssBytes: 400000000,
      availBytes: 1200000000,
      thresholdBytes: 350000000,
      availableBytes: 600000000,
      neededBytes: 714000000,
      nCtxChosen: 2048,
      nCtxRequested: 4096,
      crashSafety: 0.65,
    };
    const parsed = parseStoredRamRejection({
      id: 9,
      ts: 101,
      model_id: "models/qwen2.5-0.5b-instruct-q4km.gguf",
      task_type: "model-load",
      detail: JSON.stringify({ ...stored, readFailure: "live" }),
    });
    expect(parsed?.ramRejection.readFailure).toBe("live");
    // Las filas viejas (sin la clave) se leen como foto completa: null.
    const legacy = parseStoredRamRejection({
      id: 10,
      ts: 102,
      model_id: "models/qwen2.5-0.5b-instruct-q4km.gguf",
      task_type: "model-load",
      detail: JSON.stringify(stored),
    });
    expect(legacy?.ramRejection.readFailure).toBeNull();
  });

  it("un rechazo del motor de embeddings se marca como tal y sin CrashGuard", () => {
    const e = ramRejectionEvent({
      modelId: "models/embedding-multilingual.gguf",
      totalRamBytes: 3.54 * GiB,
      rssBytes: 0.4 * GiB,
      availableBytes: 0.1 * GiB,
      neededBytes: 0.169 * GiB,
      nCtxChosen: 512,
      nCtxRequested: 512,
      crashSafety: null,
      embedding: true,
    });
    expect(e.taskType).toBe("model-load-embedding");
    expect(e.ramRejection?.availBytes).toBeNull();
    expect(e.ramRejection?.crashSafety).toBeNull();
  });

  it("recordRamRejection deja el evento en el anillo, junto a las generaciones", () => {
    recordInferenceEvent(base);
    recordRamRejection({
      modelId: "models/qwen2.5-0.5b-instruct-q4km.gguf",
      totalRamBytes: 3.54 * GiB,
      rssBytes: 0.4 * GiB,
      availableBytes: 0.3 * GiB,
      neededBytes: 0.519 * GiB,
      nCtxChosen: 2048,
      nCtxRequested: 4096,
      crashSafety: 0.5,
    });
    const events = getRecentTelemetry(10);
    expect(events).toHaveLength(2);
    expect(events[1].stopReason).toBe("rejected");
    expect(events[1].ramRejection?.neededBytes).toBeCloseTo(0.519 * GiB, -5);
  });
});

describe("telemetry: el lector de rechazos persistidos (0.1.84)", () => {
  const detail = {
    totalRamBytes: 3800000000,
    rssBytes: 400000000,
    availBytes: 1200000000,
    thresholdBytes: 350000000,
    availableBytes: 600000000,
    neededBytes: 714000000,
    nCtxChosen: 2048,
    nCtxRequested: 4096,
    crashSafety: 0.65,
  };

  it("parsea una fila del JOIN con todas sus cifras y la marca de motor", () => {
    const parsed = parseStoredRamRejection({
      id: 7,
      ts: 99,
      model_id: "models/qwen3-0.6b-q4km.gguf",
      task_type: "model-load",
      detail: JSON.stringify(detail),
    });
    expect(parsed).toEqual({
      id: 7,
      ts: 99,
      modelId: "models/qwen3-0.6b-q4km.gguf",
      embedding: false,
      ramRejection: { ...detail, readFailure: null },
    });
    const emb = parseStoredRamRejection({
      id: 8,
      ts: 100,
      model_id: "models/e5.gguf",
      task_type: "model-load-embedding",
      detail: JSON.stringify({ ...detail, availBytes: null, thresholdBytes: null, crashSafety: null }),
    });
    expect(emb?.embedding).toBe(true);
    expect(emb?.ramRejection.availBytes).toBeNull();
    expect(emb?.ramRejection.crashSafety).toBeNull();
  });

  it("una fila ilegible o incompleta se descarta sin romper la lista", () => {
    const row = { id: 1, ts: 1, model_id: null, task_type: "model-load" };
    expect(parseStoredRamRejection({ ...row, detail: "no es json" })).toBeNull();
    expect(parseStoredRamRejection({ ...row, detail: JSON.stringify({ totalRamBytes: 1 }) })).toBeNull();
    expect(
      parseStoredRamRejection({ ...row, detail: JSON.stringify({ ...detail, neededBytes: "mucho" }) }),
    ).toBeNull();
  });
});

describe("telemetry: resúmenes de velocidad por modelo (G-1)", () => {
  const row = (over: Partial<ModelSpeedRow>): ModelSpeedRow => ({
    modelId: "models/a.gguf",
    tokensPerSec: 10,
    completionTokens: 64,
    deterministic: false,
    stopReason: "completed",
    ts: 1,
    ...over,
  });

  beforeEach(() => dbx.reset());

  it("la mediana sale del conjunto que califica (últimas 20), no de la media ni del último", () => {
    const rows = [
      row({ tokensPerSec: 100, ts: 5 }),
      row({ tokensPerSec: 30, ts: 4 }),
      row({ tokensPerSec: 20, ts: 3 }),
      row({ tokensPerSec: 10, ts: 2 }),
    ];
    // Media 40, último 100; la mediana de [10, 20, 30, 100] es 25.
    expect(summarizeModelSpeeds(rows)).toEqual([
      { modelId: "a.gguf", medianTokPerSec: 25, sampleCount: 4, lastTs: 5 },
    ]);
    // La ventana es de 20: con 25 muestras cuentan las 20 últimas
    // (tasas 6..25, mediana 15,5) y el conteo es 20.
    const many = Array.from({ length: 25 }, (_, i) =>
      row({ tokensPerSec: i + 1, ts: 100 + i }),
    ).reverse();
    expect(summarizeModelSpeeds(many)).toEqual([
      { modelId: "a.gguf", medianTokPerSec: 15.5, sampleCount: 20, lastTs: 124 },
    ]);
  });

  it("los eventos que no califican no entran, y un modelo con solo esos no tiene resumen", () => {
    const rows = [
      row({ modelId: "models/b.gguf", deterministic: true, tokensPerSec: 99, ts: 9 }),
      row({ modelId: "models/b.gguf", tokensPerSec: null, ts: 8 }),
      row({ modelId: "models/b.gguf", tokensPerSec: 0, ts: 7 }),
      row({ modelId: "models/b.gguf", tokensPerSec: 50, completionTokens: 10, ts: 6 }),
      row({ modelId: "models/b.gguf", tokensPerSec: 50, stopReason: "timeout", ts: 5 }),
      row({ modelId: "models/b.gguf", tokensPerSec: 50, stopReason: "error", ts: 4 }),
      row({ modelId: "models/b.gguf", tokensPerSec: 50, stopReason: "rejected", ts: 3 }),
      row({ modelId: null, tokensPerSec: 50, ts: 2 }),
      row({ tokensPerSec: 12, ts: 1 }),
      row({ tokensPerSec: 18, ts: 0 }),
    ];
    const summaries = summarizeModelSpeeds(rows);
    expect(summaries.map((s) => s.modelId)).toEqual(["a.gguf"]);
    expect(summaries[0].medianTokPerSec).toBe(15);
  });

  it("con un solo evento válido no hay velocidad: el resumen trae el conteo y la velocidad es null (regla de las 2 muestras)", () => {
    const rows = [
      row({ modelId: "models/d.gguf", tokensPerSec: 42, ts: 7 }),
      row({ modelId: "models/d.gguf", tokensPerSec: 50, completionTokens: 3, ts: 6 }),
    ];
    expect(summarizeModelSpeeds(rows)).toEqual([
      { modelId: "d.gguf", medianTokPerSec: null, sampleCount: 1, lastTs: 7 },
    ]);
  });

  it("sin base, el lector devuelve vacío y no lanza", async () => {
    dbx.fail = true;
    await expect(modelSpeedSummaries()).resolves.toEqual([]);
  });

  it("el resumen se lee de vuelta de la tabla persistida tras «reinicio» del módulo", async () => {
    const ev = (tokensPerSec: number, ts: number): InferenceTelemetryEvent => ({
      ...base,
      ts,
      tokensPerSec,
      completionTokens: 64,
    });
    recordInferenceEvent(ev(10, 1000));
    recordInferenceEvent(ev(20, 2000));
    recordInferenceEvent(ev(60, 3000));
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    expect(dbx.rows).toHaveLength(3);
    vi.resetModules();
    const fresh = await import("./telemetry");
    await expect(fresh.modelSpeedSummaries()).resolves.toEqual([
      {
        modelId: "qwen2.5-0.5b-instruct-q4km.gguf",
        medianTokPerSec: 20,
        sampleCount: 3,
        lastTs: 3000,
      },
    ]);
  });
});
