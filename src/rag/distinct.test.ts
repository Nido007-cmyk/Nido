/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.35: distintividad del mejor candidato frente al fondo (puestos 10–50),
// igual que scripts/multilingual/e5_pipeline.py.
import { describe, expect, it } from "vitest";
import { backgroundScore, distinctFloor } from "./pure";

describe("distintividad", () => {
  it("fondo = media de los puestos 10–50 cuando hay más de 50", () => {
    const s = Array.from({ length: 60 }, (_, i) => 1 - i * 0.01);
    expect(backgroundScore(s)).toBeCloseTo((s.slice(10, 50).reduce((a, b) => a + b, 0)) / 40, 10);
  });

  it("pregunta sin respuesta (todo plano y alto): el piso sube por encima del mejor", () => {
    const flat = Array.from({ length: 200 }, (_, i) => 0.86 - i * 0.0001);
    expect(distinctFloor(0.81, flat, 0.03)).toBeGreaterThan(flat[0]);
  });

  it("pregunta con respuesta (el mejor destaca): el mejor sigue pasando", () => {
    const peaked = [0.9, 0.88, ...Array.from({ length: 198 }, (_, i) => 0.82 - i * 0.0001)];
    const f = distinctFloor(0.81, peaked, 0.03);
    expect(f).toBeLessThan(0.88);
  });

  it("gap 0 o pocos candidatos: el piso del modelo, sin cambios", () => {
    const s = Array.from({ length: 200 }, () => 0.9);
    expect(distinctFloor(0.81, s, 0)).toBe(0.81);
    expect(distinctFloor(0.81, [0.9, 0.9, 0.9], 0.03)).toBe(0.81);
  });
});
