/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * db.fixture.test.ts — L2 HISTORICAL FIXTURE CORPUS + MIGRATION HARNESS
 * (nido_knowledge.db).
 *
 * Longevity rule under test: "v1 data opens in current code; unknown major
 * fails closed with a named error". The fixtures in __fixtures__/ are real
 * SQLite files whose schema + meta stamp were produced by executing the
 * REAL writer's own SQL (getDb → openAndMigrate) — see __fixtures__/README.
 * Negatives mutate ONLY meta.schema_version.
 *
 * Harness strategy: the injected fake driver opens a TEMP COPY of the
 * fixture file with node:sqlite and lets the REAL getDb() code path run its
 * real SQL against it — including the real `SELECT value FROM meta WHERE
 * key='schema_version'` and the real checkFormatVersion. The version verdict
 * therefore comes from the fixture's actual bytes, not from a canned value.
 *
 * Encoded L1 semantics:
 * - v1 → ACCEPT.
 * - v2 / v99 / corrupt → REJECT with KnowledgeDbVersionError (exact name).
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
import { KnowledgeDbVersionError } from "../security/formatVersion";
import { getDb, resetDatabase, writeTransaction } from "./db";
import { listRouterSamples, recordRouterSample } from "../services/routerStats";
import {
  clearMissedPhrases,
  isMissedPhraseLogOn,
  listMissedPhrases,
  recordMissedPhrase,
  setMissedPhraseLog,
} from "../services/missedPhrases";

// ---------------------------------------------------------------------------
// Driver respaldado por el fixture real
// ---------------------------------------------------------------------------
let tmpDirs: string[] = [];

/** Copia el fixture a un temp (el test no-meta escribe el stamp; el fixture no se toca). */
function stageFixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nido-l2-knowledge-"));
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
    getAllAsync: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (/cipher_version/i.test(sql)) return [{ cipher_version: "4.9.0-fake" }] as T[];
      return (sqlite.prepare(sql).all as (...a: unknown[]) => unknown[])(...(params ?? [])) as T[];
    },
    getFirstAsync: async <T>(sql: string, params?: unknown[]): Promise<T | null> => {
      if (/cipher_version/i.test(sql)) return { cipher_version: "4.9.0-fake" } as T;
      if (/FROM\s+sqlite_master/i.test(sql) && !keyApplied) {
        // Sin PRAGMA key la base "cifrada" no se puede leer: probeDatabaseKind
        // la clasifica como encrypted (como una base SQLCipher real).
        throw new Error("file is not a database (sin clave)");
      }
      const row = (sqlite.prepare(sql).get as (...a: unknown[]) => unknown)(...(params ?? []));
      return (row ?? null) as T | null;
    },
    runAsync: async (sql: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        const info = (
          sqlite.prepare(sql).run as (...a: unknown[]) => {
            changes: number;
            lastInsertRowid: number;
          }
        )(...params);
        return { lastInsertRowId: info.lastInsertRowid, changes: info.changes };
      }
      sqlite.exec(sql);
      return { lastInsertRowId: 0, changes: 0 };
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
      if (!path.includes("nido_knowledge.db")) throw new Error(`DB inesperada: ${path}`);
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
  // Aislar la promesa cacheada entre tests (bump de epoch, sin sleeps).
  await resetDatabase();
});

