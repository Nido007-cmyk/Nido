/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * secureDatabase.ts — NIDO: apertura cifrada (SQLCipher) + migración
 * plaintext → encrypted con fail-closed.
 *
 * Jerarquía de claves (ver docs/C1_SQLCIPHER.md):
 *   Android Keystore (StrongBox si existe, si no TEE) — vía expo-secure-store
 *     → protege la DEK (32 B aleatorios, alias `nido_db_key`)
 *       → `PRAGMA key = "x'<dek hex>'"` sobre cada base SQLCipher
 *
 * La DEK nunca se escribe en claro fuera del Keystore. Nunca se deriva de
 * PIN, UUID, identidad pública ni ningún dato predecible: solo CSPRNG.
 *
 * Máquina de estados de migración (persistida en el sistema de ficheros):
 *   MIGRATION_NOT_REQUIRED → no existe la base: se crea cifrada directamente
 *   MIGRATION_REQUIRED     → existe en claro: hay que migrarla
 *   MIGRATION_IN_PROGRESS  → quedó un temporal de un intento anterior: recuperar
 *   MIGRATION_COMPLETE     → marcador presente (se verifica abriendo con la clave)
 *   RECOVERY_REQUIRED      → no abre ni en claro ni con la clave: intervención
 *
 * Reglas fail-closed:
 * - La base original en claro solo se sustituye por rename atómico DESPUÉS de
 *   verificar integridad, esquema y conteos de la temporal cifrada.
 * - Ante cualquier fallo: la original sigue intacta y se lanza (nunca se
 *   continúa en claro en silencio, nunca se presenta una base vacía como éxito).
 * - La única operación destructiva es el rename; la recuperación es idempotente.
 *
 * Diseño testeable: el acceso a SQLite y al sistema de ficheros va tras
 * `SecureDbDriver`, inyectable en tests. En producción es expo-sqlite +
 * expo-file-system (import ES de primer nivel).
 *
 * NOTA DE INTEROP (2026-10-06): antes se usaba require("expo-sqlite")
 * dinámico dentro de prodDriver(). El build diagnóstico d830374 mostró
 * "[seed-stage:getDb:openAndMigrate] undefined is not a function" en el
 * dispositivo físico: ensureEncryptedDatabase() terminaba pero el handle
 * devuelto no exponía execAsync en runtime. Se cambió a import ES (mismo
 * patrón que src/rag/db.ts) más verificación explícita de forma en
 * runtime (assertSqliteModuleShape / assertDbHandleShape). No basta con
 * que TypeScript compile: la forma real se confirma en el dispositivo.
 */

