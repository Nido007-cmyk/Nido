/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Phase 7 (docs/ADAPTIVE_ROUTING.md) — persistent, model-tagged execution
 * telemetry. Local/offline only (SQLite, same file as everything else in
 * rag/db.ts — never transmitted). This is the persistent source of truth;
 * src/services/telemetry.ts's in-memory QueryStats stays as a separate,
 * unmodified compatibility layer for the existing live Usage Stats display
 * — this module doesn't replace it, it's the new thing that survives a
 * reload/restart.
 *
 * Deliberately never stores the user's prompt or the generated response
 * text — this is engineering/debugging data (timing, model, task
 * classification), not a copy of conversation history.
 *
 * Row (de)serialization and export formatting live in executionTelemetry.
 * pure.ts (native-module-free, unit-tested); this file is just the
 * SQLite/file-system/sharing glue around it.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { getDb, writeTransaction } from "../rag/db";
import {
  ExecutionTelemetryRecord,
  ExecutionRow,
  newExecutionId,
  toExecutionRow,
  fromExecutionRow,
  executionRecordsToJson,
  executionRecordsToCsv,
} from "./executionTelemetry.pure";

export type { ModelResidency, ExecutionOutcome, ExecutionTelemetryRecord } from "./executionTelemetry.pure";
export { executionRecordsToJson, executionRecordsToCsv } from "./executionTelemetry.pure";

/** Fire-and-forget from the caller's point of view is NOT this function's job — it awaits the insert, but never throws in a way that should block a chat response; callers should call this after the user already has their answer, not in the critical path. */
export async function recordExecution(record: Omit<ExecutionTelemetryRecord, "id" | "createdAt">): Promise<void> {
  // R2: por el ciclo de vida guardado: telemetría obsoleta no puede recrear
  // la base tras Clear All Data.
  const id = newExecutionId();
  const createdAt = Date.now();
  const row = toExecutionRow(record, id, createdAt);
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `INSERT INTO execution_telemetry (
        id, created_at, model_id, task_type, adaptive_routing_used, reason_codes,
        retrieval_used, model_switches, cross_message_model_switch, model_residency,
        model_load_ms, ttft_ms, generation_latency_ms, total_latency_ms,
        tokens_generated, tok_per_sec, peak_rss_bytes, outcome, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row
    );
  });
}

export async function listRecentExecutions(limit = 200): Promise<ExecutionTelemetryRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ExecutionRow>(
    `SELECT * FROM execution_telemetry ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return rows.map(fromExecutionRow);
}

export async function clearExecutionTelemetry(): Promise<void> {
  // R2: ver recordExecution.
  await writeTransaction(async (txn) => {
    await txn.runAsync(`DELETE FROM execution_telemetry`);
  });
}

/**
 * Writes the export to a temp file and hands off to the OS share sheet —
 * same pattern as documentImporter.ts's exportCollection(), the existing
 * precedent for getting app data off the device. The user picks the
 * transport (a file manager, email, Bluetooth, etc.) themselves; this
 * doesn't transmit anything on its own.
 */
export async function exportExecutionTelemetry(format: "json" | "csv"): Promise<void> {
  const records = await listRecentExecutions(1000);
  const content = format === "json" ? executionRecordsToJson(records) : executionRecordsToCsv(records);
  const path = `${FileSystem.cacheDirectory}execution_telemetry.${format}`;
  await FileSystem.writeAsStringAsync(path, content);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: format === "json" ? "application/json" : "text/csv",
      dialogTitle: "Export execution telemetry",
    });
  } else {
    throw new Error("Sharing isn't available on this device");
  }
}
