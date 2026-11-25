/**
 * Fase B · Ronda 6 (2026-11-25): la ronda de confirmación
 * (corpus: medidores/generar-faseb-r6.mts, 12 frases
 * frescas de todas las familias). Once se comportaron como
 * debían sin tocar nada —la caída en el hielo con las colas
 * de H-1 en ropa nueva, el bebé que no respira bien, el
 * relato cerrado con puntos— y una sola clase quedó:
 * - G1: preparar un folleto («estoy preparando un
 *   folleto…», «i'm preparing a leaflet…», «estou
 *   preparando um folheto…») disparaba salud: la familia
 *   de guía traía el folleto en «escribiendo/writing» y la
 *   guía en «preparando/preparing», pero no el cruce.
 */
import { describe, it, expect } from "vitest";
import { deterministicAnswer } from "../eval/blindCore";

type Lang = "es" | "en" | "pt";
function route(t: string, lang: Lang): string {
  return deterministicAnswer({ id: "b6", type: "emergencia", lang, expected: "fixed-text", query: t }).route;
}
const modelSide = (t: string, lang: Lang): boolean => {
  const r = route(t, lang);
  return r === "model" || r === "factual-refusal";
};

describe("fase B ronda 6 · G1: preparar un folleto", () => {
  it("las tres frases quedan del lado del modelo", () => {
    for (const [q, lang] of [
      ["Estoy preparando un folleto sobre cómo actuar ante un atragantamiento", "es"],
      ["I'm preparing a leaflet on what to do for choking", "en"],
      ["Estou preparando um folheto sobre como agir diante de um engasgo", "pt"],
    ] as const) {
      expect(modelSide(q, lang), q).toBe(true);
    }
  });
  it("la confirmación viva de la ronda sigue declarando", () => {
    expect(route("Mi vecina se resbaló en el hielo y no hay manera de que se levante", "es")).toBe("emergency-situation");
    expect(route("The baby has something in his mouth and can't breathe right", "en")).toBe("emergency-situation");
  });
});