import * as SQLite from "expo-sqlite";
import * as FileSystem from "expo-file-system/legacy";
import { applyDatabaseKey, getDatabaseKeyHex, registerKeyLossProbe } from "../privacy/keyManager";

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export interface SecureDbHandle {
  execAsync(sql: string): Promise<void>;
  // 2026-10-06 (bug 3, "datatype mismatch" en dispositivo físico): los
  // params SON parte de la firma. La versión anterior los omitía
  // (getAllAsync: (sql) => ...) y el wrapper los descartaba en silencio:
  // toda query con `?` (p. ej. `... LIMIT ?`) corría con params sin bindear
  // (= NULL) y SQLite lanzaba SQLITE_MISMATCH ("datatype mismatch").
  getAllAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  closeAsync(): Promise<void>;
  // 2026-10-06: el wrapper DEBE exponer todo lo que el código llama sobre el
  // handle devuelto por ensureEncryptedDatabase/openEncryptedDatabase.
  // Antes solo tenía los 4 métodos de arriba y db.ts:486 llamaba
  // db.runAsync(...) → "undefined is not a function" en el dispositivo físico
  // (el cast a SQLiteDatabase no agrega métodos que no existen).
  runAsync(
    sql: string,
    params?: unknown[],
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export interface SecureDbDriver {
  openDb(path: string): Promise<SecureDbHandle>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  dbDir(): string;
}

let testDriver: SecureDbDriver | null = null;

/** Solo para tests: inyecta un driver falso. */
export function setSecureDbTestDriver(d: SecureDbDriver | null): void {
  testDriver = d;
}

// ---------------------------------------------------------------------------
// Puerta de wipe (barrera global de Clear All Data)
// ---------------------------------------------------------------------------

/**
 * Barrera global de Clear All Data (R6/R13, criterio "writer N+1 detrás del
 * reset"): mientras `resetAllAppData` está en curso, ningún trabajo de base
 * de datos del ciclo nuevo (lectura, escritura, apertura o DDL) la
 * atraviesa: espera a que el wipe termine.
 *
 * Por qué esperar en vez de fallar rápido: un writer del ciclo N+1 que
 * corriera CONCURRENTE con el borrado podría abrir el fichero con la DEK
 * aún en caché justo antes de que el wipe la elimine del Keystore,
 * dejando una base cifrada con una clave ya borrada (inabrible). Detrás
 * de la barrera, la DEK ya rotó y la caché se restableció: la apertura
 * ocurre con la clave nueva. El trabajo del ciclo ANTERIOR no espera:
 * su guard de epoch lo invalida de todos modos.
 *
 * Si el wipe falla, la puerta se "envenena": los trabajos en espera
 * reciben el error del wipe (fail-closed) en vez de continuar sobre un
 * estado a medias. El próximo `resetAllAppData` instala una puerta nueva.
 */
let wipeGate: Promise<void> | null = null;
let wipeGateResolve: (() => void) | null = null;
let wipeGateReject: ((err: unknown) => void) | null = null;

/** La llama `resetAllAppData` de forma síncrona antes de cualquier await. */
export function beginWipeGate(): void {
  if (wipeGate) return; // ya hay un wipe en curso: el exterior manda
  wipeGate = new Promise<void>((resolve, reject) => {
    wipeGateResolve = resolve;
    wipeGateReject = reject;
  });
  // Sin esto, un wipe fallido sin trabajos en espera generaría un
  // "unhandled rejection" ruidoso; los que sí esperan siguen recibiendo
  // el rechazo en su propio `await`.
  wipeGate.catch(() => {});
}

/**
 * Cierra la puerta. Sin argumento: éxito, los trabajos en espera continúan
 * en el ciclo nuevo. Con error: fail-closed, los trabajos en espera lo
 * reciben en vez de operar sobre restos.
 */
export function endWipeGate(err?: unknown): void {
  const resolve = wipeGateResolve;
  const reject = wipeGateReject;
  wipeGate = null;
  wipeGateResolve = null;
  wipeGateReject = null;
  if (err !== undefined) reject?.(err);
  else resolve?.();
}

/** La puerta vigente, o null si no hay ningún wipe en curso. */
export function getWipeGate(): Promise<void> | null {
  return wipeGate;
}

/**
 * Error lanzado cuando un write encolado pertenece a un ciclo de vida de la
 * base de datos que ya terminó (Clear All Data comenzó después de encolar el
 * write). El trabajo obsoleto falla de forma explícita en vez de reabrir o
 * repoblar silenciosamente la base borrada.
 *
 * NIDO-native: cada base gestionada (conocimiento, memoria) lleva su propio
 * epoch de ciclo de vida; resetDatabase/clearMemoryDb lo invalidan.
 */
export class DbLifecycleEndedError extends Error {
  readonly dbName: string;
  constructor(dbName: string) {
    super(
      `Write rechazado: el ciclo de vida de "${dbName}" terminó ` +
        `(Clear All Data). El trabajo obsoleto no puede reabrir ni repoblar la base.`,
    );
    this.name = "DbLifecycleEndedError";
    this.dbName = dbName;
  }
}

/**
 * R1 (wipe-terminal): `SQLite.deleteDatabaseAsync` lanza
 * `DatabaseNotFoundException` en nativo cuando el fichero no existe. En JS
 * llega con `code === "ERR_DATABASE_NOT_FOUND"` (inferido del nombre de la
 * clase por expo-modules-core) y mensaje `Database '<path>' not found`.
 *
 * SOLO esa condición precisa es benigna (ausente = ya limpio). Cualquier
 * otro fallo (handle abierto → ERR_DELETE_DATABASE, error de borrado del
 * fichero, permisos, E/S) debe propagarse para que el wipe falle de forma
 * honesta en vez de declarar éxito en silencio.
 */
export function isDatabaseNotFoundError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  if (code === "ERR_DATABASE_NOT_FOUND") return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /database\s+'.+'\s+not found/i.test(message);
}

/**
 * Verificación explícita de forma en runtime del módulo expo-sqlite
 * (2026-10-06). El build diagnóstico d830374 mostró en el dispositivo
 * físico "[seed-stage:getDb:openAndMigrate] undefined is not a function":
 * ensureEncryptedDatabase() terminaba, pero el handle devuelto no exponía
 * execAsync. La causa hipotetizada es interop ESM/CJS rota en el require()
 * dinámico que se usaba antes. Estas aserciones hacen que una forma
 * incorrecta falle AQUÍ con un mensaje claro, en vez de tres llamadas
 * más tarde con "undefined is not a function".
 *
 * No basta con que TypeScript compile: la forma real se confirma en el
 * dispositivo físico mediante la instrumentación de seedCorpus/db.
 */
export function assertSqliteModuleShape(mod: unknown): void {
  const m = mod as Record<string, unknown> | null | undefined;
  const fn = m?.["openDatabaseAsync"];
  if (typeof fn !== "function") {
    const keys = m ? Object.keys(m).slice(0, 16).join(",") : String(m);
    const hasDefault =
      m && typeof (m as Record<string, unknown>)["default"] !== "undefined";
    throw new Error(
      "secureDatabase: expo-sqlite module shape mismatch — " +
        `openDatabaseAsync is ${typeof fn} (expected function). ` +
        `Module keys: [${keys}]. Has .default: ${hasDefault}. ` +
        "The bundler resolved an unexpected module shape; DB open cannot proceed.",
    );
  }
}

/**
 * Verificación explícita de forma en runtime del módulo expo-file-system/legacy.
 */
export function assertFileSystemShape(mod: unknown): void {
  const m = mod as Record<string, unknown> | null | undefined;
  const missing = ["getInfoAsync", "deleteAsync", "moveAsync", "writeAsStringAsync"].filter(
    (k) => typeof m?.[k] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      "secureDatabase: expo-file-system/legacy shape mismatch — " +
        `missing functions: ${missing.join(", ")}. ` +
        "The bundler resolved an unexpected module shape.",
    );
  }
  if (typeof m?.["documentDirectory"] === "undefined") {
    throw new Error(
      "secureDatabase: expo-file-system/legacy shape mismatch — " +
        "documentDirectory is undefined.",
    );
  }
}

