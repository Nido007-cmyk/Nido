/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda T-03 de la 0.1.99 (auditoría de la app 2026-11-14, carril 06,
 * asiento M-31): el censo del acta dijo que cleanupAfterSuccessfulRestore
 * no tenía llamadores, pero SÍ lo tiene (ChatScreen.tsx, efecto de
 * montaje) y su verificación de integridad ya estaba probada (F3-16).
 * El hueco real que queda dentro de la misma función: verifica SOLO
 * la base de memoria y sin embargo borra también las copias previas
 * de la base de conocimiento. Con la memoria sana y el conocimiento
 * corrupto, la única copia buena de conocimiento se perdía — el
 * «borrar ante una restauración fallida» que F3-16 quiso cerrar,
 * cerrado a medias. La pareja de copias es la red de UNA sola
 * restauración: no se desmonta mientras cualquiera de las dos bases
 * no verifique íntegra (puerta «todo o nada» sobre las dos).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const W = vi.hoisted(() => ({
  deleted: [] as string[],
  memoryIntegrity: "ok",
  knowledgeIntegrity: "ok",
  knowledgeFails: false,
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/mock/",
  EncodingType: { UTF8: "utf8", Base64: "base64" },
  getInfoAsync: vi.fn(),
  copyAsync: vi.fn(),
  moveAsync: vi.fn(),
  readDirectoryAsync: vi.fn(async (uri: string) => {
    if (uri === "/mock/SQLite/") {
      return [
        "nido_memory.db.pre-restore-2026-01-01",
        "nido_knowledge.db.pre-restore-2026-01-01",
        "nido_memory.db",
        "nido_knowledge.db",
      ];
    }
    return ["restored.db", "restored.knowledge.db", "settings.json"];
  }),
  writeAsStringAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  deleteAsync: vi.fn(async (uri: string) => {
    W.deleted.push(uri);
  }),
}));

vi.mock("../privacy/keyManager", () => ({
  getDatabaseKeyHex: async () => "ab".repeat(32),
}));

vi.mock("./secureDatabase", () => ({
  WAL_CHECKPOINT_SQL: "PRAGMA wal_checkpoint(TRUNCATE);",
}));

vi.mock("./databaseManager", () => ({
  getDatabase: vi.fn(async () => ({
    execAsync: vi.fn(),
    getFirstAsync: async () => ({ n: 10 }),
    getAllAsync: async () => [{ integrity_check: W.memoryIntegrity }],
  })),
  closeDatabase: vi.fn(async () => {}),
}));

vi.mock("../rag/db", () => ({
  getDb: async () => {
    if (W.knowledgeFails) throw new Error("la base de conocimiento no abre");
    return {
      execAsync: vi.fn(),
      getFirstAsync: async () => ({ n: 10 }),
      getAllAsync: async () => [{ integrity_check: W.knowledgeIntegrity }],
    };
  },
}));

import { cleanupAfterSuccessfulRestore } from "./backup";

const MEM_COPY = "/mock/SQLite/nido_memory.db.pre-restore-2026-01-01";
const KB_COPY = "/mock/SQLite/nido_knowledge.db.pre-restore-2026-01-01";

beforeEach(() => {
  vi.clearAllMocks();
  W.deleted.length = 0;
  W.memoryIntegrity = "ok";
  W.knowledgeIntegrity = "ok";
  W.knowledgeFails = false;
});

describe("M-31: la limpieza post-restauración verifica CADA base antes de borrar su copia", () => {
  it("con las dos bases íntegras borra las copias de ambas y los restos de extracción", async () => {
    await expect(cleanupAfterSuccessfulRestore()).resolves.toBe(4);
    expect(W.deleted).toEqual(expect.arrayContaining([MEM_COPY, KB_COPY, "/mock/restored.db", "/mock/restored.knowledge.db"]));
  });

  it("con el conocimiento corrupto no se borra NADA: la pareja de copias es una sola red", async () => {
    W.knowledgeIntegrity = "database disk image is malformed";
    await expect(cleanupAfterSuccessfulRestore()).resolves.toBe(0);
    expect(W.deleted).toEqual([]);
  });

  it("con la memoria corrupta no se borra nada (doctrina F3-16 intacta)", async () => {
    W.memoryIntegrity = "database disk image is malformed";
    await expect(cleanupAfterSuccessfulRestore()).resolves.toBe(0);
    expect(W.deleted).toEqual([]);
  });

  it("si la base de conocimiento no se puede ni abrir, tampoco se borra nada (fail-safe)", async () => {
    W.knowledgeFails = true;
    await expect(cleanupAfterSuccessfulRestore()).resolves.toBe(0);
    expect(W.deleted).toEqual([]);
  });
});
