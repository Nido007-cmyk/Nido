/**
 * On-device evaluation harness: runs the fixed EVAL_SET against one or
 * more configurations (a specific installed model, or adaptive routing)
 * and produces comparable structured results. See docs/EVAL_QUERIES.md
 * for how to run it and read the output.
 *
 * Metrics come from the same sources chat uses — executor.ts's timing and
 * residency, telemetry.ts's peak-RSS sampler — and every query is also
 * written to the persisted execution telemetry (recordExecution), so eval
 * runs show up in the Execution Telemetry screen like any other message.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { getMemoryInfo } from "ram-monitor";
import { llamaEngine } from "../inference/LlamaEngine";
import { executeRoutingPlan, ExecutableModel, PipelineCallbacks, PipelineResult } from "../routing/executor";
import { classifyTask } from "../routing/classify";
import { runAdaptiveChat } from "../services/adaptiveChat";
import { recordExecution, type ExecutionOutcome } from "../services/executionTelemetry";
import { trackPeakRss } from "../services/telemetry";
import { ModelManager } from "../models/ModelManager";
import { MODEL_CATALOG, CatalogModel } from "../models/manifest";
import { DEFAULT_MAX_TOKENS, getRoutingPreset } from "../models/settings";
import { DEFAULT_PERSONALITY_ID, getPersonality } from "../constants/personalities";
import { EVAL_SET, EVAL_SET_VERSION, EvalQuery } from "./evalSet";
import {
  buildFixedModelPlan,
  EvalConfig,
  evalConfigId,
  EvalResultRow,
  evalRowsToCsv,
  evalRowsToJsonl,
  expectedKbHit,
  newEvalRunId,
  tokensPerSecond,
} from "./evalHarness.pure";

const modelManager = new ModelManager();

// Fixed, not read from the user's settings, so runs on different days or
// devices use the same prompt and budget. Recorded on every row.
const EVAL_PERSONALITY_ID = DEFAULT_PERSONALITY_ID;
const EVAL_MAX_TOKENS = DEFAULT_MAX_TOKENS;

export const EVAL_RESULTS_DIR = `${FileSystem.documentDirectory}eval/`;

/** Every curated-catalog LLM actually on disk. */
export async function listInstalledEvalModels(): Promise<CatalogModel[]> {
  const candidates = MODEL_CATALOG.filter((m) => m.kind === "llm");
  const statuses = await Promise.all(candidates.map((m) => modelManager.statusOf(m)));
  return statuses.filter((s) => s.present).map((s) => s.asset);
}

export interface EvalProgress {
  configIndex: number;
  configCount: number;
  queryIndex: number;
  queryCount: number;
  config: EvalConfig;
  query: EvalQuery;
}

export interface RunEvaluationOptions {
  configs: EvalConfig[];
  queries?: EvalQuery[];
  onProgress?: (p: EvalProgress) => void;
  onRow?: (row: EvalResultRow) => void;
  shouldStop?: () => boolean;
}

export interface EvaluationRun {
  runId: string;
  rows: EvalResultRow[];
  /** Where the JSONL results were saved on the device. */
  savedPath: string;
  stopped: boolean;
}

async function runOne(
  runId: string,
  config: EvalConfig,
  q: EvalQuery,
  models: Map<string, ExecutableModel>,
  routingPreset: string | undefined,
  shouldStop: () => boolean
): Promise<EvalResultRow> {
  const systemPrompt = getPersonality(EVAL_PERSONALITY_ID).systemPrompt;
  const peakRss = trackPeakRss(() => {
    try {
      return getMemoryInfo().rssBytes;
    } catch {
      return 0;
    }
  });
  const start = performance.now();
  let tokensGenerated = 0;
  const callbacks: PipelineCallbacks = {
    onToken: () => {
      tokensGenerated += 1;
    },
    shouldStop,
  };

  let result: PipelineResult | undefined;
  let taskType = classifyTask(q.query);
  let modelId = config.kind === "model" ? config.modelId : undefined;
  let errorMessage: string | undefined;

  try {
    const input = { query: q.query, systemPrompt };
    if (config.kind === "model") {
      const plan = buildFixedModelPlan(q.query, config.modelId, EVAL_MAX_TOKENS);
      result = await executeRoutingPlan(plan, input, (id) => models.get(id), callbacks);
    } else {
      const adaptive = await runAdaptiveChat(input, EVAL_MAX_TOKENS, callbacks);
      result = adaptive;
      taskType = adaptive.taskType;
      modelId = adaptive.plan.steps.find((s) => s.type === "generate")?.modelId;
    }
  } catch (e: any) {
    errorMessage = e?.message ?? String(e);
  }
  const totalLatencyMs = performance.now() - start;
  const peakRssBytes = peakRss.stop();

  const answer = result?.answer ?? "";
  const outcome: ExecutionOutcome = errorMessage
    ? "failure"
    : result!.stopped
      ? "cancelled"
      : answer.trim().length > 0
        ? "success"
        : "failure";
  if (outcome === "failure" && !errorMessage) {
    errorMessage = result?.warnings.join("; ") || "empty answer";
  }
  const retrievedTitles = result?.citations.map((c) => c.title) ?? [];

  const metrics = {
    modelId,
    taskType,
    adaptiveRoutingUsed: config.kind === "adaptive",
    reasonCodes: result?.plan.reasonCodes,
    retrievalUsed: result ? result.citations.length > 0 : undefined,
    modelSwitches: result?.modelSwitches,
    crossMessageModelSwitch: result?.crossMessageModelSwitch,
    modelResidency: result?.modelResidency,
    modelLoadMs: result?.modelLoadMs,
    ttftMs: result?.ttftMs,
    generationLatencyMs: result?.generationLatencyMs,
    totalLatencyMs,
    tokensGenerated,
    tokPerSec: tokensPerSecond(tokensGenerated, result?.generationLatencyMs),
    peakRssBytes,
    outcome,
    errorMessage,
  };

  recordExecution(metrics).catch(() => {});

  return {
    ...metrics,
    runId,
    evalSetVersion: EVAL_SET_VERSION,
    configId: evalConfigId(config),
    configLabel: config.label,
    routingPreset,
    personalityId: EVAL_PERSONALITY_ID,
    maxTokens: EVAL_MAX_TOKENS,
    queryId: q.id,
    category: q.category,
    query: q.query,
    answer,
    promptFormat: result?.promptFormat,
    retrievedTitles,
    expectedKbTitles: q.expectedKbTitles,
    expectedKbHit: expectedKbHit(q.expectedKbTitles, retrievedTitles),
    timedOut: result?.timedOut ?? false,
    createdAt: Date.now(),
  };
}