/**
 * T5-12-2026-10-06: verificación explícita de forma en runtime del módulo
 * expo-crypto. Tres sitios lo cargan con require() diferido (keyManager,
 * p2p/crypto, diagnostics/security); expo-crypto es ESM puro y solo
 * funciona vía interop de Metro — la misma clase de bug que bbfe047.
 * Si la forma del export cambia, falla en claro aquí en vez de un
 * "undefined is not a function" críptico en el call-site.
 */
export function assertExpoCryptoShape(mod: unknown, caller: string): void {
  const m = mod as Record<string, unknown> | null | undefined;
  // expo-crypto expone getRandomBytes (sync) y getRandomBytesAsync.
  const syncFn = m?.["getRandomBytes"];
  const asyncFn = m?.["getRandomBytesAsync"];
  if (typeof syncFn !== "function" && typeof asyncFn !== "function") {
    const keys = m ? Object.keys(m).slice(0, 16).join(",") : String(m);
    const hasDefault =
      m && typeof (m as Record<string, unknown>)["default"] !== "undefined";
    throw new Error(
      `expo-crypto shape mismatch en ${caller} — ` +
        `getRandomBytes/getRandomBytesAsync no son funciones. ` +
        `Module keys: [${keys}]. Has .default: ${hasDefault}. ` +
        "The bundler resolved an unexpected module shape; secure randomness unavailable.",
    );
  }
}

/**
 * Verificación explícita de forma en runtime del handle devuelto por
 * openDatabaseAsync (2026-10-06). Se llama en openDb() ANTES de envolver
 * el handle: si el objeto nativo no expone las APIs que NIDO utiliza,
 * falla aquí con un mensaje claro.
 *
 * Fuente única de verdad de los métodos que SecureDbHandle expone:
 * SECURE_DB_HANDLE_METHODS (abajo). assertDbHandleShape y los regression
 * tests la usan: si el código consumidor empieza a llamar un método nuevo,
 * se agrega ahí (y a la interfaz y al wrapper) o la aserción/tests lo delatan.
 * 2026-10-06: runAsync y withTransactionAsync se agregaron tras el fallo
 * del build bbfe047 en el dispositivo físico ("undefined is not a
 * function" en db.ts:486 — el wrapper no exponía runAsync).
 */
export const SECURE_DB_HANDLE_METHODS = [
  "execAsync",
  "getAllAsync",
  "getFirstAsync",
  "closeAsync",
  "runAsync",
  "withTransactionAsync",
] as const;

export function assertDbHandleShape(db: unknown, where: string): void {
  const h = db as Record<string, unknown> | null | undefined;
  // 2026-10-06: TODOS los métodos de SecureDbHandle, no solo los 4
  // originales. El fallo bbfe047 en el dispositivo físico fue exactamente
  // este: el check solo verificaba execAsync y el código luego llamaba
  // runAsync (inexistente en el wrapper) → "undefined is not a function".
  const missing = SECURE_DB_HANDLE_METHODS.filter(
    (k) => typeof h?.[k] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      `secureDatabase: DB handle from ${where} missing functions: ${missing.join(", ")} ` +
        "(expo-sqlite API shape mismatch on this build).",
    );
  }
}

/**
 * Envuelve el handle nativo de expo-sqlite en un SecureDbHandle.
 * 2026-10-06: el wrapper DEBE exponer los 6 métodos de la interfaz —
 * el build bbfe047 falló en el dispositivo físico porque faltaban
 * runAsync y withTransactionAsync ("undefined is not a function" en
 * db.ts:486). Exportada para que los regression tests verifiquen la
 * delegación (argumentos, retorno y comportamiento transaccional).
 */
