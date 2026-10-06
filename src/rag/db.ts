import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { getDatabaseKeyHex } from "../privacy/keyManager";
import {
  assertDbHandleShape,
  DbLifecycleEndedError,
  deleteManagedDatabase,
  ensureEncryptedDatabase,
  getWipeGate,
  isDatabaseNotFoundError,
} from "../security/secureDatabase";
import {
  KNOWLEDGE_DB_SCHEMA_VERSION,
  KnowledgeDbVersionError,
  checkFormatVersion,
} from "../security/formatVersion";

/** Nombre pre-rebrand del fichero (era BOAR-era "aoair"). Solo para migración y borrado. */
const LEGACY_DB_NAME = "aoair_knowledge.db";
const DB_NAME = "nido_knowledge.db";
/** Nombre del fichero de la base de conocimiento (lo necesita appReset para verificar el borrado). */
export const KNOWLEDGE_DB_NAME = DB_NAME;
/**
 * Fichero heredado pre-rebrand. Durante la transición, Clear All Data debe
 * borrarlo también por si la migración de fichero nunca llegó a ejecutarse.
 */
export const LEGACY_KNOWLEDGE_DB_NAME = LEGACY_DB_NAME;

/**
 * Sufijos gestionados junto al fichero principal: sidecars de SQLite,
 * temporal de migración y marcador .sqlcipher.
 */
const DB_FILE_SUFFIXES = ["", "-wal", "-shm", "-journal", ".migtmp", ".sqlcipher"];

function sqliteDir(): string {
  const doc = FileSystem.documentDirectory ?? "";
  return `${doc.replace(/\/$/, "")}/SQLite/`;
}

/**
 * Migración única del nombre de fichero pre-rebrand: si existe el fichero
 * heredado y aún no existe el nuevo, MUEVE (no copia) el fichero principal,
 * sus sidecars, el temporal de migración y el marcador .sqlcipher al nuevo
 * nombre. Así las instalaciones existentes conservan su índice sin un
 * re-embedding costoso en el dispositivo.
 *
 * El marcador se mueve tal cual: getMigrationState solo comprueba su
 * existencia, y aunque faltara, la sonda clasificaría la base movida como
 * "encrypted" (misma DEK del Keystore) y no intentaría re-migrarla.
 *
 * Best-effort: si algo falla, openAndMigrate crea una base nueva y el
 * fichero heredado queda para que Clear All Data lo elimine.
 */
export async function migrateLegacyKnowledgeDb(): Promise<void> {
  const dir = sqliteDir();
  try {
    const newMain = `${dir}${DB_NAME}`;
    if ((await FileSystem.getInfoAsync(newMain)).exists) return; // ya migrado o instalación nueva
    for (const suffix of DB_FILE_SUFFIXES) {
      const from = `${dir}${LEGACY_DB_NAME}${suffix}`;
      const to = `${dir}${DB_NAME}${suffix}`;
      try {
        if ((await FileSystem.getInfoAsync(from)).exists) {
          await FileSystem.moveAsync({ from, to });
        }
      } catch {
        /* best-effort por fichero */
      }
    }
  } catch {
    /* best-effort global */
  }
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Epoch del ciclo de vida de la base de conocimiento. resetDatabase() lo
 * incrementa. Cada writeTransaction captura el epoch al encolarse; cuando le
 * llega su turno solo se ejecuta si el epoch no cambió. Así, un write
 * encolado pero no iniciado antes de Clear All Data falla de forma explícita
 * (DbLifecycleEndedError) en vez de reabrir/repoblar la base ya borrada.
 *
 * La comprobación ocurre en el momento de ejecución (no solo al encolar),
 * así que ningún timing puede resucitar la base: el trabajo obsoleto nunca
 * llega a llamar a getDb().
 */
let dbEpoch = 0;
/**
 * Epoch para el que se creó el handle/promesa cacheado en `dbPromise`.
 * Junto con el post-chequeo de getDbForEpoch cierra el TOCTOU entre
 * "writer autorizado para el epoch N" y "adquisición del handle": si
 * resetDatabase() avanzó el ciclo de vida mientras se esperaba la apertura,
 * el handle obtenido (viejo o recién creado) se descarta sin usar.
 */
let dbOpenEpoch = -1;

/**
 * Generación actual del ciclo de vida de la base de conocimiento. Las
 * operaciones largas (seed del corpus, import de documentos) la capturan al
 * inicio y la propagan a cada write vía WriteOptions: si Clear All Data
 * avanza el ciclo a mitad de la operación, sus writes pendientes fallan con
 * DbLifecycleEndedError en vez de repoblar la base nueva con trabajo
 * obsoleto del ciclo anterior.
 */
export function getDbEpoch(): number {
  return dbEpoch;
}

/** Opciones de escritura: token de ciclo de vida de la operación origen. */
export interface WriteOptions {
  /**
   * Epoch capturado al inicio de una operación larga (seed/import). Por
   * defecto se usa el vigente al encolar el write (correcto para acciones
   * discretas del usuario).
   */
  lifecycleEpoch?: number;
}

/**
 * Opens (and lazily creates) the local knowledge base: an FTS5 virtual table
 * for lexical search plus a parallel table of vector embeddings for semantic
 * search. Entirely local - expo-sqlite is a native binding, no network.
 *
 * Lecturas del ciclo de vida actual: se ligan al epoch vigente en el momento
 * de la llamada. Las escrituras deben pasar por writeTransaction (guard de
 * ciclo de vida + serialización); ver getDbForEpoch.
 */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  return getDbForEpoch(dbEpoch);
}

