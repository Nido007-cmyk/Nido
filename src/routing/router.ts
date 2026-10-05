/**
 * Adaptive routing Phase 3 — deterministic routing policy. Given a task and
 * what's actually available, decides an execution plan (a typed list of
 * steps) — it does NOT execute anything (that's Phase 4's executor.ts) and
 * it does NOT judge whether an eventual answer is correct ("The router
 * should not claim that an answer is correct. It chooses an execution
 * plan.").
 *
 * Deliberately rule-based, not LLM-driven, per the build plan. Same input
 * always produces the same plan — planRoute has no side effects and calls
 * nothing async.
 */
import { ModelProfile } from "./profiles";
import { TaskType, ModelRole, RoutingPreset, RoutingStepType } from "./types";
import { isRetrievalIrrelevant } from "./classify";

// A greeting/pure-small-talk reply has no substantive content to fill a
// large budget with — see planRoute's own comment on where this was found
// (a real-device "whats up?" test running to the full 512-token default
// and free-associating into an unrelated multi-question ramble). Within
// the 64-128 token range that's reasonable for a short conversational
// reply, not a fixed/arbitrary pick — still a cap, not a floor: it only
// ever lowers effectiveMaxTokens, never raises it above the user's own
// Max Output Tokens setting.
const GREETING_MAX_TOKENS = 128;

export interface InferenceBudget {
  maxTokens: number;
  /** Soft ceiling passed through to each generate/verify step's timeoutMs. Advisory, not enforced by the router itself. */
  maxTotalLatencyMs?: number;
  allowVerification: boolean;
  allowRetrieval: boolean;
}

export interface DeviceState {
  freeRamBytes?: number;
  /** Not wired to a real battery API yet — reserved for when one exists; treated the same as lowPowerMode if ever set. */
  batteryLevel?: number;
  lowPowerMode?: boolean;
}

export type FallbackPolicy = "skip" | "use-default" | "fail";

export interface CostEstimate {
  /**
   * How many times the plan needs to swap the resident generation model.
   * Real cost, not a rounding error — see docs/ADAPTIVE_ROUTING.md §3/§13:
   * this app can only hold one generation context at a time, so each swap
   * is an actual unload+reload with a RAM pre-flight check, not free.
   */
  modelSwitches: number;
}