export function wrapSecureDbHandle(
  db: Pick<
    SQLite.SQLiteDatabase,
    | "execAsync"
    | "getAllAsync"
    | "getFirstAsync"
    | "closeAsync"
    | "runAsync"
    | "withTransactionAsync"
  >,
): SecureDbHandle {
  // La forma del handle nativo ya se verificó con assertDbHandleShape
  // antes de envolverlo (ver openDb en prodDriver).
  return {
    execAsync: (sql) => db.execAsync(sql),
    // 2026-10-06 (bug 3): reenviar params. Sin esto, `getAllAsync("... LIMIT ?", [n])`
    // ejecutaba `LIMIT NULL` → SQLite "datatype mismatch" en el dispositivo.
    getAllAsync: <T,>(sql: string, params?: unknown[]) =>
      params === undefined
        ? db.getAllAsync<T>(sql)
        : db.getAllAsync<T>(sql, params as SQLite.SQLiteBindParams),
    getFirstAsync: <T,>(sql: string, params?: unknown[]) =>
      params === undefined
        ? db.getFirstAsync<T>(sql)
        : db.getFirstAsync<T>(sql, params as SQLite.SQLiteBindParams),
    closeAsync: () => db.closeAsync(),
    runAsync: (sql, params) =>
      params === undefined
        ? db.runAsync(sql)
        : db.runAsync(sql, params as SQLite.SQLiteBindParams),
    withTransactionAsync: (task) => db.withTransactionAsync(task),
  };
}

// ---------------------------------------------------------------------------
// Driver de producción
// ---------------------------------------------------------------------------

/**
 * Driver de producción: expo-sqlite + expo-file-system vía import ES de
 * primer nivel (mismo patrón que src/rag/db.ts). La forma real de ambos
 * módulos se verifica en runtime con assertSqliteModuleShape /
 * assertFileSystemShape; la forma del handle, con assertDbHandleShape en
 * openDb(). En tests se usa setSecureDbTestDriver() y prodDriver() nunca
 * se toca, así que los módulos nativos no se cargan en Node/vitest
 * (los tests hacen vi.mock de expo-sqlite / expo-file-system/legacy).
 *
 * La inyección vía `globalThis.__NIDO_PROD_DRIVER__` se conserva como punto
 * de extensión (si alguien la define, gana); el fallback real es este.
 *
 * Hallazgo 2026-10-05 (instalación limpia en tablet física): nada inyectaba
 * el driver, así que la sonda N4 (`findManagedDatabases`) lanzaba SIEMPRE en
 * producción y `getDatabaseKeyHex()` caía en fail-closed incluso en primer
 * arranque genuino — la generación de la DEK era inalcanzable.
 */
function prodDriver(): SecureDbDriver {
  if (testDriver) return testDriver;
  const injected = (
    globalThis as unknown as { __NIDO_PROD_DRIVER__?: () => SecureDbDriver }
  ).__NIDO_PROD_DRIVER__;
  if (injected) return injected();
  try {
    // Verificación explícita de forma del módulo en runtime (2026-10-06):
    // el import ES debe exponer openDatabaseAsync como función. Si el
    // bundler resolviera una forma distinta (p. ej. interop ESM/CJS rota),
    // esto falla con un mensaje claro en vez de "undefined is not a function"
    // tres llamadas más tarde.
    assertSqliteModuleShape(SQLite);
    assertFileSystemShape(FileSystem);
    const baseDir = `${(FileSystem.documentDirectory ?? "").replace(/\/$/, "")}/SQLite/`;
    return {
      dbDir: () => baseDir,
      exists: async (path: string) =>
        (await FileSystem.getInfoAsync(path)).exists === true,
      remove: async (path: string) => {
        await FileSystem.deleteAsync(path, { idempotent: true });
      },
      rename: async (from: string, to: string) => {
        await FileSystem.moveAsync({ from, to });
      },
      writeFile: async (path: string, content: string) => {
        await FileSystem.writeAsStringAsync(path, content);
      },
      openDb: async (path: string): Promise<SecureDbHandle> => {
        const slash = path.lastIndexOf("/");
        const db = await SQLite.openDatabaseAsync(
          path.slice(slash + 1),
          { useNewConnection: true },
          path.slice(0, slash),
        );
        // DIAGNOSTIC (2026-10-06): verificación explícita de que el objeto
        // devuelto expone las APIs que NIDO utiliza. El build d830374 falló
        // en openAndMigrate() con "undefined is not a function" porque el
        // handle no tenía execAsync en runtime.
        assertDbHandleShape(db, "expo-sqlite openDatabaseAsync");
        return wrapSecureDbHandle(db);
      },
    };
  } catch (e) {
    throw new Error(
      "secureDatabase: driver de producción no disponible " +
        "(expo-sqlite/expo-file-system no cargaron). En tests usa " +
        "setSecureDbTestDriver().",
      { cause: e },
    );
  }
}

// ---------------------------------------------------------------------------
// N4 — sonda de pérdida de clave (Keystore) y recovery honesto
// ---------------------------------------------------------------------------

/**
 * Bases cifradas gestionadas por NIDO (comparten la misma DEK del Keystore).
 * La sonda N4 comprueba estos ficheros ANTES de que getDatabaseKeyHex()
 * genere una clave: si alguno existe y la DEK falta, es pérdida de clave,
 * no instalación nueva.
 */