/**
 * Adquisición de handle ligada a un epoch concreto (TOCTOU-hardened):
 *
 * 1. Pre-chequeo SÍNCRONO: si el epoch ya avanzó, se falla sin tocar nada.
 *    Entre este chequeo y el inicio de la apertura no hay ningún `await`:
 *    el hilo JS es cooperativo y resetDatabase() invalida el epoch también
 *    de forma síncrona al empezar, así que ningún reset puede colarse en
 *    ese tramo.
 * 2. Post-chequeo tras el `await`: si Clear All Data avanzó el epoch
 *    mientras se esperaba la apertura, el handle se descarta sin usar -
 *    nunca se escribe sobre un handle de un ciclo de vida ya terminado,
 *    ni sobre uno recién abierto para el ciclo nuevo por un writer obsoleto.
 *
 * Invariante: un writer planificado bajo el epoch N no puede adquirir un
 * handle usable después de que reset avance el ciclo de vida a N+1.
 */
async function getDbForEpoch(epoch: number): Promise<SQLite.SQLiteDatabase> {
  // DIAGNOSTIC (2026-10-05): fine-grained stages to find "undefined is not
  // a function" inside getDb(). TODO: remove once root cause fixed.
  const dstage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      // Preserve original error type (instanceof checks in tests) — only
      // prepend the stage tag to the message.
      if (e instanceof Error) {
        e.message = `[seed-stage:getDb:${name}] ${e.message}`;
        throw e;
      }
      throw new Error(`[seed-stage:getDb:${name}] ${String(e)}`);
    }
  };
  // Barrera de wipe (ver secureDatabase.getWipeGate): ni lecturas, ni
  // aperturas, ni DDL atraviesan un Clear All Data en curso; esperan a que
  // termine y actúan ya en el ciclo nuevo (o fallan si el wipe falló).
  const gate = await dstage("getWipeGate", async () => getWipeGate());
  if (gate) await gate;
  if (epoch !== dbEpoch) {
    throw new DbLifecycleEndedError(DB_NAME);
  }
  if (!dbPromise) {
    dbOpenEpoch = epoch;
    const fresh = dstage("openAndMigrate", async () => openAndMigrate());
    dbPromise = fresh;
    // No cachear un rechazo para siempre: si esta apertura falla, se limpia
    // el slot para que la próxima llamada reintente en vez de recibir una
    // promesa envenenada permanentemente. El error original sigue llegando
    // intacto a todos los que esperaban `fresh`.
    fresh.catch(() => {
      if (dbPromise === fresh) {
        dbPromise = null;
        dbOpenEpoch = -1;
      }
    });
  }
  const db = await dbPromise;
  if (epoch !== dbEpoch || epoch !== dbOpenEpoch) {
    throw new DbLifecycleEndedError(DB_NAME);
  }
  return db;
}

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * A transaction on the shared connection, run after any other one still in
 * progress. Two overlapping withTransactionAsync calls on one connection
 * fail with "cannot start a transaction within a transaction", and
 * withExclusiveTransactionAsync opens and closes a connection per call,
 * which crashed expo-sqlite natively after a few thousand inserts.
 */
