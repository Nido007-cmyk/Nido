/**
 * databaseManager.ts — NIDO: gestor centralizado de la base `nido_memory.db`.
 *
 * Unifica el acceso de los 4 stores (memory, tasks, skills, graph) a una
 * sola conexión coordinada. Resuelve la deuda arquitectónica H-1/H-2/H-3:
 *
 * - UNA sola conexión (no 4 handles independientes)
 * - UN solo writeQueue global (escrituras serializadas entre stores)
 * - Wipe gate centralizado (todos los stores respetan Clear All Data)
 * - Epoch único (invalida handles tras wipe)
 * - Schema version unificada
 * - close() real que cierra el handle
 *
 * Garantías de seguridad (no se debilitan):
 * - SQLCipher siempre (fail-closed si no hay clave)
 * - Cero fallback a plaintext
 * - DbLifecycleEndedError tras wipe
 *
 * Uso:
 *   import { getDatabase, writeTransaction } from "../security/databaseManager";
 *   const db = await getDatabase();
 *   await writeTransaction(async (db) => { ... });
 */

// Tipo local para evitar importar expo-sqlite (paquete roto en entorno de tests).
// En producción, la forma real viene de secureDatabase.
/**
 * H8-2026-10-06: esta interfaz DEBE coincidir con SecureDbHandle
 * (src/security/secureDatabase.ts). La versión anterior declaraba
 * `execAsync(sql, params?)` (el wrapper real IGNORA params — la misma
 * clase del bug `LIMIT ?`) y `withTransactionAsync<T>` con retorno T
 * que el runtime no entrega. El cast `as unknown as` ocultaba el desajuste.
 */
interface SQLiteDatabase {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  runAsync(sql: string, params?: unknown[]): Promise<{ lastInsertRowId: number; changes: number }>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}
import { getDatabaseKeyHex } from "../privacy/keyManager";
import {
  assertDbHandleShape,
  DbLifecycleEndedError,
  deleteManagedDatabase,
  ensureEncryptedDatabase,
  getCurrentDriver,
  getWipeGate,
  type SecureDbHandle,
} from "./secureDatabase";
import {
  MEMORY_DB_SCHEMA_VERSION,
  MemoryDbVersionError,
  checkFormatVersion,
} from "./formatVersion";

const DB_NAME = "nido_memory.db";
const SCHEMA_VERSION = MEMORY_DB_SCHEMA_VERSION;

/** DDL unificado: todas las tablas de los 4 stores. */
const UNIFIED_DDL = `
-- Tabla de versión (fuente de verdad del esquema)
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Memory store (facts, preferences, people, logs, reminders, notes)
CREATE TABLE IF NOT EXISTS facts (
  id         TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'general',
  confidence REAL NOT NULL DEFAULT 1.0,
  source     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS preferences (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS people (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  relationship TEXT,
  notes        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS daily_log (
  id         TEXT PRIMARY KEY,
  day        TEXT NOT NULL,
  entry      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_log_day ON daily_log(day);
CREATE TABLE IF NOT EXISTS agent_notes (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_reminders (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL,
  due_at     TEXT,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON agent_reminders(due_at) WHERE done = 0;

-- Task store (scheduled tasks)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  instruction TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_run_at INTEGER,
  next_run_at INTEGER,
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  notify_on_complete INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS scheduled_task_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  success INTEGER NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  tools_used TEXT NOT NULL DEFAULT '[]',
  policy_decisions INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON scheduled_task_runs(task_id);

-- Learned skills store
CREATE TABLE IF NOT EXISTS learned_skills (
  name TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  instructions TEXT NOT NULL,
  learned_at INTEGER NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  total_uses INTEGER NOT NULL DEFAULT 0,
  learned_from TEXT NOT NULL DEFAULT '',
  refinements TEXT NOT NULL DEFAULT '[]'
);

-- Knowledge graph store
CREATE TABLE IF NOT EXISTS kg_entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS kg_relations (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL,
  last_reinforced_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'user'
);
CREATE INDEX IF NOT EXISTS idx_kg_rel_from ON kg_relations(from_id);
CREATE INDEX IF NOT EXISTS idx_kg_entities_name ON kg_entities(name);
CREATE INDEX IF NOT EXISTS idx_kg_relations_to ON kg_relations(to_id);
`;

// ---------------------------------------------------------------------------
// Estado del singleton
// ---------------------------------------------------------------------------

let dbPromise: Promise<SQLiteDatabase> | null = null;
let openEpoch = -1;
let currentEpoch = 0;
let writeChain: Promise<unknown> = Promise.resolve();

/** Devuelve el epoch actual (para tests). */
export function getDatabaseEpoch(): number {
  return currentEpoch;
}