export const MANAGED_DB_NAMES = ["nido_memory.db", "nido_knowledge.db", "aoair_knowledge.db"] as const;

/** Driver vigente (test o producción). */
export function getCurrentDriver(): SecureDbDriver {
  return testDriver ?? prodDriver();
}

/** Nombres de las bases gestionadas presentes en el dispositivo. */
export async function findManagedDatabases(driver?: SecureDbDriver): Promise<string[]> {
  const d = driver ?? getCurrentDriver();
  const dir = d.dbDir().replace(/\/$/, "");
  const found: string[] = [];
  for (const name of MANAGED_DB_NAMES) {
    if (await d.exists(`${dir}/${name}`)) found.push(name);
  }
  return found;
}

// Registro al cargar el módulo: memoryStore y rag/db importan secureDatabase
// antes de resolver la DEK, así que la sonda siempre está activa en la ruta
// real de arranque. keyManager no puede importar secureDatabase (ciclo).
registerKeyLossProbe(() => findManagedDatabases());

export interface KeyLossRecoveryResult {
  /** Rutas archivadas (los datos NO se destruyen: se renombran). */
  archived: string[];
}

/**
 * N4 — Camino documentado hacia adelante tras un KeyLossError.
 *
 * Diseño honesto mínimo:
 * - Requiere `confirmed: true`: solo se invoca tras una confirmación
 *   EXPLÍCITA del usuario (la UI muestra el aviso de pérdida de datos del
 *   KeyLossError y el usuario acepta empezar de cero). Sin confirmación,
 *   lanza: jamás hay auto-destrucción ni regeneración silenciosa.
 * - NO borra los datos: archiva cada base gestionada (principal, sidecars,
 *   temporal de migración y marcador) renombrándola a
 *   `<ruta>.keyloss-<timestamp>`. Los datos quedan recuperables si la clave
 *   original reaparece (p. ej. restauración del Keystore).
 * - No genera la DEK: tras archivar, el siguiente arranque ve "sin bases,
 *   sin clave" y genera legítimamente (first-run real).
 * - Fail-closed: si un rename falla, lanza sin continuar a medias.
 */
export async function recoverFromKeyLoss(opts: {
  confirmed: boolean;
  driver?: SecureDbDriver;
}): Promise<KeyLossRecoveryResult> {
  if (!opts.confirmed) {
    throw new Error(
      "recoverFromKeyLoss: requiere confirmación explícita del usuario " +
        "(aviso de pérdida de datos). NIDO nunca destruye ni regenera en silencio.",
    );
  }
  const d = opts.driver ?? getCurrentDriver();
  const ts = Date.now();
  const archived: string[] = [];
  for (const name of await findManagedDatabases(d)) {
    const p = pathsFor(d, name);
    for (const path of [p.main, ...p.sidecars, p.tmp, p.marker]) {
      if (!(await d.exists(path))) continue;
      const target = `${path}.keyloss-${ts}`;
      try {
        await d.rename(path, target);
      } catch (e) {
        throw new Error(
          `recoverFromKeyLoss: no se pudo archivar ${path} (fail-closed: ` +
            "nada más se tocó).",
          { cause: e },
        );
      }
      archived.push(target);
    }
  }
  return { archived };
}

// ---------------------------------------------------------------------------
// Sentencias SQL (exportadas para el test de verificación real con SQLCipher)
// ---------------------------------------------------------------------------

export const SQLCIPHER_EXPORT_ALIAS = "nido_enc";

export function buildKeyPragmaSql(dekHex: string): string {
  return `PRAGMA key = "x'${dekHex.toLowerCase()}'";`;
}

function quotePath(p: string): string {
  return `'${p.replace(/'/g, "''")}'`;
}

export function buildAttachEncryptedSql(tmpPath: string, dekHex: string): string {
  return `ATTACH DATABASE ${quotePath(tmpPath)} AS ${SQLCIPHER_EXPORT_ALIAS} KEY "x'${dekHex.toLowerCase()}'";`;
}

export const SQLCIPHER_EXPORT_SQL = `SELECT sqlcipher_export('${SQLCIPHER_EXPORT_ALIAS}');`;
export const DETACH_ENCRYPTED_SQL = `DETACH DATABASE ${SQLCIPHER_EXPORT_ALIAS};`;
export const VERIFY_READ_SQL = "SELECT count(*) AS n FROM sqlite_master;";
export const INTEGRITY_CHECK_SQL = "PRAGMA integrity_check;";
export const WAL_CHECKPOINT_SQL = "PRAGMA wal_checkpoint(TRUNCATE);";
export const SCHEMA_SQL =
  "SELECT type AS type, name AS name, sql AS sql FROM sqlite_master ORDER BY type, name;";

// ---------------------------------------------------------------------------
// Estado de migración
// ---------------------------------------------------------------------------

