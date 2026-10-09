/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { getUiLocale, matchCanned } from "./cannedResponses";

/**
 * FIX 2026-10-08: detectLang prefiere el idioma de la UI (getUiLocale,
 * leído fresco en cada llamada, nunca cacheado). En tests la cadena
 * i18n no carga → getUiLocale() es null → heurística por texto.
 */
describe("getUiLocale / detectLang", () => {
  it("getUiLocale() es null cuando i18n no carga (tests)", () => {
    expect(getUiLocale()).toBeNull();
  });

  it("sin UI locale, la heurística por texto decide (es por defecto)", () => {
    // i18n no disponible en tests → fallback por texto.
    expect(matchCanned("hola")!.lang).toBe("es");
    expect(matchCanned("hey")!.lang).toBe("en");
  });

  it("los patrones de privacidad en tercera persona matchean", () => {
    expect(matchCanned("dónde guardan mis datos?")!.kind).toBe("privacy");
    expect(matchCanned("where do they store my data?")!.kind).toBe("privacy");
  });
});
