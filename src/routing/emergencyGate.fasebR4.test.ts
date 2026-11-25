/**
 * Fase B · Ronda 4 (2026-11-25): el barrido de cierre
 * (corpus: medidores/generar-faseb-r4.mts, 21 frases). Los
 * no-sucesos salieron limpios (9/9) y las sondas de residuo
 * se comportaron como lo declarado (la ideación vaga sin
 * forma léxica queda del lado del modelo por la regla
 * sellada: red de crisis solo léxica). Tres clases vivas:
 * - E1: la espina atorada en la garganta («se le atoró una
 *   espina de pescado») no casaba el atragantamiento.
 * - E2: el corte con el hueso visible («se le ve el
 *   hueso», «you can see the bone», «dá para ver o osso»)
 *   no casaba ningún signo de gravedad.
 * - E3: el incendio forestal en inglés y portugués
 *   («wildfire», «incêndio florestal») no estaba en las
 *   listas de fuego; en español sí.
 */
import { describe, it, expect } from "vitest";
import { deterministicAnswer } from "../eval/blindCore";

type Lang = "es" | "en" | "pt";
function route(t: string, lang: Lang): string {
  return deterministicAnswer({ id: "b4", type: "emergencia", lang, expected: "fixed-text", query: t }).route;
}

describe("fase B ronda 4 · E1/E2/E3: espina, hueso e incendio forestal", () => {
  it("las seis frases declaran situación", () => {
    for (const [q, lang] of [
      ["Se le atoró una espina de pescado en la garganta a mi esposo", "es"],
      ["Mi hijo se cortó con un cuchillo y se le ve el hueso", "es"],
      ["She cut her hand on a knife and you can see the bone", "en"],
      ["There's a wildfire nearby and the smoke is reaching the houses", "en"],
      ["Ela cortou a mão numa faca e dá para ver o osso", "pt"],
      ["Tem um incêndio florestal perto e a fumaça está chegando nas casas", "pt"],
    ] as const) {
      expect(route(q, lang), q).toBe("emergency-situation");
    }
  });
  it("el residuo declarado se queda donde la regla sellada lo deja", () => {
    for (const [q, lang] of [
      ["Hay días que no le veo sentido a nada", "es"],
      ["Some days I just don't see the point of anything", "en"],
      ["Tem dias que não vejo sentido em nada", "pt"],
    ] as const) {
      expect(route(q, lang), q).toBe("model");
    }
  });
});
