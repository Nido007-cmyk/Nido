/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda T-03 de la 0.1.99 (auditoría de la app 2026-11-14, carril 06):
 * - m-62: cuando el selector no reporta el tamaño, la importación de
 *   texto leía el fichero ENTERO antes de comprobar los 25 MB (y la
 *   ruta de imagen/OCR no tenía cota previa): un .txt enorme sin
 *   tamaño declarado era un OOM, no un error limpio. El tamaño real
 *   se resuelve con getInfoAsync ANTES de leer.
 * - M-32: sizeBytes contaba los ficheros fuente en vez de lo
 *   almacenado (embeddings fuera) y enforceStorageBudget no tenía
 *   ningún llamador. La colección nace con los bytes medidos de la
 *   base (texto + copia FTS + vectores) y, tras importar, la cuota
 *   LRU se aplica: lo que excede expulsa lo menos usado, nunca lo
 *   recién importado.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface World {
  files: Map<string, string>;
  infoSizes: Map<string, number>;
  reads: Array<{ uri: string; options?: unknown }>;
  infoCalls: string[];
  inserted: Array<{ chunkId: string; collectionId?: string; title: string; body: string; vectorBytes: number }>;
  collections: Map<string, Record<string, unknown>>;
  deletedCollections: string[];
  ocrAvailable: boolean;
  ocrCalls: number;
}
const world = ((globalThis as Record<string, unknown>).__nidoDatosWorld ??= {
  files: new Map(),
  infoSizes: new Map(),
  reads: [],
  infoCalls: [],
  inserted: [],
  collections: new Map(),
  deletedCollections: [],
  ocrAvailable: false,
  ocrCalls: 0,
}) as World;
const W = () => (globalThis as Record<string, unknown>).__nidoDatosWorld as World;

const utf8 = (s: string) => new TextEncoder().encode(s).length;

vi.mock("expo-document-picker", () => ({ getDocumentAsync: async () => ({ canceled: true }) }));
vi.mock("expo-sharing", () => ({ shareAsync: async () => {} }));
vi.mock("./pdfText", () => {
  class PdfTextError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
  }
  return { PdfTextError, extractPdfTextCapped: async () => "" };
});
vi.mock("./ocr", () => ({
  isOcrAvailable: async () => W().ocrAvailable,
  recognizeImageText: async () => {
    W().ocrCalls++;
    return "texto leido por OCR";
  },
  recognizeScannedPdfText: async () => null,
  OCR_PROVENANCE_NOTE: { en: "[OCR]", es: "[OCR]", pt: "[OCR]" },
  OcrError: class extends Error {},
}));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: async (uri: string, options?: unknown) => {
    W().reads.push({ uri, options });
    return W().files.get(uri) ?? "";
  },
  getInfoAsync: async (uri: string) => {
    W().infoCalls.push(uri);
    const size = W().infoSizes.get(uri);
    return size === undefined ? { exists: false } : { exists: true, size };
  },
  writeAsStringAsync: async () => {},
  readDirectoryAsync: async () => [],
  deleteAsync: async () => {},
  cacheDirectory: "file:///cache/",
  documentDirectory: "file:///docs/",
}));
vi.mock("../rag/embed", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => ({ vector: new Float32Array(4), modelSha256: "x" }),
  },
}));
vi.mock("../rag/db", () => ({
  getDbEpoch: () => 1,
  getDb: async () => ({ execAsync: async () => {} }),
  insertChunk: async (c: { chunkId: string; docId: string; title: string; body: string; collectionId?: string }, v: Float32Array) => {
    W().inserted.push({ chunkId: c.chunkId, collectionId: c.collectionId, title: c.title, body: c.body, vectorBytes: v.byteLength });
  },
  insertChunkWithoutEmbedding: async (c: { chunkId: string; docId: string; title: string; body: string; collectionId?: string }) => {
    W().inserted.push({ chunkId: c.chunkId, collectionId: c.collectionId, title: c.title, body: c.body, vectorBytes: 0 });
  },
  deleteOrphanCollectionChunks: async () => 0,
  createCustomCollection: async (c: Record<string, unknown>) => {
    W().collections.set(c.id as string, {
      ...c,
      sourceFilename: c.sourceFilename ?? null,
      active: true,
      createdAt: 1000,
      lastAccessed: 1000,
    });
  },
  deleteCustomCollection: async (id: string) => {
    W().deletedCollections.push(id);
    W().collections.delete(id);
    for (let i = W().inserted.length - 1; i >= 0; i--) {
      if (W().inserted[i].collectionId === id) W().inserted.splice(i, 1);
    }
  },
  setCustomCollectionActive: async () => {},
  listCustomCollections: async () => [...W().collections.values()],
  getCollectionDocs: async () => [],
  getMetaValue: async () => "1",
  setMetaValue: async () => {},
  listAllCollectionDocFingerprints: async () => [],
  listCollectionChunks: async () => [],
  recordCollectionDocFingerprints: async () => {},
  recordImportWarnings: async () => {},
  listImportWarnings: async () => ({}),
  dismissImportWarnings: async () => {},
  // La medida REAL (SQL) vive en rag/db y tiene su propio test con
  // base de verdad (db.datos0199.test.ts). Aquí se reproduce su
  // contrato: texto de chunks + su copia FTS + bytes de vectores,
  // solo de la colección pedida.
  measureCollectionStoredBytes: async (collectionId: string) => {
    let bytes = 0;
    for (const c of W().inserted) {
      if (c.collectionId !== collectionId) continue;
      bytes += 2 * (utf8(c.title) + utf8(c.body)) + c.vectorBytes;
    }
    return bytes;
  },
}));

