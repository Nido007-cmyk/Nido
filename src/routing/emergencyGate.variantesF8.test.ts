// Tanda de variantes de la casa, Familia 8: los menores de la
// F9 (históricos) con el veto de prevención, en su alcance
// corregido por el censo de la ciega. Dos piezas:
//  - El veto de prevención: SITUATION_TOPIC_FRAMES solo traía
//    «how to prevent» y solo miraba el arranque, así que «how
//    can I prevent a child from choking» declaraba emergencia
//    por la raíz «chok» con su contexto, y la cortesía rompía
//    el arranque en los tres idiomas. Entran las formas con
//    «can i»/«puedo»/«posso»/«faço para» y el arranque se lee
//    tras la cortesía. La cara de salud NO se toca: el tema
//    de prevención es suyo y sigue declarando.
//  - Los históricos de la F9: la muerte familiar contada con
//    su causa («murió de un infarto», «died of», «morreu de»)
//    y el «last year» inglés no eran marco histórico — la
//    lista traía el plural («murieron», «morreram») y no el
//    singular — y declaraban salud.
import { describe, expect, it } from "vitest";
import { isEmergencySituation, isHealthQuestion } from "./emergencyGate";

describe("variantes F8 · el tema de prevención no es una situación", () => {
  for (const q of [
    "how can I prevent a child from choking",
    "please, how can I prevent a child from choking",
    "¿cómo puedo evitar que un niño se atragante?",
    "¿cómo puedo prevenir que mi padre se caiga en el baño?",
    "como faço para prevenir que meu pai caia no banheiro",
  ]) {
    it(`no declara situación: ${q}`, () => {
      expect(isEmergencySituation(q), q).toBe(false);
    });
  }
});

describe("variantes F8 · la muerte familiar contada es historia, no salud", () => {
  for (const q of [
    "mi abuelo murió de un infarto hace años",
    "my grandfather died of a heart attack years ago",
    "meu avô morreu de infarto há anos",
    "last year I had a fever for a week",
  ]) {
    it(`no declara salud: ${q}`, () => {
      expect(isHealthQuestion(q), q).toBe(false);
    });
  }
});

describe("variantes F8 · guardas: el tema sigue en salud y el parte sigue declarando", () => {
  it("la prevención sigue siendo tema de la puerta de salud", () => {
    expect(isHealthQuestion("how can I prevent a child from choking")).toBe(true);
  });
  it("el parte con la petición detrás sigue declarando situación", () => {
    expect(isEmergencySituation("hay un hombre inconsciente, ¿cómo puedo ayudar?")).toBe(true);
  });
  it("el año suelto no es marco histórico: la fiebre desde 2023 es presente", () => {
    expect(isHealthQuestion("tengo fiebre desde 2023")).toBe(true);
  });
});
