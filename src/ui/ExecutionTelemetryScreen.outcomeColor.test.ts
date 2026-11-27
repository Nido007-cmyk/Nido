/**
 * H-A11-1 — la regla de contraste de S-03 llega a la etiqueta de
 * resultado de la pantalla de telemetría (juicio de FV-1 sobre el
 * hallazgo de ADV11).
 *
 * La etiqueta es texto mono de 9 px; su rama «cancelled» usaba
 * text.accentAmber en los dos temas. Medido por ADV11 y re-medido
 * por FV-1 (y por esta fixture, que calcula el ratio WCAG de los
 * tokens reales): accentAmber de Daylight (#B07C2A) sobre
 * cardElevated (#F0EDE6) = 3,12 — por debajo de AA para texto
 * menudo. La cura es el modismo exacto de S-03: en Daylight,
 * amber.600 (#875E1E) = 4,92 sobre la misma superficie; en Night,
 * accentAmber se queda (es su uso asentado). Las demás ramas no
 * se tocan.
 */
import { describe, it, expect } from "vitest";
import { daylightTheme, nightGardenTheme, type Colors } from "./theme/colors";
import { outcomeColor } from "./ExecutionTelemetryScreen.pure";

function luminance(hex: string): number {
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("H-A11-1 · outcomeColor de la telemetría", () => {
  it("cancelled en Daylight usa el ámbar corregido de S-03 y pasa AA", () => {
    const colors = daylightTheme as Colors;
    const fg = outcomeColor(colors, "cancelled");
    // 0.1.117 (UI nueva): el ámbar de texto de Daylight es #8A5A12.
    expect(fg).toBe("#8A5A12");
    expect(fg).toBe(colors.amber[600]);
    // La superficie real de la etiqueta es cardElevated.
    const ratio = contrastRatio(fg, colors.bg.cardElevated);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(5.01, 1);
    // Desde 0.1.117 el texto ámbar de Daylight también pasa AA en esa superficie.
    expect(contrastRatio(colors.text.accentAmber, colors.bg.cardElevated)).toBeGreaterThanOrEqual(4.5);
  });

  it("cancelled en Night conserva accentAmber", () => {
    const colors = nightGardenTheme as unknown as Colors;
    expect(outcomeColor(colors, "cancelled")).toBe(colors.text.accentAmber);
  });

  it("las demás ramas no se mueven", () => {
    const colors = daylightTheme as Colors;
    expect(outcomeColor(colors, "failure")).toBe(colors.crimson[400]);
    expect(outcomeColor(colors, "success")).toBe(colors.text.accentEmerald);
  });
});
