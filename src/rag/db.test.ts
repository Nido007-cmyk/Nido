/**
 * db.test.ts — migración única del nombre de fichero pre-rebrand
 * (`aoair_knowledge.db` → `nido_knowledge.db`).
 *
 * Solo ejercita migrateLegacyKnowledgeDb contra un FS en memoria; el resto
 * de rag/db (apertura cifrada, transacciones) no se toca aquí.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fsx = vi.hoisted(() => {
  const files = new Map<string, string>();
  const DOC = "file:///docs/";
  /** Cuando es true, moveAsync finge fallar (best-effort). */
  const sabotage = { move: false };
  return { files, DOC, sabotage };
});

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: fsx.DOC,
  cacheDirectory: fsx.DOC,
  getInfoAsync: async (path: string) => ({ exists: fsx.files.has(path) }),
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    if (fsx.sabotage.move) throw new Error("disco lleno (simulado)");
    const content = fsx.files.get(from);
    if (content === undefined) throw new Error(`no existe: ${from}`);
    fsx.files.delete(from);
    fsx.files.set(to, content);
  },
  deleteAsync: async (path: string) => {
    fsx.files.delete(path);
  },
}));
vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: async () => {},
}));
vi.mock("../privacy/keyManager", () => ({
  getDatabaseKeyHex: async () => "ab".repeat(32),
}));
vi.mock("../security/secureDatabase", () => ({
  deleteManagedDatabase: async () => {},
  ensureEncryptedDatabase: async () => {
    throw new Error("no abrir bases en este test");
  },
}));

import { migrateLegacyKnowledgeDb } from "./db";

const DIR = `${fsx.DOC}SQLite/`;
const OLD = `${DIR}aoair_knowledge.db`;
const NEW = `${DIR}nido_knowledge.db`;
const SUFFIXES = ["", "-wal", "-shm", "-journal", ".migtmp", ".sqlcipher"];

beforeEach(() => {
  fsx.files.clear();
  fsx.sabotage.move = false;
});

describe("migrateLegacyKnowledgeDb", () => {
  it("mueve el fichero principal, sidecars y marcador al nuevo nombre", async () => {
    for (const s of SUFFIXES) fsx.files.set(`${OLD}${s}`, `contenido${s}`);
    await migrateLegacyKnowledgeDb();
    for (const s of SUFFIXES) {
      expect(fsx.files.has(`${OLD}${s}`), `origen ${s} debe haber desaparecido`).toBe(false);
      expect(fsx.files.get(`${NEW}${s}`), `destino ${s} debe existir`).toBe(`contenido${s}`);
    }
  });

  it("no toca nada si el nuevo fichero ya existe", async () => {
    fsx.files.set(NEW, "nuevo");
    fsx.files.set(OLD, "heredado");
    await migrateLegacyKnowledgeDb();
    expect(fsx.files.get(NEW)).toBe("nuevo");
    expect(fsx.files.get(OLD)).toBe("heredado");
  });

  it("no hace nada en instalación nueva (no hay fichero heredado)", async () => {
    await migrateLegacyKnowledgeDb();
    expect(fsx.files.size).toBe(0);
  });

  it("es best-effort: un fallo de move no lanza", async () => {
    fsx.files.set(OLD, "datos");
    fsx.sabotage.move = true;
    await expect(migrateLegacyKnowledgeDb()).resolves.toBeUndefined();
    // El fichero heredado sigue ahí para que Clear All Data lo elimine.
    expect(fsx.files.get(OLD)).toBe("datos");
  });

  it("mueve solo los sufijos que existen", async () => {
    fsx.files.set(OLD, "principal");
    fsx.files.set(`${OLD}-wal`, "wal");
    await migrateLegacyKnowledgeDb();
    expect(fsx.files.get(NEW)).toBe("principal");
    expect(fsx.files.get(`${NEW}-wal`)).toBe("wal");
    expect(fsx.files.has(`${NEW}.sqlcipher`)).toBe(false);
  });
});
