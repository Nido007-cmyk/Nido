/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/// <reference types="node" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pin del corpus mínimo incluido (C-01, 2026-11-01): si corpus.json
 * cambia, este test obliga a que el cambio sea deliberado y a que el
 * pin nuevo viaje a la copia hermana de la app en el carril de versión
 * (allí vive la otra copia de esta misma comprobación).
 */
const corpusDir = join(__dirname, "../../assets/corpus");

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(join(corpusDir, file))).digest("hex");
}

describe("corpus pin (C-01)", () => {
  it("corpus.json: 858 documentos y el hash fijado", () => {
    const docs = JSON.parse(readFileSync(join(corpusDir, "corpus.json"), "utf8")) as unknown;
    expect(Array.isArray(docs)).toBe(true);
    expect((docs as unknown[]).length).toBe(858);
    expect(sha256Of("corpus.json")).toBe("0a4581b414c83e23ff750705c137461ad14f8ee96fd378971bba632952bd9468");
  });

  it("los niveles descargables no se tocan", () => {
    expect(sha256Of("corpus-standard.json")).toBe("2aeff76db48098851e1304fb37dc8013d9facf9214395897e7e05f276f85d2ff");
    expect(sha256Of("corpus-full.json")).toBe("6d602003bb9da59200e3e55b75b9e15bb073a4b9b1357da2c2d47b2803c570be");
  });
});
