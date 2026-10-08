/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { getDb, writeTransaction } from "../rag/db";

export interface ChatSession {
  id: string;
  title: string;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  /** null = no rating given. Present so reopening a past session restores previously-given thumbs. */
  feedback: "up" | "down" | null;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createSession(title = "New chat"): Promise<ChatSession> {
  // R2: por el ciclo de vida guardado + serializado: una sesión obsoleta no
  // puede recrear la base tras Clear All Data.
  const now = Date.now();
  const session: ChatSession = { id: newId(), title, summary: null, createdAt: now, updatedAt: now };
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `INSERT INTO chat_sessions (id, title, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [session.id, session.title, session.summary, session.createdAt, session.updatedAt]
    );
  });
  return session;
}

export async function listSessions(): Promise<ChatSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    summary: string | null;
    created_at: number;
    updated_at: number;
  }>(`SELECT id, title, summary, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC`);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getMessages(sessionId: string): Promise<ChatMessageRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    session_id: string;
    role: "user" | "assistant";
    text: string;
    created_at: number;
    rating: "up" | "down" | null;
  }>(
    `SELECT m.id, m.session_id, m.role, m.text, m.created_at, f.rating
     FROM chat_messages m
     LEFT JOIN answer_feedback f ON f.message_id = m.id
     WHERE m.session_id = ? ORDER BY m.created_at ASC`,
    [sessionId]
  );
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    text: r.text,
    createdAt: r.created_at,
    feedback: r.rating,
  }));
}

/**
 * `id` is optional and defaults to a freshly generated one, but ChatScreen
 * always passes its own in-memory message id explicitly (the same one used
 * as the FlatList key / React state id) — so a thumbs-up/down tap can
 * reference `item.id` directly as `setMessageFeedback`'s foreign key,
 * rather than needing a separate id-mapping step.
 */
export async function addMessage(
  sessionId: string,
  role: "user" | "assistant",
  text: string,
  id: string = newId()
): Promise<void> {
  // R2: el INSERT + el UPDATE van en una sola transacción guardada: o se
  // aplican ambos bajo el ciclo de vida vigente, o el mensaje obsoleto falla
  // explícito sin recrear nada tras Clear All Data.
  const now = Date.now();
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `INSERT INTO chat_messages (id, session_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, sessionId, role, text, now]
    );
    await txn.runAsync(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`, [now, sessionId]);
  });
}

/** `rating: null` clears any existing feedback (tapping the same thumb again to un-rate). */
export async function setMessageFeedback(messageId: string, rating: "up" | "down" | null): Promise<void> {
  // R2: ver addMessage.
  await writeTransaction(async (txn) => {
    if (rating === null) {
      await txn.runAsync(`DELETE FROM answer_feedback WHERE message_id = ?`, [messageId]);
      return;
    }
    await txn.runAsync(
      `INSERT OR REPLACE INTO answer_feedback (message_id, rating, created_at) VALUES (?, ?, ?)`,
      [messageId, rating, Date.now()]
    );
  });
}

export async function setSessionTitle(sessionId: string, title: string): Promise<void> {
  // R2: ver addMessage.
  await writeTransaction(async (txn) => {
    await txn.runAsync(`UPDATE chat_sessions SET title = ? WHERE id = ?`, [title, sessionId]);
  });
}

export async function setSessionSummary(sessionId: string, summary: string): Promise<void> {
  // R2: ver addMessage.
  await writeTransaction(async (txn) => {
    await txn.runAsync(`UPDATE chat_sessions SET summary = ? WHERE id = ?`, [summary, sessionId]);
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `DELETE FROM answer_feedback WHERE message_id IN (SELECT id FROM chat_messages WHERE session_id = ?)`,
      [sessionId]
    );
    await txn.runAsync(`DELETE FROM chat_messages WHERE session_id = ?`, [sessionId]);
    await txn.runAsync(`DELETE FROM chat_sessions WHERE id = ?`, [sessionId]);
  });
}

export async function clearAllHistory(): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync(`DELETE FROM answer_feedback`);
    await txn.runAsync(`DELETE FROM chat_messages`);
    await txn.runAsync(`DELETE FROM chat_sessions`);
  });
}

/** Deletes the oldest sessions beyond `maxSessions` (0 = unlimited). */
export async function pruneSessions(maxSessions: number): Promise<void> {
  if (maxSessions <= 0) return;
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM chat_sessions ORDER BY updated_at DESC LIMIT -1 OFFSET ?`,
    [maxSessions]
  );
  for (const row of rows) {
    await deleteSession(row.id);
  }
}
