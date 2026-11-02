/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * corpusPin.test.ts — auditoría completa 2026-10-31
 * (F5-05): el corpus empaquetado (assets/corpus/corpus.json, los
 * documentos que seedCorpus siembra en cada arranque) no
 * tenía huella declarada en ningún sitio: alterarlo dejaba
 * verify:manifest-sig en OK (N18 y N19 de la faceta). Viaja
 * dentro del APK firmado, así que el hueco es de atestación y
 * detección en CI, no de inyección remota; esta fijación es la
 * declaración que faltaba. Si el corpus cambia a propósito, se
 * actualizan huella y conteo en el mismo commit que lo cambia.
 *
 * 2026-11-01 (C-01 en la línea de packs, traído por el carril de
 * versión): el corpus crece de 300 a 858 documentos (185 conceptos
 * en es/en/pt, captura verificada contra la API de Wikipedia del
 * 2026-11-01; los 300 publicados quedan byte a byte como prefijo).
 * La huella y el conteo de abajo son los de ese corpus, medidos en
 * las dos copias; la copia hermana de la línea de packs fija además
 * los hashes de los niveles descargables, que aquí se fijan también
 * (no se tocan: son los bytes que las apps publicadas ya descargan).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BUNDLED_CORPUS_SHA256 =
  "0a4581b414c83e23ff750705c137461ad14f8ee96fd378971bba632952bd9468";
const BUNDLED_CORPUS_DOCS = 858;

function sha256OfCorpusFile(file: string): string {
  return createHash("sha256")
    .update(readFileSync(new URL(`../../assets/corpus/${file}`, import.meta.url)))
    .digest("hex");
}

describe("corpus empaquetado (F5-05)", () => {
  it("su huella y su conteo son los declarados", () => {
    const raw = readFileSync(
      new URL("../../assets/corpus/corpus.json", import.meta.url),
    );
    expect(createHash("sha256").update(raw).digest("hex")).toBe(BUNDLED_CORPUS_SHA256);
    const docs = JSON.parse(raw.toString("utf8")) as unknown[];
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBe(BUNDLED_CORPUS_DOCS);
  });

  it("los niveles descargables no se tocan", () => {
    expect(sha256OfCorpusFile("corpus-standard.json")).toBe(
      "2aeff76db48098851e1304fb37dc8013d9facf9214395897e7e05f276f85d2ff",
    );
    expect(sha256OfCorpusFile("corpus-full.json")).toBe(
      "6d602003bb9da59200e3e55b75b9e15bb073a4b9b1357da2c2d47b2803c570be",
    );
  });
});
