/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.60: fallos que encontró la evaluación v2 (casos CO-05, TO-20, TO-23
 * de src/eval/cases/v2.json) al correrla contra los routers reales.
 */
import { describe, expect, it } from "vitest";
import { matchSafetyAnswer } from "./safetyAnswers";
import { extractToolAction } from "./toolRouter";

describe("CO: aparatos de interior + síntomas → aviso de síntomas", () => {
  it.each([
    ["we have a gas heater on and everyone feels dizzy with a headache", "en"],
    ["the furnace is running and we all have headaches and nausea", "en"],
    ["tenemos el calentador de gas prendido y a todos nos duele la cabeza", "es"],
    ["con la caldera encendida estamos todos mareados", "es"],
    ["la chimenea está encendida y mi hijo tiene náuseas y dolor de cabeza", "es"],
    ["o aquecedor a gás está ligado e todos estão com dor de cabeça", "pt"],
  ] as const)("%s", (text, lang) => {
    expect(matchSafetyAnswer(text, lang)?.kind).toBe("co-symptoms");
  });
});

describe("CO: esos mismos aparatos SIN síntomas no reciben «nunca lo uses dentro»", () => {
  it.each([
    ["tengo una estufa de gas en la cocina, es seguro cocinar con ella?", "es"],
    ["can I use my furnace in the basement", "en"],
    ["la caldera está en el sótano, es normal?", "es"],
    ["is a gas fireplace ok in the living room", "en"],
    ["posso usar o aquecedor a gás em casa", "pt"],
  ] as const)("%s", (text, lang) => {
    expect(matchSafetyAnswer(text, lang)).toBeNull();
  });

  it("lo que ya avisaba sigue avisando (generador dentro de casa)", () => {
    expect(matchSafetyAnswer("puedo usar el generador dentro de la casa durante el apagón", "es")?.kind).toBe("co-hazard");
    expect(matchSafetyAnswer("tenemos el brasero encendido y a todos nos duele la cabeza y estamos mareados", "es")?.kind).toBe("co-symptoms");
  });
});

describe("Mensaje NIDO: formas naturales", () => {
  it.each([
    ["mándale un mensaje NIDO a Ana diciendo que llego tarde", "Ana", "llego tarde"],
    ["manda un mensaje de nido a Ana que llego tarde", "Ana", "llego tarde"],
    ["mándale un mensaje por nido a Ana diciendo que llego tarde", "Ana", "llego tarde"],
    ["manda por nido a Ana diciendo que llego tarde", "Ana", "llego tarde"],
  ])("%s", (s, to, text) => {
    expect(extractToolAction(s)).toMatchObject({ kind: "nidoSend", to, text, lang: "es" });
  });

  it("«diciendo» sin «que» sigue igual", () => {
    expect(extractToolAction("manda por nido a Ana diciendo hola")).toMatchObject({ kind: "nidoSend", to: "Ana", text: "hola" });
  });

  it("inglés y portugués con «that» / «que»", () => {
    expect(extractToolAction("send Ana a nido message saying that I'm late")).toMatchObject({ kind: "nidoSend", to: "Ana", text: "I'm late" });
    expect(extractToolAction("manda pelo nido para a Ana dizendo que chego tarde")).toMatchObject({ kind: "nidoSend", to: "Ana", text: "chego tarde" });
  });
});
