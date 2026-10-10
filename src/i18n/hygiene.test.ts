/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Higiene de traducciones (auditoría 2026-10-10, N2).
 *
 * 1. en/es/pt tienen exactamente las mismas claves.
 * 2. Toda clave fija usada con t("…") en el código existe.
 * 3. Ningún Alert.alert lleva el título como texto fijo: debe pasar por t().
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");

function flatKeys(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(name) || /\.test\.|\.d\.ts$/.test(name)) return [];
    return [full];
  });
}

const FILES = [...sourceFiles(join(ROOT, "src")), join(ROOT, "App.tsx")];

describe("i18n hygiene", () => {
  const enKeys = new Set(flatKeys(en));

  it("en, es and pt have the same keys", () => {
    const esKeys = new Set(flatKeys(es));
    const ptKeys = new Set(flatKeys(pt));
    expect([...enKeys].filter((k) => !esKeys.has(k))).toEqual([]);
    expect([...esKeys].filter((k) => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter((k) => !ptKeys.has(k))).toEqual([]);
    expect([...ptKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it("every literal key passed to t() exists", () => {
    const missing: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"([\w.\-:]+)"/g)) {
        const key = m[1];
        if (enKeys.has(key) || enKeys.has(`${key}_one`) || enKeys.has(`${key}_other`)) continue;
        // Clave padre leída entera (returnObjects): vale si tiene hijas.
        if ([...enKeys].some((k) => k.startsWith(`${key}.`))) continue;
        missing.push(`${file.slice(ROOT.length + 1)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("no Alert.alert uses a hard-coded title", () => {
    const literal: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/Alert\.alert\(\s*["'`]/g)) {
        const line = src.slice(0, m.index).split("\n").length;
        literal.push(`${file.slice(ROOT.length + 1)}:${line}`);
      }
    }
    expect(literal).toEqual([]);
  });
});
