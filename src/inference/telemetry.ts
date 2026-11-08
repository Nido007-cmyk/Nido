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

export type TelemetryStopReason = "completed" | "timeout" | "stopped" | "error" | "rejected";

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
  /**
   * Solo en eventos de rechazo del pre-flight (stopReason "rejected"):
   * las cifras que la comprobación de memoria vio al rechazar. Es lo
   * que permite distinguir en el aparato un rechazo del pre-flight de
   * un fallo nativo de initLlama (que no deja este registro).
   */
  ramRejection?: {
    totalRamBytes: number;
    rssBytes: number;
    availBytes: number | null;
    thresholdBytes: number | null;
    availableBytes: number;
    neededBytes: number;
    nCtxChosen: number;
    nCtxRequested: number;
    crashSafety: number | null;
  };
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

/** Detalle de un rechazo del pre-flight, como JSON en su propia columna. */
const REJECTION_DDL = `
CREATE TABLE IF NOT EXISTS inference_telemetry_rejections (
  telemetry_id INTEGER PRIMARY KEY,
  detail TEXT NOT NULL
);`;

/**
 * Auditoría completa 2026-10-31 (F3-13): guarda de borrado, espejo de
 * la de networkAudit (auditoría 2026-10-29). persistEvent es
 * fire-and-forget: un evento del mundo anterior al borrado podía
 * completar su escritura DESPUÉS del wipe y resucitar telemetría
 * vieja dentro de la base nueva. Mientras el borrado está en curso
 * no se persiste nada y el anillo en memoria se vacía; los eventos
 * registrados antes del borrado pero escritos durante él se
 * descartan al comprobar la marca tras la espera.
 */
let telemetryWiping = false;

export function beginTelemetryWipe(): void {
  telemetryWiping = true;
  ring.length = 0;
}

export function endTelemetryWipe(): void {
  telemetryWiping = false;
}

async function persistEvent(e: InferenceTelemetryEvent): Promise<void> {
  const recordedWhileWiping = telemetryWiping;
  // Best-effort: telemetry must never break inference. Any failure here
  // (no DB in tests, DB locked, wiped) is silently swallowed — the
  // in-memory ring buffer above remains the source of truth for the session.
  try {
    const { getDatabase } = await import("../security/databaseManager");
    const db = await getDatabase();
    // F3-13: si el borrado empezó antes del registro o durante la
    // espera, este evento es del mundo borrado: no entra en la base nueva.
    if (recordedWhileWiping || telemetryWiping) return;
    await db.execAsync(TELEMETRY_DDL);
    const inserted = await db.runAsync(
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
    // El detalle de un rechazo vive en su tabla: la principal no cambia
    // de esquema (las instalaciones ya la tienen creada) y el detalle es
    // un JSON que solo estos eventos llevan.
    if (e.ramRejection) {
      await db.execAsync(REJECTION_DDL);
      await db.runAsync(
        `INSERT INTO inference_telemetry_rejections (telemetry_id, detail) VALUES (?, ?)`,
        [inserted.lastInsertRowId, JSON.stringify(e.ramRejection)]
      );
    }
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

/**
 * Fase 2 del arreglo del defecto de memoria (reapertura 2026-11-08):
 * el registro de los rechazos del pre-flight. Hasta aquí un rechazo
 * no dejaba rastro en ningún sitio: el mensaje viajaba a la tarjeta y
 * moría ahí, y la foto del dueño era la única «telemetría» — por eso
 * la primera pasada tuvo que modelar las cifras del aparato en vez de
 * leerlas. Cada rechazo queda ahora en el mismo anillo y la misma
 * tabla que las generaciones (SQLite cifrada, solo en el aparato),
 * con las cifras que el pre-flight vio: total, RSS, libre en vivo,
 * umbral, disponible calculado, coste del plan al peldaño elegido,
 * techo pedido y factor del CrashGuard. stop_reason "rejected" lo
 * distingue de cualquier generación; los contadores de una generación
 * que nunca ocurrió van a cero y los tiempos a null.
 */
export interface RamRejectionInfo {
  modelId: string | null;
  totalRamBytes: number;
  rssBytes: number;
  availBytes?: number | null;
  thresholdBytes?: number | null;
  availableBytes: number;
  neededBytes: number;
  nCtxChosen: number;
  nCtxRequested: number;
  crashSafety: number | null;
  /** Solo memoria: el rechazo del motor de embeddings (sin escalera ni CrashGuard). */
  embedding?: boolean;
}

/** Un rechazo del pre-flight como evento de telemetría. Puro. */
export function ramRejectionEvent(info: RamRejectionInfo, now = Date.now()): InferenceTelemetryEvent {
  return {
    ts: now,
    modelId: info.modelId,
    taskType: info.embedding ? "model-load-embedding" : "model-load",
    promptChars: 0,
    promptTokensEst: 0,
    completionTokens: 0,
    ttftMs: null,
    totalMs: 0,
    tokensPerSec: null,
    stopReason: "rejected",
    nPredict: 0,
    ramRejection: {
      totalRamBytes: info.totalRamBytes,
      rssBytes: info.rssBytes,
      availBytes: info.availBytes ?? null,
      thresholdBytes: info.thresholdBytes ?? null,
      availableBytes: info.availableBytes,
      neededBytes: info.neededBytes,
      nCtxChosen: info.nCtxChosen,
      nCtxRequested: info.nCtxRequested,
      crashSafety: info.crashSafety,
    },
  };
}

/** Registra un rechazo del pre-flight (mismo canal que las generaciones; nunca lanza). */
export function recordRamRejection(info: RamRejectionInfo): void {
  recordInferenceEvent(ramRejectionEvent(info));
}
export function getRecentTelemetry(limit = 100): InferenceTelemetryEvent[] {
  return ring.slice(Math.max(0, ring.length - limit));
}

/** Test/utility hook: clears the in-memory ring (does not touch the DB). */
export function clearTelemetry(): void {
  ring.length = 0;
}
