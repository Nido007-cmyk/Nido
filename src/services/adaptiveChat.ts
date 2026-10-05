/**
 * Adaptive routing Phase 9 — wires the router/executor (src/routing/,
 * Phases 3-4) into ordinary chat. This is the ONLY new integration point:
 * Deep Research Mode (src/services/orchestrator.ts) is completely
 * separate and untouched — this module is never called from that path.
 *
 * Feature-flagged (settings.ts's getAdaptiveRoutingEnabled, off by
 * default) and designed to fail safe: every external call here (disk
 * status, settings, RAM readout) is wrapped so a single failure degrades
 * gracefully rather than throwing, and the ONE thing this module cannot
 * protect against — executeRoutingPlan() itself throwing — is explicitly
 * the caller's (ChatScreen.tsx's) responsibility to catch and fall back to
 * the existing fixed-active-model path. A routing failure must never leave
 * the user without a response.
 */
import { classifyTask } from "../routing/classify";
import { buildModelProfiles, AvailableModel } from "../routing/profiles";
import { planRoute, RoutingContext } from "../routing/router";
import {
  executeRoutingPlan,
  ExecutableModel,
  PipelineCallbacks,
  PipelineInput,
  PipelineResult,
} from "../routing/executor";
import { ModelManager } from "../models/ModelManager";
import { MODEL_CATALOG, CatalogModel } from "../models/manifest";
import { getRoutingPreset, getModelRoleAssignments, getActiveModelId } from "../models/settings";
import { getDeviceTotalRamBytes } from "ram-monitor";
import type { TaskType } from "../routing/types";

const modelManager = new ModelManager();

export interface AdaptiveChatResult extends PipelineResult {
  /** The model that actually generated the answer (the plan's "generate" step's model), for telemetry/UI — undefined only if planRoute produced no generate step at all. */
  modelUsed?: CatalogModel;
  /** classifyTask(input.query)'s result — exposed here since RoutingPlan itself doesn't carry the task type, only the decisions made from it. */
  taskType: TaskType;
}

/**
 * Resolves current on-device state (which models are downloaded, the
 * user's routing preset/overrides, device RAM) and runs one adaptive
 * routing pass: classify -> plan -> execute. Every step reuses existing,
 * already-tested infrastructure (classify.ts, profiles.ts, router.ts,
 * executor.ts) — nothing here reimplements routing logic, it only wires
 * pieces that previously had no caller.
 */
export async function runAdaptiveChat(
  input: PipelineInput,
  maxTokens: number,
  callbacks: PipelineCallbacks = {}
): Promise<AdaptiveChatResult> {
  const [statuses, preset, overrides, fallbackId] = await Promise.all([
    modelManager.statusAll(),
    getRoutingPreset(),
    getModelRoleAssignments(),
    getActiveModelId("llm"),
  ]);

  const available: AvailableModel[] = statuses
    .filter((s) => s.asset.kind === "llm")
    .map((s) => ({ model: s.asset, present: s.present }));

  let deviceRamBytes = 0;
  try {
    deviceRamBytes = getDeviceTotalRamBytes();
  } catch {
    // Same fallback profiles.ts already handles: an unavailable RAM readout
    // degrades compatibility badges to "unknown", never blocks routing.
    deviceRamBytes = 0;
  }

  const taskType = classifyTask(input.query);
  const profiles = buildModelProfiles(preset, available, overrides, deviceRamBytes, fallbackId ?? undefined);

  const context: RoutingContext = {
    taskType,
    query: input.query,
    hasLocalKnowledgeBase: true,
    retrievalAvailable: true,
    availableModels: profiles,
    preset,
    budget: { maxTokens, allowVerification: true, allowRetrieval: true },
  };

  const plan = planRoute(context);

  const modelById = new Map<string, ExecutableModel>(
    available
      .filter((a) => a.present)
      .map((a) => [
        a.model.id,
        { id: a.model.id, filename: a.model.filename, usesChatTemplate: a.model.capabilities?.usesChatTemplate },
      ])
  );
  const resolveModel = (modelId: string) => modelById.get(modelId);

  // Timing (modelLoadMs/ttftMs/generationLatencyMs) and residency are
  // measured precisely inside executeRoutingPlan() itself, scoped to the
  // generate step specifically — see PipelineResult's own doc comments.
  // No separate timing wraps this call; a coarser "whole plan" duration
  // would just re-conflate load+retrieve+generate the way the old,
  // superseded measurement here used to.
  const result = await executeRoutingPlan(plan, input, resolveModel, callbacks);

  const generateModelId = plan.steps.find((s) => s.type === "generate")?.modelId;
  const modelUsed = generateModelId ? MODEL_CATALOG.find((m) => m.id === generateModelId) : undefined;

  return { ...result, modelUsed, taskType };
}
