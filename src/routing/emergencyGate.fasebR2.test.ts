/**
 * Fase B · Ronda 2 (2026-11-25): dimensiones no cazadas ni en
 * la auditoría ni en la ronda 1 (corpus de la ronda:
 * medidores/generar-faseb-r2.mts, 34 frases; foto inicial
 * 28/34). Tres clases:
 * - C1: la tarea meta sobre la guía (descargarla,
 *   imprimirla, pasarla) disparaba la puerta de salud en
 *   las tres lenguas.
 * - C2: «cant» sin apóstrofo y «flor» por «floor» en el
 *   dictado dejaban la inmovilidad inglesa sin declarar.
 * - C3: la quemadura en progresivo con el orden alterado
 *   («quemándose con la estufa, está mi abuela») no casaba
 *   ningún signo.
 * Las dimensiones limpias de la ronda (parte en dos frases,
 * mezcla de idiomas, pregunta hipotética interrogativa,
 * orden sobre sangrado y caída) no llevan cura: su foto va
 * en el cuerpo del PR.
 */
import { describe, it, expect } from "vitest";
import { deterministicAnswer } from "../eval/blindCore";

type Lang = "es" | "en" | "pt";
function route(t: string, lang: Lang): string {
  return deterministicAnswer({ id: "b2", type: "emergencia", lang, expected: "fixed-text", query: t }).route;
}
const modelSide = (t: string, lang: Lang): boolean => {
  const r = route(t, lang);
  return r === "model" || r === "factual-refusal";
};

describe("fase B ronda 2 · C1: la tarea meta sobre la guía", () => {
  it("descargar, imprimir o pasar la guía no dispara puertas", () => {
    for (const [q, lang] of [
      ["Quiero descargar la guía de primeros auxilios para imprimirla", "es"],
      ["Pásame el folleto de qué hacer si alguien se quema", "es"],
      ["I want to download the first aid guide to print it", "en"],
      ["Send me the leaflet on what to do if someone gets burned", "en"],
      ["Quero baixar o guia de primeiros socorros para imprimir", "pt"],
      ["Me passa o folheto sobre o que fazer se alguém se queimar", "pt"],
    ] as const) {
      expect(modelSide(q, lang), q).toBe(true);
    }
  });
});

describe("fase B ronda 2 · C2/C3: dictado y progresivo", () => {
  it("la inmovilidad dictada y la quemadura en curso declaran", () => {
    expect(route("my uncle is lying on the flor and cant get himself up", "en")).toBe("emergency-situation");
    expect(route("En la cocina, quemándose con la estufa, está mi abuela", "es")).toBe("emergency-situation");
  });
  it("el tema suelto de quemaduras sigue fuera de la situación", () => {
    expect(route("¿Cómo se trata una quemadura leve en casa?", "es")).toBe("health-gate");
  });
});
