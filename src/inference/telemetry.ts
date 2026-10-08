/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * telemetry.ts — lightweight, ON-DEVICE-ONLY inference instrumentation (P2.4).
 *
 * PRIVACY: this never leaves the device. Events are kept in an in-memory
 * ring buffer and persisted to the app's encrypted SQLite database
 * (same SQLCipher database as everything else). No network calls, no
 * analytics SDKs, no third parties. The user can inspect this data; a
 * future UI surface can read getRecentTelemetry().
 *
 * What it records per generation: timing (TTFT, total, tok/s), token
 * counts, stop reason, sampling preset, task type, and whether the
 * response was deterministic (canned — never touched the model).
 *
 * Design: recordInferenceEvent() is synchronous and never throws — the
 * ring buffer always works, even when the database isn't available
 * (tests, early startup). DB persistence is fire-and-forget best-effort.
 * Telemetry must NEVER break or slow down inference.
 *
 * This module has no top-level native imports (the DB is reached via a
 * lazy dynamic import) so it stays unit-testable under plain Node/vitest.
 */

export type TelemetryStopReason = "completed" | "timeout" | "stopped" | "error";

export interface InferenceTelemetryEvent {
  /** Unix ms timestamp of generation start. */
  ts: number;
  /** Loaded model filename, or null when unknown. */
  modelId: string | null;
  /** Caller-provided context, e.g. "agent-loop", "research-generate". */
  taskType?: string;
  /** True when the response was served deterministically (no model call). */
  deterministic?: boolean;
  promptChars: number;
  /** Conservative estimate (chars/3), same basis as assertPromptBudget. */
  promptTokensEst: number;
  completionTokens: number;
  /** ms to first token; null when nothing was generated. */
  ttftMs: number | null;
  totalMs: number;
  tokensPerSec: number | null;
  stopReason: TelemetryStopReason;
  samplingPreset?: string;
  temperature?: number;
  nPredict: number;
}

const RING_CAP = 500;
const DB_MAX_ROWS = 1000;

const ring: InferenceTelemetryEvent[] = [];

const TELEMETRY_DDL = `
CREATE TABLE IF NOT EXISTS inference_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  model_id TEXT,
  task_type TEXT,
  deterministic INTEGER NOT NULL DEFAULT 0,
  prompt_chars INTEGER NOT NULL,
  prompt_tokens_est INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  ttft_ms REAL,
  total_ms REAL NOT NULL,
  tokens_per_sec REAL,
  stop_reason TEXT NOT NULL,
  sampling_preset TEXT,
  temperature REAL,
  n_predict INTEGER NOT NULL
);`;

async function persistEvent(e: InferenceTelemetryEvent): Promise<void> {
  // Best-effort: telemetry must never break inference. Any failure here
  // (no DB in tests, DB locked, wiped) is silently swallowed — the
  // in-memory ring buffer above remains the source of truth for the session.
  try {
    const { getDatabase } = await import("../security/databaseManager");
    const db = await getDatabase();
    await db.execAsync(TELEMETRY_DDL);
    await db.runAsync(
      `INSERT INTO inference_telemetry
       (ts, model_id, task_type, deterministic, prompt_chars, prompt_tokens_est,
        completion_tokens, ttft_ms, total_ms, tokens_per_sec, stop_reason,
        sampling_preset, temperature, n_predict)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.ts,
        e.modelId,
        e.taskType ?? null,
        e.deterministic ? 1 : 0,
        e.promptChars,
        e.promptTokensEst,
        e.completionTokens,
        e.ttftMs,
        e.totalMs,
        e.tokensPerSec,
        e.stopReason,
        e.samplingPreset ?? null,
        e.temperature ?? null,
        e.nPredict,
      ]
    );
    // Prune: keep only the newest DB_MAX_ROWS events.
    await db.execAsync(
      `DELETE FROM inference_telemetry WHERE id NOT IN (SELECT id FROM inference_telemetry ORDER BY id DESC LIMIT ${DB_MAX_ROWS})`
    );
  } catch {
    /* telemetry is best-effort by design */
  }
}

/**
 * Records one inference event. Synchronous, never throws. The DB write
 * is fire-and-forget — callers must NOT await this.
 */
export function recordInferenceEvent(e: InferenceTelemetryEvent): void {
  ring.push(e);
  if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
  void persistEvent(e);
}

/** Newest-first? No — oldest-first slice of the most recent events. */
export function getRecentTelemetry(limit = 100): InferenceTelemetryEvent[] {
  return ring.slice(Math.max(0, ring.length - limit));
}

/** Test/utility hook: clears the in-memory ring (does not touch the DB). */
export function clearTelemetry(): void {
  ring.length = 0;
}
