/**
 * memoryStore.fixture.test.ts — L2 HISTORICAL FIXTURE CORPUS + MIGRATION
 * HARNESS (nido_memory.db).
 *
 * Longevity rule under test: "v1 data opens in current code; unknown major
 * fails closed with a named error". The fixtures in __fixtures__/ are real
 * SQLite files whose schema + meta stamp were produced by executing the
 * REAL writer's own SQL (getMemoryDb → openAndMigrate) — see
 * __fixtures__/README. Negatives mutate ONLY meta.schema_version. This also
 * covers the P2P tables, which live in this same database.
 *
 * Harness strategy: the injected fake driver opens a TEMP COPY of the
 * fixture file with node:sqlite and lets the REAL getMemoryDb() code path
 * run its real SQL against it — including the real `SELECT value FROM meta
 * WHERE key='schema_version'` and the real checkFormatVersion. The version
 * verdict therefore comes from the fixture's actual bytes, not from a
 * canned value.
 *
 * Encoded L1 semantics:
 * - v1 → ACCEPT.
 * - v2 / v99 / corrupt → REJECT with MemoryDbVersionError (exact name).
 * - no meta row → ACCEPT + stamp v1 (first-open stamping, L1 semantics).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixturePath = (name: string): string => join(FIX, name);

// ---------------------------------------------------------------------------
// Mundo falso (hoisted)
// ---------------------------------------------------------------------------
const fx = vi.hoisted(() => {
  const DOC = "file:///docs/";
  return { DOC };
});

vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: async () => {},
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: fx.DOC,
  getInfoAsync: async () => ({ exists: false }),
  moveAsync: async () => {
    throw new Error("move no usado en estos tests");
  },
  deleteAsync: async () => {},
}));

// keyManager fiel: mismo handshake que db.version.test.ts.
vi.mock("../../privacy/keyManager", () => ({

  registerKeyLossProbe: () => {},
  getDatabaseKeyHex: async () => "ab".repeat(32),
  applyDatabaseKey: async (
    db: {
      execAsync(s: string): Promise<void>;
      getAllAsync(s: string): Promise<Array<{ cipher_version?: string }>>;
      getFirstAsync(s: string): Promise<unknown>;
      closeAsync(): Promise<void>;
    },
    keyHex: string | null,
  ) => {
    if (!keyHex) return;
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
      await db.closeAsync().catch(() => {});
      throw new Error("formato de clave inválido (fail-closed)");
    }
    await db.execAsync(`PRAGMA key = "x'${keyHex.toLowerCase()}'";`);
    const rows = await db.getAllAsync("PRAGMA cipher_version;");
    if (!rows?.[0]?.cipher_version) {
      await db.closeAsync().catch(() => {});
      throw new Error("sin SQLCipher: fail-closed");
    }
    await db.getFirstAsync("SELECT count(*) AS n FROM sqlite_master;");
  },
}));

// Código REAL bajo prueba.
import { setSecureDbTestDriver } from "../../security/secureDatabase";
import { MemoryDbVersionError } from "../../security/formatVersion";
import { getMemoryDb, clearMemoryDb } from "./memoryStore";

// ---------------------------------------------------------------------------
// Driver respaldado por el fixture real
// ---------------------------------------------------------------------------
let tmpDirs: string[] = [];

/** Copia el fixture a un temp (el test no-meta escribe el stamp; el fixture no se toca). */
function stageFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nido-l2-memory-"));
  tmpDirs.push(dir);
  const tmp = join(dir, "fixture.db");
  copyFileSync(fixturePath(name), tmp);
  return tmp;
}