export function writeTransaction(
  work: (db: SQLite.SQLiteDatabase) => Promise<void>,
  opts?: WriteOptions
): Promise<void> {
  // Epoch de la operación origen (seed/import lo capturan al inicio) o, por
  // defecto, el vigente al encolar. El guard compara en ejecución: el
  // trabajo obsoleto falla explícito aunque el epoch avanzara a mitad.
  const scheduledEpoch = opts?.lifecycleEpoch ?? dbEpoch;
  const run = writeChain.then(async () => {
    // Barrera de wipe: el writer del ciclo N+1 va DETRÁS del reset, nunca
    // concurrente con el borrado (ver getWipeGate). El trabajo del ciclo
    // anterior no necesita esperar: el guard de epoch lo invalida igual.
    const gate = getWipeGate();
    if (gate) await gate;
    // Lifecycle guard: si Clear All Data comenzó después de encolar este
    // write, fallar explícitamente en vez de reabrir/repoblar la base.
    // getDbForEpoch repite el chequeo de forma atómica con la adquisición
    // del handle (ver TOCTOU): el epoch capturado viaja hasta el handle.
    if (scheduledEpoch !== dbEpoch) {
      throw new DbLifecycleEndedError(DB_NAME);
    }
    const db = await getDbForEpoch(scheduledEpoch);
    await db.withTransactionAsync(() => work(db));
  });
  writeChain = run.catch(() => {});
  return run;
}

/**
 * Closes and deletes the on-disk database (chat history, the whole
 * knowledge base - bundled corpus, downloaded packs, and custom imported
 * collections all live in this one file) and clears the cached connection
 * so the next getDb() call creates a fresh one. Used by appReset.ts's
 * "Clear All Data" - not called during normal operation.
 *
 * Wipe-terminal semantics (GOAL 1 + R1/R2/TOCTOU):
 * 1. El epoch se invalida PRIMERO y de forma síncrona: cualquier write
 *    encolado pero aún no iniciado verá el cambio cuando le llegue su turno
 *    y fallará con DbLifecycleEndedError en vez de reabrir la base.
 * 2. El reset NO drena el trabajo en vuelo del ciclo anterior: debe poder
 *    completar aunque una transacción vieja siga abierta sobre el handle
 *    viejo. La terminalidad no depende del drenaje:
 *    a) el bump síncrono impide que el ciclo viejo adquiera NUEVOS handles
 *       (toda reapertura por path queda bloqueada por el guard de epoch);
 *    b) el borrado es unlink: las escrituras que el handle viejo haga vía
 *       su fd ya abierto van a un inodo sin path y no recrean el fichero;
 *    c) el cierre best-effort del handle viejo aborta/libera su transacción
 *       cuando el driver lo permite;
 *    d) checkGone (appReset) verifica la ausencia al final del wipe.
 * 3. El cierre del handle viejo es best-effort: la garantía del borrado
 *    viene de la eliminación de ficheros + la verificación checkGone en
 *    appReset, así que un fallo de close no debe abortar el wipe
 *    (consistente con memoryStore.clearMemoryDb).
 * 4. R1: borrar una base ausente (p. ej. el nombre heredado
 *    `aoair_knowledge.db` en instalaciones nuevas) es "ya limpio" y no
 *    aborta el wipe; cualquier otro error de borrado se propaga para que
 *    el wipe falle de forma honesta.
 * 5. TOCTOU: la adquisición del handle está ligada al epoch
 *    (getDbForEpoch): ningún reset puede colarse entre "writer autorizado"
 *    y "handle adquirido" de forma que permita mutación obsoleta.
 * 6. Writes del ciclo nuevo (epoch N+1) encolados durante el wipe: la
 *    cadena los ordena tras el trabajo viejo y su apertura pasa por
 *    getDbForEpoch con pre/post-chequeo. Si su apertura cae dentro de la
 *    ventana del borrado, el unlink sigue ganando (el path no reaparece
 *    por escrituras vía fd); el wipe permanece terminal y checkGone lo
 *    verifica de forma honesta.
 */
