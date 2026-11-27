/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.117 · UI nueva: la paleta re-teñida pasa AA (4,5:1) en las parejas
 * de texto que la app usa de verdad, en los dos temas.
 */
import { describe, expect, it } from "vitest";
import { daylightTheme, nightGardenTheme } from "./colors";

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a: string, b: string): number {
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("UI nueva 0.1.117 · contraste AA", () => {
  for (const t of [daylightTheme, nightGardenTheme]) {
    it(`${t.name}: textos sobre fondo, tarjeta y tarjeta elevada`, () => {
      const texts = [t.text.primary, t.text.secondary, t.text.muted, t.text.dim, t.text.accentEmerald, t.text.accentAmber];
      for (const bg of [t.bg.black, t.bg.card, t.bg.cardElevated]) {
        for (const fg of texts) expect(ratio(fg, bg), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${t.name}: el rojo de emergencia se lee sobre la tarjeta`, () => {
      expect(ratio(t.crimson[400], t.bg.card)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it("Daylight: texto blanco sobre el pino y sobre el rojo de los botones", () => {
    expect(ratio("#FFFFFF", daylightTheme.emerald[500])).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#FFFFFF", daylightTheme.crimson[500])).toBeGreaterThanOrEqual(4.5);
  });
  it("Night Garden: texto oscuro sobre el verde de los botones", () => {
    expect(ratio(nightGardenTheme.text.inverse, nightGardenTheme.emerald[500])).toBeGreaterThanOrEqual(4.5);
  });
});
