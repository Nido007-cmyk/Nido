/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { evaluateExpression, formatNumber, CalcError } from "./calc";

describe("evaluateExpression", () => {
  it("respeta precedencia de operadores", () => {
    expect(evaluateExpression("2+3*4")).toBe(14);
    expect(evaluateExpression("(2+3)*4")).toBe(20);
    expect(evaluateExpression("10-2*3")).toBe(4);
  });

  it("maneja división, módulo y potencia", () => {
    expect(evaluateExpression("7/2")).toBe(3.5);
    expect(evaluateExpression("10%3")).toBe(1);
    expect(evaluateExpression("2^10")).toBe(1024);
    expect(evaluateExpression("2^3^2")).toBe(512); // ^ asocia a la derecha
  });

  it("maneja unarios y decimales", () => {
    expect(evaluateExpression("-5+3")).toBe(-2);
    expect(evaluateExpression("-(2+3)")).toBe(-5);
    expect(evaluateExpression("0.1+0.2")).toBeCloseTo(0.3);
  });

  it("evalúa funciones y constantes", () => {
    expect(evaluateExpression("sqrt(16)")).toBe(4);
    expect(evaluateExpression("abs(-7)")).toBe(7);
    expect(evaluateExpression("round(2.6)")).toBe(3);
    expect(evaluateExpression("sin(pi/2)")).toBeCloseTo(1);
    expect(evaluateExpression("2*pi")).toBeCloseTo(2 * Math.PI);
    expect(evaluateExpression("log(100)")).toBe(2);
  });

  it("rechaza división entre cero", () => {
    expect(() => evaluateExpression("1/0")).toThrow(CalcError);
    expect(() => evaluateExpression("1%0")).toThrow(CalcError);
  });

  it("rechaza entradas maliciosas o malformadas", () => {
    expect(() => evaluateExpression("")).toThrow(CalcError);
    expect(() => evaluateExpression("2+")).toThrow(CalcError);
    expect(() => evaluateExpression("(2+3")).toThrow(CalcError);
    expect(() => evaluateExpression("__proto__")).toThrow(CalcError);
    expect(() => evaluateExpression("process.exit()")).toThrow(CalcError);
    expect(() => evaluateExpression("2;3")).toThrow(CalcError);
    expect(() => evaluateExpression("sqrt(-1)")).toThrow(CalcError);
    expect(() => evaluateExpression("foo(2)")).toThrow(CalcError);
  });

  it("no ejecuta código arbitrario", () => {
    // Si esto usara eval(), `constructor` daría acceso al runtime.
    expect(() => evaluateExpression("[1,2].constructor")).toThrow(CalcError);
    expect(() => evaluateExpression("globalThis")).toThrow(CalcError);
  });
});

describe("formatNumber", () => {
  it("recorta ruido de punto flotante", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(42)).toBe("42");
  });
});
