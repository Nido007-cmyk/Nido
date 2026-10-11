/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Multilingual search (0.2.0): the knowledge base is stamped with the ACTIVE
 * embedding model, a switch drops every vector and re-stamps in one step,
 * and a vector computed by one model can never land in a base stamped for
 * another. Runs the real db.ts SQL on a copy of the v1 fixture (node:sqlite),
 * same harness as db.fixture.test.ts but with bound parameters.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

// Shared with the mock factories through globalThis (they run before this
// module's body; vi.hoisted isn't available in every runner).
type Fx = { DOC: string; activeEmbedding: string | null };
const g = globalThis as unknown as { __nidoEmbFx?: Fx };
g.__nidoEmbFx = g.__nidoEmbFx ?? { DOC: "file:///docs/", activeEmbedding: null };
const fx = g.__nidoEmbFx;

vi.mock("expo-sqlite", () => ({ deleteDatabaseAsync: async () => {} }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async () => ({ exists: false }),
  moveAsync: async () => {
    throw new Error("move no usado");
  },
  deleteAsync: async () => {},
}));
vi.mock("../models/settings", () => ({
  getActiveModelId: async (kind: string) =>
    kind === "embedding" ? ((globalThis as unknown as { __nidoEmbFx?: Fx }).__nidoEmbFx?.activeEmbedding ?? null) : null,
}));
vi.mock("../privacy/keyManager", () => ({
  registerKeyLossProbe: () => {},
  getDatabaseKeyHex: async () => "ab".repeat(32),
  applyDatabaseKey: async (
    db: { execAsync(s: string): Promise<void>; getFirstAsync(s: string): Promise<unknown> },
    keyHex: string | null
  ) => {
    if (!keyHex) return;
    await db.execAsync(`PRAGMA key = "x'${keyHex}'";`);
    await db.getFirstAsync("SELECT count(*) AS n FROM sqlite_master;");
  },
}));

import { setSecureDbTestDriver } from "../security/secureDatabase";
import { KnowledgeDbVersionError } from "../security/formatVersion";
import {
  countChunkVectors,
  getDb,
  getEmbeddingStamp,
  insertChunk,
  insertEmbeddingForModel,
  listChunksWithoutEmbedding,
  resetDatabase,
  resetEmbeddingsForModel,
} from "./db";

const BGE = "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514";
const E5 = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";

let tmpDirs: string[] = [];

function makeHandle(dbPath: string) {
  const sqlite = new DatabaseSync(dbPath);
  let keyApplied = false;
  const bind = (params?: unknown[]) => (params ?? []) as never[];
  return {
    execAsync: async (sql: string) => {
      if (/^\s*PRAGMA\s+key/i.test(sql)) {
        keyApplied = true;
        return;
      }
      sqlite.exec(sql);
    },
    getAllAsync: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (/cipher_version/i.test(sql)) return [{ cipher_version: "4.9.0-fake" }] as T[];
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    getFirstAsync: async <T>(sql: string, params?: unknown[]): Promise<T | null> => {
      if (/cipher_version/i.test(sql)) return { cipher_version: "4.9.0-fake" } as T;
      if (/FROM\s+sqlite_master/i.test(sql) && !keyApplied) throw new Error("file is not a database (sin clave)");
      return (sqlite.prepare(sql).get(...bind(params)) ?? null) as T | null;
    },
    runAsync: async (sql: string, params?: unknown[]) => {
      if (params && params.length > 0) {
        const info = sqlite.prepare(sql).run(...bind(params));
        return { lastInsertRowId: Number(info.lastInsertRowid), changes: Number(info.changes) };
      }
      sqlite.exec(sql);
      return { lastInsertRowId: 0, changes: 0 };
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      sqlite.exec("BEGIN");
      try {
        await fn();
        sqlite.exec("COMMIT");
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
    closeAsync: async () => {
      sqlite.close();
    },
  };
}

function useFreshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "nido-emb-"));
  tmpDirs.push(dir);
  const dbPath = join(dir, "k.db");
  copyFileSync(join(FIX, "knowledge.v1.db"), dbPath);
  setSecureDbTestDriver({
    dbDir: () => `${fx.DOC}SQLite/`,
    openDb: async () => makeHandle(dbPath),
    exists: async (path: string) => !path.endsWith(".migtmp") && !path.endsWith(".sqlcipher"),
    remove: async () => {},
    rename: async () => {
      throw new Error("rename no usado");
    },
    writeFile: async () => {
      throw new Error("writeFile no usado");
    },
  });
  return dbPath;
}

function raw(dbPath: string, sql: string): unknown[] {
  const d = new DatabaseSync(dbPath);
  try {
    return d.prepare(sql).all();
  } finally {
    d.close();
  }
}

const chunk = (id: string) => ({ chunkId: id, docId: `d-${id}`, title: `T ${id}`, body: `body ${id}` });
const vec = (x: number) => new Float32Array([x, 1, 2, 3]);

/** Opens, adds two chunks with vectors stamped for `sha`, closes the cached handle. */
async function seedWithVectors(sha: string) {
  fx.activeEmbedding = sha === E5 ? "multilingual-e5-small-q8" : null;
  await getDb();
  await insertChunk(chunk("a"), vec(1));
  await insertChunk(chunk("b"), vec(2));
  await resetDatabaseKeepFile();
}

