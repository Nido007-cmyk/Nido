/**
 * secureDbTestHarness.ts — arnés compartido de las suites de la capa
 * cifrada (B-01, Pieza I). Antes de este módulo, 13 suites re-tecleaban
 * su propia copia de `applyDatabaseKey` (8 de Clase A sin try/catch en
 * el paso 5 ni `label`, 3 de Clase B sin validación de formato ni
 * `cipher_version`, 2 stubs mudos) y 19 re-implementaban el handle o
 * el driver: cada copia divergía del real en silencio (censo D1–D5).
 *
 * Aquí vive UNA sola versión de cada pieza:
 *
 * - `fakeKeyManagerModule()`: el módulo `keyManager` para `vi.mock`,
 *   con el handshake **importado del real** (`vi.importActual`), nunca
 *   re-tecleado. Si el handshake real cambia, todas las suites lo
 *   heredan; si una suite necesita sabotear el entorno (la lectura de
 *   la clave, p. ej.), lo pasa como override nombrado.
 * - `makeNodeSqliteHandle()`: handle sobre `node:sqlite` con la
 *   guarda `keyApplied` como comportamiento único — sin `PRAGMA key`
 *   previo, una lectura de `sqlite_master` falla como en una base
 *   SQLCipher real («file is not a database»), de modo que una
 *   apertura con la clave equivocada SÍ puede producir el fail-closed
 *   del real en estas suites (la divergencia D2 era que en cuatro de
 *   ellas no podía). Los adornos reales de cada suite (transacción
 *   BEGIN/COMMIT, `foreign_keys` apagado) son opciones nombradas, no
 *   copias.
 * - `makeFakeFsDriver()`: el driver de la Familia B (sistema de
 *   ficheros en memoria) con sus adornos como opciones.
 *
 * Nada de esto es código de producción: solo lo importan suites.
 */
import { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";
import type { SecureDbDriver, SecureDbHandle } from "./secureDatabase";

type KeyManagerModule = typeof import("../privacy/keyManager");

export interface FakeKeyManagerOverrides {
  /** Sustituye la lectura de la DEK (sabotajes de entorno de cada suite). */
  getDatabaseKeyHex?: () => Promise<string | null>;
  /** Exportaciones extra que una suite concreta necesite del módulo. */
  [extra: string]: unknown;
}

/**
 * El módulo `../privacy/keyManager` para `vi.mock(...)`: por defecto,
 * `registerKeyLossProbe` inerte, la DEK de fixture «ab»×32 y — la
 * pieza que importa — el `applyDatabaseKey` VERDADERO, importado del
 * módulo real. Los overrides se aplican encima, nombrados por suite.
 */
export async function fakeKeyManagerModule(
  overrides: FakeKeyManagerOverrides = {},
): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<KeyManagerModule>("../privacy/keyManager");
  const { getDatabaseKeyHex, ...extra } = overrides;
  return {
    registerKeyLossProbe: () => {},
    getDatabaseKeyHex: getDatabaseKeyHex ?? (async () => "ab".repeat(32)),
    applyDatabaseKey: actual.applyDatabaseKey,
    ...extra,
  };
}

export interface NodeSqliteHandleOptions {
  /**
   * `withTransactionAsync` con BEGIN/COMMIT/ROLLBACK reales sobre la
   * conexión (suites del importador y de avisos). Por defecto, la
   * forma histórica de la mayoría: ejecutar la tarea sin envolver.
   */
  transactional?: boolean;
  /**
   * Ejecuta `PRAGMA foreign_keys = OFF;` al abrir (paridad con el
   * teléfono: la app nunca activa las FK y node:sqlite sí por
   * defecto; la suite del importador lo necesita por diseño).
   */
  foreignKeysOff?: boolean;
}

/**
 * Handle `SecureDbHandle` sobre un fichero SQLite real servido por
 * `node:sqlite`. `PRAGMA key` es un no-op que ARMA la guarda; la
 * versión de cipher se responde con el literal de fixture que las
 * suites ya usaban; toda la demás SQL corre de verdad.
 */