export async function resetDatabase(): Promise<void> {
  // Invalidar el ciclo de vida antes de cualquier await: a partir de aquí
  // ningún trabajo obsoleto puede reabrir la base.
  dbEpoch += 1;
  const oldDbPromise = dbPromise;
  dbPromise = null;
  dbOpenEpoch = -1;
  // Sin drenaje del trabajo en vuelo: el reset debe completar aunque una
  // transacción del ciclo anterior siga abierta (ver punto 2 del comentario).
  // El cierre best-effort aborta esa transacción cuando el driver lo permite;
  // la terminalidad la garantizan el bump síncrono + unlink + checkGone.
  if (oldDbPromise) {
    try {
      const db = await oldDbPromise;
      await db.closeAsync();
    } catch {
      /* best-effort: el borrado + la verificación deciden el resultado */
    }
  }
  // Durante la transición se borran ambos nombres: si la migración de
  // fichero nunca llegó a ejecutarse, el fichero heredado seguiría ahí.
  for (const name of [DB_NAME, LEGACY_DB_NAME]) {
    try {
      await SQLite.deleteDatabaseAsync(name);
    } catch (err) {
      // R1: ausente = ya limpio. Cualquier otro fallo (fichero abierto,
      // E/S, permisos) aborta el wipe en vez de fingir éxito.
      if (!isDatabaseNotFoundError(err)) throw err;
    }
    try {
      await deleteManagedDatabase(name); // sidecars, temporal y marcador .sqlcipher, best-effort
    } catch {
      /* best-effort */
    }
  }
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  // Misma clave Keystore que la base de memoria (ver keyManager).
  // En prod sin SecureStore lanza: fail-closed.
  // DIAGNOSTIC (2026-10-05): wrap each step to find "undefined is not a function".
  const ostage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      // Preserve original error type (instanceof checks in tests) — only
      // prepend the stage tag to the message.
      if (e instanceof Error) {
        e.message = `[seed-stage:getDb:openAndMigrate:${name}] ${e.message}`;
        throw e;
      }
      throw new Error(`[seed-stage:getDb:openAndMigrate:${name}] ${String(e)}`);
    }
  };
  const keyHex = await ostage("getDatabaseKeyHex", async () => getDatabaseKeyHex());
  // Antes de abrir: mueve el fichero heredado pre-rebrand si existe, para
  // conservar el índice sin re-embedding.
  await ostage("migrateLegacyKnowledgeDb", async () => migrateLegacyKnowledgeDb());
  // Apertura cifrada con migración plaintext→SQLCipher fail-closed.
  const db = (await ostage("ensureEncryptedDatabase", async () => ensureEncryptedDatabase(DB_NAME, "rag/db", {
    dekHex: keyHex,
  }))) as unknown as SQLite.SQLiteDatabase;

  // DIAGNOSTIC (2026-10-06): verificación explícita de que el handle
  // devuelto expone TODOS los métodos que openAndMigrate y el resto del
  // código llaman sobre él ANTES de usarlo. El build d830374 falló aquí
  // en el dispositivo físico con "undefined is not a function" sin etiqueta
  // de sub-stage (esta llamada está fuera de los ostage); el build bbfe047
  // pasó el check parcial de execAsync y luego falló en db.runAsync(:486),
  // que el wrapper SecureDbHandle no exponía. assertDbHandleShape verifica
  // los 6 métodos de la interfaz (execAsync, getAllAsync, getFirstAsync,
  // closeAsync, runAsync, withTransactionAsync). Cadena a confirmar en
  // Android: ensureEncryptedDatabase → DB handle → all methods available
  // → openAndMigrate → schema created.
  await ostage("handleShapeCheck", async () => {
    assertDbHandleShape(db, "ensureEncryptedDatabase (SecureDbHandle wrapper)");
  });

  // GOAL 2: si la inicialización del esquema falla (disco lleno, base
  // corrupta), no filtrar el handle nativo y no dejar la promesa cacheada
  // envenenada: getDb() la limpia al rechazar para que el próximo intento
  // reintente. El error original se relanza intacto; un fallo del close de
  // limpieza nunca lo enmascara. Sin fallback silencioso a otra base.
  try {
    await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk_id UNINDEXED,
      doc_id UNINDEXED,
      title,
      body
    );

    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      title TEXT,
      body TEXT NOT NULL,
      source TEXT
    );

    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      chunk_id TEXT PRIMARY KEY REFERENCES chunks(chunk_id),
      -- embedding stored as raw float32 blob for brute-force cosine search
      embedding BLOB NOT NULL,
      dim INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id),
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session
      ON chat_messages(session_id, created_at);

    -- One rating per assistant message (message_id is the primary key, not
    -- an auto-increment id) - a re-tap replaces the row via INSERT OR
    -- REPLACE rather than accumulating a history of rating changes; this
    -- app only needs "the user's current verdict on this answer," not an
    -- edit trail.
    CREATE TABLE IF NOT EXISTS answer_feedback (
      message_id TEXT PRIMARY KEY REFERENCES chat_messages(id),
      rating TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Phase 7 (docs/ADAPTIVE_ROUTING.md) - persistent, model-tagged
    -- execution telemetry, local/offline only, never transmitted. NEVER
    -- stores the user's prompt or the generated response text - this is
    -- engineering/debugging data (timing, model, task classification), not
    -- a copy of conversation history. reason_codes is a JSON-encoded
    -- string array (router.ts's RoutingPlan.reasonCodes), not a joined
    -- table, since it's small and read as a whole, never queried by
    -- individual code.
    CREATE TABLE IF NOT EXISTS execution_telemetry (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      model_id TEXT,
      task_type TEXT,
      adaptive_routing_used INTEGER NOT NULL DEFAULT 0,
      reason_codes TEXT,
      retrieval_used INTEGER,
      model_switches INTEGER,
      cross_message_model_switch INTEGER,
      model_residency TEXT,
      model_load_ms REAL,
      ttft_ms REAL,
      generation_latency_ms REAL,
      total_latency_ms REAL,
      tokens_generated INTEGER,
      tok_per_sec REAL,
      peak_rss_bytes INTEGER,
      outcome TEXT,
      error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_execution_telemetry_created
      ON execution_telemetry(created_at DESC);

    -- User-imported document collections (Settings > Knowledge Base >
    -- Import). Chunks from the bundled/downloaded corpus have no collection
    -- (collection_id IS NULL on the chunks table below) and are always
    -- searched; chunks belonging to a collection are only searched while
    -- that collection's "active" flag is on, so the user can toggle a
    -- custom pack off without deleting it.
    CREATE TABLE IF NOT EXISTS custom_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_filename TEXT,
      doc_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL DEFAULT 0
    );
    -- L1 - contrato de versionado: cada apertura estampa y exige
    -- schema_version. major desconocido / ausente / corrupto → fail-closed
    -- con KnowledgeDbVersionError; nunca se opera sobre un esquema que no se
    -- entiende.
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(chunks)`);
  if (!columns.some((c) => c.name === "collection_id")) {
    await db.execAsync(`ALTER TABLE chunks ADD COLUMN collection_id TEXT REFERENCES custom_collections(id)`);
  }

  // Storage budget (BOAR item 4, adapted): track last access for LRU eviction.
  // New installs get the column via CREATE TABLE; existing DBs get ALTER.
  const collColumns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(custom_collections)`);
  if (!collColumns.some((c) => c.name === "last_accessed")) {
    await db.execAsync(`ALTER TABLE custom_collections ADD COLUMN last_accessed INTEGER NOT NULL DEFAULT 0`);
    // Backfill: existing collections get created_at as their last access.
    await db.execAsync(`UPDATE custom_collections SET last_accessed = created_at WHERE last_accessed = 0`);
  }

  const schemaVer = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = 'schema_version';"
  );
  if (!schemaVer) {
    // Primera apertura de esta base (instalación nueva o base heredada sin
    // stamp): se estampa v1. Las bases creadas a partir de aquí ya la traen.
    await db.runAsync("INSERT INTO meta (key, value) VALUES ('schema_version', ?);", [
      String(KNOWLEDGE_DB_SCHEMA_VERSION),
    ]);
  } else {
    checkFormatVersion({
      formatId: "nido_knowledge.db",
      found: schemaVer.value,
      supportedMajor: KNOWLEDGE_DB_SCHEMA_VERSION,
      ErrorClass: KnowledgeDbVersionError,
    });
  }
  } catch (err) {
    try {
      await db.closeAsync();
    } catch {
      /* el error original es lo que importa; la limpieza no lo enmascara */
    }
    throw err;
  }

  return db;
}

