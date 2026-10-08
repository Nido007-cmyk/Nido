/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

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
// H8-2026-10-06: debe coincidir con SecureDbHandle (ver databaseManager.ts).
interface SQLiteDatabase {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  runAsync(sql: string, params?: unknown[]): Promise<{ lastInsertRowId: number; changes: number }>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}
import type { Fact, Preference, Person, DailyLogEntry, MemorySnapshot } from "./types";

/**
 * H6-2026-10-06: tope de longitud por ítem de memoria (~125 tokens).
 * Un fact gigante ya no hace que se descarte toda la memoria.
 */
export const MAX_FACT_CONTENT_CHARS = 500;
export const MAX_PREFERENCE_VALUE_CHARS = 500;
export const MAX_PERSON_NOTES_CHARS = 500;
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
  // H6-2026-10-06: cap por ítem para que un fact gigante no rompa el
  // presupuesto de contexto (antes: se descartaba TODA la memoria).
  const content = (input.content ?? "").slice(0, MAX_FACT_CONTENT_CHARS);
  // DEDUP-2026-10-08: si ya existe un fact casi idéntico, actualizarlo en
  // vez de insertar un duplicado (el usuario repite el dato con otras palabras).
  // R1-2026-10-08: el dedup está acotado a la MISMA fuente. Sin esto, un fact
  // de un peer ("peer:abc: mom birthday march 15") matcheaba por inclusión
  // un fact del dueño ("mom birthday march 15") y SOBREESCRIBÍA su fila:
  // corrupción ciega de la memoria del dueño por contenido remoto.
  const existing = await findSimilarFact(content, input.source ?? "user");
  if (existing) {
    // Conservar el contenido más completo de los dos.
    const merged = content.length > existing.content.length ? content : existing.content;
    const updatedAt = new Date().toISOString();
    await writeMemoryTransaction(async (db) => {
      await db.runAsync("UPDATE facts SET content = ?, updated_at = ? WHERE id = ?;", [
        merged,
        updatedAt,
        existing.id,
      ]);
    });
    return { ...existing, content: merged, updatedAt };
  }
  const fact: Fact = {
    id: newId(),
    content,
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

/** Normaliza un texto para comparar facts: minúsculas, sin puntuación, espacios simples. */
export function normalizeFactText(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Similitud Jaccard sobre palabras. 1 = idénticos, 0 = sin palabras en común.
 */
export function factSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeFactText(a).split(" ").filter(Boolean));
  const wb = new Set(normalizeFactText(b).split(" ").filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

/**
 * Busca un fact existente muy similar al contenido dado.
 * Detecta: contenido idéntico normalizado, uno contenido en el otro,
 * o similitud Jaccard >= 0.75.
 *
 * R1-2026-10-08: `onlySource` acota la comparación a facts de la misma
 * fuente. Un fact de un peer NUNCA debe matchear (y por tanto sobrescribir)
 * un fact del dueño: el contenido remoto no es confiable.
 */
export async function findSimilarFact(
  content: string,
  onlySource?: Fact["source"]
): Promise<Fact | null> {
  const norm = normalizeFactText(content);
  if (!norm) return null;
  const facts = await getFacts(500);
  for (const f of facts) {
    if (onlySource && f.source !== onlySource) continue;
    const fn = normalizeFactText(f.content);
    if (!fn) continue;
    if (fn === norm) return f;
    if (fn.includes(norm) || norm.includes(fn)) return f;
    if (factSimilarity(content, f.content) >= 0.75) return f;
  }
  return null;
}

export async function getFacts(limit = 100): Promise<Fact[]> {
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<any>(
    "SELECT id, content, category, confidence, source, created_at AS createdAt, updated_at AS updatedAt FROM facts ORDER BY updated_at DESC LIMIT ?;",
    [limit]
  );
  return rows as Fact[];
}

/**
 * R1 FIX 2026-10-08: facts del PROPIETARIO solamente, para inyectar en el
 * contexto de sus conversaciones. Los facts con source='peer' (escritos por
 * un NIDO par vía task:remember) NUNCA entran aquí: son contenido remoto no
 * confiable y permitirlos sería inyección de prompt persistente en el agente
 * del dueño (sobrevive reboots: SQLite).
 *
 * Allowlist explícita ('user','inferred'), NO `!= 'peer'`: una fuente futura
 * desconocida no entra al contexto por defecto (fail-closed). Si algún día
 * se quiere consultar memoria de peers, debe ser por una vía separada y
 * explícitamente marcada como no confiable, nunca por el snapshot ambiental.
 */
export async function getOwnerFacts(limit = 100): Promise<Fact[]> {
  const db = await getMemoryDb();
  const rows = await db.getAllAsync<any>(
    "SELECT id, content, category, confidence, source, created_at AS createdAt, updated_at AS updatedAt FROM facts WHERE source IN ('user','inferred') ORDER BY updated_at DESC LIMIT ?;",
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
  // H6-2026-10-06: cap por ítem.
  const cappedValue = (value ?? "").slice(0, MAX_PREFERENCE_VALUE_CHARS);
  await writeMemoryTransaction(async (db) => {
    await db.runAsync(
      "INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now');",
      [key, cappedValue]
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
  // DEDUP 2026-10-07: si ya existe una persona con el mismo nombre (case-insensitive),
  // actualizar en vez de duplicar.
  const existing = await getPeople();
  const normalized = input.name.toLowerCase().trim();
  const dup = existing.find((p) => p.name.toLowerCase().trim() === normalized);
  if (dup) {
    const updated: Person = {
      ...dup,
      relationship: input.relationship ?? dup.relationship,
      notes: input.notes?.slice(0, MAX_PERSON_NOTES_CHARS) ?? dup.notes,
      updatedAt: new Date().toISOString(),
    };
    await writeMemoryTransaction(async (db) => {
      await db.runAsync(
        "UPDATE people SET relationship = ?, notes = ?, updated_at = ? WHERE id = ?;",
        [updated.relationship ?? null, updated.notes ?? null, updated.updatedAt, dup.id]
      );
    });
    return updated;
  }

  const person: Person = {
    id: newId(),
    name: input.name,
    relationship: input.relationship,
    // H6-2026-10-06: cap por ítem.
    notes: input.notes?.slice(0, MAX_PERSON_NOTES_CHARS),
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
    // R1: solo facts del propietario. Los facts de peers (source='peer')
    // quedan fuera del contexto por diseño (ver getOwnerFacts).
    getOwnerFacts(50),
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

/** Elimina una nota por id. */
export async function deleteNote(id: string): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await db.runAsync("DELETE FROM agent_notes WHERE id = ?;", [id]);
  });
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
  // DEDUP 2026-10-07: no crear duplicado si ya existe uno pendiente similar.
  // M6 FIX: también comparar dueAt. Si el texto coincide pero la fecha es
  // diferente, no es duplicado (el usuario cambió la fecha).
  const existing = await listReminders(50);
  const normalized = input.text.toLowerCase().trim();
  const dueAtNorm = input.dueAt ?? null;
  const dup = existing.find(
    (r) => !r.done && r.text.toLowerCase().trim() === normalized && (r.due_at ?? null) === dueAtNorm
  );
  if (dup) return dup;

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

/** Elimina un recordatorio por id. */
export async function deleteReminder(id: string): Promise<void> {
  await writeMemoryTransaction(async (db) => {
    await db.runAsync("DELETE FROM agent_reminders WHERE id = ?;", [id]);
  });
}
