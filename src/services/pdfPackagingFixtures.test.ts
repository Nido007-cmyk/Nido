/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * P-04/P-05 (auditoría de rendimiento 2026-11-01): las fixtures PDF
 * del carril de exclusiones de empaquetado.
 *
 * Las tres PDFs de `__fixtures__/` son ficheros reales, generados con
 * el generador de la tanda y verificados por una ruta independiente
 * (poppler): la cifrada no se abre sin su contraseña y se abre con
 * ella; la latina CID extrae su frase entera por Identity-H +
 * ToUnicode; la CJK parsea como PDF válido y su fuente nombra el
 * CMap UniJIS-UCS2-H sin incrustarlo.
 *
 * Lo que este test juzga en esta máquina:
 *  1. La ESTRUCTURA de cada fixture (los bytes llevan lo que las
 *     define: /Encrypt Standard R3; Type0 + Identity-H + ToUnicode;
 *     el nombre UniJIS-UCS2-H y ningún ToUnicode del que colgarse).
 *  2. El CONTRATO del importador ante los desenlaces que el nativo
 *     produce con el APK ya recortado, apuntalando la costura de
 *     pdfText con esos desenlaces: el cifrado se nombra
 *     (pdfPassword), el CJK sin su recurso se nombra (pdfUnreadable)
 *     y NADA importa en silencio; el latino CID entra con su texto.
 *
 * Lo que NO juzga (deuda de aparato, asentada en el informe de la
 * tanda): que pdfbox en el aparato abra la cifrada con el núcleo
 * JCE vivo tras excluir las tablas PQC, extraiga la latina idéntica
 * y falle en voz alta con la CJK sin el recurso cmap. Eso lo miden
 * la ronda física del dueño y el build de CI, no vitest.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const bytesOf = (name: string) => readFileSync(join(FIXTURES, name));
const latin1Of = (name: string) => bytesOf(name).toString("latin1");

type PdfOutcome = { kind: "text"; text: string } | { kind: "error"; code: string; message: string };
interface World {
  inserted: string[];
  created: string[];
  pdfOutcome: PdfOutcome;
}
const world = ((globalThis as Record<string, unknown>).__nidoPdfFixturesWorld ??= {
  inserted: [],
  created: [],
  pdfOutcome: { kind: "text", text: "" },
}) as World;
const W = () => (globalThis as Record<string, unknown>).__nidoPdfFixturesWorld as World;