/**
 * Runs every query for the first config, then every query for the next,
 * so each model is loaded once per config rather than per query (the
 * first query of each config therefore carries the load cost — see
 * modelResidency/modelLoadMs). No conversation history: each query is
 * answered on its own.
 */
export async function runEvaluation({
  configs,
  queries = EVAL_SET,
  onProgress,
  onRow,
  shouldStop = () => false,
}: RunEvaluationOptions): Promise<EvaluationRun> {
  const runId = newEvalRunId();
  const rows: EvalResultRow[] = [];
  const residentBefore = llamaEngine.getModelInfo()?.filename ?? null;

  // An explicitly selected model is always measured in its own instruction
  // format: the chat template shipped in its GGUF, falling back to the plain
  // prompt only if the file has none. Not the catalog's usesChatTemplate
  // flag, which is a live-chat setting (Phi and Qwen-7B are off there).
  const installed = await listInstalledEvalModels();
  const models = new Map<string, ExecutableModel>(
    installed.map((m) => [m.id, { id: m.id, filename: m.filename, usesChatTemplate: "if-embedded" }])
  );
  const routingPreset = configs.some((c) => c.kind === "adaptive") ? await getRoutingPreset() : undefined;

  console.log(`[EVAL] run ${runId} start — set v${EVAL_SET_VERSION}, ${queries.length} queries x ${configs.length} configs`);
  let stopped = false;
  try {
    outer: for (let ci = 0; ci < configs.length; ci++) {
      for (let qi = 0; qi < queries.length; qi++) {
        if (shouldStop()) {
          stopped = true;
          break outer;
        }
        const config = configs[ci];
        const query = queries[qi];
        onProgress?.({ configIndex: ci, configCount: configs.length, queryIndex: qi, queryCount: queries.length, config, query });
        const row = await runOne(runId, config, query, models, config.kind === "adaptive" ? routingPreset : undefined, shouldStop);
        rows.push(row);
        console.log(`[EVAL] ${JSON.stringify(row)}`);
        onRow?.(row);
      }
    }
  } finally {
    // Leave chat on the model it had before the run, not the last one evaluated.
    const residentAfter = llamaEngine.getModelInfo()?.filename ?? null;
    if (residentBefore && residentAfter !== residentBefore) {
      await llamaEngine.load(residentBefore).catch((e) => console.warn("[EVAL] could not restore previous model:", e?.message ?? e));
    }
  }

  await FileSystem.makeDirectoryAsync(EVAL_RESULTS_DIR, { intermediates: true }).catch(() => {});
  const savedPath = `${EVAL_RESULTS_DIR}${runId}.jsonl`;
  await FileSystem.writeAsStringAsync(savedPath, evalRowsToJsonl(rows));
  console.log(`[EVAL] run ${runId} ${stopped ? "stopped" : "done"} — ${rows.length} rows saved to ${savedPath}`);
  return { runId, rows, savedPath, stopped };
}

/** Hands results to the OS share sheet, same as exportExecutionTelemetry. */
export async function exportEvalResults(run: Pick<EvaluationRun, "runId" | "rows">, format: "jsonl" | "csv"): Promise<void> {
  const content = format === "jsonl" ? evalRowsToJsonl(run.rows) : evalRowsToCsv(run.rows);
  const path = `${FileSystem.cacheDirectory}${run.runId}.${format}`;
  await FileSystem.writeAsStringAsync(path, content);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device");
  await Sharing.shareAsync(path, {
    mimeType: format === "jsonl" ? "application/x-ndjson" : "text/csv",
    dialogTitle: "Export evaluation results",
  });
}
