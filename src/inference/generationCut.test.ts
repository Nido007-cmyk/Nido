// 0.1.92 (auditoría del paquete 0.1.91, familia 6): el corte por tope se lee del motor, no de contar llamadas.
import { describe, expect, it } from "vitest";
import { generationHitLimit } from "./generationCut";
import { generationCutNote } from "../agent/loop/fallbackText";

describe("¿la generación llegó al tope?", () => {
  it("el caso que la cuenta de llamadas perdía: tope real con llamadas retenidas (saltos de línea, UTF-8)", () => {
    // 5 pasos numerados: cada «\n» retiene una llamada (posible «\nUser:»).
    // 423 tokens generados, 418 llamadas de onToken.
    const native = { stopped_limit: true, stopped_eos: false, stopped_word: "", context_full: false, interrupted: false };
    expect(generationHitLimit(native, 418, 423)).toBe(true);
    // Y con la decisión de la 0.1.91 encima: lleva su nota.
    expect(generationCutNote(true, generationHitLimit(native, 418, 423))).toBe("spaceShortened");
    expect(generationCutNote(false, generationHitLimit(native, 418, 423))).toBe("answerCut");
  });

  it("el caso del aparato (0.1.91): respuesta corta con fin natural → sin corte, sin nota", () => {
    const native = { stopped_limit: false, stopped_eos: true, stopped_word: "", context_full: false, interrupted: false };
    expect(generationHitLimit(native, 80, 423)).toBe(false);
    expect(generationCutNote(true, generationHitLimit(native, 80, 423))).toBeNull();
  });

  it("el fin de turno que cae justo en el último token no es un corte", () => {
    expect(generationHitLimit({ stopped_limit: true, stopped_eos: true }, 423, 423)).toBe(false);
    expect(generationHitLimit({ stopped_limit: true, stopped_eos: false, stopped_word: "\nUser:" }, 423, 423)).toBe(false);
  });

  it("ventana de contexto llena a mitad de respuesta: corte", () => {
    expect(generationHitLimit({ stopped_limit: false, stopped_eos: false, context_full: true }, 120, 423)).toBe(true);
  });

  it("parada pedida (usuario o guarda de bucle): no es el tope", () => {
    expect(generationHitLimit({ stopped_limit: false, stopped_eos: false, interrupted: true }, 423, 423)).toBe(false);
  });

  it("sin veredicto del motor (resultado mínimo o build vieja): respaldo por cuenta de llamadas", () => {
    expect(generationHitLimit(undefined, 423, 423)).toBe(true);
    expect(generationHitLimit(null, 80, 423)).toBe(false);
    expect(generationHitLimit({}, 423, 423)).toBe(true);
  });

  it("acepta stopped_limit como número (el tipo declarado de llama.rn)", () => {
    expect(generationHitLimit({ stopped_limit: 1, stopped_eos: false }, 10, 423)).toBe(true);
    expect(generationHitLimit({ stopped_limit: 0, stopped_eos: false }, 423, 423)).toBe(false);
  });
});
