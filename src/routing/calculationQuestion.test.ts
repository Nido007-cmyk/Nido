// 0.1.92 (familia 7): qué turno razona — solo el de cuentas.
import { describe, expect, it } from "vitest";
import {
  isCalculationQuestion,
  shouldReasonThisTurn,
  REASONING_MIN_GEN_TOKENS,
  REASON_ON_CALCULATION_MODEL_IDS,
} from "./calculationQuestion";
import { MODEL_CATALOG } from "../models/manifest";

describe("pregunta de cuentas", () => {
  it("las del banco del dueño y sus hermanas, en los tres idiomas", () => {
    for (const q of [
      "Tengo 3 cajas de 12 huevos y se rompen 7. ¿Cuántos huevos me quedan?",
      "Un tren sale a las 9:00 y el viaje dura 2 horas y media. Si lleva 40 minutos de retraso, ¿a qué hora llega?",
      "Si compro 4 panes a 15 pesos cada uno y pago con un billete de 100, ¿cuánto me devuelven?",
      "¿Cuánto es el 15% de 200?",
      "I have 5 boxes with 8 apples each and I give away 9. How many apples are left?",
      "If a movie starts at 7:45 pm and lasts 1 hour 50 minutes, what time does it end?",
      "Tenho 6 pacotes com 10 biscoitos cada e como 14. Quantos biscoitos sobram?",
    ]) {
      expect(isCalculationQuestion(q), q).toBe(true);
    }
  });

  it("lo demás del banco no razona: sigue como en la 0.1.91", () => {
    for (const q of [
      "Explícame cómo cambiar una llanta en 5 pasos numerados",
      "Como cambio la llanta de un carro",
      "Cuéntame un cuento muy corto de un zorro que aprende a nadar",
      "Escribe un correo breve a mi vecino, dos frases, sin asunto",
      "Dame un consejo para una entrevista de trabajo",
      "¿Cuántos días tiene un año bisiesto?",
      "¿Cuánto tarda en hervir el agua?",
      "Hola",
      "",
    ]) {
      expect(isCalculationQuestion(q), q).toBe(false);
    }
  });

  it("un texto largo pegado con cifras no es una cuenta", () => {
    expect(isCalculationQuestion(`${"En 2024 hubo 12 casos. ".repeat(30)}¿cuántos hubo?`)).toBe(false);
  });
});

describe("qué turno razona", () => {
  const huevos = "Tengo 3 cajas de 12 huevos y se rompen 7. ¿Cuántos huevos me quedan?";
  const base = { modelId: "qwen3-0.6b-q4km", usesChatTemplate: true, sourceCount: 0, genTokens: 416, query: huevos };

  it("la cuenta, con el modelo medido, sin fuentes y con presupuesto: razona", () => {
    expect(shouldReasonThisTurn(base)).toBe(true);
  });

  it("cualquier condición que falte lo deja como en la 0.1.91", () => {
    expect(shouldReasonThisTurn({ ...base, modelId: undefined })).toBe(false);
    expect(shouldReasonThisTurn({ ...base, modelId: "qwen2.5-0.5b-instruct-q4km" })).toBe(false);
    expect(shouldReasonThisTurn({ ...base, usesChatTemplate: false })).toBe(false);
    // Con fuentes manda el régimen de evidencia: no se toca.
    expect(shouldReasonThisTurn({ ...base, sourceCount: 2 })).toBe(false);
    expect(shouldReasonThisTurn({ ...base, genTokens: REASONING_MIN_GEN_TOKENS - 1 })).toBe(false);
    expect(shouldReasonThisTurn({ ...base, query: "Como cambio la llanta de un carro" })).toBe(false);
  });

  it("la lista es solo el modelo en el que se midió, y existe en el catálogo como modelo que no razona por defecto", () => {
    expect([...REASON_ON_CALCULATION_MODEL_IDS]).toEqual(["qwen3-0.6b-q4km"]);
    const m = MODEL_CATALOG.find((x) => x.id === "qwen3-0.6b-q4km");
    expect(m?.capabilities?.noThink).toBe(true);
    expect(m?.capabilities?.usesChatTemplate).toBe(true);
  });
});
