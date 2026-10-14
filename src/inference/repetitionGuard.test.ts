/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { findRepetitionLoop, trimRepetitionLoop } from "./repetitionGuard";

describe("bucle de repetición del modelo", () => {
  it("el caso real de la Tab A9+ se corta tras la primera vez", () => {
    const head = "Ejemplos de plantas que conozco son ";
    const text = head + "las aluminosas, ".repeat(30);
    expect(findRepetitionLoop(text)).not.toBeNull();
    expect(trimRepetitionLoop(text)).toBe(head + "las aluminosas…");
  });

  it("también si el texto acaba a mitad del trozo repetido", () => {
    const text = "Hola. " + "el sol sale por el este y ".repeat(8) + "el sol sa";
    expect(findRepetitionLoop(text)).not.toBeNull();
  });

  it("un párrafo largo que se repite 3 veces", () => {
    const p = "La fotosíntesis convierte luz en energía química dentro del cloroplasto. ";
    expect(findRepetitionLoop("Intro. " + p.repeat(3))).not.toBeNull();
  });

  it.each([
    ["texto normal", "La fotosíntesis ocurre en los cloroplastos. Primero la luz excita la clorofila; luego el agua se divide y se libera oxígeno. Después, en el ciclo de Calvin, el CO2 se fija en azúcares."],
    ["tabla markdown", "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |"],
    ["risa corta", "Jajaja, ja ja ja ja ja, qué gracioso. Bueno, sigamos con lo tuyo y hablemos de otra cosa distinta."],
    ["lista numerada", "1. Agua\n2. Luz\n3. Dióxido de carbono\n4. Clorofila\n5. Temperatura adecuada\n6. Nutrientes del suelo"],
    ["texto corto", "sí sí sí sí"],
  ])("no corta %s", (_l, text) => {
    expect(findRepetitionLoop(text)).toBeNull();
    expect(trimRepetitionLoop(text)).toBe(text);
  });
});