export interface ChunkRecord {
  chunkId: string;
  docId: string;
  title: string;
  body: string;
  source?: string;
  /** Set for chunks from a user-imported collection; omitted for the bundled/downloaded corpus. */
  collectionId?: string;
}

export async function insertChunk(
  chunk: ChunkRecord,
  embedding: Float32Array,
  opts?: WriteOptions
): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunks (chunk_id, doc_id, title, body, source, collection_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [chunk.chunkId, chunk.docId, chunk.title, chunk.body, chunk.source ?? null, chunk.collectionId ?? null]
    );
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunks_fts (chunk_id, doc_id, title, body) VALUES (?, ?, ?, ?)`,
      [chunk.chunkId, chunk.docId, chunk.title, chunk.body]
    );
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunk_embeddings (chunk_id, embedding, dim) VALUES (?, ?, ?)`,
      [chunk.chunkId, new Uint8Array(embedding.buffer), embedding.length]
    );
  }, opts);
}

/**
 * Inserts a chunk WITHOUT a vector embedding (FTS-only). Used when the
 * native embedding engine is unavailable in the build — the document is
 * still searchable via full-text search; only semantic vector search is
 * degraded. This keeps setup from blocking on a native JSI issue.
 */
export async function insertChunkWithoutEmbedding(
  chunk: ChunkRecord,
  opts?: WriteOptions
): Promise<void> {
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunks (chunk_id, doc_id, title, body, source, collection_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [chunk.chunkId, chunk.docId, chunk.title, chunk.body, chunk.source ?? null, chunk.collectionId ?? null]
    );
    await txn.runAsync(
      `INSERT OR REPLACE INTO chunks_fts (chunk_id, doc_id, title, body) VALUES (?, ?, ?, ?)`,
      [chunk.chunkId, chunk.docId, chunk.title, chunk.body]
    );
    // Deliberately no chunk_embeddings row — vector search will skip it.
  }, opts);
}