/** resetDatabase() also deletes the file through the driver; here remove() is a no-op, so it only drops the handle. */
async function resetDatabaseKeepFile() {
  await resetDatabase();
}

beforeEach(async () => {
  tmpDirs = [];
  fx.activeEmbedding = null;
  await resetDatabase();
});

afterEach(() => {
  setSecureDbTestDriver(null);
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

describe("embedding model stamp", () => {
  it("a new base is stamped with the active model (multilingual)", async () => {
    useFreshDb();
    fx.activeEmbedding = "multilingual-e5-small-q8";
    await getDb();
    expect(await getEmbeddingStamp()).toBe(E5);
  });

  it("an unknown/absent Settings choice stamps the required model (as before)", async () => {
    useFreshDb();
    fx.activeEmbedding = "no-such-model";
    await getDb();
    expect(await getEmbeddingStamp()).toBe(BGE);
  });

  it("vectors from an UNKNOWN model → fail closed (unchanged R1 behaviour)", async () => {
    const dbPath = useFreshDb();
    await seedWithVectors(BGE);
    const d = new DatabaseSync(dbPath);
    d.prepare("UPDATE meta SET value = ? WHERE key = 'embedding_model_sha256'").run("f".repeat(64));
    d.close();
    await expect(getDb()).rejects.toBeInstanceOf(KnowledgeDbVersionError);
  });

  it("vectors from the OTHER catalog model (old backup, lost Settings) → dropped and re-stamped, text kept", async () => {
    const dbPath = useFreshDb();
    await seedWithVectors(BGE);
    fx.activeEmbedding = "multilingual-e5-small-q8";
    await getDb();
    expect(await getEmbeddingStamp()).toBe(E5);
    expect(await countChunkVectors()).toEqual({ chunks: 2, withVector: 0 });
    expect(raw(dbPath, "SELECT count(*) AS n FROM chunks_fts")).toEqual([{ n: 2 }]);
  });

  it("stamp differs but there are NO vectors → re-stamped (interrupted switch), text kept", async () => {
    const dbPath = useFreshDb();
    await getDb();
    await insertChunk(chunk("a"), vec(1));
    await resetEmbeddingsForModel(E5); // switch started…
    await resetDatabaseKeepFile(); // …and the app died before Settings changed
    fx.activeEmbedding = null; // still bge
    await getDb();
    expect(await getEmbeddingStamp()).toBe(BGE);
    expect(raw(dbPath, "SELECT chunk_id FROM chunks")).toEqual([{ chunk_id: "a" }]);
  });
});

describe("explicit switch + rebuild", () => {
  it("resetEmbeddingsForModel drops every vector and re-stamps; text and FTS stay", async () => {
    const dbPath = useFreshDb();
    await getDb();
    await insertChunk(chunk("a"), vec(1));
    await insertChunk(chunk("b"), vec(2));
    await resetEmbeddingsForModel(E5);
    expect(await getEmbeddingStamp()).toBe(E5);
    expect(await countChunkVectors()).toEqual({ chunks: 2, withVector: 0 });
    expect(raw(dbPath, "SELECT count(*) AS n FROM chunks_fts")).toEqual([{ n: 2 }]);
    expect((await listChunksWithoutEmbedding(10)).map((c) => c.chunkId).sort()).toEqual(["a", "b"]);
  });

  it("rejects a malformed sha", async () => {
    useFreshDb();
    await getDb();
    await expect(resetEmbeddingsForModel("nope")).rejects.toThrow(/invalid embedding model/);
  });

  it("insertEmbeddingForModel only writes for the stamped model", async () => {
    useFreshDb();
    await getDb();
    await insertChunk(chunk("a"), vec(1));
    await resetEmbeddingsForModel(E5);
    expect(await insertEmbeddingForModel("a", vec(9), BGE)).toBe(false);
    expect(await countChunkVectors()).toEqual({ chunks: 1, withVector: 0 });
    expect(await insertEmbeddingForModel("a", vec(9), E5)).toBe(true);
    expect(await countChunkVectors()).toEqual({ chunks: 1, withVector: 1 });
  });

  it("insertEmbeddingForModel never creates a vector for a deleted chunk", async () => {
    const dbPath = useFreshDb();
    await getDb();
    expect(await insertEmbeddingForModel("ghost", vec(1), BGE)).toBe(true);
    expect(raw(dbPath, "SELECT count(*) AS n FROM chunk_embeddings")).toEqual([{ n: 0 }]);
  });

  it("insertChunk tagged with another model stores the text without the vector", async () => {
    const dbPath = useFreshDb();
    await getDb();
    await resetEmbeddingsForModel(E5);
    await insertChunk(chunk("a"), vec(1), { modelSha256: BGE });
    expect(raw(dbPath, "SELECT chunk_id FROM chunks")).toEqual([{ chunk_id: "a" }]);
    expect(await countChunkVectors()).toEqual({ chunks: 1, withVector: 0 });
    await insertChunk(chunk("b"), vec(2), { modelSha256: E5 });
    expect(await countChunkVectors()).toEqual({ chunks: 2, withVector: 1 });
  });

  it("insertChunk without a tag behaves as before", async () => {
    useFreshDb();
    await getDb();
    await insertChunk(chunk("a"), vec(1));
    expect(await countChunkVectors()).toEqual({ chunks: 1, withVector: 1 });
  });
});
