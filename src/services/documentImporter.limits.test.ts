/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/** Offensive audit (0.1.18): import limits, empty imports and cleanup. */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface World {
  files: Map<string, string>;
  inserted: string[];
  deleted: string[];
  created: string[];
  failEmbedAt: number;
}
const world = ((globalThis as Record<string, unknown>).__nidoImportWorld ??= {
  files: new Map(),
  inserted: [],
  deleted: [],
  created: [],
  failEmbedAt: -1,
}) as World;
const W = () => (globalThis as Record<string, unknown>).__nidoImportWorld as World;

vi.mock("expo-document-picker", () => ({ getDocumentAsync: async () => ({ canceled: true }) }));
vi.mock("expo-sharing", () => ({ shareAsync: async () => {} }));
vi.mock("expo-pdf-text-extract", () => ({ extractText: async () => "" }));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: async (uri: string) => W().files.get(uri) ?? "",
  writeAsStringAsync: async () => {},
  cacheDirectory: "file:///cache/",
}));
vi.mock("../rag/embed", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => {
      const w = W();
      if (w.failEmbedAt >= 0 && w.inserted.length === w.failEmbedAt) throw new Error("embed boom");
      return { vector: [0.1], modelSha256: "x" };
    },
  },
}));
vi.mock("../rag/db", () => ({
  getDbEpoch: () => 1,
  insertChunk: async (c: { chunkId: string }) => {
    W().inserted.push(c.chunkId);
  },
  insertChunkWithoutEmbedding: async (c: { chunkId: string }) => {
    W().inserted.push(c.chunkId);
  },
  createCustomCollection: async (c: { id: string }) => {
    W().created.push(c.id);
  },
  deleteCustomCollection: async (id: string) => {
    W().deleted.push(id);
  },
  setCustomCollectionActive: async () => {},
  listCustomCollections: async () => W().created.map((id) => ({ id })),
  getCollectionDocs: async () => [],
}));

type M = typeof import("./documentImporter");
let M: M;
beforeAll(async () => {
  M = await import("./documentImporter");
});
beforeEach(() => {
  world.files.clear();
  world.inserted.length = 0;
  world.deleted.length = 0;
  world.created.length = 0;
  world.failEmbedAt = -1;
});

const asset = (name: string, size?: number) => ({ uri: `file:///${name}`, name, size }) as never;

describe("document import limits", () => {
  it("rejects a file the picker reports as too large, before reading it", async () => {
    await expect(M.importDocuments([asset("huge.txt", 300 * 1024 * 1024)], "x")).rejects.toMatchObject({
      code: "tooLarge",
      vars: { name: "huge.txt", max: "25" },
    });
    expect(world.inserted).toEqual([]);
  });

  it("rejects text that turns out too large once read", async () => {
    world.files.set("file:///big.txt", "a".repeat(M.MAX_IMPORT_TEXT_FILE_BYTES + 1));
    await expect(M.importDocuments([asset("big.txt")], "x")).rejects.toMatchObject({ code: "tooLarge" });
  });

  it("an import with no text says so instead of creating an empty collection", async () => {
    world.files.set("file:///empty.txt", "   ");
    await expect(M.importDocuments([asset("empty.txt", 3)], "x")).rejects.toMatchObject({ code: "noText" });
    expect(world.created).toEqual([]);
  });

  it("a failure half way removes what was already inserted", async () => {
    world.files.set("file:///doc.txt", "palabra ".repeat(2000));
    world.failEmbedAt = 2;
    await expect(M.importDocuments([asset("doc.txt", 16000)], "Mi doc")).rejects.toThrow("embed boom");
    expect(world.inserted.length).toBe(2);
    expect(world.deleted).toHaveLength(1);
    expect(world.deleted[0]).toMatch(/^custom-\d+-mi-doc$/);
    expect(world.created).toEqual([]);
  });

  it("a normal import still works", async () => {
    world.files.set("file:///ok.md", "Hola mundo");
    const c = await M.importDocuments([asset("ok.md", 10)], "Notas");
    expect(c.id).toMatch(/^custom-/);
    expect(world.inserted).toHaveLength(1);
    expect(world.deleted).toEqual([]);
  });
});