function makeHandle(dbPath: string) {
  const sqlite = new DatabaseSync(dbPath);
  let keyApplied = false;
  return {
    execAsync: async (sql: string) => {
      if (/^\s*PRAGMA\s+key/i.test(sql)) {
        keyApplied = true;
        return; // no-op en node:sqlite
      }
      sqlite.exec(sql);
    },
    getAllAsync: async <T>(sql: string): Promise<T[]> => {
      if (/cipher_version/i.test(sql)) return [{ cipher_version: "4.9.0-fake" }] as T[];
      return sqlite.prepare(sql).all() as T[];
    },
    getFirstAsync: async <T>(sql: string): Promise<T | null> => {
      if (/cipher_version/i.test(sql)) return { cipher_version: "4.9.0-fake" } as T;
      if (/FROM\s+sqlite_master/i.test(sql) && !keyApplied) {
        // Sin PRAGMA key la base "cifrada" no se puede leer: probeDatabaseKind
        // la clasifica como encrypted (como una base SQLCipher real).
        throw new Error("file is not a database (sin clave)");
      }
      const row = sqlite.prepare(sql).get();
      return (row ?? null) as T | null;
    },
    runAsync: async (sql: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        (sqlite.prepare(sql).run as (...a: unknown[]) => void)(...params);
      } else {
        sqlite.exec(sql);
      }
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      await fn();
    },
    closeAsync: async () => {
      sqlite.close();
    },
  };
}

/** El driver "ve" el fixture como la base existente (sin tmp ni marker). */
function useFixture(name: string): string {
  const dbPath = stageFixture(name);
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async (path: string) => {
      if (!path.includes("nido_memory.db")) throw new Error(`DB inesperada: ${path}`);
      return makeHandle(dbPath);
    },
    exists: async (path: string) => !path.endsWith(".migtmp") && !path.endsWith(".sqlcipher"),
    remove: async () => {},
    rename: async () => {
      throw new Error("rename no usado en estos tests");
    },
    writeFile: async () => {
      throw new Error("writeFile no usado en estos tests");
    },
  });
  return dbPath;
}

function readStamp(dbPath: string): string | null {
  const check = new DatabaseSync(dbPath);
  try {
    const row = check.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } finally {
    check.close();
  }
}

beforeEach(async () => {
  tmpDirs = [];
  // Driver mínimo para el clearMemoryDb() de aislamiento (no necesita abrir DBs).
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async () => { throw new Error("openDb no usado en beforeEach"); },
    exists: async () => false,
    remove: async () => {},
    rename: async () => {},
    writeFile: async () => {},
  });
  // Aislar la promesa cacheada entre tests (bump de epoch, sin sleeps).
  await clearMemoryDb();
});

afterEach(() => {
  setSecureDbTestDriver(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe("memory DB fixture corpus — longevity contract", () => {
  it("v1 fixture abre con el código actual → ACCEPT", async () => {
    useFixture("memory.v1.db");
    await expect(getMemoryDb()).resolves.toBeDefined();
  });

  it("v99 fixture → REJECT con MemoryDbVersionError (nombre exacto)", async () => {
    useFixture("memory.v99.db");
    const err = await getMemoryDb().catch((e) => e);
    expect(err).toBeInstanceOf(MemoryDbVersionError);
    expect((err as Error).name).toBe("MemoryDbVersionError");
    expect((err as Error).message).toContain("nido_memory.db");
  });

  it("v2 fixture (más nueva que este lector) → REJECT con MemoryDbVersionError", async () => {
    useFixture("memory.v2.db");
    await expect(getMemoryDb()).rejects.toBeInstanceOf(MemoryDbVersionError);
  });

  it("versión corrupta → REJECT con MemoryDbVersionError", async () => {
    useFixture("memory.corrupt-version.db");
    await expect(getMemoryDb()).rejects.toBeInstanceOf(MemoryDbVersionError);
  });

  it("sin fila meta → ACCEPT y estampa v1 (semántica L1 de primera apertura)", async () => {
    const dbPath = useFixture("memory.no-meta.db");
    expect(readStamp(dbPath)).toBeNull();
    await expect(getMemoryDb()).resolves.toBeDefined();
    // El stamp lo escribió el propio código al abrir, no el test.
    expect(readStamp(dbPath)).toBe("1");
  });
});
