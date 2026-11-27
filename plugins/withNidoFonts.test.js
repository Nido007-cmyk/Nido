// MIT License
// Copyright (c) 2026 NIDO contributors
// See LICENSE file for details.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const plugin = require("./withNidoFonts.js");

describe("withNidoFonts", () => {
  it("copia las cuatro fuentes verificadas", () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "fonts-"));
    const copied = plugin.copyFonts(plugin.SOURCE_DIR, dest);
    expect(copied.length).toBe(4);
    for (const f of copied) expect(fs.existsSync(path.join(dest, f))).toBe(true);
  });

  it("falla si una fuente no coincide con su SHA-256", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "fonts-src-"));
    for (const f of Object.keys(plugin.FONTS)) fs.copyFileSync(path.join(plugin.SOURCE_DIR, f), path.join(src, f));
    fs.writeFileSync(path.join(src, "SourceSerif4.ttf"), "no es una fuente");
    expect(() => plugin.copyFonts(src, fs.mkdtempSync(path.join(os.tmpdir(), "fonts-d-")))).toThrow(/SourceSerif4/);
  });

  it("las licencias OFL viajan con las fuentes", () => {
    expect(fs.existsSync(path.join(plugin.SOURCE_DIR, "OFL-AtkinsonHyperlegibleNext.txt"))).toBe(true);
    expect(fs.existsSync(path.join(plugin.SOURCE_DIR, "OFL-SourceSerif4.txt"))).toBe(true);
  });
});
