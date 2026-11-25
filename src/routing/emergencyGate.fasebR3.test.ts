/**
 * Fase B · Ronda 3 (2026-11-25): las familias del censo que
 * ningún instrumento había medido por dimensión (órdenes,
 * avisos, charla) y sucesos nuevos (corpus de la ronda:
 * medidores/generar-faseb-r3.mts, 33 frases; foto inicial
 * 27/33). Cuatro clases:
 * - D1: la descarga eléctrica en inglés («got an electric
 *   shock») no casaba ningún signo; sus gemelas sí.
 * - D2: el olor a gas en su forma corrida inglesa y
 *   portuguesa («smells strongly of gas», «cheirando muito
 *   gás») no casaba los signos asentados.
 * - D3: la alarma de humo con la batería agotándose
 *   («chirping because the battery is dying») declaraba
 *   situación por el signo «smoke alarm».
 * - D4: la metáfora en curso («drowning in work»,
 *   «sangrando de amor») disparaba la puerta de salud.
 * Limpias sin cura: las órdenes de actuar (6/6), la mascota
 * en apuros (3/3) y los avisos en español y portugués.
 */
import { describe, it, expect } from "vitest";
import { deterministicAnswer } from "../eval/blindCore";

type Lang = "es" | "en" | "pt";
function route(t: string, lang: Lang): string {
  return deterministicAnswer({ id: "b3", type: "emergencia", lang, expected: "fixed-text", query: t }).route;
}
const FIJO = new Set(["safety", "emergency-number", "crisis", "emergency-situation", "health-gate"]);
const modelSide = (t: string, lang: Lang): boolean => {
  const r = route(t, lang);
  return r === "model" || r === "factual-refusal";
};

describe("fase B ronda 3 · D1/D2: descarga y olor a gas", () => {
  it("las formas corridas declaran", () => {
    for (const [q, lang] of [
      ["My brother got an electric shock and isn't moving", "en"],
      ["It smells strongly of gas in the kitchen and the stove was off", "en"],
      ["Está cheirando muito gás na cozinha e o fogão estava desligado", "pt"],
    ] as const) {
      expect(FIJO.has(route(q, lang)), q).toBe(true);
    }
  });
});

describe("fase B ronda 3 · D3/D4: la batería y la metáfora no disparan", () => {
  it("las tres frases quedan del lado del modelo", () => {
    for (const [q, lang] of [
      ["The smoke alarm is chirping because the battery is dying", "en"],
      ["I'm drowning in work this week, I can't keep up", "en"],
      ["Estoy sangrando de amor por ella, es una canción", "es"],
    ] as const) {
      expect(modelSide(q, lang), q).toBe(true);
    }
  });
  it("la alarma de humo con humo de verdad sigue declarando", () => {
    expect(route("The smoke alarm is going off and the kitchen is full of smoke", "en")).toBe("emergency-situation");
  });
});
