// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

/**
 * withBundledPacks.test.js (0.1.95): los packs de primer arranque.
 *
 * 1. Los cuatro archivos existen en el repo y su SHA-256 y tamaño son los
 *    de su entrada del catálogo firmado: si alguien cambia un pack sin
 *    cambiar el catálogo (o al revés), installBundled lo rechazaría en el
 *    teléfono; esta prueba lo caza antes.
 * 2. La copia deja los cuatro en la carpeta de destino.
 * 3. Si falta uno, el prebuild falla (nunca un APK sin números).
 */
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODEL_CATALOG } from "../src/models/manifest";

const require = createRequire(import.meta.url);
const { copyBundledPacks, EXPECTED_FILES, SOURCE_DIR } = require("./withBundledPacks.js");

describe("withBundledPacks", () => {
  it.each(EXPECTED_FILES)("%s coincide con su entrada del catálogo firmado", (file) => {
    const bytes = fs.readFileSync(path.join(SOURCE_DIR, file));
    const entry = MODEL_CATALOG.find((m) => m.filename === `corpus/${file}`);
    expect(entry, `sin entrada de catálogo para ${file}`).toBeTruthy();
    expect(bytes.length).toBe(entry.sizeBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
  });

  it("copia los cuatro packs al destino", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "packs-"));
    const copied = copyBundledPacks(SOURCE_DIR, dest);
    expect(copied).toEqual(EXPECTED_FILES);
    for (const f of EXPECTED_FILES) expect(fs.existsSync(path.join(dest, f))).toBe(true);
  });

  it("falla si falta un pack: nunca un APK sin números de emergencia", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "src-"));
    fs.writeFileSync(path.join(src, EXPECTED_FILES[0]), "x");
    expect(() => copyBundledPacks(src, fs.mkdtempSync(path.join(os.tmpdir(), "dst-")))).toThrow(/faltan packs/);
  });
});
