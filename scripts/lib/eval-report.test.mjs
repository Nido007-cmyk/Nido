/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { configStats, dedupeRows, formatAnswers, formatReport, formatTable, mean, median, parseRows } from "./eval-report.mjs";

const row = (over) => ({
  runId: "eval-1",
  evalSetVersion: "1",
  configId: "model:phi",
  configLabel: "Phi",
  queryId: "q1",
  category: "explanation",
  query: "How do vaccines work?",
  modelId: "phi",
  promptFormat: "chat-template",
  answer: "They train the immune system.",
  outcome: "success",
  retrievalUsed: true,
  retrievedTitles: ["Vaccine"],
  expectedKbHit: true,
  modelResidency: "resident",
  modelLoadMs: 0,
  modelSwitches: 0,
  crossMessageModelSwitch: false,
  ttftMs: 1000,
  generationLatencyMs: 9000,
  totalLatencyMs: 11000,
  tokPerSec: 10,
  peakRssBytes: 3 * 1024 ** 3,
  ...over,
});

describe("reading rows", () => {
  it("reads JSONL and Metro log lines, ignoring everything else", () => {
    const a = row({ queryId: "a" });
    const b = row({ queryId: "b" });
    const text = [JSON.stringify(a), " LOG  [EVAL] run eval-1 start", ` LOG  [EVAL] ${JSON.stringify(b)}`, "garbage", "{not json"].join("\n");
    expect(parseRows(text).map((r) => r.queryId)).toEqual(["a", "b"]);
  });

  it("dedupes by run, config and query", () => {
    expect(dedupeRows([row({ answer: "old" }), row({ answer: "new" })])).toEqual([row({ answer: "new" })]);
  });
});

describe("statistics", () => {
  it("computes median and mean over numbers only", () => {
    expect(median([3, 1, undefined, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(mean([2, 4, null])).toBe(3);
    expect(median([])).toBeUndefined();
  });

  it("averages model load only over queries that loaded, and counts residency", () => {
    const s = configStats([
      row({ queryId: "a", modelResidency: "cold", modelLoadMs: 8000, crossMessageModelSwitch: false }),
      row({ queryId: "b" }),
      row({ queryId: "c", outcome: "failure", retrievalUsed: false, expectedKbHit: false }),
      row({ queryId: "d", expectedKbHit: null }),
    ]);
    expect(s).toMatchObject({ n: 4, ok: 3, failed: 1, retrievalUsed: 3, kbHit: "2/3" });
    expect(s.load).toEqual({ avg: 8000, p50: 8000, count: 1 });
    expect(s.residency).toEqual({ cold: 1, switched: 0, resident: 3 });
    expect(s.peakRss).toBe(3 * 1024 ** 3);
  });
});

describe("formatting", () => {
  const rows = [
    row({ queryId: "a", modelResidency: "cold", modelLoadMs: 8000 }),
    row({ queryId: "b" }),
    row({ configId: "adaptive", configLabel: "Adaptive", queryId: "a", modelId: "qwen", promptFormat: "chat-template" }),
    row({ configId: "adaptive", configLabel: "Adaptive", queryId: "b", outcome: "failure", errorMessage: "empty answer" }),
  ];

  it("prints a block per config with the requested metrics", () => {
    const report = formatReport(rows);
    for (const s of ["NIDO Device Evaluation — eval-1 (set v1, 2 queries)", "Phi", "Adaptive", "TTFT:", "Model load:", "Generation:", "Tokens/sec:", "Peak RSS:", "Residency:", "Model switches:", "Retrieval:", "Models used:     qwen, phi", "Adaptive / b: failure — empty answer"]) {
      expect(report).toContain(s);
    }
  });

  it("prints a table and a grading sheet", () => {
    expect(formatTable(rows).split("\n")[0]).toMatch(/^run \/ config\s+format/);
    const answers = formatAnswers(rows);
    expect(answers).toContain("## a (explanation)");
    expect(answers).toContain("### Adaptive — phi · chat-template · failure · retrieval: Vaccine");
    expect(answers).toContain("empty answer");
  });
});
