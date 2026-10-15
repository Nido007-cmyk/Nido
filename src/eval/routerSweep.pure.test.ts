/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.42: el barrido del router como puerta de regresión.
 *
 * El corpus es sintético (plantillas × variantes de escritura), así que el
 * porcentaje no es «lo que acierta con usuarios reales»; sirve para que un
 * cambio en un patrón no rompa en silencio formas que ya funcionaban. Los
 * mínimos están un poco por debajo de lo medido en 0.1.42; la charla debe
 * seguir al 100 %: nunca una acción que nadie pidió.
 */
import { describe, expect, it } from "vitest";
import { memoryFullCoverageHit } from "../agent/loop/memoryQuery";
import { buildCorpus, EXPECTED, routeOf, runSweep, summarize, SWEEP_MEMORY, type Family } from "./routerSweep.pure";

const MIN_RATE: Record<Family, number> = {
  remember: 0.98,
  selfFact: 0.98,
  reminder: 0.98,
  timer: 0.98,
  note: 0.98,
  memoryQuestion: 0.9,
  calc: 0.98,
  convert: 0.98,
  date: 0.88,
  chat: 1,
};

describe("barrido del router", () => {
  const corpus = buildCorpus();
  const results = runSweep(corpus);

  it("el corpus es grande y determinista", () => {
    expect(corpus.length).toBeGreaterThan(5000);
    const again = buildCorpus();
    expect(again.map((c) => c.text)).toEqual(corpus.map((c) => c.text));
  });

  it("cada familia supera su mínimo", () => {
    for (const s of summarize(results)) {
      const rate = s.ok / s.total;
      expect({ family: s.family, rate: rate >= MIN_RATE[s.family] }).toEqual({ family: s.family, rate: true });
    }
  });

  it("la charla nunca dispara una acción", () => {
    const falseActions = results.filter((r) => r.family === "chat" && !r.ok).map((r) => r.text);
    expect(falseActions).toEqual([]);
  });
});

describe("formas nuevas del barrido (0.1.42)", () => {
  const cases: Array<[string, Family]> = [
    ["oye, recuérdame llamar a mamá mañana a las 5", "reminder"],
    ["pon un recordatorio para mañana a las 9: dentista", "reminder"],
    ["can you remind me to call John tomorrow at 5pm", "reminder"],
    ["¿me puedes recordar mañana a las 8 sacar la basura?", "reminder"],
    ["pon un temporizador de media hora", "timer"],
    ["set a timer for half an hour", "timer"],
    ["cuenta 5 minutos", "timer"],
    ["7 al cuadrado", "calc"],
    ["what is 3 cubed", "calc"],
    ["toma en cuenta que soy vegetariano", "remember"],
    ["just so you know, my sister is called Ana", "remember"],
    ["anota en tu memoria que mi coche es azul", "remember"],
    ["tengo 2 hijos", "remember"],
    ["¿dónde dejé el coche?", "memoryQuestion"],
    ["¿dónde está la clave del wifi?", "memoryQuestion"],
  ];
  it.each(cases)("%s → %s", (text, expected) => {
    expect(EXPECTED[expected]).toContain(routeOf(text));
  });

  it("«anota …» sin «en tu memoria» sigue siendo una nota", () => {
    expect(routeOf("anota comprar leche")).toBe("noteSave");
  });
});

describe("memoryFullCoverageHit", () => {
  it("pregunta cuyos términos están todos en un hecho → sí", () => {
    expect(memoryFullCoverageHit("¿dónde está la clave del wifi?", SWEEP_MEMORY)).toBe(true);
  });
  it("sin signo de pregunta, o sin memoria → no", () => {
    expect(memoryFullCoverageHit("la clave del wifi", SWEEP_MEMORY)).toBe(false);
    expect(memoryFullCoverageHit("¿dónde está la clave del wifi?", { ...SWEEP_MEMORY, facts: [] })).toBe(false);
  });
  it("cobertura parcial → no", () => {
    expect(memoryFullCoverageHit("¿cuál es la capital de Francia?", SWEEP_MEMORY)).toBe(false);
  });
});
