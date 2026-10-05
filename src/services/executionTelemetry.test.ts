import { describe, it, expect } from "vitest";
import { executionRecordsToJson, executionRecordsToCsv, ExecutionTelemetryRecord } from "./executionTelemetry.pure";

function record(overrides: Partial<ExecutionTelemetryRecord> = {}): ExecutionTelemetryRecord {
  return {
    id: "1",
    createdAt: 1700000000000,
    adaptiveRoutingUsed: true,
    modelId: "qwen2.5-1.5b-instruct-q4km",
    taskType: "greeting",
    reasonCodes: ["retrieve:skipped-task-not-knowledge-based", "generate:role-fast-resolved-to-qwen"],
    retrievalUsed: false,
    modelSwitches: 0,
    crossMessageModelSwitch: true,
    modelResidency: "switched",
    modelLoadMs: 812.4,
    ttftMs: 210.9,
    generationLatencyMs: 4500.2,
    totalLatencyMs: 5600.1,
    tokensGenerated: 87,
    tokPerSec: 13.2,
    peakRssBytes: 2_400_000_000,
    outcome: "success",
    ...overrides,
  };
}

describe("executionRecordsToJson", () => {
  it("round-trips every field, including arrays, through JSON.parse", () => {
    const r = record();
    const parsed = JSON.parse(executionRecordsToJson([r]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(r);
  });

  it("does not include prompt or response text fields — telemetry never stores conversation content", () => {
    const json = executionRecordsToJson([record()]);
    expect(json).not.toMatch(/"prompt"/i);
    expect(json).not.toMatch(/"response"/i);
    expect(json).not.toMatch(/"text"/i);
  });
});

describe("executionRecordsToCsv", () => {
  it("produces a header row plus one row per record, in the declared column order", () => {
    const csv = executionRecordsToCsv([record({ id: "a" }), record({ id: "b" })]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].split(",")[0]).toBe("id");
    expect(lines[1].startsWith("a,")).toBe(true);
    expect(lines[2].startsWith("b,")).toBe(true);
  });

  it("joins reasonCodes with a pipe, not a comma, so a single reasonCodes value doesn't split across CSV columns", () => {
    const csv = executionRecordsToCsv([record()]);
    expect(csv).toContain("retrieve:skipped-task-not-knowledge-based|generate:role-fast-resolved-to-qwen");
  });

  it("quotes and escapes a cell containing a comma or a quote", () => {
    const csv = executionRecordsToCsv([record({ errorMessage: 'failed, said "the model"' })]);
    expect(csv).toContain('"failed, said ""the model"""');
  });

  it("renders undefined/null fields as empty cells, not the literal string 'undefined'", () => {
    const csv = executionRecordsToCsv([record({ modelId: undefined, reasonCodes: undefined })]);
    expect(csv).not.toContain("undefined");
  });

  it("handles an empty record list by emitting just the header", () => {
    const csv = executionRecordsToCsv([]);
    expect(csv.split("\n")).toHaveLength(1);
  });
});