export type MigrationState =
  | "MIGRATION_NOT_REQUIRED"
  | "MIGRATION_REQUIRED"
  | "MIGRATION_IN_PROGRESS"
  | "MIGRATION_COMPLETE"
  | "RECOVERY_REQUIRED";

interface DbPaths {
  main: string;
  tmp: string;
  marker: string;
  sidecars: string[];
}

function pathsFor(driver: SecureDbDriver, name: string): DbPaths {
  const dir = driver.dbDir().replace(/\/$/, "");
  const main = `${dir}/${name}`;
  return {
    main,
    tmp: `${main}.migtmp`,
    marker: `${main}.sqlcipher`,
    sidecars: [`${main}-wal`, `${main}-shm`, `${main}-journal`],
  };
}

type DbKind = "plaintext" | "encrypted" | "unreadable";

/** Abre sin clave para distinguir en claro / cifrada / ilegible. Cierra siempre. */
async function probeDatabaseKind(
  driver: SecureDbDriver,
  mainPath: string,
  dekHex: string | null,
): Promise<DbKind> {
  const h = await driver.openDb(mainPath);
  try {
    await h.getFirstAsync(VERIFY_READ_SQL);
    return "plaintext";
  } catch {
    // No abre sin clave: o está cifrada o es ilegible.
  } finally {
    await h.closeAsync().catch(() => {});
  }
  if (!dekHex) return "unreadable";
  const h2 = await driver.openDb(mainPath);
  try {
    await h2.execAsync(buildKeyPragmaSql(dekHex));
    await h2.getFirstAsync(VERIFY_READ_SQL);
    return "encrypted";
  } catch {
    return "unreadable";
  } finally {
    await h2.closeAsync().catch(() => {});
  }
}

export async function getMigrationState(
  name: string,
  dekHex: string | null,
  driver?: SecureDbDriver,
): Promise<MigrationState> {
  const d = driver ?? prodDriver();
  const p = pathsFor(d, name);
  if (await d.exists(p.tmp)) return "MIGRATION_IN_PROGRESS";
  if (!(await d.exists(p.main))) return "MIGRATION_NOT_REQUIRED";
  if (await d.exists(p.marker)) return "MIGRATION_COMPLETE";
  const kind = await probeDatabaseKind(d, p.main, dekHex);
  if (kind === "plaintext") return "MIGRATION_REQUIRED";
  if (kind === "encrypted") return "MIGRATION_COMPLETE"; // cifrada sin marcador (instalación intermedia)
  return "RECOVERY_REQUIRED";
}

// ---------------------------------------------------------------------------
// Huella de verificación (esquema + conteos)
// ---------------------------------------------------------------------------

