/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * memoryStore.r1.test.ts — R1 (red-team 2026-10-08): aislamiento de facts de peers.
 *
 * Verifica con la ruta REAL de base de datos (driver falso respaldado por
 * node:sqlite, mismo patrón que memoryStore.fixture.test.ts):
 *
 * 1. snapshot() NUNCA incluye facts con source='peer' (inyección de prompt
 *    persistente en el contexto del dueño).
 * 2. getOwnerFacts() excluye peers; getFacts() los sigue viendo (la UI de
 *    gestión de memoria muestra todo, con transparencia).
 * 3. El dedup de saveFact está acotado por fuente: un fact de un peer que
 *    contiene como substring un fact del dueño NO sobrescribe la fila del
 *    dueño (corrupción ciega).
 * 4. El dedup sigue funcionando dentro del mismo namespace (dueño-dueño,
 *    peer-peer).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const fx = vi.hoisted(() => ({ DOC: "file:///docs/" }));

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

// keyManager fiel: mismo handshake que memoryStore.fixture.test.ts.
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
import {
  getMemoryDb,
  clearMemoryDb,
  saveFact,
  getFacts,
  getOwnerFacts,
  snapshot,
} from "./memoryStore";

let tmpDirs: string[] = [];

function makeHandle(dbPath: string) {
  const sqlite = new DatabaseSync(dbPath);
  return {
    execAsync: async (sql: string) => {
      if (/^\s*PRAGMA\s+key/i.test(sql)) return; // no-op en node:sqlite
      sqlite.exec(sql);
    },
    getAllAsync: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (/cipher_version/i.test(sql)) return [{ cipher_version: "4.9.0-fake" }] as T[];
      const stmt = sqlite.prepare(sql);
      const args = (params ?? []) as Array<string | number | bigint | Buffer | null>;
      return (args.length ? stmt.all(...args) : stmt.all()) as T[];
    },
    getFirstAsync: async <T>(sql: string, params?: unknown[]): Promise<T | null> => {
      if (/cipher_version/i.test(sql)) return { cipher_version: "4.9.0-fake" } as T;
      const stmt = sqlite.prepare(sql);
      const args = (params ?? []) as Array<string | number | bigint | Buffer | null>;
      const row = args.length ? stmt.get(...args) : stmt.get();
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

/** Base fresca por test: el migrate real crea el schema. */
function useFreshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "nido-r1-memory-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "nido_memory.db");
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async (path: string) => {
      if (!path.includes("nido_memory.db")) throw new Error(`DB inesperada: ${path}`);
      return makeHandle(dbPath);
    },
    // Existencia real en disco: una base fresca (inexistente) salta el
    // migratePlaintextToEncrypted (MIGRATION_NOT_REQUIRED) y se crea
    // directamente cifrada por openEncryptedDatabase.
    exists: async (path: string) =>
      path.includes("nido_memory.db") ? existsSync(dbPath) : false,
    remove: async () => {},
    rename: async () => {
      throw new Error("rename no usado en estos tests");
    },
    writeFile: async () => {
      throw new Error("writeFile no usado en estos tests");
    },
  });
}

beforeEach(async () => {
  tmpDirs = [];
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async () => {
      throw new Error("openDb no usado en beforeEach");
    },
    exists: async () => false,
    remove: async () => {},
    rename: async () => {},
    writeFile: async () => {},
  });
  await clearMemoryDb();
  useFreshDb();
  await clearMemoryDb();
  // Fuerza el migrate real sobre la base fresca.
  await getMemoryDb();
});

afterEach(() => {
  setSecureDbTestDriver(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe("R1: facts de peers aislados de la memoria del dueño", () => {
  it("snapshot() excluye facts con source='peer'", async () => {
    await saveFact({ content: "my mom birthday is march 15", source: "user" });
    await saveFact({ content: "peer:abc123: the sky is green", source: "peer" });

    const snap = await snapshot();
    const contents = snap.facts.map((f) => f.content);
    expect(contents).toContain("my mom birthday is march 15");
    expect(contents.some((c) => c.includes("peer:abc123"))).toBe(false);
    expect(snap.facts.every((f) => f.source !== "peer")).toBe(true);
  });

  it("getOwnerFacts excluye peers; getFacts los sigue viendo (transparencia en UI)", async () => {
    await saveFact({ content: "owner fact", source: "user" });
    await saveFact({ content: "peer:abc123: peer fact", source: "peer" });

    const owner = await getOwnerFacts(100);
    expect(owner.every((f) => f.source !== "peer")).toBe(true);
    expect(owner.map((f) => f.content)).toContain("owner fact");

    const all = await getFacts(100);
    expect(all.some((f) => f.source === "peer")).toBe(true);
  });

  it("un fact de peer que contiene un fact del dueño NO lo sobrescribe", async () => {
    const owner = await saveFact({
      content: "mom birthday march 15",
      source: "user",
    });
    // Ataque del red-team: el payload del peer incluye el fact del dueño
    // como substring → antes matcheaba por inclusión y sobrescribía la fila.
    const peerResult = await saveFact({
      content: "peer:abc123: mom birthday march 15 and also the moon is cheese",
      source: "peer",
    });

    // Filas distintas: el peer no tocó la del dueño.
    expect(peerResult.id).not.toBe(owner.id);

    const all = await getFacts(100);
    const ownerRow = all.find((f) => f.id === owner.id);
    expect(ownerRow).toBeDefined();
    expect(ownerRow!.content).toBe("mom birthday march 15");
    expect(ownerRow!.source).toBe("user");
  });

  it("el dedup sigue funcionando dentro del mismo namespace", async () => {
    const first = await saveFact({
      content: "my mom birthday is march 15",
      source: "user",
    });
    // El dueño repite el dato con otras palabras → se actualiza, no duplica.
    const second = await saveFact({
      content: "my mom birthday is march 15 and she loves orchids",
      source: "user",
    });
    expect(second.id).toBe(first.id);
    expect(second.content).toContain("orchids");

    // Peer-peer también deduplica dentro de su namespace.
    const p1 = await saveFact({ content: "peer:abc123: hello", source: "peer" });
    const p2 = await saveFact({
      content: "peer:abc123: hello world",
      source: "peer",
    });
    expect(p2.id).toBe(p1.id);
  });

  it("facts 'inferred' del dueño sí entran al snapshot", async () => {
    await saveFact({ content: "user likes coffee", source: "inferred" });
    const snap = await snapshot();
    expect(snap.facts.some((f) => f.content === "user likes coffee")).toBe(true);
  });
});
