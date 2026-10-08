/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/// <reference types="node" />
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let resident: string | null = null;
const loadMock = vi.fn(async (filename: string) => {
  resident = filename;
});
const generateMock = vi.fn(async (opts: any) => {
  for (const piece of ["Mock", " answer", "."]) opts.onToken?.(piece);
  return "Mock answer.";
});
const retrieveMock = vi.fn(async (_query: string) => [] as any[]);
const presentIds = new Set<string>();
const recordExecutionMock = vi.fn(async (_r: any) => {});
const writeMock = vi.fn(async (_path: string, _content: string) => {});
// Model files whose GGUF ships a chat template (all three curated models do).
const filesWithTemplate = new Set<string>();

vi.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    load: (f: string) => loadMock(f),
    generate: (o: any) => generateMock(o),
    getModelInfo: () => (resident ? { filename: resident, nCtx: 4096, nThreads: 4 } : null),
    hasEmbeddedChatTemplate: () => (resident ? filesWithTemplate.has(resident) : false),
  },
}));
vi.mock("../rag/retrieve", () => ({ retrieve: (q: string) => retrieveMock(q) }));
vi.mock("../models/ModelManager", () => ({
  ModelManager: class {
    async statusOf(asset: any) {
      return { asset, present: presentIds.has(asset.id), sizeOnDiskBytes: 0, checksumOk: null };
    }
    async statusAll() {
      const { MODEL_CATALOG } = await import("../models/manifest");
      return Promise.all(MODEL_CATALOG.map((m) => this.statusOf(m)));
    }
  },
}));
vi.mock("../models/settings", () => ({
  DEFAULT_MAX_TOKENS: 512,
  getRoutingPreset: async () => "balanced",
  getModelRoleAssignments: async () => ({}),
  getActiveModelId: async () => "phi-3.5-mini-instruct-q4km",
}));
vi.mock("ram-monitor", () => ({
  getMemoryInfo: () => ({ rssBytes: 1_500_000_000 }),
  getDeviceTotalRamBytes: () => 12 * 1024 ** 3,
}));
vi.mock("../services/executionTelemetry", () => ({ recordExecution: (r: any) => recordExecutionMock(r) }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  cacheDirectory: "file:///cache/",
  makeDirectoryAsync: async () => {},
  writeAsStringAsync: (p: string, c: string) => writeMock(p, c),
}));
vi.mock("expo-sharing", () => ({ isAvailableAsync: async () => true, shareAsync: async () => {} }));

import { EVAL_SET, EvalCategory } from "./evalSet";
import {
  buildFixedModelPlan,
  EVAL_CSV_COLUMNS,
  evalConfigId,
  evalRowsToCsv,
  evalRowsToJsonl,
  expectedKbHit,
  tokensPerSecond,
  EvalResultRow,
} from "./evalHarness.pure";
import { runEvaluation } from "./evalHarness";
import { MODEL_CATALOG } from "../models/manifest";

const PHI = MODEL_CATALOG.find((m) => m.id === "phi-3.5-mini-instruct-q4km")!;
const QWEN = MODEL_CATALOG.find((m) => m.id === "qwen2.5-1.5b-instruct-q4km")!;

beforeEach(() => {
  resident = null;
  presentIds.clear();
  filesWithTemplate.clear();
  filesWithTemplate.add(PHI.filename).add(QWEN.filename);
  loadMock.mockClear();
  generateMock.mockClear();
  retrieveMock.mockReset().mockResolvedValue([]);
  recordExecutionMock.mockClear();
  writeMock.mockClear();
});

describe("eval set", () => {
  it("covers every required category", () => {
    const required: EvalCategory[] = [
      "greeting", "factual", "explanation", "comparison", "synthesis", "reasoning", "retrieval-grounded", "no-kb-content",
    ];
    const present = new Set(EVAL_SET.map((q) => q.category));
    for (const c of required) expect(present.has(c)).toBe(true);
  });

  it("has unique ids", () => {
    expect(new Set(EVAL_SET.map((q) => q.id)).size).toBe(EVAL_SET.length);
  });

  it("only expects corpus articles that actually exist in the bundled corpus", () => {
    const dir = join(__dirname, "../../assets/corpus");
    const titles = new Set(
      ["corpus.json", "corpus-standard.json", "corpus-full.json"].flatMap((f) =>
        (JSON.parse(readFileSync(join(dir, f), "utf8")) as Array<{ title: string }>).map((d) => d.title)
      )
    );
    for (const q of EVAL_SET) for (const t of q.expectedKbTitles) expect(titles.has(t), `${q.id}: ${t}`).toBe(true);
    for (const q of EVAL_SET.filter((q) => q.category === "no-kb-content")) expect(q.expectedKbTitles).toEqual([]);
  });
});

