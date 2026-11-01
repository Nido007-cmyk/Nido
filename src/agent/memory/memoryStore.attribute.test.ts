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
import { getMemoryDb, clearMemoryDb, saveFact, getFacts } from "./memoryStore";

let tmpDirs: string[] = [];


/** Base fresca por test: el migrate real crea el schema. */
function useFreshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "nido-attr-memory-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "nido_memory.db");
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async (path: string) => {
      if (!path.includes("nido_memory.db")) throw new Error(`DB inesperada: ${path}`);
      return makeNodeSqliteHandle(dbPath);
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