export interface CustomCollection {
  id: string;
  name: string;
  sourceFilename: string | null;
  docCount: number;
  chunkCount: number;
  sizeBytes: number;
  active: boolean;
  createdAt: number;
  lastAccessed: number;
}

export async function listCustomCollections(): Promise<CustomCollection[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    source_filename: string | null;
    doc_count: number;
    chunk_count: number;
    size_bytes: number;
    active: number;
    created_at: number;
    last_accessed: number;
  }>(`SELECT * FROM custom_collections ORDER BY created_at DESC`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sourceFilename: r.source_filename,
    docCount: r.doc_count,
    chunkCount: r.chunk_count,
    sizeBytes: r.size_bytes,
    active: r.active === 1,
    createdAt: r.created_at,
    lastAccessed: r.last_accessed,
  }));
}

export async function createCustomCollection(
  collection: Omit<CustomCollection, "active" | "createdAt" | "lastAccessed">,
  opts?: WriteOptions
): Promise<void> {
  // R2: por el ciclo de vida guardado + serializado: un import obsoleto no
  // puede recrear la colección tras Clear All Data.
  const now = Date.now();
  await writeTransaction(async (txn) => {
    await txn.runAsync(
      `INSERT INTO custom_collections (id, name, source_filename, doc_count, chunk_count, size_bytes, active, created_at, last_accessed)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        collection.id,
        collection.name,
        collection.sourceFilename,
        collection.docCount,
        collection.chunkCount,
        collection.sizeBytes,
        now,
        now,
      ]
    );
  }, opts);
}

export async function setCustomCollectionActive(id: string, active: boolean): Promise<void> {
  // R2: ver createCustomCollection.
  await writeTransaction(async (txn) => {
    await txn.runAsync(`UPDATE custom_collections SET active = ? WHERE id = ?`, [active ? 1 : 0, id]);
  });
}

export async function deleteCustomCollection(id: string): Promise<void> {
  await writeTransaction(async (txn) => {
    const rows = await txn.getAllAsync<{ chunk_id: string }>(
      `SELECT chunk_id FROM chunks WHERE collection_id = ?`,
      [id]
    );
    for (const r of rows) {
      await txn.runAsync(`DELETE FROM chunks WHERE chunk_id = ?`, [r.chunk_id]);
      await txn.runAsync(`DELETE FROM chunks_fts WHERE chunk_id = ?`, [r.chunk_id]);
      await txn.runAsync(`DELETE FROM chunk_embeddings WHERE chunk_id = ?`, [r.chunk_id]);
    }
    await txn.runAsync(`DELETE FROM custom_collections WHERE id = ?`, [id]);
  });
}

export async function getCollectionDocs(
  id: string
): Promise<Array<{ title: string; source: string; body: string }>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ title: string; body: string; source: string | null }>(
    `SELECT DISTINCT title, body, source FROM chunks WHERE collection_id = ? ORDER BY chunk_id`,
    [id]
  );
  return rows.map((r) => ({ title: r.title, body: r.body, source: r.source ?? "" }));
}
