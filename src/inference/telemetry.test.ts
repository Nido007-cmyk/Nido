/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  clearTelemetry,
  getRecentTelemetry,
  ramRejectionEvent,
  recordInferenceEvent,
  recordRamRejection,
  type InferenceTelemetryEvent,
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
    });
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
