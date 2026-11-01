/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * R-06 P5: el fracaso por fichero se nombra. Una importación mixta
 * con éxito devuelve como AVISOS los ficheros que aportaron cero
 * chunks, con la huella del rechazo de OCR (código y mensaje
 * acotado) cuando la llamada rechazó — lo que el catch desnudo del
 * importador tiraba entero. Mundo como el de limits, con la costura
 * de OCR apuntalada (./ocr) y el idioma fijado por ../models/settings.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OcrError } from "./ocr";

interface World {
  files: Map<string, string>;
  inserted: string[];
  created: string[];
  pdfText: string;
  ocrAvailable: boolean;
  pdfOcrText: string;
  pdfOcrError: Error | null;
  imageOcrText: string;
  imageOcrError: Error | null;
}
const world = ((globalThis as Record<string, unknown>).__nidoOcrWarningsWorld ??= {
  files: new Map(),
  inserted: [],
  created: [],
  pdfText: "",
  ocrAvailable: true,
  pdfOcrText: "",
  pdfOcrError: null,
  imageOcrText: "",
  imageOcrError: null,
}) as World;
const W = () => (globalThis as Record<string, unknown>).__nidoOcrWarningsWorld as World;

vi.mock("expo-document-picker", () => ({ getDocumentAsync: async () => ({ canceled: true }) }));
vi.mock("expo-sharing", () => ({ shareAsync: async () => {} }));
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
    extractPdfTextCapped: async () => W().pdfText,
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
    isOcrAvailable: async () => W().ocrAvailable,
    recognizeImageText: async () => {
      const w = W();
      if (w.imageOcrError) throw w.imageOcrError;
      return w.imageOcrText;
    },
    recognizeScannedPdfText: async () => {
      const w = W();
      if (w.pdfOcrError) throw w.pdfOcrError;
      return w.pdfOcrText;
    },
  };
});
vi.mock("../models/settings", () => ({ getLanguageId: async () => "es" }));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: async (uri: string) => W().files.get(uri) ?? "",
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
  deleteCustomCollection: async () => {},
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
  world.created.length = 0;
  world.pdfText = "";
  world.ocrAvailable = true;
  world.pdfOcrText = "";
  world.pdfOcrError = null;
  world.imageOcrText = "";
  world.imageOcrError = null;
});

const asset = (name: string, size?: number) => ({ uri: `file:///${name}`, name, size }) as never;

describe("R-06 P5: avisos por fichero sin texto", () => {
  it("imagen buena + PDF cuyo OCR devuelve «»: éxito y aviso que nombra el PDF", async () => {
    world.imageOcrText = "CLINICA SAN RAFAEL. Su cita es el martes.";
    world.pdfText = ""; // sin capa de texto
    world.pdfOcrText = ""; // el OCR corrió y volvió vacío
    const result = await M.importDocuments(
      [asset("foto.png", 1000), asset("documento-prueba-ocr.pdf", 2000)],
      "Mixta",
    );
    expect(world.created).toHaveLength(1);
    expect(world.inserted.length).toBeGreaterThan(0);
    expect(result.importWarnings).toEqual([{ name: "documento-prueba-ocr.pdf", reason: "ocrEmpty" }]);
  });

  it("PDF solo con OCR vacío: el error nombrado sigue siendo noText (resolvió vacío, no rechazó)", async () => {
    world.pdfText = "";
    world.pdfOcrText = "";
    await expect(M.importDocuments([asset("escaneado.pdf", 1000)], "x")).rejects.toMatchObject({
      code: "noText",
    });
    expect(world.created).toEqual([]);
  });

  it("PDF cuyo OCR lanza, solo: ocrFailed conserva el código y el mensaje del nativo", async () => {
    world.pdfText = "";
    world.pdfOcrError = new OcrError("OCR_FAILED", "Couldn't recognize the PDF's pages: native boom");
    const err = await M.importDocuments([asset("malo.pdf", 1000)], "x").catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: "ocrFailed",
      vars: {
        name: "malo.pdf",
        ocrCode: "OCR_FAILED",
        ocrMessage: "Couldn't recognize the PDF's pages: native boom",
      },
    });
    expect((err as Error).message).toContain("Couldn't recognize the PDF's pages");
    expect(world.created).toEqual([]);
  });

  it("PDF cuyo OCR lanza, junto a una imagen buena: éxito y el aviso conserva la huella del rechazo", async () => {
    world.imageOcrText = "Texto impreso de la foto.";
    world.pdfText = "";
    world.pdfOcrError = new OcrError("OCR_FAILED", "Couldn't recognize the PDF's pages: native boom");
    const result = await M.importDocuments([asset("foto.png", 1000), asset("malo.pdf", 2000)], "Mixta");
    expect(world.created).toHaveLength(1);
    expect(result.importWarnings).toEqual([
      {
        name: "malo.pdf",
        reason: "ocrFailed",
        ocrCode: "OCR_FAILED",
        ocrMessage: "Couldn't recognize the PDF's pages: native boom",
      },
    ]);
  });

  it("la huella conserva el mensaje acotado, no el error entero sin fin", async () => {
    world.imageOcrText = "Texto impreso de la foto.";
    world.pdfText = "";
    world.pdfOcrError = new OcrError("OCR_FAILED", "x".repeat(500));
    const result = await M.importDocuments([asset("foto.png", 1000), asset("malo.pdf", 2000)], "Mixta");
    expect(result.importWarnings).toHaveLength(1);
    expect(result.importWarnings[0].ocrMessage).toHaveLength(200);
  });

  it("una importación limpia no devuelve avisos", async () => {
    world.files.set("file:///notas.txt", "palabra ".repeat(50));
    const result = await M.importDocuments([asset("notas.txt", 400)], "Notas");
    expect(result.importWarnings).toEqual([]);
  });

  it("dos ficheros de texto idénticos dan 2 chunks: no hay deduplicación al importar", async () => {
    const text = "palabra ".repeat(50);
    world.files.set("file:///a.txt", text);
    world.files.set("file:///b.txt", text);
    const result = await M.importDocuments([asset("a.txt", 400), asset("b.txt", 400)], "Gemelos");
    expect(world.inserted).toHaveLength(2);
    expect(result.importWarnings).toEqual([]);
  });
});

