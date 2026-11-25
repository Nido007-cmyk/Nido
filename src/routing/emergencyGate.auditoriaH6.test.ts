/**
 * Auditoría 2026-11-25, hallazgo H-6: el habla indirecta de
 * signos pasados se leía como suceso vivo. El veto de
 * narración cubría llamada, caída y CO contados; con los
 * signos (atragantamiento, desmayo, corte con sangrado) el
 * marco de relato no acotaba en español y portugués (el
 * inglés salía limpio entero). Tres salían como situación de
 * emergencia y dos como puerta de salud.
 *
 * La cura tiene tres piezas:
 * - El marco de relato como rama del veto de narración:
 *   verbo de relato («contó que», «me contaram que», «diz
 *   que»…) ∧ verbo del suceso en pasado ∧ sin ancla viva,
 *   la misma conjunción de la rama de distancia.
 * - La causa raíz de la frase portuguesa: la reparación de
 *   erratas de la puerta convertía el posesivo «dele» en
 *   «duele» (borrado de la primera vocal), y ese «duele»
 *   espurio es un ancla viva que desarmaba el veto. La
 *   protección es por contexto: «dele» tras pronombre de
 *   dolor (me/le/se…) sigue siendo la errata española de
 *   «duele» que el corpus gobernado cobra («me dele el
 *   pecho»); fuera de esa construcción, el posesivo
 *   portugués se restaura y no reescribe nada.
 *
 * La dimensión gemela, habla indirecta de suceso VIVO, sigue
 * declarando: el marco de relato con el suceso en presente o
 * con ancla viva no veta nada.
 */
import { describe, it, expect } from "vitest";
import { deterministicAnswer } from "../eval/blindCore";

type Lang = "es" | "en" | "pt";
function route(t: string, lang: Lang): string {
  return deterministicAnswer({ id: "h6", type: "emergencia", lang, expected: "model-side", query: t }).route;
}
const modelSide = (t: string, lang: Lang): boolean => {
  const r = route(t, lang);
  return r === "model" || r === "factual-refusal";
};

describe("auditoría 2026-11-25 · H-6: el relato pasado no es suceso vivo", () => {
  it("las cinco frases de la auditoría no disparan ninguna puerta", () => {
    for (const [q, lang] of [
      ["Mi abuela contó que se atragantó una vez con un hueso", "es"],
      ["Me contaron que una vecina se cortó y sangró mucho el lunes", "es"],
      ["O vizinho diz que o filho dele desmaiou na semana passada", "pt"],
      ["Minha avó contou que uma vez se engasgou com um osso", "pt"],
      ["Me contaram que uma vizinha se cortou e sangrou muito na segunda-feira", "pt"],
    ] as const) {
      expect(modelSide(q, lang), q).toBe(true);
    }
  });

  it("el relato de suceso vivo sigue declarando", () => {
    for (const [q, lang] of [
      ["Me está diciendo que mi hijo se está atragantando ahora", "es"],
      ["O vizinho diz que o filho dele está se engasgando agora", "pt"],
    ] as const) {
      const r = route(q, lang);
      expect(r === "emergency-situation" || r === "health-gate", q).toBe(true);
    }
  });

  it("el relato pasado con una parte viva sigue declarando", () => {
    expect(route("Mi abuela contó que se cayó ayer y ahora no se puede mover", "es")).toBe("emergency-situation");
  });

  it("«una vez» como frecuencia de dosis no es marcador de relato: la consulta sigue en salud", () => {
    expect(route("Tengo que tomar una pastilla una vez al día", "es")).toBe("health-gate");
  });

  it("la errata española «me dele» tras pronombre de dolor sigue reparándose a «me duele»", () => {
    expect(route("Me dele el pecho", "es")).toBe("health-gate");
  });

  it("el posesivo portugués no se reescribe como dolor: el desmayo contado con «dele» no declara", () => {
    expect(modelSide("O filho dele desmaiou na semana passada", "pt")).toBe(true);
  });
});
