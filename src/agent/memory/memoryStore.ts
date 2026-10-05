/**
 * memoryStore.ts — NIDO: memoria persistente del agente, 100% en el dispositivo.
 *
 * USA EL DatabaseManager centralizado (`src/security/databaseManager.ts`):
 * - Una sola conexión a `nido_memory.db` compartida con task/skills/graph stores
 * - WriteQueue global, wipe gate y epoch centralizados
 * - SQLCipher fail-closed, cero fallback a plaintext
 *
 * Las funciones de lifecycle (getMemoryDb, writeMemoryTransaction, etc.)
 * delegan al DatabaseManager. Las funciones CRUD usan esas primitivas.
 */

// Tipo local para evitar importar expo-sqlite (paquete roto en entorno de tests).
interface SQLiteDatabase {
  execAsync(sql: string, params?: unknown[]): Promise<void>;
  getAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  runAsync(sql: string, params?: unknown[]): Promise<{ lastInsertRowId: number; changes: number }>;
  withTransactionAsync<T>(fn: () => Promise<T>): Promise<T>;
  closeAsync(): Promise<void>;
}
import type { Fact, Preference, Person, DailyLogEntry, MemorySnapshot } from "./types";
import {
  getDatabase,
  writeTransaction,
  closeDatabase,
  wipeDatabase,
  getDatabaseEpoch,
  safeJsonParse,
} from "../../security/databaseManager";

const DB_NAME = "nido_memory.db";
/** Nombre del fichero de la base de memoria (lo necesita appReset para verificar el borrado). */
export const MEMORY_DB_NAME = DB_NAME;

/**
 * Generación actual del ciclo de vida de la base de memoria. Los módulos
 * que cachean estado derivado del esquema (p. ej. el DDL de p2p/store) la
 * usan para invalidar su caché tras Clear All Data: sin esto, el flag
 * "ya migrado" sobreviviría al wipe y la base nueva quedaría sin tablas.
 *
 * DELEGADO al DatabaseManager: todos los stores comparten el mismo epoch.
 */
export function getMemoryDbEpoch(): number {
  return getDatabaseEpoch();
}
/**
 * @deprecated La clave la maneja el DatabaseManager vía keyManager.
 * Mantenido por compatibilidad; ahora es no-op.
 */
export function setMemoryEncryptionKey(hex: string | null): void {
  // No-op: el DatabaseManager obtiene la clave de keyManager.
}

/**
 * @deprecated El DatabaseManager maneja el ciclo de vida de la clave.
 * Mantenido por compatibilidad; ahora es no-op.
 */
export function resetMemoryKeyCache(): void {
  // No-op: el DatabaseManager no cachea la clave de esta forma.
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * DELEGADO al DatabaseManager: todos los stores comparten la misma conexión.
 * @deprecated Usar getDatabase() del DatabaseManager directamente.
 */
export function getMemoryDb(): Promise<SQLiteDatabase> {
  return getDatabase();
}

/**
 * Escrituras serializadas. DELEGADO al DatabaseManager.
 *
 * Exportada para que el store P2P (`src/p2p/store.ts`, que vive en esta
 * misma base) pase por el MISMO guard de epoch: un único epoch por base,
 * una única cola serializada.
 */
export function writeMemoryTransaction<T>(
  work: (db: SQLiteDatabase) => Promise<T>
): Promise<T> {
  return writeTransaction(work);
}

// ---------------------------------------------------------------- facts

export async function saveFact(input: {
  content: string;
  category?: Fact["category"];
  confidence?: number;
  source?: Fact["source"];
}): Promise<Fact> {
  const fact: Fact = {
    id: newId(),
    content: input.content,
    category: input.category ?? "general",
    confidence: input.confidence ?? 1.0,
    source: input.source ?? "user",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeMemoryTransaction(async (db) => {
    await db.runAsync(
      "INSERT INTO facts (id, content, category, confidence, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);",
      [fact.id, fact.content, fact.category, fact.confidence, fact.source, fact.createdAt, fact.updatedAt]
    );
  });
  return fact;
}

export async function getFacts(limit = 100): Promise<Fact[]> {
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<any>(
    "SELECT id, content, category, confidence, source, created_at AS createdAt, updated_at AS updatedAt FROM facts ORDER BY updated_at DESC LIMIT ?;",
    [limit]
  );
  return rows as Fact[];
}

export async function deleteFact(id: string): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await db.runAsync("DELETE FROM facts WHERE id = ?;", [id]);
  });
}

// ---------------------------------------------------------- preferences

export async function setPreference(key: string, value: string): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await db.runAsync(
      "INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now');",
      [key, value]
    );
  });
}

export async function getPreference(key: string): Promise<string | null> {
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM preferences WHERE key = ?;",
    [key]
  );
  return row?.value ?? null;
}

export async function getAllPreferences(): Promise<Preference[]> {
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<any>(
    "SELECT key, value, updated_at AS updatedAt FROM preferences ORDER BY key;"
  );
  return rows as Preference[];
}

// -------------------------------------------------------------- people

export async function savePerson(input: {
  name: string;
  relationship?: string;
  notes?: string;
}): Promise<Person> {
  const person: Person = {
    id: newId(),
    name: input.name,
    relationship: input.relationship,
    notes: input.notes,
    updatedAt: new Date().toISOString(),
  };
  await writeMemoryTransaction(async (db) => {
    await db.runAsync(
      "INSERT INTO people (id, name, relationship, notes, updated_at) VALUES (?, ?, ?, ?, ?);",
      [person.id, person.name, person.relationship ?? null, person.notes ?? null, person.updatedAt]
    );
  });
  return person;
}

