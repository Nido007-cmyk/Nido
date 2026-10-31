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
  sweeps: number;
  order: string[];
  failEmbedAt: number;
  pdfText: string;
  pdfCalls: number;
  pdfMaxChars: number[];
}
const world = ((globalThis as Record<string, unknown>).__nidoImportWorld ??= {
  files: new Map(),
  inserted: [],
  deleted: [],
  created: [],
  sweeps: 0,
  order: [],
  failEmbedAt: -1,
  pdfText: "",
  pdfCalls: 0,
  pdfMaxChars: [],
}) as World;
const W = () => (globalThis as Record<string, unknown>).__nidoImportWorld as World;

vi.mock("expo-document-picker", () => ({ getDocumentAsync: async () => ({ canceled: true }) }));
vi.mock("expo-sharing", () => ({ shareAsync: async () => {} }));
// El módulo nativo con topes (modules/nido-pdf-text): como él, se para en
// cuanto el texto pasa de maxChars, sin devolver el texto entero.
vi.mock("./pdfText", () => {
  class PdfTextError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    PdfTextError,
    extractPdfTextCapped: async (_uri: string, maxChars: number) => {
      const w = W();
      w.pdfCalls++;
      w.pdfMaxChars.push(maxChars);
      if (w.pdfText.length > maxChars) throw new PdfTextError("TEXT_TOO_LARGE", "too large");
      return w.pdfText;
    },
  };
});
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
    W().order.push("insert");
  },
  insertChunkWithoutEmbedding: async (c: { chunkId: string }) => {
    W().inserted.push(c.chunkId);
    W().order.push("insert");
  },
  deleteOrphanCollectionChunks: async () => {
    W().sweeps++;
    W().order.push("sweep");
    return 0;
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
  world.sweeps = 0;
  world.order.length = 0;
  world.failEmbedAt = -1;
  world.pdfText = "";
  world.pdfCalls = 0;
  world.pdfMaxChars.length = 0;
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

  it("auditoría 2026-10-31 (F3-17): cada importación barre primero los trozos huérfanos de la anterior", async () => {
    world.files.set("file:///doc.txt", "palabra ".repeat(50));
    await M.importDocuments([asset("doc.txt", 400)], "Mi doc");
    expect(world.sweeps).toBe(1);
    expect(world.order[0]).toBe("sweep");
    expect(world.order.indexOf("insert")).toBeGreaterThan(0);
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

  it("estimateChunkCount coincide con el troceado real", async () => {
    for (const len of [1, 1999, 2000, 2001, 3800, 3801, 10_000, 123_457]) {
      world.files.set("file:///n.txt", "a".repeat(len));
      world.inserted.length = 0;
      await M.importDocuments([asset("n.txt", len)], "n");
      expect(world.inserted.length).toBe(M.estimateChunkCount(len));
    }
    expect(M.estimateChunkCount(0)).toBe(0);
  });
});

describe("auditoría 2026-10-29: bomba de descompresión en PDF", () => {
  it("un PDF pequeño que da demasiado texto se rechaza antes de trocear", async () => {
    // 1 MB de archivo, pero el texto extraído da ~11 000 trozos.
    world.pdfText = "palabra ".repeat(2_500_000);
    await expect(M.importDocuments([asset("bomba.pdf", 1024 * 1024)], "x")).rejects.toMatchObject({
      code: "tooManyChunks",
      vars: { max: String(M.MAX_IMPORT_CHUNKS) },
    });
    expect(world.inserted).toEqual([]);
    expect(world.created).toEqual([]);
  });

  it("varios archivos: se para en cuanto la suma pasa del tope, sin leer los demás", async () => {
    // Cada PDF da ~2 800 trozos: cabe uno, el segundo pasa del tope.
    world.pdfText = "a".repeat(5_000_000);
    expect(M.estimateChunkCount(5_000_000)).toBeLessThan(M.MAX_IMPORT_CHUNKS);
    await expect(
      M.importDocuments([asset("a.pdf", 10), asset("b.pdf", 10), asset("c.pdf", 10)], "x"),
    ).rejects.toMatchObject({ code: "tooManyChunks" });
    expect(world.pdfCalls).toBe(2);
    expect(world.inserted).toEqual([]);
    // El segundo PDF solo tiene permiso para lo que queda del tope, no para todo.
    expect(world.pdfMaxChars[1]).toBeLessThan(world.pdfMaxChars[0]);
  });

  it("el lector nativo recibe el tope de texto, así que nunca devuelve más", async () => {
    world.pdfText = "a".repeat(1000);
    await M.importDocuments([asset("ok.pdf", 10)], "x");
    expect(world.pdfMaxChars[0]).toBe(M.maxCharsForChunks(M.MAX_IMPORT_CHUNKS) + 200);
    expect(M.estimateChunkCount(M.maxCharsForChunks(M.MAX_IMPORT_CHUNKS))).toBe(M.MAX_IMPORT_CHUNKS);
  });

  it("un PDF normal sigue entrando", async () => {
    world.pdfText = "Texto de un PDF normal. ".repeat(200);
    const c = await M.importDocuments([asset("ok.pdf", 50_000)], "PDF");
    expect(c.id).toMatch(/^custom-/);
    expect(world.inserted.length).toBe(M.estimateChunkCount(world.pdfText.trim().length));
  });
});
