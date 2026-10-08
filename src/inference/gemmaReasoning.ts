/**
 * MIT License
 * Copyright (c) 2026 aoair contributors (original BOAR code)
 * Copyright (c) 2026 NIDO contributors (modifications)
 * See LICENSE file for details.
 */

/**
 * Gemma reasoning parser - extracts `<think>`/`</think>` or
 * `<thought>`/`</thought>` blocks from Gemma 3n output.
 *
 * Adapted from BOAR's gemmaReasoning.ts (MIT). The reasoning blocks are
 * stripped from the visible answer; callers can log or display them
 * separately (e.g., in a "show reasoning" UI toggle).
 */

export interface ParsedReasoning {
  /** The reasoning/thinking content, or null if none found. */
  reasoning: string | null;
  /** The visible answer with reasoning blocks removed. */
  answer: string;
}

/**
 * Parse Gemma 3n output for reasoning blocks.
 *
 * Handles:
 * - `<think>...</think>` (Gemma 3n standard)
 * - `<thought>...</thought>` (alternative)
 * - Multiple blocks (concatenated with double newline)
 * - Unclosed blocks (treated as reasoning to end of output)
 * - No blocks (returns full text as answer)
 *
 * Pure function - no side effects, no network, testable without a device.
 */
export function parseGemmaReasoning(output: string): ParsedReasoning {
  const reasoningParts: string[] = [];
  let answer = output;
  let foundBlocks = false;

  // Match <think>...</think> or <thought>...</thought>, including unclosed
  const pattern = /<(think|thought)>([\s\S]*?)(?:<\/(?:think|thought)>|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    foundBlocks = true;
    const content = match[2].trim();
    if (content) {
      reasoningParts.push(content);
    }
  }

  if (foundBlocks) {
    // Remove all reasoning blocks from the answer (even empty ones)
    answer = output.replace(pattern, "").trim();
    // Clean up excessive blank lines left by removal
    answer = answer.replace(/\n{3,}/g, "\n\n");
  }

  return {
    reasoning: reasoningParts.length > 0 ? reasoningParts.join("\n\n") : null,
    answer: answer.trim(),
  };
}

/**
 * Check if output contains reasoning blocks (without parsing).
 * Useful for deciding whether to show a "reasoning" UI indicator.
 */
export function hasReasoningBlocks(output: string): boolean {
  return /<(think|thought)>/i.test(output);
}