type M = typeof import("./documentImporter");
let M: M;
beforeAll(async () => {
  M = await import("./documentImporter");
});
beforeEach(() => {
  const w = W();
  w.files.clear();
  w.infoSizes.clear();
  w.reads.length = 0;
  w.infoCalls.length = 0;
  w.inserted.length = 0;
  w.collections.clear();
  w.deletedCollections.length = 0;
  w.ocrAvailable = false;
  w.ocrCalls = 0;
});

const asset = (uri: string, name: string, size?: number) =>
  ({ uri, name, ...(size === undefined ? {} : { size }), mimeType: "text/plain" }) as never;

describe("m-62: sin tamaño del selector, la cota actúa ANTES de leer", () => {
  it("un .txt gigante sin tamaño declarado se rechaza sin leerlo entero", async () => {
    const uri = "file:///cache/grande.txt";
    W().files.set(uri, "a".repeat(26 * 1024 * 1024));
    W().infoSizes.set(uri, 26 * 1024 * 1024);
    await expect(M.importDocuments([asset(uri, "grande.txt")], "x")).rejects.toMatchObject({ code: "tooLarge" });
    // Se consultó el tamaño real…
    expect(W().infoCalls).toContain(uri);
    // …y nunca hubo una lectura completa (sin opciones de rango) del fichero.
    const fullReads = W().reads.filter((r) => r.uri === uri && r.options === undefined);
    expect(fullReads).toEqual([]);
  });

  it("una imagen gigante sin tamaño declarado se rechaza antes del OCR", async () => {
    const uri = "file:///cache/foto.png";
    W().ocrAvailable = true;
    W().files.set(uri, "PNGDATA");
    W().infoSizes.set(uri, 30 * 1024 * 1024);
    await expect(M.importDocuments([asset(uri, "foto.png")], "x")).rejects.toMatchObject({ code: "tooLarge" });
    expect(W().ocrCalls).toBe(0);
  });

  it("un fichero pequeño sin tamaño declarado importa como siempre", async () => {
    const uri = "file:///cache/nota.txt";
    W().files.set(uri, "una nota breve y sana");
    W().infoSizes.set(uri, 21);
    const created = await M.importDocuments([asset(uri, "nota.txt")], "notas");
    expect(created.chunkCount).toBeGreaterThan(0);
  });
});

describe("M-32: la contabilidad es lo almacenado y la cuota se aplica", () => {
  it("sizeBytes nace de lo almacenado (texto x2 + vectores), no del fichero fuente", async () => {
    const uri = "file:///cache/doc.txt";
    W().files.set(uri, "contenido breve");
    const created = await M.importDocuments([asset(uri, "doc.txt", 5_000_000)], "docs");
    const stored = [...W().collections.values()][0];
    expect(stored.sizeBytes).not.toBe(5_000_000);
    expect(stored.sizeBytes).toBe(created.sizeBytes);
    // 1 chunk: (título "doc" + cuerpo) x2 (chunks + FTS) + vector float32 de dim 4 (16 B).
    const chunk = W().inserted[0];
    expect(stored.sizeBytes).toBe(2 * (utf8(chunk.title) + utf8(chunk.body)) + 16);
  });

  it("tras importar, lo que excede la cuota expulsa la colección menos usada, no la nueva", async () => {
    W().collections.set("vieja", {
      id: "vieja",
      name: "Vieja",
      sourceFilename: null,
      docCount: 1,
      chunkCount: 10,
      sizeBytes: 60 * 1024 * 1024,
      active: true,
      createdAt: 1,
      lastAccessed: 1,
    });
    const uri = "file:///cache/nuevo.txt";
    W().files.set(uri, "documento nuevo pequeño");
    const created = await M.importDocuments([asset(uri, "nuevo.txt", 100)], "nueva");
    expect(W().deletedCollections).toContain("vieja");
    expect(W().collections.has(created.id)).toBe(true);
  });

  it("bajo cuota no se expulsa nada", async () => {
    W().collections.set("previa", {
      id: "previa",
      name: "Previa",
      sourceFilename: null,
      docCount: 1,
      chunkCount: 1,
      sizeBytes: 1024,
      active: true,
      createdAt: 1,
      lastAccessed: 1,
    });
    const uri = "file:///cache/otro.txt";
    W().files.set(uri, "otro documento pequeño");
    await M.importDocuments([asset(uri, "otro.txt", 100)], "otra");
    expect(W().deletedCollections).toEqual([]);
    expect(W().collections.size).toBe(2);
  });
});
