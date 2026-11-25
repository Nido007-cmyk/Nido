// Tanda de variantes de la casa, compleción de la Familia 5:
// el residuo que el re-cobro final dejó por nombre — 11
// variantes de errata (0 bases) de una sola clase: la palabra
// rota cuya forma canónica las puertas solo conocen por
// prefijo («vmitos» de vómitos, que la puerta de salud casa
// por el prefijo «vomit»; «vviendo» de viviendo, de
// «vivi(?:r|endo)»; «sicídio» de suicidio, de «suicid\w*»).
// La reparación no podía reponerlas porque su vocabulario
// sale de las listas y las formas enteras no están en
// ninguna. La cura no toca ninguna lista de casado: solo
// completa el vocabulario de la reparación con las formas
// enteras medidas, una por puerta.
import { describe, expect, it } from "vitest";
import { isHealthQuestion } from "./emergencyGate";
import { isSelfHarmMessage } from "../agent/loop/safetyAnswers";
import { crisisQuestionKind } from "../rag/packFacts";

describe("variantes F5-bis · la errata sobre la palabra conocida por prefijo", () => {
  for (const q of [
    "mi hijo tiene vmitos",
    "mi hija tiene vmitos",
    "mi madre tiene vmitos",
    "mi padre tiene vmitos",
    "mi esposo tiene vmitos",
    "mi esposa tiene vmitos",
    "mi bebé tiene vmitos",
    "mi abuela tiene vmitos",
    "vmité sangre",
  ]) {
    it(`declara salud: ${q}`, () => {
      expect(isHealthQuestion(q), q).toBe(true);
    });
  }
  it("declara crisis: no quiero seguir vviendo", () => {
    expect(isSelfHarmMessage("no quiero seguir vviendo")).toBe(true);
  });
  it("declara crisis: tenho pensado em sicídio", () => {
    expect(isSelfHarmMessage("tenho pensado em sicídio") || crisisQuestionKind("tenho pensado em sicídio")).toBe(
      true,
    );
  });
});
