/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  clearTelemetry,
  getRecentTelemetry,
  recordInferenceEvent,
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
