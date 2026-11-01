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

vi.mock("../../privacy/keyManager", async () => {
  const { fakeKeyManagerModule } = await import("../../security/secureDbTestHarness");
  return fakeKeyManagerModule();
});

// Código REAL bajo prueba.
import { setSecureDbTestDriver } from "../../security/secureDatabase";
import { makeNodeSqliteHandle } from "../../security/secureDbTestHarness";
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


/** Base fresca por test: el migrate real crea el schema. */
function useFreshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "nido-repeat-memory-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "nido_memory.db");
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async (path: string) => {
      if (!path.includes("nido_memory.db")) throw new Error(`DB inesperada: ${path}`);
      return makeNodeSqliteHandle(dbPath);
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

describe("0.1.35: repetición mensual y anual en la base", () => {
  it("un cumpleaños anual se guarda, se lista y al completarse pasa al año siguiente", async () => {
    const r = await saveReminder({ text: "Cumpleaños de mi mamá", dueAt: new Date(2027, 2, 15, 9, 0).toISOString(), repeat: "year" });
    expect(r.repeat).toBe("year");
    expect((await listReminders()).find((x) => x.id === r.id)?.repeat).toBe("year");
    await completeReminder(r.id, new Date(2027, 2, 15, 9, 1));
    const after = (await listReminders()).find((x) => x.id === r.id);
    expect(new Date(after!.due_at!)).toEqual(new Date(2028, 2, 15, 9, 0));
  });

  it("mensual: avanza al mes siguiente; borrar limpia también su tabla", async () => {
    const r = await saveReminder({ text: "alquiler", dueAt: new Date(2026, 10, 1, 9, 0).toISOString(), repeat: "month" });
    await completeReminder(r.id, new Date(2026, 10, 1, 9, 5));
    expect(new Date((await listReminders()).find((x) => x.id === r.id)!.due_at!)).toEqual(new Date(2026, 11, 1, 9, 0));
    await deleteReminder(r.id);
    const again = await saveReminder({ text: "alquiler", dueAt: new Date(2026, 10, 1, 9, 0).toISOString() });
    expect((await listReminders()).find((x) => x.id === again.id)?.repeat ?? null).toBeNull();
  });
});
