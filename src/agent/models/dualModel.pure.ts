/**
 * dualModel.pure.ts - NIDO: Dual-model architecture router (DR-8).
 *
 * Routes tasks between a tiny specialist (fast, low-power) and a
 * larger reasoner (slower, more capable) based on task complexity.
 *
 * - Simple tasks (greetings, chit-chat, quick facts): tiny model
 * - Complex tasks (reasoning, multi-step, code): reasoner model
 *
 * Pure logic - the actual model loading is platform-specific.
 * The router only decides WHICH model should handle a task.
 */

import { classifyTask } from "../../routing/classify";
import type { TaskType } from "../../routing/types";

export type ModelTier = "tiny" | "reasoner";

export interface DualModelConfig {
  /** Model ID for the tiny specialist (e.g., "gemma-2b-fast") */
  tinyModelId: string;
  /** Model ID for the reasoner (e.g., "gemma-7b-reasoner") */
  reasonerModelId: string;
  /** Max tokens before forcing reasoner (long tasks need capability) */
  tinyMaxTokens: number;
}

/**
 * Task types that the tiny model handles well.
 * Fast, low-power, sufficient for simple interactions.
 */
const TINY_FRIENDLY_TASKS: Set<TaskType> = new Set([
  "greeting",
  "conversation",
  "chat",
  "lookup",
]);

/**
 * Task types that require the reasoner.
 * Complex reasoning, multi-step, or high-stakes.
 */
const REASONER_REQUIRED_TASKS: Set<TaskType> = new Set([
  "code",
  "compare",
  "calculate",
]);

/**
 * Decide which model tier should handle a task.
 *
 * Rules:
 * 1. If task type is tiny-friendly → tiny
 * 2. If task type requires reasoning → reasoner
 * 3. If query is long (> tinyMaxTokens estimate) → reasoner
 * 4. Default: tiny (prefer speed/power efficiency)
 */
export function selectModelTier(
  query: string,
  taskType: TaskType,
  config: DualModelConfig
): ModelTier {
  // Rule 1: Tiny-friendly tasks stay on tiny
  if (TINY_FRIENDLY_TASKS.has(taskType)) {
    return "tiny";
  }

  // Rule 2: Complex tasks need the reasoner
  if (REASONER_REQUIRED_TASKS.has(taskType)) {
    return "reasoner";
  }

  // Rule 3: Long queries likely need more capability
  // Rough estimate: 1 token ~ 4 chars
  const estimatedTokens = Math.ceil(query.length / 4);
  if (estimatedTokens > config.tinyMaxTokens) {
    return "reasoner";
  }

  // Rule 4: Default to tiny for speed and battery
  return "tiny";
}

/**
 * Get the model ID for a tier.
 */
export function getModelIdForTier(
  tier: ModelTier,
  config: DualModelConfig
): string {
  return tier === "tiny" ? config.tinyModelId : config.reasonerModelId;
}

/**
 * Convenience: classify and select in one step.
 */
export function routeToModel(
  query: string,
  config: DualModelConfig
): { tier: ModelTier; modelId: string; taskType: TaskType } {
  const taskType = classifyTask(query);
  const tier = selectModelTier(query, taskType, config);
  return {
    tier,
    modelId: getModelIdForTier(tier, config),
    taskType,
  };
}
