/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda T-03 de la 0.1.99 (auditoría de la app 2026-11-14, carril 06,
 * asiento M-32): la cuota de documentos medía los ficheros FUENTE del
 * selector, no lo almacenado, y los embeddings no contaban.
 * measureCollectionStoredBytes mide lo que la base guarda de verdad
 * por una colección: el texto de sus chunks, la copia de ese texto en
 * el índice FTS y los bytes de los blobs de vectores. Contra la base
 * real (arnés node:sqlite, como db.vectorFormat.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

vi.mock("expo-sqlite", () => ({ deleteDatabaseAsync: async () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async () => ({ exists: false }),
  moveAsync: async () => {
    throw new Error("move no usado");
  },
  deleteAsync: async () => {},
}));
vi.mock("../privacy/keyManager", async () => {
  const { fakeKeyManagerModule } = await import("../security/secureDbTestHarness");
  return fakeKeyManagerModule();
});

import { setSecureDbTestDriver } from "../security/secureDatabase";
import { makeNodeSqliteHandle } from "../security/secureDbTestHarness";
import {
  createCustomCollection,
  insertChunk,
  insertChunkWithoutEmbedding,
  measureCollectionStoredBytes,
  resetDatabase,
} from "./db";

const utf8 = (s: string) => new TextEncoder().encode(s).length;

let tmpDirs: string[] = [];

function useFreshDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "nido-datos-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "k.db");
  copyFileSync(join(FIX, "knowledge.v1.db"), dbPath);
  setSecureDbTestDriver({
    dbDir: () => "file:///docs/SQLite/",
    openDb: async () => makeNodeSqliteHandle(dbPath, { transactional: true }),
    exists: async (path: string) => !path.endsWith(".migtmp") && !path.endsWith(".sqlcipher"),
    remove: async () => {},
    rename: async () => {
      throw new Error("rename no usado");
    },
    writeFile: async () => {
      throw new Error("writeFile no usado");
    },
  });
}

beforeEach(async () => {
  tmpDirs = [];
  await resetDatabase();
});

afterEach(() => {
  setSecureDbTestDriver(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe("M-32: measureCollectionStoredBytes mide lo almacenado, embeddings incluidos", () => {
  it("suma texto (chunks + FTS) y vectores, solo de la colección pedida", async () => {
    useFreshDb();
    await createCustomCollection({
      id: "col-1",
      name: "Colección",
      sourceFilename: "doc.txt",
      docCount: 1,
      chunkCount: 2,
      sizeBytes: 0,
    });
    const v = new Float32Array(4); // 16 B en float32
    await insertChunk(
      { chunkId: "a1", docId: "d1", title: "Título", body: "cuerpo áé", collectionId: "col-1" },
      v,
    );
    await insertChunkWithoutEmbedding({
      chunkId: "a2",
      docId: "d1",
      title: "T2",
      body: "segundo",
      collectionId: "col-1",
    });
    // Corpus sin colección: no cuenta para ninguna colección.
    await insertChunk({ chunkId: "seed1", docId: "seed", title: "X", body: "corpus" }, v);

    const expected =
      2 * (utf8("Título") + utf8("cuerpo áé")) + 16 + 2 * (utf8("T2") + utf8("segundo"));
    await expect(measureCollectionStoredBytes("col-1")).resolves.toBe(expected);
  });

  it("una colección inexistente o vacía mide 0", async () => {
    useFreshDb();
    await expect(measureCollectionStoredBytes("no-existe")).resolves.toBe(0);
  });
});
