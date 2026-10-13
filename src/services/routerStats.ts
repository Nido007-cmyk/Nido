/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * routerStats.ts — 0.1.33: guarda en el dispositivo (base local cifrada,
 * misma que la telemetría de ejecución) el coste del pre-router y el
 * desenlace de cada mensaje. Nunca se transmite y nunca guarda texto.
 *
 * Todo es best-effort: registrar NUNCA bloquea ni rompe el chat.
 */
import { getDb, writeTransaction } from "../rag/db";
import { isRouterOutcome, type RouterOutcome, type RouterSample } from "./routerStats.pure";

export type { RouterOutcome, RouterSample, RouterSummary } from "./routerStats.pure";
export { summarizeRouterSamples, formatRouterMs, percentOf } from "./routerStats.pure";

const MAX_ROWS = 2000;

export function recordRouterSample(classifyMs: number, outcome: RouterOutcome): void {
  if (!Number.isFinite(classifyMs) || classifyMs < 0) return;
  void writeTransaction(async (txn) => {
    await txn.runAsync("INSERT INTO router_samples (ts, classify_ms, outcome) VALUES (?, ?, ?)", [
      Date.now(),
      classifyMs,
      outcome,
    ]);
    await txn.runAsync(
      `DELETE FROM router_samples WHERE id NOT IN (SELECT id FROM router_samples ORDER BY id DESC LIMIT ${MAX_ROWS})`
    );
  }).catch(() => {
    /* best-effort */
  });
}

export async function listRouterSamples(limit = MAX_ROWS): Promise<RouterSample[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ ts: number; classify_ms: number; outcome: string }>(
    "SELECT ts, classify_ms, outcome FROM router_samples ORDER BY id DESC LIMIT ?",
    [limit]
  );
  return rows
    .filter((r) => isRouterOutcome(r.outcome))
    .map((r) => ({ ts: r.ts, classifyMs: r.classify_ms, outcome: r.outcome as RouterOutcome }));
}

export async function clearRouterSamples(): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync("DELETE FROM router_samples");
  });
}
