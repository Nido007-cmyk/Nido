/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  validateTaskRequest,
  validateTaskResult,
  validateTaskMessage,
  allScopesValid,
  TASK_LIMITS,
} from "./taskProtocol";

const GOOD_REQUEST = {
  negotiationId: "neg-123",
  taskId: "123e4567-e89b-42d3-a456-426614174000",
  description: "Summarize this",
  resultSchema: { type: "object" },
  delegationToken: "tok",
  expiresAt: Date.now() + 60000,
  maxDurationMs: 30000,
};

describe("taskProtocol validators (fail-closed)", () => {
  it("accepts a valid TASK_REQUEST", () => {
    expect(validateTaskRequest(GOOD_REQUEST)).not.toBeNull();
  });

  it("rejects expired requests", () => {
    expect(
      validateTaskRequest({ ...GOOD_REQUEST, expiresAt: Date.now() - 10 * 60 * 1000 })
    ).toBeNull();
  });

  it("rejects bad taskId", () => {
    expect(validateTaskRequest({ ...GOOD_REQUEST, taskId: "not-a-uuid" })).toBeNull();
  });

  it("rejects oversized description", () => {
    expect(
      validateTaskRequest({ ...GOOD_REQUEST, description: "x".repeat(5000) })
    ).toBeNull();
  });

  it("rejects maxDurationMs over the cap", () => {
    expect(
      validateTaskRequest({
        ...GOOD_REQUEST,
        maxDurationMs: TASK_LIMITS.maxDurationMs + 1,
      })
    ).toBeNull();
  });

  it("rejects non-object body", () => {
    expect(validateTaskRequest(null)).toBeNull();
    expect(validateTaskRequest("str")).toBeNull();
    expect(validateTaskRequest([])).toBeNull();
  });

  it("rejects oversized results", () => {
    const big = "x".repeat(TASK_LIMITS.resultMaxBytes + 1);
    expect(
      validateTaskResult({
        taskId: GOOD_REQUEST.taskId,
        ok: true,
        result: big,
      })
    ).toBeNull();
  });

  it("dispatches by type and drops unknown types", () => {
    expect(validateTaskMessage("TASK_REQUEST", GOOD_REQUEST)).not.toBeNull();
    expect(
      validateTaskMessage("NOPE" as never, GOOD_REQUEST)
    ).toBeNull();
  });

  it("scope allowlist is enforced", () => {
    expect(allScopesValid(["task:answer"])).toBe(true);
    expect(allScopesValid(["task:answer", "task:delete_everything"])).toBe(false);
    expect(allScopesValid([])).toBe(false);
    expect(allScopesValid("task:answer")).toBe(false);
  });
});
