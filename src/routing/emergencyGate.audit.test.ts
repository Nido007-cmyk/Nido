// Auditoría completa 0.1.62–0.1.72 (F-5/F-6/F-7): asimetrías de las
// tres lenguas en la puerta de emergencia y de salud. Pares: la forma
// que faltaba dispara; su metáfora o su tema cotidiano, no.
import { describe, expect, it } from "vitest";
import { isEmergencySituation, isEmergencyText, isHealthQuestion } from "./emergencyGate";
import { crisisQuestionKind } from "../rag/packFacts";

describe("F-5: la emergencia viva contada, en las tres lenguas", () => {
  it("la contracción inglesa y la primera persona de la respiración disparan", () => {
    for (const t of ["my dad collapsed and isn't breathing", "he isn't breathing", "she wasn't breathing when I found her"]) {
      expect(isEmergencySituation(t), t).toBe(true);
    }
    expect(isEmergencySituation("no puedo respirar")).toBe(true);
    expect(isEmergencySituation("não consigo respirar")).toBe(true);
    expect(isEmergencySituation("ele não consegue respirar")).toBe(true);
    expect(isEmergencyText("i can't breathe", "en")).toBe(true);
  });
  it("las convulsiones, el infarto y el ictus en curso disparan en las tres", () => {
    for (const t of ["someone is having a seizure", "i think i'm having a heart attack", "my mom is having a stroke",
      "mi papá está teniendo un infarto", "le está dando una convulsión", "ele está tendo um AVC"]) {
      expect(isEmergencySituation(t), t).toBe(true);
    }
  });
  it("par: lo que no es un suceso sigue sin disparar", () => {
    for (const t of ["what is a heart attack", "history of the stroke unit", "cuántas personas murieron de infarto en 1990",
      "how do i improve my backstroke?", "my brush stroke technique?", "this traffic is killing me"]) {
      expect(isEmergencySituation(t), t).toBe(false);
    }
  });
});

describe("F-6: la puerta de salud conoce el infarto, el ictus y la ingestión", () => {
  it("dispara con la víctima o la pregunta", () => {
    for (const t of ["my baby swallowed a battery", "qué hago si mi hijo se tragó pastillas", "meu filho engoliu água sanitária",
      "¿cuáles son los síntomas de un infarto?", "what are the signs of a heart attack?", "quais os sinais de um AVC?"]) {
      expect(isHealthQuestion(t), t).toBe(true);
    }
  });
  it("par: la metáfora de la ingestión no es salud", () => {
    for (const t of ["my phone swallowed the sd card?", "¿se tragó el cuento mi jefe?", "the ATM swallowed my card?"]) {
      expect(isHealthQuestion(t), t).toBe(false);
    }
  });
});

describe("F-7: la intención de crisis en español y portugués", () => {
  it("«matarme» y «me matar» son crisis, como «kill myself»", () => {
    for (const t of ["quiero matarme", "me voy a matar", "quero me matar", "vou me matar", "penso em me matar",
      "quiero acabar con mi vida", "i want to take my own life", "I want to kill myself"]) {
      expect(crisisQuestionKind(t), t).toBe(true);
    }
  });
  it("par: el modismo de esfuerzo y «matar» sin sí mismo no lo son", () => {
    for (const t of ["me voy a matar estudiando", "me mato a trabajar", "me voy a matar de risa", "vou me matar de rir",
      "cómo matar mosquitos", "matar el tiempo"]) {
      expect(crisisQuestionKind(t), t).toBe(false);
    }
  });
});
