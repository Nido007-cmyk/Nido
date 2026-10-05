/**
 * Native-module-free half of the evaluation harness (see evalHarness.ts and
 * docs/EVAL_QUERIES.md): configuration ids, the fixed-model plan, result
 * rows and export formatting. Unit-testable under plain vitest.
 */
import { classifyTask, isRetrievalIrrelevant } from "../routing/classify";
import type { RoutingPlan, RoutingStep } from "../routing/router";
import type { PromptFormat } from "../routing/executor";
import { csvCell, type ExecutionTelemetryRecord } from "../services/executionTelemetry.pure";
import type { EvalCategory } from "./evalSet";

/**
 * "model": every query answered by one specific installed model, with the
 * same retrieval decision the fixed-model chat path makes.
 * "adaptive": every query goes through runAdaptiveChat with the current
 * routing preset, exactly like chat with Adaptive Routing on.
 */
export type EvalConfig =
  | { kind: "model"; modelId: string; label: string }
  | { kind: "adaptive"; label: string };

export function evalConfigId(config: EvalConfig): string {
  return config.kind === "model" ? `model:${config.modelId}` : "adaptive";
}

/**
 * One result row = the same metrics the persisted execution telemetry
 * records for a chat message (ExecutionTelemetryRecord), plus what an
 * evaluation needs on top: which run/config/query it was, and the answer.
 */
export interface EvalResultRow extends Omit<ExecutionTelemetryRecord, "id" | "createdAt"> {
  runId: string;
  evalSetVersion: string;
  configId: string;
  configLabel: string;
  /** Only for the adaptive config: the routing preset in effect. */
  routingPreset?: string;
  personalityId: string;
  maxTokens: number;
  queryId: string;
  category: EvalCategory;
  query: string;
  answer: string;
  /** Prompt format the answer was generated with: the model's own chat template, or the plain fallback. Undefined if no generate step ran. */
  promptFormat?: PromptFormat;
  retrievedTitles: string[];
  expectedKbTitles: string[];
  /** Whether every expected corpus article was retrieved; null when none are expected. */
  expectedKbHit: boolean | null;
  timedOut: boolean;
  createdAt: number;
}

export function newEvalRunId(now = Date.now()): string {
  return `eval-${new Date(now).toISOString().replace(/[:.]/g, "-")}`;
}

/**
 * The plan for a "model" config: retrieve (unless the task type makes
 * local documents irrelevant, same rule as the fixed-model chat path),
 * then generate with the given model. Built here rather than by planRoute
 * because the point of this config is to NOT let routing pick the model.
 */
export function buildFixedModelPlan(query: string, modelId: string, maxTokens: number): RoutingPlan {
  const taskType = classifyTask(query);
  const retrieve = !isRetrievalIrrelevant(taskType);
  const steps: RoutingStep[] = [];
  if (retrieve) steps.push({ id: "retrieve-0", type: "retrieve", required: false });
  steps.push({ id: `generate-${steps.length}`, type: "generate", modelId, required: true, maxTokens });
  return {
    steps,
    selectedModelIds: [modelId],
    estimatedCost: { modelSwitches: 0 },
    fallbackPolicy: "fail",
    reasonCodes: [
      "eval:fixed-model",
      retrieve ? "retrieve:relevant-to-task" : "retrieve:skipped-task-not-knowledge-based",
      `generate:fixed-${modelId}`,
    ],
  };
}

export function tokensPerSecond(tokensGenerated: number, generationLatencyMs: number | undefined): number | undefined {
  if (!generationLatencyMs || generationLatencyMs <= 0 || tokensGenerated <= 0) return undefined;
  return tokensGenerated / (generationLatencyMs / 1000);
}

export function expectedKbHit(expected: string[], retrieved: string[]): boolean | null {
  if (expected.length === 0) return null;
  return expected.every((title) => retrieved.includes(title));
}

export function evalRowsToJsonl(rows: EvalResultRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

export const EVAL_CSV_COLUMNS: Array<keyof EvalResultRow> = [
  "runId",
  "evalSetVersion",
  "configId",
  "configLabel",
  "routingPreset",
  "personalityId",
  "maxTokens",
  "queryId",
  "category",
  "query",
  "modelId",
  "promptFormat",
  "taskType",
  "adaptiveRoutingUsed",
  "retrievalUsed",
  "retrievedTitles",
  "expectedKbTitles",
  "expectedKbHit",
  "reasonCodes",
  "modelSwitches",
  "crossMessageModelSwitch",
  "modelResidency",
  "modelLoadMs",
  "ttftMs",
  "generationLatencyMs",
  "totalLatencyMs",
  "tokensGenerated",
  "tokPerSec",
  "peakRssBytes",
  "outcome",
  "errorMessage",
  "timedOut",
  "answer",
  "createdAt",
];

export function evalRowsToCsv(rows: EvalResultRow[]): string {
  const header = EVAL_CSV_COLUMNS.join(",");
  const lines = rows.map((r) => EVAL_CSV_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return [header, ...lines].join("\n");
}
