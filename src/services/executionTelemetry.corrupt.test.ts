/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import {
  fromExecutionRow,
  type ExecutionRow,
} from "./executionTelemetry.pure";

const row: ExecutionRow = {
  id: "e1",
  created_at: 1700000000000,
  model_id: "qwen2.5-1.5b",
  task_type: "chat",
  adaptive_routing_used: 1,
  reason_codes: JSON.stringify(["fast", "local"]),
  retrieval_used: 0,
  model_switches: 0,
  cross_message_model_switch: null,
  model_residency: "ram",
  model_load_ms: 120,
  ttft_ms: 30,
  generation_latency_ms: 400,
  total_latency_ms: 550,
  tokens_generated: 42,
  tok_per_sec: 12.5,
  peak_rss_bytes: 1000000,
  outcome: "ok",
  error_message: null,
};

describe("fromExecutionRow — corrupt persisted rows", () => {
  it("parses a well-formed row, including reason codes", () => {
    const rec = fromExecutionRow(row);
    expect(rec.reasonCodes).toEqual(["fast", "local"]);
    expect(rec.adaptiveRoutingUsed).toBe(true);
    expect(rec.retrievalUsed).toBe(false);
  });

  it("treats a NULL reason_codes column as undefined", () => {
    expect(fromExecutionRow({ ...row, reason_codes: null }).reasonCodes).toBeUndefined();
  });

  it("treats an empty-string reason_codes column as undefined", () => {
    expect(fromExecutionRow({ ...row, reason_codes: "" }).reasonCodes).toBeUndefined();
  });

  it("FAIL-SAFE (Q-1): corrupt reason_codes JSON degrades to undefined instead of throwing", () => {
    // One bad row must not break listRecentExecutions() or the Telemetry
    // screen — the corrupt cell is treated as absent.
    const rec = fromExecutionRow({ ...row, reason_codes: "{not-json" });
    expect(rec.reasonCodes).toBeUndefined();
    expect(rec.id).toBe("e1");
  });

  it("FAIL-SAFE (Q-1): reason_codes with valid JSON but wrong shape degrades to undefined", () => {
    // A row whose reason_codes is valid JSON but not an array of strings
    // (e.g. a bare string) is treated as absent rather than flowing through raw.
    const rec = fromExecutionRow({ ...row, reason_codes: JSON.stringify("oops") });
    expect(rec.reasonCodes).toBeUndefined();
  });
});
