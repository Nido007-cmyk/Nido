/**
 * Auditoría 2026-11-25, hallazgo H-5: hipotéticos y
 * condicionales que disparaban la ruta de suceso. El veto de
 * hipotético sellado cubría el español de caída y de CO, pero
 * no el inglés de caída ni de CO, ni el atragantamiento en
 * subjuntivo en español y portugués, ni la afirmación genérica
 * de incendio en inglés. La cura es un marco de hipotético
 * compartido por las dos caras de la puerta: apertura
 * condicional (if / si / se) con el modo condicional en la
 * cláusula principal (would / tendría / teria) y sin forma
 * interrogativa — la consulta condicional genuina («¿qué hago
 * si mi hijo se atraganta?») no abre con la condición ni trae
 * ese modo, y sigue cerrando su puerta. La afirmación habitual
 * de incendio sale además de la ruta del número por su marco
 * («when there is a fire, I call…»: enunciado, no pregunta),
 * como su gemela española ya sellada.
 */
import { describe, it, expect } from "vitest";
import { deterministicAnswer } from "../eval/blindCore";

type Lang = "es" | "en" | "pt";
function route(t: string, lang: Lang): string {
  return deterministicAnswer({ id: "h5", type: "emergencia", lang, expected: "model-side", query: t }).route;
}
const modelSide = (t: string, lang: Lang): boolean => {
  const r = route(t, lang);
  return r === "model" || r === "factual-refusal";
};

describe("auditoría 2026-11-25 · H-5: el hipotético no dispara el suceso", () => {
  it("las seis frases de la auditoría no disparan ninguna puerta", () => {
    for (const [q, lang] of [
      ["Si un día mi hijo se atragantara, tendría que hacerle la maniobra", "es"],
      ["If my grandfather fell tomorrow, I would help him get up", "en"],
      ["If the carbon monoxide alarm sounded tonight, we would leave the house", "en"],
      ["When there is a fire, I call the fire department", "en"],
      ["If my son ever choked, I would have to do the maneuver", "en"],
      ["Se um dia meu filho se engasgasse, eu teria que fazer a manobra", "pt"],
    ] as const) {
      expect(modelSide(q, lang), q).toBe(true);
    }
  });

  it("la gemela española sellada del incendio sigue fuera", () => {
    expect(modelSide("Cuando haya un incendio llamo a los bomberos", "es")).toBe(true);
  });

  it("la consulta condicional genuina sigue cerrando su puerta", () => {
    for (const [q, lang] of [
      ["¿Qué hago si mi hijo se atraganta?", "es"],
      ["What should I do if my son chokes?", "en"],
    ] as const) {
      const r = route(q, lang);
      expect(r === "health-gate" || r === "emergency-situation", q).toBe(true);
    }
  });

  it("el suceso vivo gemelo sigue declarando", () => {
    expect(route("My grandfather fell and can't get up", "en")).toBe("emergency-situation");
    expect(route("Mi hijo se está atragantando ahora mismo", "es")).toBe("emergency-situation");
  });
});