export function makeNodeSqliteHandle(
  dbPath: string,
  options: NodeSqliteHandleOptions = {},
): SecureDbHandle {
  const sqlite = new DatabaseSync(dbPath);
  if (options.foreignKeysOff) sqlite.exec("PRAGMA foreign_keys = OFF;");
  let keyApplied = false;
  const bind = (params?: unknown[]) => (params ?? []) as never[];
  return {
    execAsync: async (sql: string) => {
      if (/^\s*PRAGMA\s+key/i.test(sql)) {
        keyApplied = true;
        return; // no-op en node:sqlite: la base de fixture va en claro
      }
      sqlite.exec(sql);
    },
    getAllAsync: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (/cipher_version/i.test(sql)) return [{ cipher_version: "4.9.0-fake" }] as T[];
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    getFirstAsync: async <T>(sql: string, params?: unknown[]): Promise<T | null> => {
      if (/cipher_version/i.test(sql)) return { cipher_version: "4.9.0-fake" } as T;
      if (/FROM\s+sqlite_master/i.test(sql) && !keyApplied) {
        // Sin PRAGMA key la base «cifrada» no se puede leer:
        // probeDatabaseKind la clasifica como encrypted, como una
        // base SQLCipher real.
        throw new Error("file is not a database (sin clave)");
      }
      return (sqlite.prepare(sql).get(...bind(params)) ?? null) as T | null;
    },
    runAsync: async (sql: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        const info = sqlite.prepare(sql).run(...bind(params));
        return { lastInsertRowId: Number(info.lastInsertRowid), changes: Number(info.changes) };
      }
      sqlite.exec(sql);
      return { lastInsertRowId: 0, changes: 0 };
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      if (!options.transactional) {
        await fn();
        return;
      }
      sqlite.exec("BEGIN");
      try {
        await fn();
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    closeAsync: async () => {
      sqlite.close();
    },
  };
}

export interface FakeFsDriverOptions {
  /** El «disco» de la suite: mapa ruta → contenido, compartido con sus mocks de FS. */
  files: Map<string, string>;
  /** Fábrica del handle guionizado de la suite (su escenario; no se unifica). */
  makeHandle: (path: string) => SecureDbHandle;
  /** Directorio de documentos del mundo falso. Por defecto `file:///docs/`. */
  docDir?: string;
  /** Contenido que `openDb` deja en `files` al abrir. Por defecto `"db-bytes"`. */
  bytesOnOpen?: string;
  /** Compuerta previa a la apertura (retenciones de apertura de wipeTerminal). */
  beforeOpen?: (path: string) => Promise<void>;
  /** Registro y efectos de la apertura (log de `opens`, marcador `.sqlcipher`…). */
  onOpen?: (path: string, files: Map<string, string>) => void;
  /** Registro del borrado (log de `removedPaths`). El borrado en sí siempre ocurre. */
  onRemove?: (path: string) => void;
  /** Mensaje del `rename` cuando la suite no lo usa. */
  renameError?: string;
}

/**
 * El driver de la Familia B: un `SecureDbDriver` sobre un sistema de
 * ficheros en memoria. La cáscara era idéntica en las cuatro suites
 * (dbDir, exists por mapa, remove que borra, writeFile que guarda,
 * rename que lanza «no usado»); lo que varía — el handle guionizado,
 * los registros, las compuertas — entra como opciones nombradas.
 */
export function makeFakeFsDriver(options: FakeFsDriverOptions): SecureDbDriver {
  const docDir = options.docDir ?? "file:///docs/";
  return {
    dbDir: () => `${docDir}SQLite/`,
    openDb: async (path: string) => {
      await options.beforeOpen?.(path);
      options.onOpen?.(path, options.files);
      options.files.set(path, options.bytesOnOpen ?? "db-bytes");
      return options.makeHandle(path);
    },
    exists: async (path: string) => options.files.has(path),
    remove: async (path: string) => {
      options.onRemove?.(path);
      options.files.delete(path);
    },
    rename: async () => {
      throw new Error(options.renameError ?? "rename no usado en estos tests");
    },
    writeFile: async (path: string, content: string) => {
      options.files.set(path, content);
    },
  };
}
