/**
 * Tests for Gemma reasoning parser (BOAR item 5, adapted for NIDO).
 */

import { describe, it, expect } from "vitest";
import { parseGemmaReasoning, hasReasoningBlocks } from "./gemmaReasoning";

describe("parseGemmaReasoning", () => {
  it("extracts <think> blocks", () => {
    const output = `<think>
The user is asking about the weather. I should provide a helpful answer.
</think>
It's sunny today with a high of 75°F.`;

    const result = parseGemmaReasoning(output);
    expect(result.reasoning).toContain("The user is asking about the weather");
    expect(result.answer).toBe("It's sunny today with a high of 75°F.");
  });

  it("extracts <thought> blocks", () => {
    const output = `<thought>Let me think about this carefully.</thought>Here's my answer.`;

    const result = parseGemmaReasoning(output);
    expect(result.reasoning).toBe("Let me think about this carefully.");
    expect(result.answer).toBe("Here's my answer.");
  });

  it("handles multiple blocks", () => {
    const output = `<think>First thought.</think> Middle text. <think>Second thought.</think> Final answer.`;

    const result = parseGemmaReasoning(output);
    expect(result.reasoning).toBe("First thought.\n\nSecond thought.");
    expect(result.answer).toBe("Middle text.  Final answer.");
  });

  it("handles unclosed blocks", () => {
    const output = `Answer starts here. <think>This reasoning never closes...`;

    const result = parseGemmaReasoning(output);
    expect(result.reasoning).toBe("This reasoning never closes...");
    expect(result.answer).toBe("Answer starts here.");
  });

  it("returns null reasoning when no blocks", () => {
    const output = `Just a plain answer with no reasoning blocks.`;

    const result = parseGemmaReasoning(output);
    expect(result.reasoning).toBeNull();
    expect(result.answer).toBe(output);
  });

  it("handles empty reasoning blocks", () => {
    const output = `<think></think>Actual answer.`;

    const result = parseGemmaReasoning(output);
    // Empty blocks are ignored
    expect(result.reasoning).toBeNull();
    expect(result.answer).toBe("Actual answer.");
  });

  it("cleans up excessive blank lines", () => {
    const output = `Line 1.\n\n\n<think>Reasoning</think>\n\n\nLine 2.`;

    const result = parseGemmaReasoning(output);
    expect(result.answer).not.toMatch(/\n{3,}/);
  });

  it("is case-insensitive for tags", () => {
    const output = `<THINK>Uppercase tags work.</THINK>Answer.`;

    const result = parseGemmaReasoning(output);
    expect(result.reasoning).toBe("Uppercase tags work.");
  });
});

describe("hasReasoningBlocks", () => {
  it("detects <think> blocks", () => {
    expect(hasReasoningBlocks("<think>test</think> answer")).toBe(true);
  });

  it("detects <thought> blocks", () => {
    expect(hasReasoningBlocks("<thought>test</thought> answer")).toBe(true);
  });

  it("returns false when no blocks", () => {
    expect(hasReasoningBlocks("Just a plain answer.")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(hasReasoningBlocks("<THINK>test</THINK>")).toBe(true);
  });
});
