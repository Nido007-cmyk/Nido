/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";

/**
 * RAG-GROUNDING 2026-10-11: la cabecera de fuentes dice lo que se comprobó
 * de verdad (src/rag/grounding.ts). Las 5 variantes deben existir en los 3
 * idiomas y ninguna puede prometer más de lo que hace la verificación
 * léxica ("verificada", "verified", "confirmada"…).
 */
const KEYS = ["title", "titleGrounded", "titlePartial", "titleAbstained", "titleUnverified"];
const locales = { en, es, pt } as const;

describe("sourceFootnotes — títulos por estado de anclaje", () => {
  it("existen y no están vacíos en en/es/pt", () => {
    for (const [name, locale] of Object.entries(locales)) {
      const block = (locale as Record<string, Record<string, unknown>>).sourceFootnotes;
      for (const k of KEYS) {
        expect(typeof block[k], `${name}.sourceFootnotes.${k}`).toBe("string");
        expect((block[k] as string).trim().length, `${name}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("ya no dicen 'relevance-ranked' (no informaba si la respuesta estaba respaldada)", () => {
    expect(en.sourceFootnotes.title).not.toMatch(/relevance-ranked/i);
    expect(es.sourceFootnotes.title).not.toMatch(/ordenadas por relevancia/i);
    expect(pt.sourceFootnotes.title).not.toMatch(/ordenadas por relevância/i);
  });

  it("ningún título promete verificación que no existe", () => {
    for (const [name, locale] of Object.entries(locales)) {
      const block = (locale as Record<string, Record<string, string>>).sourceFootnotes;
      for (const k of KEYS) {
        expect(block[k], `${name}.${k}`).not.toMatch(/\bverified\b|verificad|confirmad|garantiz|guarantee/i);
      }
    }
  });
});