afterEach(() => {
  setSecureDbTestDriver(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe("knowledge DB fixture corpus — longevity contract", () => {
  it("v1 fixture abre con el código actual → ACCEPT", async () => {
    useFixture("knowledge.v1.db");
    await expect(getDb()).resolves.toBeDefined();
  });

  it("v99 fixture → REJECT con KnowledgeDbVersionError (nombre exacto)", async () => {
    useFixture("knowledge.v99.db");
    const err = await getDb().catch((e) => e);
    expect(err).toBeInstanceOf(KnowledgeDbVersionError);
    expect((err as Error).name).toBe("KnowledgeDbVersionError");
    expect((err as Error).message).toContain("nido_knowledge.db");
  });

  it("v2 fixture (más nueva que este lector) → REJECT con KnowledgeDbVersionError", async () => {
    useFixture("knowledge.v2.db");
    await expect(getDb()).rejects.toBeInstanceOf(KnowledgeDbVersionError);
  });

  it("versión corrupta → REJECT con KnowledgeDbVersionError", async () => {
    useFixture("knowledge.corrupt-version.db");
    await expect(getDb()).rejects.toBeInstanceOf(KnowledgeDbVersionError);
  });

  it("sin fila meta → ACCEPT y estampa v1 (semántica L1 de primera apertura)", async () => {
    const dbPath = useFixture("knowledge.no-meta.db");
    expect(readStamp(dbPath)).toBeNull();
    await expect(getDb()).resolves.toBeDefined();
    // El stamp lo escribió el propio código al abrir, no el test.
    expect(readStamp(dbPath)).toBe("1");
  });
});

// 0.1.39: lo que el router deja pasar al modelo. SQL real contra la base v1.
describe("router_samples y router_missed (0.1.39) sobre una base v1 existente", () => {
  // recordRouterSample no espera a la escritura: una transacción vacía en
  // la misma cola termina después de las anteriores.
  const flush = () => writeTransaction(async () => {});
  const columns = (dbPath: string, table: string): string[] => {
    const check = new DatabaseSync(dbPath);
    try {
      return (check.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    } finally {
      check.close();
    }
  };

  it("la migración añade las columnas de vía y la tabla de frases, sin tocar lo demás", async () => {
    const dbPath = useFixture("knowledge.v1.db");
    await getDb();
    expect(columns(dbPath, "router_samples")).toEqual(
      expect.arrayContaining(["ts", "classify_ms", "outcome", "route", "model_tool", "retry"]),
    );
    expect(columns(dbPath, "router_missed")).toEqual(
      expect.arrayContaining(["ts", "text", "route", "model_tool", "retry", "fallback"]),
    );
    expect(readStamp(dbPath)).toBe("1");
  });

  it("guarda y lee la vía de cada turno, saneando lo que escribe el modelo", async () => {
    useFixture("knowledge.v1.db");
    await getDb();
    recordRouterSample(0.05, "router", { route: "calc", modelTools: [], retry: null });
    recordRouterSample(0.05, "model", { route: "model", modelTools: ["create_reminder", "recuérdame a Ana"], retry: "nudge" });
    recordRouterSample(0.05, "chat");
    await flush();
    const rows = await listRouterSamples();
    expect(rows.map((r) => [r.outcome, r.route, r.modelTool, r.retry])).toEqual([
      ["chat", null, null, null],
      ["model", "model", "create_reminder,other", "nudge"],
      ["router", "calc", null, null],
    ]);
  });

  it("las frases no reconocidas: apagado por defecto, se guardan solo si se enciende y apagar las borra", async () => {
    useFixture("knowledge.v1.db");
    await getDb();
    const routing = { route: "model", modelTools: ["create_reminder"], retry: null, fallback: null };
    expect(await isMissedPhraseLogOn()).toBe(false);
    await recordMissedPhrase("avísame del dentista el jueves", routing);
    expect(await listMissedPhrases()).toEqual([]);

    await setMissedPhraseLog(true);
    expect(await isMissedPhraseLogOn()).toBe(true);
    await recordMissedPhrase("avísame del dentista el jueves", routing);
    const list = await listMissedPhrases();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ text: "avísame del dentista el jueves", route: "model", modelTool: "create_reminder" });

    await setMissedPhraseLog(false);
    expect(await listMissedPhrases()).toEqual([]);
    await setMissedPhraseLog(true);
    await recordMissedPhrase("otra", routing);
    await clearMissedPhrases();
    expect(await listMissedPhrases()).toEqual([]);
  });

  it("conserva solo las 50 más recientes", async () => {
    useFixture("knowledge.v1.db");
    await getDb();
    await setMissedPhraseLog(true);
    const routing = { route: "model", modelTools: [], retry: null, fallback: "notUnderstood" };
    for (let i = 0; i < 55; i++) await recordMissedPhrase(`frase ${i}`, routing);
    const list = await listMissedPhrases(100);
    expect(list).toHaveLength(50);
    expect(list[0].text).toBe("frase 54");
    expect(list[49].text).toBe("frase 5");
  });
});