vi.mock("expo-document-picker", () => ({ getDocumentAsync: async () => ({ canceled: true }) }));
vi.mock("expo-sharing", () => ({ shareAsync: async () => {} }));
vi.mock("./pdfText", () => {
  class PdfTextError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "PdfTextError";
    }
  }
  return {
    PdfTextError,
    extractPdfTextCapped: async () => {
      const o = W().pdfOutcome;
      if (o.kind === "error") throw new PdfTextError(o.code, o.message);
      return o.text;
    },
  };
});
vi.mock("./ocr", () => {
  class MockOcrError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "OcrError";
    }
  }
  return {
    OcrError: MockOcrError,
    OCR_PROVENANCE_NOTE: {
      es: "Texto reconocido con OCR (prueba).",
      en: "OCR-recognized text (test).",
      pt: "Texto reconhecido com OCR (teste).",
    },
    isOcrAvailable: async () => false,
    recognizeImageText: async () => "",
    recognizeScannedPdfText: async () => "",
  };
});
vi.mock("../models/settings", () => ({ getLanguageId: async () => "es" }));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: async () => "",
  writeAsStringAsync: async () => {},
  cacheDirectory: "file:///cache/",
}));
vi.mock("../rag/embed", () => ({
  embeddingEngine: {
    embedPassageTagged: async () => ({ vector: [0.1], modelSha256: "x" }),
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
  deleteOrphanCollectionChunks: async () => 0,
  createCustomCollection: async (c: { id: string }) => {
    W().created.push(c.id);
  },
  measureCollectionStoredBytes: async () => 0,
  deleteCustomCollection: async () => {},
  setCustomCollectionActive: async () => {},
  listCustomCollections: async () => W().created.map((id) => ({ id })),
  getCollectionDocs: async () => [],
  getMetaValue: async () => "1",
  setMetaValue: async () => {},
  listAllCollectionDocFingerprints: async () => [],
  listCollectionChunks: async () => [],
  recordCollectionDocFingerprints: async () => {},
  recordImportWarnings: async () => {},
  listImportWarnings: async () => ({}),
  dismissImportWarnings: async () => {},
}));

type M = typeof import("./documentImporter");
let M: M;
beforeAll(async () => {
  M = await import("./documentImporter");
});
beforeEach(() => {
  world.inserted.length = 0;
  world.created.length = 0;
  world.pdfOutcome = { kind: "text", text: "" };
});

const asset = (name: string) =>
  ({ uri: `file:///${name}`, name, size: bytesOf(name).length }) as never;

describe("P-04/P-05 · la estructura de las fixtures es la que las define", () => {
  it("la cifrada lleva el diccionario Standard R3 y su texto NO viaja en claro", () => {
    const raw = latin1Of("pdf-cifrado.pdf");
    expect(raw).toContain("/Encrypt");
    expect(raw).toContain("/Filter /Standard");
    expect(raw).toContain("/R 3");
    expect(raw).not.toContain("amoxicilina");
  });

  it("la latina CID es Type0 + CIDFontType2 con Identity-H y ToUnicode", () => {
    const raw = latin1Of("pdf-latino-cid.pdf");
    expect(raw).toContain("/Subtype /Type0");
    expect(raw).toContain("/Subtype /CIDFontType2");
    expect(raw).toContain("/Encoding /Identity-H");
    expect(raw).toContain("/ToUnicode");
  });

  it("la CJK nombra UniJIS-UCS2-H (Adobe-Japan1) y NO incrusta ToUnicode: cuelga del recurso", () => {
    const raw = latin1Of("pdf-cjk.pdf");
    expect(raw).toContain("/Encoding /UniJIS-UCS2-H");
    expect(raw).toContain("(Japan1)");
    expect(raw).not.toContain("/ToUnicode");
  });
});

describe("P-04/P-05 · el contrato del importador tras el recorte", () => {
  it("P-04 · la cifrada: el nativo pide contraseña y la importación lo NOMBRA (pdfPassword), sin importar nada", async () => {
    // El desenlace real del módulo nativo ante un PDF cifrado:
    // PDDocument.load lanza InvalidPasswordException → PASSWORD_REQUIRED.
    world.pdfOutcome = { kind: "error", code: "PASSWORD_REQUIRED", message: "password required" };
    const err = await M.importDocuments([asset("pdf-cifrado.pdf")], "Cifrada").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "pdfPassword" });
    expect(String((err as Error).message)).toContain("pdf-cifrado.pdf");
    expect(world.inserted).toEqual([]);
    expect(world.created).toEqual([]);
  });

  it("P-05 · la CJK sin su cmap: la extracción falla y la importación lo NOMBRA (pdfUnreadable), nunca en silencio", async () => {
    // El desenlace de pdfbox sin el recurso UniJIS-UCS2-H: la carga
    // del CMap nombrado falla y la extracción rechaza.
    world.pdfOutcome = {
      kind: "error",
      code: "PDF_EXTRACTION_ERROR",
      message: "Could not load CMap UniJIS-UCS2-H",
    };
    const err = await M.importDocuments([asset("pdf-cjk.pdf")], "CJK").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "pdfUnreadable" });
    expect(String((err as Error).message)).toContain("pdf-cjk.pdf");
    expect(world.inserted).toEqual([]);
    expect(world.created).toEqual([]);
  });

  it("P-05 · la latina CID importa con su texto, idéntica a hoy (Identity-H es de los que quedan)", async () => {
    world.pdfOutcome = {
      kind: "text",
      text: "La cita es el martes a las nueve. Revisión general.",
    };
    const result = await M.importDocuments([asset("pdf-latino-cid.pdf")], "Latina");
    expect(world.created).toHaveLength(1);
    expect(world.inserted.length).toBeGreaterThan(0);
    expect(result.importWarnings ?? []).toEqual([]);
  });
});