describe("buildFixedModelPlan", () => {
  it("retrieves then generates with exactly the given model", () => {
    const plan = buildFixedModelPlan("How do vaccines work?", QWEN.id, 512);
    expect(plan.steps.map((s) => s.type)).toEqual(["retrieve", "generate"]);
    expect(plan.steps[1]).toMatchObject({ modelId: QWEN.id, maxTokens: 512, required: true });
    expect(plan.reasonCodes).toContain("eval:fixed-model");
  });

  it("skips retrieval for a greeting, like the fixed-model chat path, without capping tokens", () => {
    const plan = buildFixedModelPlan("hey, what's up?", PHI.id, 512);
    expect(plan.steps.map((s) => s.type)).toEqual(["generate"]);
    expect(plan.steps[0].maxTokens).toBe(512);
  });
});

describe("result helpers", () => {
  it("ids configs, computes tok/s and KB hits", () => {
    expect(evalConfigId({ kind: "model", modelId: "x", label: "X" })).toBe("model:x");
    expect(evalConfigId({ kind: "adaptive", label: "A" })).toBe("adaptive");
    expect(tokensPerSecond(20, 2000)).toBe(10);
    expect(tokensPerSecond(0, 2000)).toBeUndefined();
    expect(tokensPerSecond(20, undefined)).toBeUndefined();
    expect(expectedKbHit([], ["A"])).toBeNull();
    expect(expectedKbHit(["A", "B"], ["B", "A", "C"])).toBe(true);
    expect(expectedKbHit(["A", "B"], ["A"])).toBe(false);
  });

  it("exports every requested field, and escapes answers safely in CSV", () => {
    for (const f of [
      "query", "modelId", "taskType", "answer", "retrievalUsed", "modelSwitches", "modelResidency", "modelLoadMs",
      "ttftMs", "generationLatencyMs", "totalLatencyMs", "tokPerSec", "peakRssBytes", "outcome", "errorMessage",
    ] as const) {
      expect(EVAL_CSV_COLUMNS).toContain(f);
    }
    const row = { queryId: "q", answer: 'Line one, "quoted"\nline two', retrievedTitles: ["A", "B"] } as unknown as EvalResultRow;
    const csv = evalRowsToCsv([row]);
    expect(csv.split("\n")[0]).toBe(EVAL_CSV_COLUMNS.join(","));
    expect(csv).toContain('"Line one, ""quoted""\nline two"');
    expect(csv).toContain(",A|B,");
    expect(JSON.parse(evalRowsToJsonl([row]))).toEqual(row);
  });
});

