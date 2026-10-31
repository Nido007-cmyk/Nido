/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { _setOcrNativeForTests, isOcrAvailable, recognizeImageText, TESSDATA_LANG } from "./ocr";

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
