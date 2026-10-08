/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * evalResume.test.ts - Tests for eval restore points.
 */

import { describe, it, expect } from "vitest";
import {
  createRestorePoint,
  updateRestorePoint,
  getRemainingIndices,
  isRestorePointComplete,
  getRestorePointProgress,
  validateRestorePoint,
  isConfigCompatible,
  serializeRestorePoint,
  deserializeRestorePoint,
  RESTORE_POINT_VERSION,
} from "./evalResume.pure";
import type { EvalConfig, EvalResultRow } from "./evalHarness.pure";

const mockConfig: EvalConfig = {
  kind: "model",
  modelId: "test-model",
  label: "Test Model",
};

function mockResult(queryId: string): EvalResultRow {
  return {
    runId: "run-123",
    evalSetVersion: "1.0",
    configId: "model:test-model",
    configLabel: "Test Model",
    personalityId: "default",
    maxTokens: 100,
    queryId,
    category: "factual",
    query: "test query",
    answer: "test answer",
    retrievedTitles: [],
    expectedKbTitles: [],
    expectedKbHit: null,
    timedOut: false,
    createdAt: Date.now(),
    adaptiveRoutingUsed: false,
  } as unknown as EvalResultRow;
}

describe("evalResume.pure", () => {
  it("creates a restore point", () => {
    const point = createRestorePoint("run-123", mockConfig, 10);
    expect(point.runId).toBe("run-123");
    expect(point.harnessVersion).toBe(RESTORE_POINT_VERSION);
    expect(point.completedIndices).toEqual([]);
    expect(point.results).toEqual([]);
    expect(point.totalItems).toBe(10);
  });

  it("updates restore point after completing an item", () => {
    let point = createRestorePoint("run-123", mockConfig, 3);
    point = updateRestorePoint(point, 0, mockResult("q0"));
    expect(point.completedIndices).toEqual([0]);
    expect(point.results).toHaveLength(1);

    point = updateRestorePoint(point, 2, mockResult("q2"));
    expect(point.completedIndices).toEqual([0, 2]);
    expect(point.results).toHaveLength(2);
  });

  it("does not duplicate completed indices", () => {
    let point = createRestorePoint("run-123", mockConfig, 3);
    point = updateRestorePoint(point, 0, mockResult("q0"));
    const before = point.results.length;
    point = updateRestorePoint(point, 0, mockResult("q0-dup"));
    expect(point.results).toHaveLength(before);
  });

  it("gets remaining indices", () => {
    let point = createRestorePoint("run-123", mockConfig, 5);
    point = updateRestorePoint(point, 1, mockResult("q1"));
    point = updateRestorePoint(point, 3, mockResult("q3"));
    expect(getRemainingIndices(point)).toEqual([0, 2, 4]);
  });

  it("detects completion", () => {
    let point = createRestorePoint("run-123", mockConfig, 2);
    expect(isRestorePointComplete(point)).toBe(false);
    point = updateRestorePoint(point, 0, mockResult("q0"));
    expect(isRestorePointComplete(point)).toBe(false);
    point = updateRestorePoint(point, 1, mockResult("q1"));
    expect(isRestorePointComplete(point)).toBe(true);
  });

  it("calculates progress", () => {
    let point = createRestorePoint("run-123", mockConfig, 4);
    expect(getRestorePointProgress(point)).toBe(0);
    point = updateRestorePoint(point, 0, mockResult("q0"));
    expect(getRestorePointProgress(point)).toBe(0.25);
    point = updateRestorePoint(point, 1, mockResult("q1"));
    expect(getRestorePointProgress(point)).toBe(0.5);
  });

  it("validates restore points", () => {
    const valid = createRestorePoint("run-123", mockConfig, 5);
    expect(validateRestorePoint(valid).valid).toBe(true);
    expect(validateRestorePoint(null).valid).toBe(false);
    expect(validateRestorePoint({}).valid).toBe(false);
    expect(validateRestorePoint({ ...valid, harnessVersion: 999 }).valid).toBe(false);
  });

  it("checks config compatibility", () => {
    const point = createRestorePoint("run-123", mockConfig, 5);
    expect(isConfigCompatible(point, mockConfig)).toBe(true);
    expect(
      isConfigCompatible(point, { kind: "model", modelId: "other", label: "Other" })
    ).toBe(false);
    expect(isConfigCompatible(point, { kind: "adaptive", label: "Adaptive" })).toBe(false);
  });

  it("serializes and deserializes", () => {
    let point = createRestorePoint("run-123", mockConfig, 3);
    point = updateRestorePoint(point, 0, mockResult("q0"));
    const json = serializeRestorePoint(point);
    const restored = deserializeRestorePoint(json);
    expect(restored).not.toBeNull();
    expect(restored!.runId).toBe("run-123");
    expect(restored!.completedIndices).toEqual([0]);
  });

  it("returns null for invalid JSON", () => {
    expect(deserializeRestorePoint("not json")).toBeNull();
    expect(deserializeRestorePoint('{"invalid": true}')).toBeNull();
  });
});
