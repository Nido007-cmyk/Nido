// Auditoría 0.1.79: «Reintentar» no duplica la pregunta y el error no llega al modelo.
import { describe, expect, it } from "vitest";
import { historyForModel, planRetry, type RetryableMessage } from "./chatRetry";

const u = (id: string, text: string): RetryableMessage => ({ id, role: "user", text });
const a = (id: string, text: string, failed = false): RetryableMessage => ({ id, role: "assistant", text, failed });

describe("reintentar", () => {
  it("tras un fallo: reenvía la pregunta y quita la pregunta fallida y su error", () => {
    const plan = planRetry([u("1", "hola"), a("2", "¡Hola!"), u("3", "¿y la RCP?"), a("4", "Algo salió mal", true)]);
    expect(plan).toEqual({ question: "¿y la RCP?", removeIds: ["3", "4"], deleteFromHistory: ["3"] });
  });

  it("sin fallo (reenviar a mano): no quita nada", () => {
    expect(planRetry([u("1", "hola"), a("2", "¡Hola!")])).toEqual({ question: "hola", removeIds: [], deleteFromHistory: [] });
  });

  it("sin preguntas: nada que reintentar", () => {
    expect(planRetry([])).toBeNull();
  });
});

describe("historial para el modelo", () => {
  it("sin burbujas de error ni la pregunta que no tuvo respuesta", () => {
    const msgs = [u("1", "hola"), a("2", "¡Hola!"), u("3", "x"), a("4", "Algo salió mal", true), u("5", "y"), a("6", "")];
    expect(historyForModel(msgs).map((m) => m.id)).toEqual(["1", "2", "5"]);
  });
});