/**
 * Obtiene la conexión única a nido_memory.db.
 * Respeta wipe gate, epoch, y fail-closed.
 */
export async function getDatabase(): Promise<SQLiteDatabase> {
  return getDatabaseForEpoch(currentEpoch);
}

async function getDatabaseForEpoch(
  epoch: number
): Promise<SQLiteDatabase> {
  // Barrera de wipe: ni lecturas, ni aperturas, ni DDL atraviesan un
  // Clear All Data en curso.
  const gate = getWipeGate();
  if (gate) await gate;
  if (epoch !== currentEpoch) {
    throw new DbLifecycleEndedError(DB_NAME);
  }
  if (!dbPromise) {
    openEpoch = epoch;
    const fresh = openAndMigrate();
    dbPromise = fresh;
    // No cachear un rechazo: si la apertura falla, el próximo getDatabase()
    // reintenta en vez de recibir una promesa envenenada.
    fresh.catch(() => {
      if (dbPromise === fresh) {
        dbPromise = null;
        openEpoch = -1;
      }
    });
  }
  const db = await dbPromise;
  if (epoch !== currentEpoch || epoch !== openEpoch) {
    throw new DbLifecycleEndedError(DB_NAME);
  }
  return db;
}

async function openAndMigrate(): Promise<SQLiteDatabase> {
  // Fail-closed: si getDatabaseKeyHex falla, el error se propaga.
  // NO hay fallback a plaintext (corregido en commit ad1f82c).
  const encryptionKeyHex = await getDatabaseKeyHex();

  // F1b-2026-10-06: tipar como SecureDbHandle + assertDbHandleShape en vez
  // del cast amplio `as unknown as SQLiteDatabase` (el compilador no
  // detectaría una deriva futura de la interfaz con el cast).
  const rawDb = await ensureEncryptedDatabase(DB_NAME, "databaseManager", {
    dekHex: encryptionKeyHex ?? undefined,
    driver: getCurrentDriver(),
  });
  assertDbHandleShape(rawDb, "databaseManager.openAndMigrate");
  const db = rawDb as SecureDbHandle;

  if (!encryptionKeyHex && typeof __DEV__ !== "undefined" && __DEV__) {
    console.warn(
      "[databaseManager] Sin clave de cifrado: la base vive en claro (solo dev)."
    );
  }

  try {
    await db.execAsync("PRAGMA journal_mode = WAL;");
    await db.execAsync(UNIFIED_DDL);

    const ver = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'schema_version';"
    );
    if (!ver) {
      await db.runAsync(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?);",
        [String(SCHEMA_VERSION)]
      );
    } else {
      checkFormatVersion({
        formatId: "nido_memory.db",
        found: ver.value,
        supportedMajor: SCHEMA_VERSION,
        ErrorClass: MemoryDbVersionError,
      });
    }
  } catch (err) {
    try {
      await db.closeAsync();
    } catch {
      /* el error original es lo que importa */
    }
    throw err;
  }
  return db;
}

/**
 * Escrituras serializadas sobre la conexión compartida.
 * Todos los stores usan esta única cola (no 4 colas independientes).
 */
export function writeTransaction<T>(
  work: (db: SQLiteDatabase) => Promise<T>
): Promise<T> {
  const scheduledEpoch = currentEpoch;
  const run: Promise<T> = writeChain.then(async (): Promise<T> => {
    const gate = getWipeGate();
    if (gate) await gate;
    if (scheduledEpoch !== currentEpoch) {
      throw new DbLifecycleEndedError(DB_NAME);
    }
    const db = await getDatabaseForEpoch(scheduledEpoch);
    let result: T;
    await db.withTransactionAsync(async () => {
      result = await work(db);
    });
    return result!;
  });
  writeChain = run.catch(() => {});
  return run;
}

/**
 * Cierra la conexión real y avanza el epoch.
 * Después de esto, getDatabase() reabre limpiamente.
 */
export async function closeDatabase(): Promise<void> {
  currentEpoch++;
  const old = dbPromise;
  dbPromise = null;
  openEpoch = -1;
  if (old) {
    try {
      const db = await old;
      await db.closeAsync();
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Wipe completo: elimina la base y rota la DEK.
 * Después del wipe, ningún store puede recuperar datos viejos.
 */
export async function wipeDatabase(): Promise<void> {
  await closeDatabase();
  await deleteManagedDatabase(DB_NAME, getCurrentDriver());
  // El epoch ya avanzó en closeDatabase; la próxima apertura usa DEK nueva.
}

/**
 * Parsea JSON de forma segura. Retorna fallback si el dato está corrupto.
 * (Resuelve H-5: JSON.parse sin protección)
 */
export function safeJsonParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