interface TableFingerprint {
  name: string;
  sql: string | null;
  count: number;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function collectFingerprint(h: SecureDbHandle): Promise<TableFingerprint[]> {
  const objs = await h.getAllAsync<{ type: string; name: string; sql: string | null }>(SCHEMA_SQL);
  const tables = objs.filter((o) => o.type === "table");
  const out: TableFingerprint[] = [];
  for (const t of tables) {
    const row = await h.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM ${quoteIdent(t.name)};`);
    out.push({ name: t.name, sql: t.sql, count: Number(row?.n ?? -1) });
  }
  return out;
}

function fingerprintsEqual(a: TableFingerprint[], b: TableFingerprint[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (t, i) => t.name === b[i].name && t.sql === b[i].sql && t.count === b[i].count,
  );
}

// ---------------------------------------------------------------------------
// Migración
// ---------------------------------------------------------------------------

async function removeWithSidecars(driver: SecureDbDriver, mainPath: string): Promise<void> {
  for (const p of [mainPath, `${mainPath}-wal`, `${mainPath}-shm`, `${mainPath}-journal`]) {
    await driver.remove(p).catch(() => {});
  }
}

/**
 * Verifica que `path` abre con la clave y pasa integrity_check.
 * Cierra la base al terminar (éxito o fallo).
 */
async function verifyEncryptedDatabase(
  driver: SecureDbDriver,
  path: string,
  dekHex: string,
  label: string,
  expected?: TableFingerprint[],
): Promise<void> {
  const h = await driver.openDb(path);
  try {
    await applyDatabaseKey(h, dekHex, label); // PRAGMA key + cipher_version + lectura de prueba
    const ic = await h.getFirstAsync<{ integrity_check: string }>(INTEGRITY_CHECK_SQL);
    if (String(ic?.integrity_check ?? "").toLowerCase() !== "ok") {
      throw new Error(`${label}: integrity_check no pasó en la base migrada.`);
    }
    if (expected) {
      const actual = await collectFingerprint(h);
      if (!fingerprintsEqual(expected, actual)) {
        throw new Error(
          `${label}: la base migrada no coincide (esquema o conteos). Migración abortada.`,
        );
      }
    }
  } finally {
    await h.closeAsync().catch(() => {});
  }
}

/**
 * Migra una base en claro a SQLCipher. Solo la operación destructiva es el
 * rename atómico tmp→main, y solo ocurre tras verificación completa.
 * Ante cualquier fallo la original queda intacta y se lanza.
 */
export async function migratePlaintextToEncrypted(
  name: string,
  dekHex: string,
  driver?: SecureDbDriver,
): Promise<void> {
  const d = driver ?? prodDriver();
  const p = pathsFor(d, name);
  const label = `migración(${name})`;
  if (!/^[0-9a-f]{64}$/i.test(dekHex)) throw new Error(`${label}: DEK inválida (fail-closed).`);

  // Limpieza de un temporal parcial previo (si lo hay, es basura no verificada).
  if (await d.exists(p.tmp)) await removeWithSidecars(d, p.tmp);

  // 1. Exportar la base en claro a la temporal cifrada.
  let fingerprint: TableFingerprint[];
  const src = await d.openDb(p.main);
  try {
    await src.execAsync(WAL_CHECKPOINT_SQL).catch(() => {});
    fingerprint = await collectFingerprint(src);
    await src.execAsync(buildAttachEncryptedSql(p.tmp, dekHex));
    try {
      await src.getAllAsync(SQLCIPHER_EXPORT_SQL);
    } finally {
      await src.execAsync(DETACH_ENCRYPTED_SQL).catch(() => {});
    }
  } finally {
    await src.closeAsync().catch(() => {});
  }

  // 2. Verificar la temporal: abre con la clave, integrity_check y huella idéntica.
  await verifyEncryptedDatabase(d, p.tmp, dekHex, label, fingerprint);

  // 3. Sustitución atómica: el rename sobrescribe la original en claro.
  //    Es la única operación destructiva y ocurre DESPUÉS de verificar.
  await d.rename(p.tmp, p.main);
  // 4. Sidecars de la base antigua (pertenecen al fichero en claro): fuera.
  for (const s of p.sidecars) await d.remove(s).catch(() => {});
  // 5. Marcador de migración completada.
  await d.writeFile(
    p.marker,
    JSON.stringify({ v: 1, cipher: "sqlcipher4", migratedAt: new Date().toISOString(), db: name }),
  );
  // 6. Apertura final de confirmación con la clave.
  await verifyEncryptedDatabase(d, p.main, dekHex, label, fingerprint);
}

/** Limpieza total de una base gestionada: principal, sidecars, temporal y marcador. */
export async function deleteManagedDatabase(name: string, driver?: SecureDbDriver): Promise<void> {
  const d = driver ?? prodDriver();
  const p = pathsFor(d, name);
  await removeWithSidecars(d, p.main);
  await d.remove(p.tmp).catch(() => {});
  await d.remove(p.marker).catch(() => {});
}

/**
 * Lee la huella de contenido (esquema + conteos) de la base principal,
 * aceptando principal en claro o cifrada (aplica la DEK en este último
 * caso). Fail-closed: si la principal no puede leerse, lanza un error
 * explícito — el llamador no debe promover ningún temporal sin esta prueba.
 */
async function collectMainFingerprint(
  driver: SecureDbDriver,
  mainPath: string,
  dekHex: string,
  label: string,
): Promise<TableFingerprint[]> {
  const h = await driver.openDb(mainPath);
  try {
    try {
      await h.getFirstAsync(VERIFY_READ_SQL);
    } catch {
      // No abre en claro: probar con la clave (fail-closed si no abre).
      await applyDatabaseKey(h, dekHex, label);
    }
    return await collectFingerprint(h);
  } catch (err) {
    throw new Error(
      `${label}: la base principal existe pero no pudo leerse con la DEK disponible; ` +
        `no puede demostrarse que el temporal contenga su contenido. Causa: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  } finally {
    await h.closeAsync().catch(() => {});
  }
}

/**
 * Recupera un intento interrumpido (quedó el temporal). Idempotente.
 *
 * INVARIANTE (A/F-NEW-1): la base principal NUNCA se sustituye ni se destruye
 * hasta que el temporal haya DEMOSTRADO contener su contenido (esquema +
 * conteos idénticos a la huella de la principal), no solo ser
 * estructuralmente válido. Si la principal existe pero no puede leerse, no
 * hay forma de demostrar la equivalencia: no se promueve ni se descarta nada
 * y se lanza RECOVERY_REQUIRED (fail-closed explícito, nunca silencioso).
 *
 * - Si el temporal demuestra el contenido: se completa el rename pendiente.
 * - Si no: se descarta el temporal y se reintenta la migración completa
 *   desde la principal, que quedó intacta.
 * - Si no hay ni temporal demostrable ni principal legible: RECOVERY_REQUIRED.
 */
export async function recoverInterruptedMigration(
  name: string,
  dekHex: string,
  driver?: SecureDbDriver,
): Promise<void> {
  const d = driver ?? prodDriver();
  const p = pathsFor(d, name);
  const label = `recuperación(${name})`;

  // Prueba de contenido ANTES de cualquier operación destructiva: la huella
  // de la principal es la única referencia válida contra el temporal.
  const mainExists = await d.exists(p.main);
  let expected: TableFingerprint[] | undefined;
  if (mainExists) {
    try {
      expected = await collectMainFingerprint(d, p.main, dekHex, label);
    } catch {
      // La principal existe pero es ilegible: promover el temporal sería
      // destruir datos que no podemos verificar. No se toca nada.
      throw new Error(
        `${label}: RECOVERY_REQUIRED — la base principal existe pero no es legible ` +
          `con la DEK disponible; el temporal no puede demostrar que contiene su ` +
          `contenido. No se promueve ni se descarta nada: se requiere intervención ` +
          `del usuario (restaurar o restablecer).`,
      );
    }
  }

  const tmpValid = await (async () => {
    try {
      await verifyEncryptedDatabase(d, p.tmp, dekHex, label, expected);
      return true;
    } catch {
      return false;
    }
  })();
  if (tmpValid) {
    // El rename es la única operación destructiva y ocurre DESPUÉS de la
    // prueba de contenido.
    await d.rename(p.tmp, p.main);
    for (const s of p.sidecars) await d.remove(s).catch(() => {});
    await d.writeFile(
      p.marker,
      JSON.stringify({ v: 1, cipher: "sqlcipher4", migratedAt: new Date().toISOString(), db: name }),
    );
    await verifyEncryptedDatabase(d, p.main, dekHex, label, expected);
    return;
  }
  // Temporal no demostrable: descartarlo y reintentar desde la principal si
  // es legible (quedó intacta: nunca se renombró nada sobre ella).
  await removeWithSidecars(d, p.tmp);
  const kind = mainExists ? await probeDatabaseKind(d, p.main, dekHex) : "unreadable";
  if (kind === "plaintext") {
    await migratePlaintextToEncrypted(name, dekHex, d);
    return;
  }
  if (kind === "encrypted") {
    await d.writeFile(
      p.marker,
      JSON.stringify({ v: 1, cipher: "sqlcipher4", migratedAt: new Date().toISOString(), db: name }),
    );
    await verifyEncryptedDatabase(d, p.main, dekHex, label);
    return;
  }
  throw new Error(
    `${label}: RECOVERY_REQUIRED — ni el temporal ni la principal son legibles. ` +
      "No se tocó nada: se requiere intervención del usuario (restaurar o restablecer).",
  );
}

/** Abre la base cifrada con la DEK (fail-closed si la clave no abre). */
export async function openEncryptedDatabase(
  name: string,
  dekHex: string,
  label: string,
  driver?: SecureDbDriver,
): Promise<SecureDbHandle> {
  const d = driver ?? prodDriver();
  const p = pathsFor(d, name);
  const h = await d.openDb(p.main);
  try {
    await applyDatabaseKey(h, dekHex, label);
  } catch (e) {
    // applyDatabaseKey ya cerró; re-lanzar con contexto.
    throw e;
  }
  return h;
}

export interface EnsureOptions {
  driver?: SecureDbDriver;
  /**
   * DEK a usar. `undefined` = resolver vía getDatabaseKeyHex();
   * `null` = sin cifrado (solo dev); string = clave explícita (tests).
   */
  dekHex?: string | null;
}

/**
 * Punto de entrada: garantiza que `name` queda abierta CIFRADA.
 * - Sin DEK (solo dev sin SecureStore): abre en claro con aviso (comportamiento
 *   histórico de desarrollo). En producción getDatabaseKeyHex lanza.
 * - Con DEK: ejecuta la máquina de estados y devuelve la base abierta y verificada.
 */
export async function ensureEncryptedDatabase(
  name: string,
  label: string,
  opts?: EnsureOptions,
): Promise<SecureDbHandle> {
  const d = opts?.driver ?? prodDriver();
  const dekHex = opts && "dekHex" in opts ? opts.dekHex : await getDatabaseKeyHex();
  if (!dekHex) {
    // Solo dev: la base abre en claro (getDatabaseKeyHex ya avisó).
    return d.openDb(pathsFor(d, name).main);
  }
  const state = await getMigrationState(name, dekHex, d);
  switch (state) {
    case "MIGRATION_NOT_REQUIRED":
      return openEncryptedDatabase(name, dekHex, label, d);
    case "MIGRATION_REQUIRED":
      await migratePlaintextToEncrypted(name, dekHex, d);
      return openEncryptedDatabase(name, dekHex, label, d);
    case "MIGRATION_IN_PROGRESS":
      await recoverInterruptedMigration(name, dekHex, d);
      return openEncryptedDatabase(name, dekHex, label, d);
    case "MIGRATION_COMPLETE":
      return openEncryptedDatabase(name, dekHex, label, d);
    case "RECOVERY_REQUIRED":
      throw new Error(
        `${label}: RECOVERY_REQUIRED — la base no abre ni en claro ni con la clave ` +
          "del Keystore. No se abrió en claro. Revisa la pantalla de recuperación.",
      );
  }
}
