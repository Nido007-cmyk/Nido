/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Delegated task execution — protocol extension (v1).
 *
 * ADDITIVE ONLY: these message types ride inside the existing signed
 * P2P envelopes. The transport, handshake, and PROPOSE/ACCEPT/DECLINE/
 * COUNTER negotiation semantics are frozen and untouched.
 *
 * Every validator here is fail-closed: malformed input is dropped,
 * never interpreted.
 *
 * Threat model: see ~/workspace/nido-task-delegation-plan/THREAT_MODEL.md
 */

import { toHex as bytesToHex } from "./crypto";

/** New performatives for delegated tasks (threaded on negotiationId). */
export type TaskMessageType =
  | "TASK_REQUEST"
  | "TASK_STATUS"
  | "TASK_RESULT"
  | "TASK_CANCEL"
  | "TASK_REJECT";

/** v1 scope allowlist — deliberately small. */
export const TASK_SCOPES_V1 = [
  "task:answer",
  "task:summarize",
  "task:remember",
] as const;
export type TaskScope = (typeof TASK_SCOPES_V1)[number];

/** Hard caps (threat model 4.7). Enforced before parsing. */
export const TASK_LIMITS = {
  descriptionMaxChars: 4000,
  documentMaxBytes: 512 * 1024,
  resultMaxBytes: 8 * 1024,
  maxDurationMs: 120_000,
  tokenLifetimeMs: 15 * 60 * 1000,
  clockSkewMs: 5 * 60 * 1000,
  approvalTimeoutMs: 60_000,
  maxPendingPerPeer: 3,
} as const;

/** Body of TASK_REQUEST (A -> B). */
export interface TaskRequestBody {
  negotiationId: string;
  taskId: string;
  description: string;
  resultSchema: Record<string, unknown>;
  delegationToken: string;
  expiresAt: number;
  maxDurationMs: number;
  /** Optional attached document (base64); only for task:summarize. */
  documentBase64?: string;
}

/** Body of TASK_STATUS (B -> A). */
export interface TaskStatusBody {
  taskId: string;
  status: "working";
  progressNote?: string;
}

/** Body of TASK_RESULT (B -> A). */
export interface TaskResultBody {
  taskId: string;
  ok: boolean;
  /** Typed result; must validate against the declared resultSchema. */
  result?: unknown;
  error?: { code: string; message: string };
}

/** Body of TASK_CANCEL (A -> B). */
export interface TaskCancelBody {
  taskId: string;
  reason?: string;
}

/** Body of TASK_REJECT (B -> A). */
export interface TaskRejectBody {
  taskId: string;
  reasonCode: "denied" | "timeout" | "expired" | "invalid_token" | "unsupported_scope" | "busy";
}

export type TaskMessageBody =
  | TaskRequestBody
  | TaskStatusBody
  | TaskResultBody
  | TaskCancelBody
  | TaskRejectBody;

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]+$/i;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

/**
 * Fail-closed validator for TASK_REQUEST bodies.
 * Returns the sanitized body or null (drop the message).
 */
export function validateTaskRequest(raw: unknown): TaskRequestBody | null {
  if (!isRecord(raw)) return null;
  const {
    negotiationId,
    taskId,
    description,
    resultSchema,
    delegationToken,
    expiresAt,
    maxDurationMs,
    documentBase64,
  } = raw;

  if (!isNonEmptyString(negotiationId, 128)) return null;
  if (typeof taskId !== "string" || !UUID_V4_RE.test(taskId)) return null;
  if (!isNonEmptyString(description, TASK_LIMITS.descriptionMaxChars)) return null;
  if (!isRecord(resultSchema)) return null;
  if (!isNonEmptyString(delegationToken, 8192)) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  if (
    typeof maxDurationMs !== "number" ||
    !Number.isFinite(maxDurationMs) ||
    maxDurationMs <= 0 ||
    maxDurationMs > TASK_LIMITS.maxDurationMs
  )
    return null;
  if (documentBase64 !== undefined) {
    if (typeof documentBase64 !== "string") return null;
    // Base64 length bound ~= byte bound * 4/3 + padding slack.
    if (documentBase64.length > Math.ceil((TASK_LIMITS.documentMaxBytes * 4) / 3) + 8)
      return null;
    if (!/^[A-Za-z0-9+/=]*$/.test(documentBase64)) return null;
  }
  // Expiry check with clock-skew tolerance (threat model: clock skew).
  const now = Date.now();
  if (expiresAt + TASK_LIMITS.clockSkewMs < now) return null;

  return {
    negotiationId,
    taskId: taskId.toLowerCase(),
    description,
    resultSchema,
    delegationToken,
    expiresAt,
    maxDurationMs: Math.min(maxDurationMs, TASK_LIMITS.maxDurationMs),
    ...(documentBase64 !== undefined ? { documentBase64 } : {}),
  };
}

