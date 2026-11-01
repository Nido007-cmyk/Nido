/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { agentFallbackText, toFallbackLang, type FallbackKind } from "./fallbackText";

describe("fallbackText — nunca silencio, nunca un éxito fingido", () => {
  const kinds: FallbackKind[] = ["notUnderstood", "actionFailed", "memoryFailed", "emptyAnswer", "spaceShortened"];

  it("cada texto existe en es/en/pt y no está vacío", () => {
    for (const k of kinds) {
      for (const lang of ["es", "en", "pt"] as const) {
        expect(agentFallbackText(k, lang).trim().length).toBeGreaterThan(10);
      }
    }
  });

  it('ninguno finge haber hecho algo ("Listo.")', () => {
    for (const k of kinds) {
      for (const lang of ["es", "en", "pt"] as const) {
        expect(agentFallbackText(k, lang)).not.toMatch(/^(listo|done|pronto)\.?$/i);
      }
    }
  });

  it("el fallo de una acción no habla de guardar (evidencia: 'Call' → 'No pude guardar eso')", () => {
    expect(agentFallbackText("actionFailed", "es")).not.toMatch(/guardar/i);
    expect(agentFallbackText("actionFailed", "en")).not.toMatch(/save/i);
  });

  it("la nota de respuesta acortada (H-12) existe, difiere por idioma y nombra el espacio", () => {
    const es = agentFallbackText("spaceShortened", "es");
    const en = agentFallbackText("spaceShortened", "en");
    const pt = agentFallbackText("spaceShortened", "pt");
    expect(new Set([es, en, pt]).size).toBe(3);
    expect(es).toMatch(/acortar/i);
    expect(es).toMatch(/espacio/i);
    expect(en).toMatch(/shorten/i);
    expect(en).toMatch(/space/i);
    expect(pt).toMatch(/encurtar/i);
    expect(pt).toMatch(/espaço/i);
  });

  it("toFallbackLang normaliza etiquetas de la UI", () => {
    expect(toFallbackLang("en-US")).toBe("en");
    expect(toFallbackLang("pt-BR")).toBe("pt");
    expect(toFallbackLang("es-MX")).toBe("es");
    expect(toFallbackLang(undefined)).toBe("es");
  });
});