describe("runEvaluation", () => {
  const queries = [EVAL_SET.find((q) => q.id === "greeting-1")!, EVAL_SET.find((q) => q.id === "grounded-2")!];

  it("runs every query per config, in config order, with the requested model", async () => {
    presentIds.add(PHI.id).add(QWEN.id);
    retrieveMock.mockResolvedValue([
      { chunkId: "c1", docId: "d1", title: "Black hole", body: "b", score: 1, matchType: "hybrid" },
    ]);
    const run = await runEvaluation({
      configs: [
        { kind: "model", modelId: QWEN.id, label: "Qwen" },
        { kind: "model", modelId: PHI.id, label: "Phi" },
      ],
      queries,
    });

    expect(run.rows.map((r) => `${r.configId}/${r.queryId}`)).toEqual([
      `model:${QWEN.id}/greeting-1`,
      `model:${QWEN.id}/grounded-2`,
      `model:${PHI.id}/greeting-1`,
      `model:${PHI.id}/grounded-2`,
    ]);
    expect(loadMock.mock.calls.map((c) => c[0])).toEqual([QWEN.filename, PHI.filename]);

    const [qGreet, qGrounded, pGreet] = run.rows;
    expect(qGreet).toMatchObject({ modelId: QWEN.id, taskType: "greeting", retrievalUsed: false, modelResidency: "cold", outcome: "success", answer: "Mock answer.", tokensGenerated: 3, peakRssBytes: 1_500_000_000 });
    expect(qGrounded).toMatchObject({ retrievalUsed: true, retrievedTitles: ["Black hole"], expectedKbHit: true, modelResidency: "resident", modelLoadMs: 0 });
    expect(pGreet).toMatchObject({ modelId: PHI.id, modelResidency: "switched", crossMessageModelSwitch: true });
    expect(qGreet.ttftMs).toBeGreaterThanOrEqual(0);
    expect(qGreet.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("measures each selected model in its own chat template, Phi included", async () => {
    presentIds.add(PHI.id).add(QWEN.id);
    const run = await runEvaluation({
      configs: [
        { kind: "model", modelId: QWEN.id, label: "Qwen" },
        { kind: "model", modelId: PHI.id, label: "Phi" },
      ],
      queries: [queries[1]],
    });
    for (const call of generateMock.mock.calls) {
      expect(call[0].messages).toBeDefined();
      expect(call[0].prompt).toBeUndefined();
    }
    expect(run.rows.map((r) => r.promptFormat)).toEqual(["chat-template", "chat-template"]);
  });

  it("falls back to the plain prompt only for a model file without a template, and says so", async () => {
    presentIds.add(PHI.id);
    filesWithTemplate.clear();
    const run = await runEvaluation({ configs: [{ kind: "model", modelId: PHI.id, label: "Phi" }], queries: [queries[1]] });
    expect(generateMock.mock.calls[0][0].prompt).toBeDefined();
    expect(run.rows[0].promptFormat).toBe("plain");
  });

  it("uses the same generation settings in both formats apart from the prompt", async () => {
    presentIds.add(PHI.id);
    await runEvaluation({ configs: [{ kind: "model", modelId: PHI.id, label: "Phi" }], queries: [queries[1]] });
    filesWithTemplate.clear();
    await runEvaluation({ configs: [{ kind: "model", modelId: PHI.id, label: "Phi" }], queries: [queries[1]] });
    const [withTemplate, plain] = generateMock.mock.calls.map((c) => c[0]);
    expect(withTemplate.nPredict).toBe(plain.nPredict);
    expect(withTemplate.temperature).toBe(plain.temperature);
    expect(withTemplate.timeoutMs).toBe(plain.timeoutMs);
  });

  it("leaves the adaptive config on live-chat formatting (Phi plain), and records it", async () => {
    presentIds.add(PHI.id).add(QWEN.id);
    const comparison = EVAL_SET.find((q) => q.id === "comparison-1")!;
    const run = await runEvaluation({ configs: [{ kind: "adaptive", label: "Adaptive" }], queries: [comparison] });
    expect(run.rows[0].modelId).toBe(PHI.id);
    expect(run.rows[0].promptFormat).toBe("plain");
  });

  it("records every query in the persisted execution telemetry", async () => {
    presentIds.add(PHI.id);
    await runEvaluation({ configs: [{ kind: "model", modelId: PHI.id, label: "Phi" }], queries });
    expect(recordExecutionMock).toHaveBeenCalledTimes(2);
    expect(recordExecutionMock.mock.calls[0][0]).toMatchObject({ modelId: PHI.id, adaptiveRoutingUsed: false, outcome: "success" });
  });

  it("adaptive config records the routed model and the preset", async () => {
    presentIds.add(PHI.id).add(QWEN.id);
    const run = await runEvaluation({ configs: [{ kind: "adaptive", label: "Adaptive" }], queries: [queries[0]] });
    expect(run.rows[0]).toMatchObject({ configId: "adaptive", routingPreset: "balanced", adaptiveRoutingUsed: true, modelId: QWEN.id });
  });

  it("reports a model that isn't installed as a failure row instead of aborting the run", async () => {
    presentIds.add(PHI.id);
    const run = await runEvaluation({
      configs: [
        { kind: "model", modelId: "not-installed", label: "Missing" },
        { kind: "model", modelId: PHI.id, label: "Phi" },
      ],
      queries: [queries[0]],
    });
    expect(run.rows[0].outcome).toBe("failure");
    expect(run.rows[0].errorMessage).toBeTruthy();
    expect(run.rows[1].outcome).toBe("success");
  });

  it("stops between queries and saves what it has", async () => {
    presentIds.add(PHI.id);
    let stop = false;
    const run = await runEvaluation({
      configs: [{ kind: "model", modelId: PHI.id, label: "Phi" }],
      queries,
      onRow: () => {
        stop = true;
      },
      shouldStop: () => stop,
    });
    expect(run.stopped).toBe(true);
    expect(run.rows).toHaveLength(1);
    expect(writeMock).toHaveBeenCalledWith(run.savedPath, evalRowsToJsonl(run.rows));
    expect(run.savedPath).toMatch(/^file:\/\/\/docs\/eval\/eval-.*\.jsonl$/);
  });

  it("restores the model that was resident before the run", async () => {
    presentIds.add(PHI.id).add(QWEN.id);
    resident = PHI.filename;
    await runEvaluation({ configs: [{ kind: "model", modelId: QWEN.id, label: "Qwen" }], queries: [queries[0]] });
    expect(resident).toBe(PHI.filename);
  });
});
