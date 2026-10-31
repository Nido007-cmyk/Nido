/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * corpusPin.test.ts — auditoría completa 2026-10-31
 * (F5-05): el corpus empaquetado (assets/corpus/corpus.json, los
 * 300 documentos que seedCorpus siembra en cada arranque) no
 * tenía huella declarada en ningún sitio: alterarlo dejaba
 * verify:manifest-sig en OK (N18 y N19 de la faceta). Viaja
 * dentro del APK firmado, así que el hueco es de atestación y
 * detección en CI, no de inyección remota; esta fijación es la
 * declaración que faltaba. Si el corpus cambia a propósito, se
 * actualizan huella y conteo en el mismo commit que lo cambia.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const BUNDLED_CORPUS_SHA256 =
  "c677b2e39df1590812289cdd2d8fcdf4a21a46b700df52ea49afe44b56d0eae0";
const BUNDLED_CORPUS_DOCS = 300;

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
});
