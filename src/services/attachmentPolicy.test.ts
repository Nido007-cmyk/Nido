/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { attachmentKind, looksLikeText } from "./attachmentPolicy";

const bytes = (...vals: number[]) => new Uint8Array(vals);
const textBytes = (s: string) => new TextEncoder().encode(s);

describe("attachmentKind: la magia manda sobre el nombre", () => {
  it("un PDF se reconoce por su cabecera aunque se llame foto.jpg", () => {
    const sample = textBytes("%PDF-1.7\n%âãÏÓ\n");
    expect(attachmentKind("foto.jpg", sample)).toEqual({ kind: "pdf" });
  });

  it("las imágenes por su firma: JPEG, PNG, WebP, GIF, HEIC", () => {
    expect(attachmentKind("a.bin", bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0))).toEqual({ kind: "image" });
    expect(attachmentKind("a.bin", bytes(137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0))).toEqual({ kind: "image" });
    const webp = new Uint8Array(12);
    webp.set(textBytes("RIFF"), 0);
    webp.set(textBytes("WEBP"), 8);
    expect(attachmentKind("a.bin", webp)).toEqual({ kind: "image" });
    expect(attachmentKind("a.bin", textBytes("GIF89a......"))).toEqual({ kind: "image" });
    const heic = new Uint8Array(12);
    heic.set(textBytes("ftyp"), 4);
    heic.set(textBytes("heic"), 8);
    expect(attachmentKind("a.bin", heic)).toEqual({ kind: "image" });
  });

  it("un ZIP disfrazado de .pdf es un archivo, no un PDF", () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0);
    expect(attachmentKind("documento.pdf", zip)).toEqual({ kind: "unsupported", reason: "archive" });
    expect(attachmentKind("tabla.xlsx", zip)).toEqual({ kind: "unsupported", reason: "spreadsheet" });
    expect(attachmentKind("libro.docx", zip)).toEqual({ kind: "unsupported", reason: "archive" });
  });

  it("el Office binario antiguo se nombra como tal", () => {
    expect(attachmentKind("viejo.doc", bytes(0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0))).toEqual({
      kind: "unsupported",
      reason: "old-office",
    });
  });

  it("texto: por extensión conocida o por muestra limpia sin extensión", () => {
    expect(attachmentKind("notas.md", textBytes("# Título\n"))).toEqual({ kind: "text" });
    expect(attachmentKind("sinextension", textBytes("texto llano con eñes y acentos: áéíóú\n"))).toEqual({ kind: "text" });
    expect(attachmentKind("raro.xyz", bytes(0x00, 0x01, 0x02, 0x03))).toEqual({ kind: "unsupported", reason: "unknown" });
  });
});

describe("looksLikeText", () => {
  it("acepta UTF-8 con acentos y rechaza binario con controles", () => {
    expect(looksLikeText(textBytes("¿Cómo se hace el suero oral?\n"))).toBe(true);
    expect(looksLikeText(bytes(0x68, 0x00, 0x6f, 0x00, 0x07, 0x00))).toBe(false);
    expect(looksLikeText(bytes(0xc3, 0x28))).toBe(false); // UTF-8 inválido
  });
});
