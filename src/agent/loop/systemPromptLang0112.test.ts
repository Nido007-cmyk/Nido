/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría de la 0.1.112, bloque 4: el prompt de sistema llega entero en
 * el idioma del turno. Se renderiza el prompt real (buildSystemPrompt) en
 * inglés y portugués para las tres intenciones, con memoria y sin ella y
 * en los tres niveles de catálogo, y se exige que no quede español.
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./agentLoop";
import { LOCAL_TOOLS } from "../tools/manifest";
import { TOOL_DESCRIPTIONS_I18N } from "../tools/toolDescriptions";
import { BUILT_IN_SKILLS } from "../skills/builtIn";

const INTENTS = ["actuar", "recordar", "conversar"] as const;
const LEVELS = ["full", "minimal", "none"] as const;
const MEMORY = "- [general] likes tea";

// Señales de español que no existen en un texto inglés o portugués
// natural. Los nombres de herramienta, de parámetro y de skill (snake_case
// y kebab-case) son identificadores del contrato y no cuentan.
const SPANISH_MARKERS = [
  /\bHoy\b/, /\busuario\b/, /\bherramientas?\b/i, /\bMemoria\b/, /\bResponde\b/, /\bvacía\b/,
  /\bInten[cs]ión\b/, /\bpídelas\b/, /\bRecibirás\b/, /\bfuente citada\b/, /\bHechos\b/, /\bPersonas\b/,
  /\bDiario reciente\b/, /\bel usuario\b/, /\buna\b/, /\b(?:del|al)\b/, /[ñ¿¡]/,
];
const stripIdentifiers = (s: string) => s.replace(/\b[a-z]+(?:[_-][a-z0-9]+)+\b/g, " ");

describe("bloque 4 (0.1.112): el prompt de sistema en el idioma del turno", () => {
  for (const lang of ["en", "pt"] as const) {
    for (const intent of INTENTS) {
      for (const level of LEVELS) {
        for (const mem of ["", MEMORY]) {
          it(`${lang} · ${intent} · ${level} · ${mem ? "con memoria" : "sin memoria"}: sin español`, () => {
            const p = stripIdentifiers(buildSystemPrompt(intent, mem, lang, level));
            for (const re of SPANISH_MARKERS) expect(p, `${re} en el prompt ${lang}`).not.toMatch(re);
          });
        }
      }
    }
  }

  it("el inglés no trae letras con tilde del español", () => {
    const p = stripIdentifiers(buildSystemPrompt("actuar", MEMORY, "en", "full"));
    expect(p).not.toMatch(/[áéíóúñ]/);
  });

  it("el español conserva sus líneas de siempre", () => {
    const p = buildSystemPrompt("actuar", "", "es", "full");
    for (const line of [
      "## Memoria del usuario",
      "(vacía por ahora)",
      "## Herramientas",
      "Para usar una herramienta emite un bloque:",
      "REGLA DE GROUNDING: basa tu respuesta ESTRICTAMENTE en la fuente citada.",
      "## Intención: actuar",
      "- save_note(title*:string, body*:string): Guarda una nota de texto en el almacén local cifrado.",
    ]) expect(p).toContain(line);
  });

  it("cada herramienta del manifiesto tiene sus gemelas en inglés y portugués", () => {
    for (const t of LOCAL_TOOLS) {
      expect(TOOL_DESCRIPTIONS_I18N[t.name]?.en, t.name).toBeTruthy();
      expect(TOOL_DESCRIPTIONS_I18N[t.name]?.pt, t.name).toBeTruthy();
    }
    expect(Object.keys(TOOL_DESCRIPTIONS_I18N).sort()).toEqual(LOCAL_TOOLS.map((t) => t.name).sort());
  });

  it("cada skill integrada tiene su procedimiento en inglés y portugués, y pide responder en esa lengua", () => {
    for (const s of BUILT_IN_SKILLS) {
      expect(s.instructionsI18n?.en, s.name).toMatch(/in English/);
      expect(s.instructionsI18n?.pt, s.name).toMatch(/em português/);
      expect(s.instructionsI18n?.en, s.name).not.toMatch(/en español/);
    }
  });
});
