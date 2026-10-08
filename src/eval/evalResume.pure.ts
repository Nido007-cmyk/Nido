/**
 * MIT License
 * Copyright (c) 2026 aoair contributors (original BOAR code)
 * Copyright (c) 2026 NIDO contributors (modifications)
 * See LICENSE file for details.
 */

/**
 * evalResume.pure.ts - NIDO: Eval resume with restore points.
 *
 * Pure logic for saving/loading eval run restore points.
 * Allows resuming an interrupted eval run instead of starting over.
 *
 * Storage is file-based (not in the encrypted DB - eval results
 * aren't user-sensitive, and file I/O is simpler for large sets).
 *
 * Design: see evalResume.design.ts
 * Adapted from BOAR's eval-resume (MIT).
 */

import type { EvalConfig, EvalResultRow } from "./evalHarness.pure";

export const RESTORE_POINT_VERSION = 1;

export interface EvalRestorePoint {
  runId: string;
  harnessVersion: number;
  startedAt: number;
  updatedAt: number;
  completedIndices: number[];
  results: EvalResultRow[];
  config: EvalConfig;
  /** Total items in the eval set (for progress display) */
  totalItems: number;
}

/**
 * Create a new restore point for a fresh run.
 */
export function createRestorePoint(
  runId: string,
  config: EvalConfig,
  totalItems: number
): EvalRestorePoint {
  const now = Date.now();
  return {
    runId,
    harnessVersion: RESTORE_POINT_VERSION,
    startedAt: now,
    updatedAt: now,
    completedIndices: [],
    results: [],
    config,
    totalItems,
  };
}

/**
 * Update a restore point after completing an item.
 * Returns a new object (immutable update).
 */
export function updateRestorePoint(
  point: EvalRestorePoint,
  index: number,
  result: EvalResultRow
): EvalRestorePoint {
  if (point.completedIndices.includes(index)) {
    // Already completed - don't duplicate
    return point;
  }
  return {
    ...point,
    updatedAt: Date.now(),
    completedIndices: [...point.completedIndices, index].sort((a, b) => a - b),
    results: [...point.results, result],
  };
}

/**
 * Get the indices that still need to run.
 */
export function getRemainingIndices(point: EvalRestorePoint): number[] {
  const completed = new Set(point.completedIndices);
  const remaining: number[] = [];
  for (let i = 0; i < point.totalItems; i++) {
    if (!completed.has(i)) {
      remaining.push(i);
    }
  }
  return remaining;
}

/**
 * Check if a restore point is complete.
 */
export function isRestorePointComplete(point: EvalRestorePoint): boolean {
  return point.completedIndices.length >= point.totalItems;
}

/**
 * Get progress as a fraction (0-1).
 */
export function getRestorePointProgress(point: EvalRestorePoint): number {
  if (point.totalItems === 0) return 1;
  return point.completedIndices.length / point.totalItems;
}

/**
 * Validate a restore point loaded from disk.
 * Returns { valid: true } or { valid: false, reason }.
 */
export function validateRestorePoint(
  data: unknown
): { valid: boolean; reason?: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, reason: "Not an object" };
  }
  const p = data as Partial<EvalRestorePoint>;

  if (typeof p.runId !== "string" || p.runId.length === 0) {
    return { valid: false, reason: "Missing runId" };
  }
  if (p.harnessVersion !== RESTORE_POINT_VERSION) {
    return {
      valid: false,
      reason: `Version mismatch: expected ${RESTORE_POINT_VERSION}, got ${p.harnessVersion}`,
    };
  }
  if (!Array.isArray(p.completedIndices)) {
    return { valid: false, reason: "Missing completedIndices" };
  }
  if (!Array.isArray(p.results)) {
    return { valid: false, reason: "Missing results" };
  }
  if (!p.config || typeof p.config !== "object") {
    return { valid: false, reason: "Missing config" };
  }
  if (typeof p.totalItems !== "number" || p.totalItems < 0) {
    return { valid: false, reason: "Invalid totalItems" };
  }

  return { valid: true };
}

/**
 * Check if a restore point's config matches the current config.
 * If not, results may not be comparable - warn the user.
 */
export function isConfigCompatible(
  point: EvalRestorePoint,
  currentConfig: EvalConfig
): boolean {
  // Simple check: kind must match, and for model kind, modelId must match
  if (point.config.kind !== currentConfig.kind) {
    return false;
  }
  if (point.config.kind === "model" && currentConfig.kind === "model") {
    return point.config.modelId === currentConfig.modelId;
  }
  return true;
}

/**
 * Serialize a restore point to JSON.
 */
export function serializeRestorePoint(point: EvalRestorePoint): string {
  return JSON.stringify(point);
}

/**
 * Deserialize and validate a restore point from JSON.
 * Returns null if invalid (caller should offer "start fresh").
 */
export function deserializeRestorePoint(json: string): EvalRestorePoint | null {
  try {
    const data = JSON.parse(json);
    const { valid } = validateRestorePoint(data);
    return valid ? (data as EvalRestorePoint) : null;
  } catch {
    return null;
  }
}
