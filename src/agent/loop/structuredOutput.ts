/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * P1.5-2026-10-08: validators + ONE bounded repair retry for structured
 * model outputs.
 *
 * Research basis: grammar/constrained decoding guarantees *valid* JSON,
 * not *correct* JSON (BAML: 91.37% vs 93.63% — failure modes survive
 * masking). Every structured output gets a code validator; on failure,
 * exactly one repair attempt with the *specific* validator error fed back
 * (extrinsic feedback works; intrinsic "are you sure, think again"
 * self-correction degrades performance — Huang et al. 2024). On second
 * failure: fail closed via the caller's fallback. Never loops, never
 * blind-retries, never returns malformed output silently.
 *
 * This module is pure and model-agnostic: callers inject their generate
 * functions, so it's unit-testable without a device.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Minimal JSON-schema subset we validate: required keys + primitive types. */
export interface SimpleSchema {
  required?: string[];
  properties?: Record<string, "string" | "number" | "boolean">;
}

/**
 * Validate that `text` parses as JSON and matches the schema.
 * Pure — no model involved.
 */
export function validateStructuredOutput<T>(schema: SimpleSchema, text: string): ValidationResult<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "output is not valid JSON" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "output JSON must be an object" };
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of schema.required ?? []) {
    if (!(key in obj)) {
      return { ok: false, error: `missing required key "${key}"` };
    }
  }
  for (const [key, type] of Object.entries(schema.properties ?? {})) {
    if (key in obj && typeof obj[key] !== type) {
      return {
        ok: false,
        error: `key "${key}" must be ${type}, got ${typeof obj[key]}`,
      };
    }
  }
  return { ok: true, value: obj as T };
}

export interface BoundedRepairArgs<T> {
  /** First generation attempt. */
  attempt: () => Promise<string>;
  /**
   * Repair generation: called ONCE with the bad output and the specific
   * validator error. The caller builds the repair prompt (original task +
   * "your previous output failed validation: <error>. Fix it.").
   */
  repair: (badOutput: string, error: string) => Promise<string>;
  /** Validate a generation's text. */
  validate: (text: string) => ValidationResult<T>;
  /** Fail-closed value when both attempts fail validation. */
  fallback: T;
  /** Optional hook for telemetry/logging (attempt index 0/1, error). */
  onValidationFailure?: (attempt: number, error: string) => void;
}

/**
 * Run attempt → validate → (on failure) ONE repair with the specific
 * error → (on second failure) fallback. Never more than 2 generations.
 */
export async function withBoundedRepair<T>(args: BoundedRepairArgs<T>): Promise<T> {
  const first = await args.attempt();
  const v1 = args.validate(first);
  if (v1.ok) return v1.value;
  args.onValidationFailure?.(0, v1.error);

  const second = await args.repair(first, v1.error);
  const v2 = args.validate(second);
  if (v2.ok) return v2.value;
  args.onValidationFailure?.(1, v2.error);

  return args.fallback;
}
