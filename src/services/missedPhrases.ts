/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * missedPhrases.ts — 0.1.39: almacén del registro OPCIONAL de frases que el
 * router no reconoció (ver missedPhrases.pure.ts). Base local cifrada, la
 * misma que la telemetría de ejecución. Nunca se transmite.
 *
 * Todo es best-effort: registrar NUNCA bloquea ni rompe el chat.
 */
import { getDb, writeTransaction } from "../rag/db";
import {
  MAX_MISSED_PHRASES,
  MISSED_PHRASES_META_KEY,
  toMissedPhrase,
  type MissedPhrase,
  type MissedRoutingLike,
} from "./missedPhrases.pure";

export type { MissedPhrase } from "./missedPhrases.pure";
export { formatMissedForCopy, looksLikeMissedCommand, missedSignal, MAX_MISSED_PHRASES } from "./missedPhrases.pure";

/** ¿Está encendido el registro? Apagado por defecto (y ante cualquier error). */
export async function isMissedPhraseLogOn(): Promise<boolean> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM meta WHERE key = ?", [
      MISSED_PHRASES_META_KEY,
    ]);
    return row?.value === "1";
  } catch {
    return false;
  }
}

/** Enciende o apaga el registro. Apagarlo BORRA las frases guardadas. */
export async function setMissedPhraseLog(on: boolean): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
      MISSED_PHRASES_META_KEY,
      on ? "1" : "0",
    ]);
    if (!on) await txn.runAsync("DELETE FROM router_missed");
  });
}

/** Guarda la frase solo si el usuario encendió el registro. */
export async function recordMissedPhrase(text: string, routing: MissedRoutingLike): Promise<void> {
  if (!(await isMissedPhraseLogOn())) return;
  const row = toMissedPhrase(text, routing, Date.now());
  if (!row) return;
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      "INSERT INTO router_missed (ts, text, route, model_tool, retry, fallback) VALUES (?, ?, ?, ?, ?, ?)",
      [row.ts, row.text, row.route, row.modelTool, row.retry, row.fallback],
    );
    await txn.runAsync(
      `DELETE FROM router_missed WHERE id NOT IN (SELECT id FROM router_missed ORDER BY id DESC LIMIT ${MAX_MISSED_PHRASES})`,
    );
  });
}

/** Más recientes primero. */
export async function listMissedPhrases(limit = MAX_MISSED_PHRASES): Promise<MissedPhrase[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    ts: number;
    text: string;
    route: string;
    model_tool: string | null;
    retry: string | null;
    fallback: string | null;
  }>("SELECT ts, text, route, model_tool, retry, fallback FROM router_missed ORDER BY id DESC LIMIT ?", [limit]);
  return rows.map((r) => ({
    ts: r.ts,
    text: r.text,
    route: r.route,
    modelTool: r.model_tool,
    retry: r.retry === "constrained" || r.retry === "nudge" ? r.retry : null,
    fallback: r.fallback,
  }));
}

export async function clearMissedPhrases(): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync("DELETE FROM router_missed");
  });
}
