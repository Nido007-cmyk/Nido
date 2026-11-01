/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  _setOcrNativeForTests,
  isOcrAvailable,
  OCR_PROVENANCE_NOTE,
  recognizeImageText,
  recognizePdfPagesText,
  recognizeScannedPdfText,
  sanitizeOcrPages,
  TESSDATA_LANG,
} from "./ocr";

describe("la costura de OCR", () => {
  it("sin módulo nativo (todas las versiones actuales): no disponible y error UNAVAILABLE", async () => {
    _setOcrNativeForTests(null);
    await expect(isOcrAvailable()).resolves.toBe(false);
    await expect(recognizeImageText("file:///pagina.jpg", "es")).rejects.toMatchObject({
      name: "OcrError",
      code: "UNAVAILABLE",
    });
  });

  it("con módulo, reconoce y le pasa el código tessdata del idioma", async () => {
    const seen: Array<[string, string]> = [];
    _setOcrNativeForTests({
      recognize: async (uri, tessdataLang) => {
        seen.push([uri, tessdataLang]);
        return "texto reconocido";
      },
    });
    await expect(isOcrAvailable()).resolves.toBe(true);
    await expect(recognizeImageText("file:///pagina.jpg", "pt")).resolves.toBe("texto reconocido");
    expect(seen).toEqual([["file:///pagina.jpg", "por"]]);
    expect(TESSDATA_LANG).toEqual({ es: "spa", en: "eng", pt: "por" });
    _setOcrNativeForTests(null);
  });

  it("un fallo del módulo se traduce a OCR_FAILED con su mensaje", async () => {
    _setOcrNativeForTests({
      recognize: async () => {
        throw new Error("tesseract init failed");
      },
    });
    await expect(recognizeImageText("file:///x.png", "en")).rejects.toMatchObject({
      name: "OcrError",
      code: "OCR_FAILED",
      message: "tesseract init failed",
    });
    _setOcrNativeForTests(null);
  });
});

describe("la costura de páginas de PDF (carril OCR 2026-10-31)", () => {
  it("sin módulo o sin la entrada de páginas: UNAVAILABLE", async () => {
    _setOcrNativeForTests(null);
    await expect(recognizeScannedPdfText("file:///doc.pdf", "es")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    _setOcrNativeForTests({ recognize: async () => "" });
    await expect(recognizeScannedPdfText("file:///doc.pdf", "es")).rejects.toMatchObject({ code: "UNAVAILABLE" });
    _setOcrNativeForTests(null);
  });

  it("con módulo, pasa las páginas saneadas y el código tessdata", async () => {
    const seen: Array<[string, number[], string]> = [];
    _setOcrNativeForTests({
      recognize: async () => "",
      recognizePdfPages: async (uri, pages, tessdataLang) => {
        seen.push([uri, pages, tessdataLang]);
        return "páginas reconocidas";
      },
    });
    await expect(recognizePdfPagesText("file:///doc.pdf", [3, 1, 3, -2, 2.5], "es")).resolves.toBe(
      "páginas reconocidas",
    );
    expect(seen).toEqual([["file:///doc.pdf", [1, 3], "spa"]]);
    await expect(recognizeScannedPdfText("file:///doc.pdf", "pt")).resolves.toBe("páginas reconocidas");
    expect(seen[1]).toEqual(["file:///doc.pdf", [], "por"]);
    _setOcrNativeForTests(null);
  });

  it("un fallo del módulo en páginas se traduce a OCR_FAILED", async () => {
    _setOcrNativeForTests({
      recognize: async () => "",
      recognizePdfPages: async () => {
        throw new Error("renderer died");
      },
    });
    await expect(recognizeScannedPdfText("file:///doc.pdf", "en")).rejects.toMatchObject({
      code: "OCR_FAILED",
      message: "renderer died",
    });
    _setOcrNativeForTests(null);
  });

  it("sanitizeOcrPages aplica el tope de la política de adjuntos (30)", () => {
    const many = Array.from({ length: 45 }, (_, i) => i);
    expect(sanitizeOcrPages(many)).toHaveLength(30);
    expect(sanitizeOcrPages([])).toEqual([]);
  });

  it("la marca de procedencia existe en los tres idiomas y nombra el OCR", () => {
    for (const lang of ["es", "en", "pt"] as const) {
      expect(OCR_PROVENANCE_NOTE[lang]).toContain("OCR");
      expect(OCR_PROVENANCE_NOTE[lang].length).toBeGreaterThan(20);
    }
  });
});
