/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/** Auditoría 2026-10-29: el lector de PDF recibe topes y traduce sus errores a códigos estables. */
import { afterEach, describe, expect, it } from "vitest";
import { _setPdfTextNativeForTests, extractPdfTextCapped, PdfTextError, toPdfTextError } from "./pdfText";

afterEach(() => _setPdfTextNativeForTests(undefined));

describe("lector de PDF con topes", () => {
  it("pasa los topes al módulo nativo, enteros y positivos", async () => {
    const calls: unknown[][] = [];
    _setPdfTextNativeForTests({
      extractText: async (...a: unknown[]) => {
        calls.push(a);
        return "hola";
      },
    } as never);
    expect(await extractPdfTextCapped("file:///a.pdf", 1000.7, 0)).toBe("hola");
    expect(calls[0]).toEqual(["file:///a.pdf", 1000, 1]);
  });

  it("traduce los errores del nativo; uno desconocido es de extracción", () => {
    expect(toPdfTextError(Object.assign(new Error("x"), { code: "TEXT_TOO_LARGE" })).code).toBe("TEXT_TOO_LARGE");
    expect(toPdfTextError(Object.assign(new Error("x"), { code: "TOO_MANY_PAGES" })).code).toBe("TOO_MANY_PAGES");
    expect(toPdfTextError(Object.assign(new Error("x"), { code: "PASSWORD_REQUIRED" })).code).toBe("PASSWORD_REQUIRED");
    expect(toPdfTextError(new Error("boom")).code).toBe("PDF_EXTRACTION_ERROR");
  });

  it("sin módulo nativo lo dice en vez de fallar raro", async () => {
    _setPdfTextNativeForTests(null);
    await expect(extractPdfTextCapped("file:///a.pdf", 10, 10)).rejects.toBeInstanceOf(PdfTextError);
  });

  it("un error del nativo llega como PdfTextError con su código", async () => {
    _setPdfTextNativeForTests({
      extractText: async () => {
        throw Object.assign(new Error("too big"), { code: "TEXT_TOO_LARGE" });
      },
    } as never);
    await expect(extractPdfTextCapped("file:///a.pdf", 10, 10)).rejects.toMatchObject({ code: "TEXT_TOO_LARGE" });
  });
});
