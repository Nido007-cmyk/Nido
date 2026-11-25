/**
 * Auditoría 2026-11-25, hallazgo H-2: «perder sangre» en inglés
 * y portugués no era sangrado para la capa. La forma española
 * («está echando mucha sangre», «sangrando mucho») sí disparaba
 * la situación de emergencia; la inglesa y la portuguesa con
 * «losing / perdendo (muito) sangue» caían al modelo, en
 * afirmación llana y en frase con inciso. La cura entra en las
 * listas de signos de emergencyGate con el cuantificador, como
 * sus gemelas ya asentadas («bleeding a lot», «sangrando
 * muito»): perder sangre a secas, sin cantidad, no entra.
 */
import { describe, it, expect } from "vitest";
import { deterministicAnswer } from "../eval/blindCore";

type Lang = "es" | "en" | "pt";
function route(t: string, lang: Lang): string {
  return deterministicAnswer({ id: "h2", type: "emergencia", lang, expected: "fixed-text", query: t }).route;
}

describe("auditoría 2026-11-25 · H-2: perder sangre en en y pt", () => {
  it("las cuatro frases de la auditoría reciben la situación de emergencia", () => {
    for (const [q, lang] of [
      ["My father is losing a lot of blood from his leg", "en"],
      ["My neighbor, who cut herself, is losing a lot of blood", "en"],
      ["Meu pai está perdendo muito sangue pela perna", "pt"],
      ["Minha vizinha, que se cortou, está perdendo muito sangue", "pt"],
    ] as const) {
      expect(route(q, lang), q).toBe("emergency-situation");
    }
  });

  it("la familia con cuantificador declara en en y pt", () => {
    for (const [q, lang] of [
      ["He is losing lots of blood", "en"],
      ["She is losing so much blood", "en"],
      ["Ele está perdendo tanto sangue", "pt"],
      ["Ela está a perder muito sangue", "pt"],
    ] as const) {
      expect(route(q, lang), q).toBe("emergency-situation");
    }
  });

  it("la gemela española que ya disparaba sigue disparando", () => {
    expect(route("Mi padre está sangrando mucho", "es")).toBe("emergency-situation");
  });

  it("perder sangre sin cantidad ni suceso no entra", () => {
    for (const [q, lang] of [
      ["How much blood do you lose in a blood test?", "en"],
      ["Quanto sangue se perde numa análise de sangue?", "pt"],
    ] as const) {
      const r = route(q, lang);
      expect(r === "model" || r === "factual-refusal", q).toBe(true);
    }
  });
});
