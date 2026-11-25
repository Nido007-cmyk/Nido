// Auditoría 2026-11-25, hallazgo H-3: la crisis en forma de
// pregunta y primera persona disparaba en español («¿Por qué
// siento que no quiero seguir viviendo?») y caía a la negativa
// factual en inglés y portugués, porque a esas dos lenguas les
// faltaba la forma léxica que el español ya tenía: el «no
// quiero seguir viviendo» dentro de la pregunta. La red sigue
// siendo solo léxica y solo de primera persona: la forma en
// segunda persona queda fuera, como la auditoría descartó.
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage, matchSafetyAnswer } from "./safetyAnswers";

describe("auditoría 2026-11-25 · H-3: crisis en forma de pregunta, primera persona", () => {
  it("las dos frases de la auditoría reciben el texto fijo de crisis", () => {
    for (const [q, lang] of [
      ["Why do I feel that I don't want to go on living?", "en"],
      ["Por que sinto que não quero continuar vivendo?", "pt"],
    ] as const) {
      expect(matchSafetyAnswer(q, lang)?.kind, q).toBe("self-harm");
    }
  });

  it("la familia en primera persona declara en en y pt", () => {
    for (const q of [
      "I don't want to go on living",
      "I don't want to keep living",
      "I do not want to continue living",
      "I don't want to go on living anymore",
      "não quero continuar vivendo",
      "não quero seguir vivendo",
      "não quero continuar a viver",
      "sinto que não quero continuar vivendo",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la gemela española que ya disparaba sigue disparando", () => {
    expect(isSelfHarmMessage("¿Por qué siento que no quiero seguir viviendo?")).toBe(true);
  });

  it("la segunda persona queda fuera en las tres lenguas", () => {
    for (const q of [
      "Do you feel that you don't want to go on living?",
      "¿Sientes que no quieres seguir viviendo?",
      "Você sente que não quer continuar vivendo?",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la ficción y la cita de tercera persona quedan fuera", () => {
    for (const q of [
      "In the novel, the character says he doesn't want to go on living",
      "escribe un cuento donde el personaje dice que no quiere seguir viviendo",
      "I want to go on living my life to the fullest",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});
