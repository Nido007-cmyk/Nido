/**
 * NIDO internal icon system v1 — registry & asset consistency tests.
 *
 * These tests deliberately do NOT import iconRegistry.ts: its static
 * `require("*.png")` calls are for Metro, and must stay string literals.
 * Instead we scan the registry source and verify every referenced asset
 * exists on disk with the expected PNG dimensions. The pixel-fidelity
 * guarantee (assets == frozen-v1 render) is enforced separately by
 * `gen_png_assets.py --verify` (see IMPLEMENTATION_PLAN.md).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { daylightTheme, nightGardenTheme } from "../../../theme/colors";

const ICONS_DIR = join(dirname(new URL(import.meta.url).pathname), "..");
const REGISTRY_SRC = readFileSync(join(ICONS_DIR, "iconRegistry.ts"), "utf8");
const ASSETS_DIR = join(ICONS_DIR, "..", "..", "..", "..", "assets", "icons");

const EXPECTED_TWO_TONE = [
  "new-chat", "memory", "knowledge", "activity", "models", "pairing",
  "security", "chat", "devices", "deep-research", "ideas", "telemetry", "wizard",
].sort();

function extractNames(src: string, constName: string): string[] {
  const m = src.match(new RegExp(`${constName}[^=]*=[^\\[]*\\[([\\s\\S]*?)\\]`, "m"));
  if (!m) throw new Error(`could not find ${constName} in iconRegistry.ts`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function extractRequires(src: string): string[] {
  return [...src.matchAll(/require\("(\.\.\/[^"]+\.png)"\)/g)].map((x) => x[1]);
}

function pngDimensions(path: string): { w: number; h: number } {
  const b = readFileSync(path);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path}: not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe("icon registry", () => {
  it("declares exactly the 40 frozen icon names, no duplicates", () => {
    const names = extractNames(REGISTRY_SRC, "ICON_NAMES");
    expect(names).toHaveLength(40);
    expect(new Set(names).size).toBe(40);
  });

  it("two-tone set matches the 13 frozen gold-accent icons", () => {
    const twoTone = extractNames(REGISTRY_SRC, "TWO_TONE_ICONS").sort();
    expect(twoTone).toEqual(EXPECTED_TWO_TONE);
  });

  it("every require() path resolves to a real asset file", () => {
    const reqs = extractRequires(REGISTRY_SRC);
    expect(reqs.length).toBeGreaterThan(0);
    for (const rel of reqs) {
      const abs = join(ICONS_DIR, rel);
      expect(existsSync(abs), `missing asset: ${rel}`).toBe(true);
    }
  });

  it("every icon has ink PNGs at @1x/@2x/@3x/@4x with correct dimensions", () => {
    const names = extractNames(REGISTRY_SRC, "ICON_NAMES");
    const scales: Array<[string, number]> = [["", 24], ["@2x", 48], ["@3x", 72], ["@4x", 96]];
    for (const name of names) {
      for (const [suffix, px] of scales) {
        const p = join(ASSETS_DIR, "ink", `nido-${name}${suffix}.png`);
        expect(existsSync(p), `missing ${p}`).toBe(true);
        const { w, h } = pngDimensions(p);
        expect({ w, h }).toEqual({ w: px, h: px });
        expect(readFileSync(p).length).toBeGreaterThan(200); // non-trivial content
      }
    }
  });

  it("gold PNGs exist exactly for the two-tone icons", () => {
    const names = extractNames(REGISTRY_SRC, "ICON_NAMES");
    const twoTone = new Set(extractNames(REGISTRY_SRC, "TWO_TONE_ICONS"));
    const scales = ["", "@2x", "@3x", "@4x"];
    for (const name of names) {
      for (const suffix of scales) {
        const p = join(ASSETS_DIR, "gold", `nido-${name}${suffix}.png`);
        if (twoTone.has(name)) {
          expect(existsSync(p), `missing ${p}`).toBe(true);
        } else {
          expect(existsSync(p), `unexpected gold layer ${p}`).toBe(false);
        }
      }
    }
  });
});

describe("icon theme tokens", () => {
  it("daylight icon tokens equal the frozen v1 values", () => {
    expect(daylightTheme.nidoIcon.ink).toBe("#1A201A");
    expect(daylightTheme.nidoIcon.gold).toBe("#A87F2B");
  });

  it("night garden icon tokens equal the frozen v1 values", () => {
    expect(nightGardenTheme.nidoIcon.ink).toBe("#F7F5F0");
    expect(nightGardenTheme.nidoIcon.gold).toBe("#E8C56B");
  });
});
