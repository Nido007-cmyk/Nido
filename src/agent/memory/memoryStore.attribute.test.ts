/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * memoryStore.attribute.test.ts — N-02: la pasada de atributo en saveFact.
 *
 * Con la ruta REAL de base de datos (driver falso respaldado por
 * node:sqlite, mismo patrón que memoryStore.r1.test.ts):
 *
 * 1. El duplicado entre idiomas se fusiona en la fila existente.
 * 2. El contradictorio en un atributo de valor único gana lo nuevo
 *    (corrección), en la misma fila.
 * 3. Los multivaluados (alergias) conviven: la sustancia va en la clave.
 * 4. La pasada hereda la acotación por fuente de R1: un fact de peer
 *    no absorbe ni reemplaza uno del dueño.
 * 5. Sin clave de atributo, saveFact se comporta como siempre.
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

// keyManager fiel: mismo handshake que memoryStore.r1.test.ts.
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
import { getMemoryDb, clearMemoryDb, saveFact, getFacts } from "./memoryStore";

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
  const dir = mkdtempSync(join(tmpdir(), "nido-attr-memory-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "nido_memory.db");
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async (path: string) => {
      if (!path.includes("nido_memory.db")) throw new Error(`DB inesperada: ${path}`);
      return makeHandle(dbPath);
    },
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

describe("N-02 — saveFact con la pasada de atributo", () => {
  it("el duplicado entre idiomas se fusiona en la misma fila", async () => {
    const first = await saveFact({ content: "vivo en Madrid", source: "user" });
    const second = await saveFact({ content: "I live in Madrid now", source: "user" });

    expect(second.id).toBe(first.id);
    const all = await getFacts(100);
    expect(all).toHaveLength(1);
  });

  it("el contradictorio en valor único gana lo nuevo, en la misma fila", async () => {
    const first = await saveFact({ content: "vivo en Madrid", source: "user" });
    const second = await saveFact({ content: "I live in Berlin now", source: "user" });

    expect(second.id).toBe(first.id);
    expect(second.content).toBe("I live in Berlin now");
    const all = await getFacts(100);
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe("I live in Berlin now");
  });

  it("los multivaluados conviven: cada alergia es su clave", async () => {
    await saveFact({ content: "soy alérgico a las nueces", source: "user" });
    await saveFact({ content: "soy alérgico al polen", source: "user" });

    const all = await getFacts(100);
    expect(all).toHaveLength(2);
  });

  it("la pasada hereda R1: un peer no absorbe ni reemplaza al dueño", async () => {
    const owner = await saveFact({ content: "vivo en Madrid", source: "user" });
    const peer = await saveFact({ content: "I live in Madrid now", source: "peer" });

    expect(peer.id).not.toBe(owner.id);
    const all = await getFacts(100);
    expect(all).toHaveLength(2);
    expect(all.find((f) => f.id === owner.id)?.content).toBe("vivo en Madrid");
  });

  it("sin clave de atributo, el comportamiento es el de siempre", async () => {
    await saveFact({ content: "me gusta el café sin azúcar", source: "user" });
    await saveFact({ content: "me gusta el té verde", source: "user" });

    const all = await getFacts(100);
    expect(all).toHaveLength(2);
  });

  it("la vía del Jaccard no se toca: la corrección 3/5 de mayo sigue ganando la primera", async () => {
    await saveFact({ content: "mi cumpleaños es el 5 de mayo", source: "user" });
    const corrected = await saveFact({ content: "mi cumpleaños es el 3 de mayo", source: "user" });

    const all = await getFacts(100);
    expect(all).toHaveLength(1);
    expect(corrected.content).toBe("mi cumpleaños es el 3 de mayo");
  });
});
