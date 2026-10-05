/**
 * dualModel.test.ts - Tests for dual-model router.
 */

import { describe, it, expect } from "vitest";
import {
  selectModelTier,
  getModelIdForTier,
  routeToModel,
  type DualModelConfig,
} from "./dualModel.pure";

const config: DualModelConfig = {
  tinyModelId: "gemma-2b-fast",
  reasonerModelId: "gemma-7b-reasoner",
  tinyMaxTokens: 100,
};

describe("dualModel.pure", () => {
  it("routes greetings to tiny", () => {
    expect(selectModelTier("hi", "greeting", config)).toBe("tiny");
    expect(selectModelTier("hello there", "greeting", config)).toBe("tiny");
  });

  it("routes code tasks to reasoner", () => {
    expect(selectModelTier("write code for fibonacci", "code", config)).toBe(
      "reasoner"
    );
  });

  it("routes long queries to reasoner", () => {
    const longQuery = "x".repeat(500); // ~125 tokens > 100
    expect(selectModelTier(longQuery, "unknown", config)).toBe("reasoner");
  });

  it("defaults short general queries to tiny", () => {
    expect(selectModelTier("what time is it?", "lookup", config)).toBe("tiny");
  });

  it("gets model ID for tier", () => {
    expect(getModelIdForTier("tiny", config)).toBe("gemma-2b-fast");
    expect(getModelIdForTier("reasoner", config)).toBe("gemma-7b-reasoner");
  });

  it("routes in one step", () => {
    const result = routeToModel("hi", config);
    expect(result.tier).toBe("tiny");
    expect(result.modelId).toBe("gemma-2b-fast");
    expect(result.taskType).toBe("greeting");
  });
});
