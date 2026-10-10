/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * actionLogStore.ts — historial de acciones del agente en la base cifrada,
 * y «deshacer» para lo que el agente creó (notas y recordatorios).
 *
 * Solo se guarda: herramienta, desenlace, si hubo confirmación y el id de
 * lo creado. Nunca argumentos ni resultados.
 */

import { getDatabase, writeTransaction } from "../security/databaseManager";
import { setActionLogSink, type ActionLogEntry, type ActionOutcome, type UndoRef } from "./actionLog";

export interface StoredAction extends ActionLogEntry {
  id: number;
  undone: boolean;
}

/** Entradas que se conservan; las más antiguas se van borrando. */
export const MAX_STORED_ACTIONS = 500;

export async function appendAction(entry: ActionLogEntry): Promise<void> {
  await writeTransaction(async (db) => {
    await db.runAsync(
      `INSERT INTO agent_action_log (ts, tool, outcome, confirmed, undo_kind, undo_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entry.ts,
        entry.tool,
        entry.outcome,
        entry.confirmed ? 1 : 0,
        entry.undo?.kind ?? null,
        entry.undo?.id ?? null,
      ],
    );
    await db.runAsync(
      `DELETE FROM agent_action_log WHERE id NOT IN
         (SELECT id FROM agent_action_log ORDER BY id DESC LIMIT ?)`,
      [MAX_STORED_ACTIONS],
    );
  });
}

/** Más recientes primero. */
export async function listActions(limit = 50): Promise<StoredAction[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: number;
    ts: string;
    tool: string;
    outcome: string;
    confirmed: number;
    undo_kind: string | null;
    undo_id: string | null;
    undone: number;
  }>("SELECT * FROM agent_action_log ORDER BY id DESC LIMIT ?", [limit]);
  return rows.map((r) => {
    const undo: UndoRef | undefined =
      (r.undo_kind === "note" || r.undo_kind === "reminder") && r.undo_id
        ? { kind: r.undo_kind, id: r.undo_id }
        : undefined;
    return {
      id: r.id,
      ts: r.ts,
      tool: r.tool,
      outcome: r.outcome as ActionOutcome,
      confirmed: r.confirmed === 1,
      undone: r.undone === 1,
      ...(undo ? { undo } : {}),
    };
  });
}

export async function clearActions(): Promise<void> {
  await writeTransaction(async (db) => {
    await db.runAsync("DELETE FROM agent_action_log");
  });
}

/** ¿Se puede deshacer esta entrada? */
export function canUndo(a: Pick<StoredAction, "outcome" | "undo" | "undone">): boolean {
  return a.outcome === "executed" && !!a.undo && !a.undone;
}

export interface UndoDeps {
  deleteNote(id: string): Promise<void>;
  deleteReminder(id: string): Promise<void>;
  cancelReminderNotification(id: string): Promise<void>;
  markUndone(actionId: number): Promise<void>;
}

/**
 * Deshace una acción borrando lo que creó. Devuelve false si la entrada no
 * se puede deshacer. Borrar algo que ya no existe no es un error: el
 * resultado que el usuario quiere (que no esté) ya se cumple.
 */
export async function undoActionWith(a: StoredAction, deps: UndoDeps): Promise<boolean> {
  if (!canUndo(a) || !a.undo) return false;
  if (a.undo.kind === "note") {
    await deps.deleteNote(a.undo.id);
  } else {
    await deps.cancelReminderNotification(a.undo.id);
    await deps.deleteReminder(a.undo.id);
  }
  await deps.markUndone(a.id);
  return true;
}

export async function undoAction(a: StoredAction): Promise<boolean> {
  const [{ deleteNote, deleteReminder }, { cancelReminderNotification }] = await Promise.all([
    import("./memory/memoryStore"),
    import("../notify/notifications"),
  ]);
  return undoActionWith(a, {
    deleteNote,
    deleteReminder,
    cancelReminderNotification,
    markUndone: async (actionId) => {
      await writeTransaction(async (db) => {
        await db.runAsync("UPDATE agent_action_log SET undone = 1 WHERE id = ?", [actionId]);
      });
    },
  });
}

/** Conecta el registro en memoria con la base. Llamar una vez al arrancar. */
export function startActionLogPersistence(): void {
  setActionLogSink((entry) => {
    // Si la base no está disponible la entrada queda solo en memoria.
    appendAction(entry).catch(() => {});
  });
}