export interface RoutingStep {
  id: string;
  type: RoutingStepType;
  modelId?: string;
  required: boolean;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface RoutingContext {
  taskType: TaskType;
  query: string;
  hasLocalKnowledgeBase: boolean;
  retrievalAvailable: boolean;
  /** Already-resolved profiles for this preset (see profiles.ts's buildModelProfiles) — the router trusts these, it doesn't re-resolve overrides/availability itself. */
  availableModels: ModelProfile[];
  preset: RoutingPreset;
  deviceState?: DeviceState;
  budget: InferenceBudget;
}

export interface RoutingPlan {
  steps: RoutingStep[];
  selectedModelIds: string[];
  estimatedCost: CostEstimate;
  fallbackPolicy: FallbackPolicy;
  /** Short machine-readable codes explaining every decision the router made — the debug/UI surface the plan asks for ("explain routing decisions at a useful level") without needing a separate logging system. */
  reasonCodes: string[];
}

function findProfile(models: ModelProfile[], role: ModelRole): ModelProfile | undefined {
  return models.find((p) => p.role === role && p.enabled);
}

/**
 * Which generation role a task/preset combination should prefer, before
 * considering what's actually available. "research"/"compare" always want
 * the strongest model regardless of preset — a Simple-preset user asking a
 * genuinely complex question shouldn't get a worse answer just because they
 * picked the low-overhead preset for everyday chat.
 */
function preferredRole(taskType: TaskType, preset: RoutingPreset): ModelRole {
  if (taskType === "greeting") return "fast";
  if (taskType === "research" || taskType === "compare" || preset === "research") {
    return "reasoning";
  }
  if (preset === "simple") return "general";
  return "fast";
}

export function planRoute(context: RoutingContext): RoutingPlan {
  const reasonCodes: string[] = [];
  const steps: RoutingStep[] = [];
  const selectedModelIds: string[] = [];
  let stepIndex = 0;
  const nextId = (type: RoutingStepType) => `${type}-${stepIndex++}`;

  const constrained = context.deviceState?.lowPowerMode === true;
  let effectiveMaxTokens = context.budget.maxTokens;
  if (constrained) {
    effectiveMaxTokens = Math.min(effectiveMaxTokens, 256);
    reasonCodes.push("budget:low-power-mode-caps-tokens-and-role");
  }
  if (context.taskType === "greeting") {
    // A genuine conversational reply to a greeting is naturally a
    // sentence or two — real-device testing found "whats up?" running all
    // the way to the full user-configured Max Output Tokens budget (512 by
    // default) produced a long, free-associated, multi-question ramble,
    // not a longer *answer* (a greeting has no substantive content to
    // fill more tokens with). Caps, never raises: someone who's set their
    // own Max Output Tokens lower than this still gets the smaller value.
    effectiveMaxTokens = Math.min(effectiveMaxTokens, GREETING_MAX_TOKENS);
    reasonCodes.push("budget:greeting-caps-tokens");
  }

  // 1. Retrieval — skipped for task types where local documents genuinely
  // aren't the relevant input (a translation, a calculation, or a pure
  // greeting doesn't get better by retrieving unrelated knowledge-base
  // chunks). Shared with the live chat path via classify.ts's
  // isRetrievalIrrelevant, so this rule lives in exactly one place.
  const retrievalIrrelevant = isRetrievalIrrelevant(context.taskType);
  const wantsRetrieval =
    context.budget.allowRetrieval &&
    context.retrievalAvailable &&
    context.hasLocalKnowledgeBase &&
    !retrievalIrrelevant;
  if (wantsRetrieval) {
    steps.push({ id: nextId("retrieve"), type: "retrieve", required: false });
    reasonCodes.push("retrieve:relevant-to-task");
  } else {
    reasonCodes.push(retrievalIrrelevant ? "retrieve:skipped-task-not-knowledge-based" : "retrieve:skipped-unavailable-or-disabled");
  }

  // 2. Generation — the one required step. Role preference degrades to
  // whatever's actually enabled rather than failing outright, per the plan's
  // "a user with one suitable model should still have a functional app."
  const wantRole: ModelRole = constrained ? "fast" : preferredRole(context.taskType, context.preset);
  let genProfile = findProfile(context.availableModels, wantRole);
  if (!genProfile) {
    genProfile =
      findProfile(context.availableModels, "general") ??
      findProfile(context.availableModels, "reasoning") ??
      findProfile(context.availableModels, "fast") ??
      context.availableModels.find((p) => p.enabled);
    if (genProfile) {
      reasonCodes.push(`generate:role-${wantRole}-unavailable-fell-back-to-${genProfile.role}`);
    }
  } else {
    reasonCodes.push(`generate:role-${wantRole}-resolved-to-${genProfile.modelId}`);
  }

  if (genProfile) {
    steps.push({
      id: nextId("generate"),
      type: "generate",
      modelId: genProfile.modelId,
      required: true,
      maxTokens: effectiveMaxTokens,
      timeoutMs: context.budget.maxTotalLatencyMs,
    });
    selectedModelIds.push(genProfile.modelId);
  } else {
    reasonCodes.push("generate:no-model-available");
  }

  // 3. Verification — optional, and only when it's plausibly worth its
  // cost: a "research"/"compare" task under the "research" preset, with
  // both retrieved evidence to check claims against AND a verifier model
  // that's actually a *different* model from the one that generated the
  // answer (asking the same model to grade its own work isn't verification).
  const wantsVerification =
    context.budget.allowVerification &&
    !constrained &&
    context.preset === "research" &&
    (context.taskType === "research" || context.taskType === "compare") &&
    wantsRetrieval &&
    !!genProfile;
  if (wantsVerification) {
    const verifierProfile = findProfile(context.availableModels, "verifier");
    if (verifierProfile && verifierProfile.modelId !== genProfile!.modelId) {
      steps.push({
        id: nextId("verify"),
        type: "verify",
        modelId: verifierProfile.modelId,
        required: false,
        maxTokens: 200,
        timeoutMs: context.budget.maxTotalLatencyMs,
      });
      if (!selectedModelIds.includes(verifierProfile.modelId)) selectedModelIds.push(verifierProfile.modelId);
      reasonCodes.push("verify:enabled");
    } else {
      reasonCodes.push("verify:skipped-no-distinct-verifier-model");
    }
  } else {
    reasonCodes.push("verify:not-applicable");
  }

  return {
    steps,
    selectedModelIds,
    estimatedCost: { modelSwitches: Math.max(0, selectedModelIds.length - 1) },
    fallbackPolicy: "use-default",
    reasonCodes,
  };
}
