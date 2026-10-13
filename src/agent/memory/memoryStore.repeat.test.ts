/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * memoryStore.repeat.test.ts — 0.1.32: recordatorios que se repiten, con la
 * ruta REAL de base de datos (driver falso respaldado por node:sqlite, mismo
 * patrón que memoryStore.r1.test.ts).
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
  saveReminder,
  listReminders,
  getDueReminders,
  completeReminder,
  deleteReminder,
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
  const dir = mkdtempSync(join(tmpdir(), "nido-repeat-memory-"));
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

describe("0.1.32: recordatorios repetidos en la base", () => {
  it("guarda la repetición y la devuelve al listar", async () => {
    const due = new Date(2026, 9, 14, 9, 0).toISOString();
    const r = await saveReminder({ text: "tomar la pastilla", dueAt: due, repeat: "day" });
    expect(r.repeat).toBe("day");
    const all = await listReminders();
    expect(all.find((x) => x.id === r.id)?.repeat).toBe("day");
  });

  it("uno normal lista repeat null", async () => {
    const r = await saveReminder({ text: "llamar", dueAt: new Date(2026, 9, 14, 9, 0).toISOString() });
    const all = await listReminders();
    expect(all.find((x) => x.id === r.id)?.repeat ?? null).toBeNull();
  });

  it("sin fecha no se guarda como repetido", async () => {
    const r = await saveReminder({ text: "algo", dueAt: null, repeat: "week" });
    expect(r.repeat).toBeNull();
  });

  it("completar uno repetido avanza su fecha y sigue pendiente", async () => {
    const due = new Date(2026, 9, 13, 9, 0);
    const r = await saveReminder({ text: "basura", dueAt: due.toISOString(), repeat: "week" });
    await completeReminder(r.id, new Date(2026, 9, 13, 9, 1));
    const after = (await listReminders()).find((x) => x.id === r.id);
    expect(after).toBeDefined();
    expect(new Date(after!.due_at!)).toEqual(new Date(2026, 9, 20, 9, 0));
  });

  it("aviso entregado un poco antes de su hora: avanza igual", async () => {
    const due = new Date(2026, 9, 13, 9, 0);
    const r = await saveReminder({ text: "agua", dueAt: due.toISOString(), repeat: "day" });
    await completeReminder(r.id, new Date(2026, 9, 13, 8, 59));
    const after = (await listReminders()).find((x) => x.id === r.id);
    expect(new Date(after!.due_at!)).toEqual(new Date(2026, 9, 14, 9, 0));
  });

  it("completar uno normal lo cierra", async () => {
    const r = await saveReminder({ text: "una vez", dueAt: new Date(2026, 9, 13, 9, 0).toISOString() });
    await completeReminder(r.id);
    expect((await listReminders()).some((x) => x.id === r.id)).toBe(false);
  });

  it("getDueReminders incluye la repetición; tras avanzar deja de estar vencido", async () => {
    const r = await saveReminder({ text: "pastilla", dueAt: new Date(2026, 9, 13, 9, 0).toISOString(), repeat: "day" });
    const nowIso = new Date(2026, 9, 13, 12, 0).toISOString();
    const due = await getDueReminders(nowIso);
    expect(due.find((x) => x.id === r.id)?.repeat).toBe("day");
    await completeReminder(r.id, new Date(2026, 9, 13, 12, 0));
    expect((await getDueReminders(nowIso)).some((x) => x.id === r.id)).toBe(false);
  });

  it("borrar quita también la fila de repetición (no queda huérfana)", async () => {
    const r = await saveReminder({ text: "borrar", dueAt: new Date(2026, 9, 13, 9, 0).toISOString(), repeat: "day" });
    await deleteReminder(r.id);
    expect((await listReminders()).some((x) => x.id === r.id)).toBe(false);
    // Un recordatorio nuevo con el mismo texto no hereda la repetición.
    const again = await saveReminder({ text: "borrar", dueAt: new Date(2026, 9, 13, 9, 0).toISOString() });
    expect((await listReminders()).find((x) => x.id === again.id)?.repeat ?? null).toBeNull();
  });

  it("dedup distingue repetido de una sola vez con mismo texto y fecha", async () => {
    const due = new Date(2026, 9, 14, 9, 0).toISOString();
    const a = await saveReminder({ text: "x", dueAt: due });
    const b = await saveReminder({ text: "x", dueAt: due, repeat: "day" });
    expect(a.id).not.toBe(b.id);
  });
});