export function validateTaskStatus(raw: unknown): TaskStatusBody | null {
  if (!isRecord(raw)) return null;
  const { taskId, status, progressNote } = raw;
  if (typeof taskId !== "string" || !UUID_V4_RE.test(taskId)) return null;
  if (status !== "working") return null;
  if (
    progressNote !== undefined &&
    !isNonEmptyString(progressNote, 500)
  )
    return null;
  return {
    taskId: taskId.toLowerCase(),
    status,
    ...(progressNote !== undefined ? { progressNote } : {}),
  };
}

export function validateTaskResult(raw: unknown): TaskResultBody | null {
  if (!isRecord(raw)) return null;
  const { taskId, ok, result, error } = raw;
  if (typeof taskId !== "string" || !UUID_V4_RE.test(taskId)) return null;
  if (typeof ok !== "boolean") return null;
  if (ok) {
    // Size-cap the serialized result before accepting (threat model 4.7).
    let serialized: string;
    try {
      serialized = JSON.stringify(result ?? null);
    } catch {
      return null;
    }
    if (serialized.length > TASK_LIMITS.resultMaxBytes) return null;
    return { taskId: taskId.toLowerCase(), ok: true, result: result ?? null };
  }
  if (!isRecord(error)) return null;
  const { code, message } = error;
  if (!isNonEmptyString(code, 64)) return null;
  if (!isNonEmptyString(message, 500)) return null;
  return { taskId: taskId.toLowerCase(), ok: false, error: { code, message } };
}

export function validateTaskCancel(raw: unknown): TaskCancelBody | null {
  if (!isRecord(raw)) return null;
  const { taskId, reason } = raw;
  if (typeof taskId !== "string" || !UUID_V4_RE.test(taskId)) return null;
  if (reason !== undefined && !isNonEmptyString(reason, 200)) return null;
  return {
    taskId: taskId.toLowerCase(),
    ...(reason !== undefined ? { reason } : {}),
  };
}

const REJECT_REASONS = [
  "denied",
  "timeout",
  "expired",
  "invalid_token",
  "unsupported_scope",
  "busy",
] as const;

export function validateTaskReject(raw: unknown): TaskRejectBody | null {
  if (!isRecord(raw)) return null;
  const { taskId, reasonCode } = raw;
  if (typeof taskId !== "string" || !UUID_V4_RE.test(taskId)) return null;
  if (
    typeof reasonCode !== "string" ||
    !(REJECT_REASONS as readonly string[]).includes(reasonCode)
  )
    return null;
  return {
    taskId: taskId.toLowerCase(),
    reasonCode: reasonCode as TaskRejectBody["reasonCode"],
  };
}

/** Dispatch validator by message type. Null = drop. */
export function validateTaskMessage(
  type: TaskMessageType,
  raw: unknown
): TaskMessageBody | null {
  switch (type) {
    case "TASK_REQUEST":
      return validateTaskRequest(raw);
    case "TASK_STATUS":
      return validateTaskStatus(raw);
    case "TASK_RESULT":
      return validateTaskResult(raw);
    case "TASK_CANCEL":
      return validateTaskCancel(raw);
    case "TASK_REJECT":
      return validateTaskReject(raw);
    default:
      return null;
  }
}

/** Scope allowlist check (fail-closed). */
export function isValidScope(scope: string): scope is TaskScope {
  return (TASK_SCOPES_V1 as readonly string[]).includes(scope);
}

/** All scopes in the list must be in the v1 allowlist. */
export function allScopesValid(scopes: unknown): scopes is TaskScope[] {
  return (
    Array.isArray(scopes) &&
    scopes.length > 0 &&
    scopes.every((s) => typeof s === "string" && isValidScope(s))
  );
}

export { bytesToHex };
export { HEX_RE };
