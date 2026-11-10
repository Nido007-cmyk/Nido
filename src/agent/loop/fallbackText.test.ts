/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { agentFallbackText, generationCutNote, toFallbackLang, type FallbackKind } from "./fallbackText";
import { degradableGenTokens } from "../../rag/pure";

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

  describe("generationCutNote (0.1.91, familia 6): la nota sigue al hecho, no a la asignación", () => {
    it("el caso del aparato: asignación degradada en ventana estrecha y fin natural dentro de lo asignado → SIN nota", () => {
      // Reproducción con las funciones reales de la ruta fija: en el
      // peldaño de emergencia (nCtx 1024) el prompt del turno de la
      // foto (sistema + pregunta simple, ~537 tokens estimados) deja
      // menos que el deseo (1024), así que la asignación degrada y
      // spaceCut es true — como en la 0.1.90, donde eso solo ya
      // pintaba la nota. La respuesta de tres frases termina natural
      // muy por debajo de lo asignado: genWasCut es false.
      const { genTokens, spaceCut } = degradableGenTokens(1024, 1024 - 537 - 64);
      expect(spaceCut).toBe(true);
      expect(genTokens).toBe(423);
      expect(generationCutNote(spaceCut, false)).toBeNull();
    });

    it("parada por el tope sin degradación → la nota del límite del turno", () => {
      expect(generationCutNote(false, true)).toBe("answerCut");
    });

    it("parada por el tope con la asignación degradada → la nota de espacio", () => {
      expect(generationCutNote(true, true)).toBe("spaceShortened");
    });

    it("sin degradación y con fin natural → sin nota", () => {
      expect(generationCutNote(false, false)).toBeNull();
    });
  });
});
