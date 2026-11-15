/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * repetitionGuard.t10.test.ts — TANDA T-10 (0.1.99), m-26 (parte 1).
 *
 * La guarda de repetición no miraba dentro de una valla de código
 * ABIERTA (la repetición ahí puede ser legítima: un tablero, filas
 * iguales). Pero una valla ```tool abierta no es código que el usuario
 * pidió: es una llamada de herramienta a medio escribir, y un bucle
 * dentro de ella quemaba la generación entera sin que la guarda lo
 * viera. La exención se mantiene para cualquier otra valla.
 */
import { describe, it, expect } from "vitest";
import { findRepetitionLoop } from "./repetitionGuard";

const LOOP = " las aluminosas,".repeat(8); // unidad con letras, 8×, >80 chars

describe("m-26: la exención de valla abierta no cubre una valla ```tool", () => {
  it("bucle dentro de una valla ```tool abierta: se detecta", () => {
    const text =
      'Voy a consultarlo.\n```tool\n{"name": "device_time", "arguments": {}}' + LOOP;
    expect(findRepetitionLoop(text)).not.toBeNull();
  });

  it("el mismo bucle tras una valla de código abierta: sigue exento", () => {
    const text = "Mira este ejemplo:\n```\n" + LOOP;
    expect(findRepetitionLoop(text)).toBeNull();
  });

  it("y tras una valla ```python abierta: sigue exento", () => {
    const text = "Ejemplo:\n```python\n" + LOOP;
    expect(findRepetitionLoop(text)).toBeNull();
  });

  it("con las vallas cerradas, la detección es la de siempre", () => {
    const text = "```\nejemplo\n```\n" + LOOP;
    expect(findRepetitionLoop(text)).not.toBeNull();
  });

  it("sin vallas, la detección es la de siempre", () => {
    expect(findRepetitionLoop("Respuesta larga y detallada." + LOOP)).not.toBeNull();
  });
});
