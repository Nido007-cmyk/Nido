/**
 * db.version.test.ts — L1 FORMAT VERSIONING CONTRACT (bases de datos).
 *
 * - nido_knowledge.db: tabla meta(schema_version) — stamp v1 en la primera
 *   apertura, enforcement en cada apertura posterior. Ausente (donde el
 *   stamp ya debería existir), desconocida o corrupta → fail-closed con
 *   KnowledgeDbVersionError.
 * - nido_memory.db: el stamp existía pero nunca se comparaba — ahora se
 *   exige al abrir. Desconocida o corrupta → fail-closed con
 *   MemoryDbVersionError.
 *
 * Estrategia: código REAL (rag/db, memoryStore, secureDatabase con
 * ensureEncryptedDatabase real) contra un driver falso inyectado con
 * setSecureDbTestDriver + expo-sqlite y keyManager simulados, siguiendo el
 * patrón de db.lifecycle.test.ts. La versión que "contiene" cada base se
 * configura por test (fx.versions): ausente del mapa = sin fila → ruta de
 * stamp. Nada aquí depende de timings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

// ---------------------------------------------------------------------------
// Mundo falso (hoisted)
// ---------------------------------------------------------------------------
const fx = vi.hoisted(() => {
  const DOC = "file:///docs/";
  const files = new Map<string, string>();
  const runLog: string[] = []; // runAsync: SQL + params (para afirmar el stamp)
  // dbName -> valor crudo de meta.schema_version. Ausente del mapa = sin fila.
  const versions = new Map<string, string>();
  const opens: string[] = [];

  function reset(): void {
    files.clear();
    runLog.length = 0;
    versions.clear();
    opens.length = 0;
  }

  function makeHandle(path: string) {
    let keyApplied = false;
    return {
      execAsync: async (sql: string) => {
        if (/^\s*PRAGMA\s+key/i.test(sql)) keyApplied = true;
      },
      getAllAsync: async <T>(sql: string): Promise<T[]> => {
        if (/cipher_version/i.test(sql)) return [{ cipher_version: "4.9.0-fake" }] as T[];
        if (/table_info\s*\(\s*chunks\s*\)/i.test(sql))
          return [{ name: "chunk_id" }, { name: "collection_id" }] as T[];
        return [] as T[];
      },
      getFirstAsync: async <T>(sql: string): Promise<T | null> => {
        if (/schema_version/.test(sql)) {
          const v = [...versions.entries()].find(([name]) => path.includes(name))?.[1];
          return v === undefined ? null : ({ value: v } as T);
        }
        if (/integrity_check/i.test(sql)) return { integrity_check: "ok" } as T;
        if (/FROM\s+sqlite_master/i.test(sql) && !keyApplied) {
          throw new Error("file is not a database (sin clave)");
        }
        return { n: 1 } as T;
      },
      runAsync: async (sql: string, params?: unknown[]) => {
        runLog.push(`RUN ${sql} :: ${JSON.stringify(params ?? [])}`);
      },
      withTransactionAsync: async (fn: () => Promise<void>) => {
        await fn();
      },
      closeAsync: async () => {},
    };
  }

  function makeDriver() {
    return {
      dbDir: () => `${DOC}SQLite/`,
      openDb: async (path: string) => {
        opens.push(path);
        files.set(path, "db-bytes");
        return makeHandle(path);
      },
      exists: async (path: string) => files.has(path),
      remove: async (path: string) => {
        files.delete(path);
      },
      rename: async () => {
        throw new Error("rename no usado en estos tests");
      },
      writeFile: async (path: string, content: string) => {
        files.set(path, content);
      },
    };
  }

  return { DOC, files, runLog, versions, opens, makeDriver, reset };
});

vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: async (name: string) => {
    const prefix = `${fx.DOC}SQLite/${name}`;
    for (const k of [...fx.files.keys()]) {
      if (k === prefix || k.startsWith(`${prefix}-`) || k.startsWith(`${prefix}.`)) {
        fx.files.delete(k);
      }
    }
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: fx.DOC,
  cacheDirectory: fx.DOC,
  getInfoAsync: async (path: string) => ({ exists: fx.files.has(path) }),
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const c = fx.files.get(from);
    if (c === undefined) throw new Error(`no existe: ${from}`);
    fx.files.delete(from);
    fx.files.set(to, c);
  },
  deleteAsync: async (path: string) => {
    fx.files.delete(path);
  },
}));

// keyManager falso pero fiel: mismo handshake que en db.lifecycle.test.ts.
vi.mock("../privacy/keyManager", () => ({

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
import { setSecureDbTestDriver } from "../security/secureDatabase";
import {
  KnowledgeDbVersionError,
  MemoryDbVersionError,
} from "../security/formatVersion";
import { getDb, resetDatabase } from "./db";
import { getMemoryDb, clearMemoryDb } from "../agent/memory/memoryStore";

beforeEach(async () => {
  fx.reset();
  setSecureDbTestDriver(fx.makeDriver());
  // Aislar la promesa cacheada entre tests (bump de epoch, sin sleeps).
  await resetDatabase();
  await clearMemoryDb();
});

afterEach(() => {
  setSecureDbTestDriver(null);
});

function stampLogged(): boolean {
  return fx.runLog.some(
    (l) => /INSERT INTO meta/i.test(l) && /schema_version/.test(l) && l.includes('"1"')
  );
}

// ---------------------------------------------------------------------------
// nido_knowledge.db
// ---------------------------------------------------------------------------
describe("knowledge DB version contract (nido_knowledge.db)", () => {
  it("base nueva (sin fila meta): estampa schema_version=1 y abre", async () => {
    await expect(getDb()).resolves.toBeDefined();
    expect(stampLogged()).toBe(true);
  });

  it("schema_version=1 abre sin re-estampar", async () => {
    fx.versions.set("nido_knowledge.db", "1");
    await expect(getDb()).resolves.toBeDefined();
    expect(stampLogged()).toBe(false);
  });

  it("schema_version=2 (más nueva) falla cerrada con KnowledgeDbVersionError", async () => {
    fx.versions.set("nido_knowledge.db", "2");
    const err = await getDb().catch((e) => e);
    expect(err).toBeInstanceOf(KnowledgeDbVersionError);
    expect((err as Error).name).toBe("KnowledgeDbVersionError");
    expect((err as Error).message).toContain("nido_knowledge.db");
  });

  it("schema_version corrupta falla cerrada", async () => {
    fx.versions.set("nido_knowledge.db", "banana");
    await expect(getDb()).rejects.toBeInstanceOf(KnowledgeDbVersionError);
  });

  it("tras un rechazo, la promesa no queda envenenada: con v1 la siguiente apertura funciona", async () => {
    fx.versions.set("nido_knowledge.db", "2");
    await expect(getDb()).rejects.toBeInstanceOf(KnowledgeDbVersionError);
    fx.versions.set("nido_knowledge.db", "1");
    await expect(getDb()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// nido_memory.db
// ---------------------------------------------------------------------------
describe("memory DB version contract (nido_memory.db)", () => {
  it("base nueva (sin fila meta): estampa schema_version=1 y abre", async () => {
    await expect(getMemoryDb()).resolves.toBeDefined();
    expect(stampLogged()).toBe(true);
  });

  it("schema_version=1 abre", async () => {
    fx.versions.set("nido_memory.db", "1");
    await expect(getMemoryDb()).resolves.toBeDefined();
    expect(stampLogged()).toBe(false);
  });

  it("schema_version=2 (más nueva) falla cerrada con MemoryDbVersionError", async () => {
    fx.versions.set("nido_memory.db", "2");
    const err = await getMemoryDb().catch((e) => e);
    expect(err).toBeInstanceOf(MemoryDbVersionError);
    expect((err as Error).name).toBe("MemoryDbVersionError");
    expect((err as Error).message).toContain("nido_memory.db");
  });

  it("schema_version corrupta falla cerrada (antes se ignoraba)", async () => {
    fx.versions.set("nido_memory.db", "1.5");
    await expect(getMemoryDb()).rejects.toBeInstanceOf(MemoryDbVersionError);
  });

  it("tras un rechazo, la promesa no queda envenenada", async () => {
    fx.versions.set("nido_memory.db", "99");
    await expect(getMemoryDb()).rejects.toBeInstanceOf(MemoryDbVersionError);
    fx.versions.set("nido_memory.db", "1");
    await expect(getMemoryDb()).resolves.toBeDefined();
  });
});