describe("Adversaria H-01: la vía OCR se nombra por fichero, aporte lo que aporte la capa", () => {
  it("PDF mixto (capa parcial) cuyo OCR rechaza: éxito, su chunk entra y el aviso nombra el rechazo", async () => {
    world.pdfText = "Portada del informe anual. Ejercicio 2026."; // solo la portada trae capa
    world.pdfOcrError = new OcrError("OCR_FAILED", "Couldn't recognize the PDF's pages: native boom");
    const result = await M.importDocuments([asset("mixto.pdf", 2000)], "Mixto");
    expect(world.created).toHaveLength(1);
    expect(world.inserted).toHaveLength(1); // el chunk de la capa de texto
    expect(result.importWarnings).toEqual([
      {
        name: "mixto.pdf",
        reason: "ocrFailed",
        ocrCode: "OCR_FAILED",
        ocrMessage: "Couldn't recognize the PDF's pages: native boom",
      },
    ]);
  });

  it("PDF mixto cuyo OCR resuelve vacío: éxito y aviso ocrEmpty — las páginas escaneadas no quedan en silencio", async () => {
    world.pdfText = "Portada del informe anual. Ejercicio 2026.";
    world.pdfOcrText = ""; // el OCR corrió y volvió sin texto
    const result = await M.importDocuments([asset("mixto.pdf", 2000)], "Mixto");
    expect(world.created).toHaveLength(1);
    expect(world.inserted).toHaveLength(1);
    expect(result.importWarnings).toEqual([{ name: "mixto.pdf", reason: "ocrEmpty" }]);
  });

  it("PDF mixto cuyo OCR sí lee las páginas escaneadas: entran los dos textos y no hay aviso", async () => {
    world.pdfText = "Portada del informe anual. Ejercicio 2026.";
    world.pdfOcrText = "Página escaneada con el balance del ejercicio.";
    const result = await M.importDocuments([asset("mixto.pdf", 2000)], "Mixto");
    expect(world.inserted).toHaveLength(2);
    expect(result.importWarnings).toEqual([]);
  });

  it("PDF de solo texto en una versión sin OCR: entra por su capa y no gana avisos nuevos", async () => {
    world.ocrAvailable = false;
    world.pdfText = "palabra ".repeat(50);
    const result = await M.importDocuments([asset("informe.pdf", 400)], "Informe");
    expect(world.created).toHaveLength(1);
    expect(result.importWarnings).toEqual([]);
  });

  it("imagen escaneada con OCR bueno: entra su texto y no hay aviso", async () => {
    world.imageOcrText = "CLINICA SAN RAFAEL. Su cita es el martes.";
    const result = await M.importDocuments([asset("foto.png", 1000)], "Foto");
    expect(world.inserted).toHaveLength(1);
    expect(result.importWarnings).toEqual([]);
  });

  it("costura: PDF de solo texto con OCR disponible — la vía vuelve «» sin páginas que leer y el aviso nombra su resultado", async () => {
    // Comportamiento asentado de la costura, documentado como el de
    // la no-deduplicación de arriba: recognizeScannedPdfText
    // devuelve "" tanto si no hay páginas escaneadas (el nativo ni
    // arranca el motor: no hay nada que leer) como si las hay y no
    // se leyó nada de ellas — la costura devuelve solo el texto y
    // no distingue ambos casos. El aviso nombra el resultado de la
    // vía OCR del fichero; separar los dos casos exige que el
    // nativo informe de las páginas intentadas (otro carril).
    world.pdfText = "palabra ".repeat(50);
    world.pdfOcrText = "";
    const result = await M.importDocuments([asset("informe.pdf", 400)], "Informe");
    expect(world.created).toHaveLength(1);
    expect(result.importWarnings).toEqual([{ name: "informe.pdf", reason: "ocrEmpty" }]);
  });
});