export async function getPeople(): Promise<Person[]> {
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<any>(
    "SELECT id, name, relationship, notes, updated_at AS updatedAt FROM people ORDER BY updated_at DESC;"
  );
  return rows as Person[];
}

export async function deletePerson(id: string): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await db.runAsync("DELETE FROM people WHERE id = ?;", [id]);
  });
}

// ----------------------------------------------------------- daily log

export async function logDay(entry: string, day?: string): Promise<DailyLogEntry> {
  const item: DailyLogEntry = {
    id: newId(),
    day: day ?? new Date().toISOString().slice(0, 10),
    entry,
    createdAt: new Date().toISOString(),
  };
  await writeMemoryTransaction(async (db) => {
    await db.runAsync("INSERT INTO daily_log (id, day, entry, created_at) VALUES (?, ?, ?, ?);", [
      item.id,
      item.day,
      item.entry,
      item.createdAt,
    ]);
  });
  return item;
}

export async function getRecentLog(limit = 20): Promise<DailyLogEntry[]> {
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<any>(
    "SELECT id, day, entry, created_at AS createdAt FROM daily_log ORDER BY created_at DESC LIMIT ?;",
    [limit]
  );
  return rows as DailyLogEntry[];
}

/** Todo lo que el agente inyecta en el contexto de cada conversación. */
export async function snapshot(): Promise<MemorySnapshot> {
  const [facts, preferences, people, recentLog] = await Promise.all([
    getFacts(50),
    getAllPreferences(),
    getPeople(),
    getRecentLog(10),
  ]);
  return { facts, preferences, people, recentLog };
}

/**
 * Borrado total: cierra y elimina la base. La clave del Keystore se borra aparte.
 *
 * Semántica wipe-terminal (ver rag/db.resetDatabase): el epoch se invalida
 * primero y de forma síncrona, así que el trabajo encolado bajo el ciclo de
 * vida anterior falla explícitamente (DbLifecycleEndedError) en vez de
 * reabrir/repoblar la base. Sin drenaje del trabajo en vuelo (ver
 * resetDatabase §2): el reset completa aunque una transacción vieja siga
 * abierta; la terminalidad la garantizan el bump síncrono + unlink +
 * checkGone. El cierre es best-effort. R1: una base ausente es "ya limpia";
 * cualquier otro error de borrado se propaga.
 */
/**
 * DELEGADO al DatabaseManager: wipe centralizado para todos los stores.
 * Después del wipe, ningún store puede recuperar datos viejos.
 */
export async function clearMemoryDb(): Promise<void> {
  await wipeDatabase();
}

// ---------------------------------------------------------------- notes

export interface AgentNote {
  id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/** Guarda una nota en la base cifrada. Devuelve la nota creada. */
export async function saveNote(input: {
  title: string;
  body?: string;
}): Promise<AgentNote> {
  const note: AgentNote = {
    id: newId(),
    title: input.title,
    body: input.body ?? "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await writeMemoryTransaction(async (db) => {
    await db.runAsync(
      "INSERT INTO agent_notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",
      [note.id, note.title, note.body, note.created_at, note.updated_at]
    );
  });
  return note;
}

/** Lista las notas (título + fecha), más recientes primero. */
export async function listNotes(limit = 50): Promise<AgentNote[]> {
  const db = await getMemoryDb();
  return db.getAllAsync<AgentNote>(
    "SELECT id, title, body, created_at, updated_at FROM agent_notes ORDER BY created_at DESC LIMIT ?;",
    [limit]
  );
}

/** Lee una nota completa por id. Null si no existe. */
export async function getNote(id: string): Promise<AgentNote | null> {
  const db = await getMemoryDb();
  const row = await db.getFirstAsync<AgentNote>(
    "SELECT id, title, body, created_at, updated_at FROM agent_notes WHERE id = ?;",
    [id]
  );
  return row ?? null;
}

// ---------------------------------------------------------------- reminders

export interface AgentReminder {
  id: string;
  text: string;
  due_at: string | null;
  done: number;
  created_at: string;
}

/** Crea un recordatorio. due_at en ISO-8601 o null (sin fecha). */
export async function saveReminder(input: {
  text: string;
  dueAt?: string | null;
}): Promise<AgentReminder> {
  const reminder: AgentReminder = {
    id: newId(),
    text: input.text,
    due_at: input.dueAt ?? null,
    done: 0,
    created_at: new Date().toISOString(),
  };
  await writeMemoryTransaction(async (db) => {
    await db.runAsync(
      "INSERT INTO agent_reminders (id, text, due_at, done, created_at) VALUES (?, ?, ?, 0, ?);",
      [reminder.id, reminder.text, reminder.due_at, reminder.created_at]
    );
  });
  return reminder;
}

/** Recordatorios pendientes (no hechos), ordenados por fecha. */
export async function listReminders(limit = 50): Promise<AgentReminder[]> {
  const db = await getMemoryDb();
  return db.getAllAsync<AgentReminder>(
    "SELECT id, text, due_at, done, created_at FROM agent_reminders WHERE done = 0 ORDER BY due_at IS NULL, due_at ASC LIMIT ?;",
    [limit]
  );
}

/** Pendientes cuya fecha ya pasó (para avisar al abrir la app). */
export async function getDueReminders(nowIso?: string): Promise<AgentReminder[]> {
  const now = nowIso ?? new Date().toISOString();
  const db = await getMemoryDb();
  return db.getAllAsync<AgentReminder>(
    "SELECT id, text, due_at, done, created_at FROM agent_reminders WHERE done = 0 AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at ASC;",
    [now]
  );
}

/** Marca un recordatorio como hecho. */
export async function completeReminder(id: string): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await db.runAsync("UPDATE agent_reminders SET done = 1 WHERE id = ?;", [id]);
  });
}
