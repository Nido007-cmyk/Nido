/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * contextBudget.ts — central context-window budget manager (P2.3).
 *
 * Before: history turns were appended without limit (assembleChatMessages)
 * and the agent loop relied on a fail/degenerate fallback when the prompt
 * didn't fit (T-contexto-2026-10-06). Long conversations degraded silently
 * or crashed into "Context is full".
 *
 * Now: one place decides what fits. Priorities, in order:
 *   1. System prompt is PINNED — always included in full; exceeding its cap
 *      throws an actionable error (fail-closed, never silently truncated).
 *   2. Generation headroom is RESERVED — never given to history.
 *   3. History is recent-first — newest turns kept, oldest dropped.
 *   4. No orphaned assistant turns — a kept assistant message always keeps
 *      its user message.
 *
 * Token counting uses estimatePromptTokens (chars/3 + ChatML overhead):
 * the same conservative estimator assertPromptBudget uses. It OVERESTIMATES
 * on purpose — the fail-safe direction is to keep slightly less history,
 * never to overflow the native context.
 *
 * Pure, no dependencies (beyond the estimator), fully unit-tested.
 */

export interface BudgetMessage {
  role: string;
  content: string;
}

export interface ContextBudgetConfig {
  /** Total context window of the model. */
  nCtx: number;
  /** Tokens reserved for generation — never allocated to history. */
  reserveGeneration: number;
  /** Max tokens the system message may occupy; exceeding throws. */
  maxSystemTokens: number;
}

export interface BudgetedConversation {
  system: BudgetMessage;
  /** Oldest-first, newest turns kept; never contains an orphaned assistant turn. */
  history: BudgetMessage[];
  currentUser: BudgetMessage;
  /** How many history turns were dropped to fit. */
  droppedTurns: number;
  /** Estimated total including the reserved generation headroom. Invariant: <= nCtx. */
  estimatedTotalTokens: number;
}

/** Default estimator: conservative (overestimates) — the fail-safe direction. */
export function defaultTokenCounter(text: string): number {
  return Math.ceil(text.length / 3) + 50;
}

/** Sensible defaults for a 4k-window chat model. */
export function budgetConfigFor(nCtx: number, reserveGeneration: number): ContextBudgetConfig {
  return { nCtx, reserveGeneration, maxSystemTokens: Math.floor(nCtx * 0.5) };
}

/**
 * Applies the budget. Throws an actionable error when even
 * system + current message + reserved headroom don't fit (fail-closed).
 * Pure function.
 */
export function applyContextBudget(
  system: BudgetMessage,
  history: BudgetMessage[],
  currentUser: BudgetMessage,
  config: ContextBudgetConfig,
  countTokens: (text: string) => number = defaultTokenCounter
): BudgetedConversation {
  const systemTokens = countTokens(system.content);
  if (systemTokens > config.maxSystemTokens) {
    throw new Error(
      `NIDO: system prompt excede el presupuesto (${systemTokens} tokens estimados > ` +
        `máximo ${config.maxSystemTokens}). Reduce el system prompt o sube maxSystemTokens.`
    );
  }
  const currentTokens = countTokens(currentUser.content);
  const historyBudget = config.nCtx - config.reserveGeneration - systemTokens - currentTokens;
  if (historyBudget < 0) {
    throw new Error(
      `NIDO: system (${systemTokens}) + mensaje actual (${currentTokens}) + reserva ` +
        `(${config.reserveGeneration}) exceden nCtx ${config.nCtx} sin siquiera historial.`
    );
  }

  // Recent-first: walk from the newest turn backwards while it fits.
  const keptNewestFirst: BudgetMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = countTokens(history[i].content);
    if (used + cost > historyBudget) break;
    keptNewestFirst.push(history[i]);
    used += cost;
  }

  // No orphaned assistant turns: if the oldest kept message is an assistant
  // message, its user turn was cut — drop it too.
  if (keptNewestFirst.length > 0) {
    const oldestKept = keptNewestFirst[keptNewestFirst.length - 1];
    if (oldestKept.role === "assistant") {
      used -= countTokens(oldestKept.content);
      keptNewestFirst.pop();
    }
  }

  const keptHistory = keptNewestFirst.reverse();
  const estimatedTotalTokens =
    systemTokens + currentTokens + used + config.reserveGeneration;

  return {
    system,
    history: keptHistory,
    currentUser,
    droppedTurns: history.length - keptHistory.length,
    estimatedTotalTokens,
  };
}
