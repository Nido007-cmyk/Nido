/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Offensive audit (0.1.18): the calculator must never give a wrong answer,
 * and common ways of writing a sum must reach it instead of the model.
 */
import { describe, expect, it } from "vitest";
import { extractCalcAction } from "./actionRouter";
import { evaluateExpression, formatNumber, isApproximate } from "../tools/calc";

describe("calculator — precedence and percent", () => {
  it.each([
    ["-2^2", -4],
    ["2^-2", 0.25],
    ["-(2)^2", -4],
    ["(-2)^2", 4],
    ["2^3^2", 512],
    ["-2^-2", -0.25],
    ["10%3", 1],
    ["15%", 0.15],
    ["200*15%", 30],
    ["(15%+8%)*1200", 276],
    ["50%*50%", 0.25],
  ])("%s = %d", (expr, value) => {
    expect(evaluateExpression(expr)).toBeCloseTo(value, 12);
  });

  it("huge integers are shown as approximate", () => {
    const v = evaluateExpression("123456789*987654321");
    expect(isApproximate(v)).toBe(true);
    expect(formatNumber(v)).toBe("121932631112635000");
    expect(isApproximate(evaluateExpression("2^53-1"))).toBe(false);
  });
});

describe("calculator — what reaches it", () => {
  it.each([
    ["cuánto es el 15% de 200", "15% de 200", 30],
    ["what is 15% of 200", "15% of 200", 30],
    ["quanto é 15% de 200", "15% de 200", 30],
    ["cuánto es 7 x 8", "7 x 8", 56],
    ["cuánto es 12÷4", "12÷4", 3],
    ["cuánto es 3·4", "3·4", 12],
    ["cuánto es 2,5*4", "2,5*4", 10],
    ["cuánto es -2^2?", "-2^2", -4],
  ])("%s", (text, expression, result) => {
    const a = extractCalcAction(text);
    expect(a?.expression).toBe(expression);
    expect(a?.result).toBeCloseTo(result, 12);
  });

  it("decimal comma is remembered for the answer", () => {
    expect(extractCalcAction("cuánto es 1,5+1")?.decimalComma).toBe(true);
    expect(extractCalcAction("cuánto es 1.5+1")?.decimalComma).toBeUndefined();
  });

  it.each([
    "cuánto es 3!", // factorial: not supported, never answer 3
    "cuánto es 5+5!",
    "cuánto es 1,000+1", // thousands or decimal? ambiguous
    "cuánto es 1.000+1",
    "cuánto es 0x10", // hexadecimal
    "cuánto es 1,5.2",
  ])("%s → not answered by the fast path", (text) => {
    expect(extractCalcAction(text)).toBeNull();
  });
});

describe("calculator 0.1.19 — bare expressions and word operators (routing probe)", () => {
  it.each([
    // La cuenta escrita sola, sin "cuánto es" (el fallo que motivó 0.1.19).
    ["15% de 200", 30],
    ["245*38", 9310],
    ["2+2", 4],
    ["7 x 8", 56],
    ["12 ÷ 4", 3],
    ["15 percent of 200", 30],
    // Operadores con palabras.
    ["9 por 7", 63],
    ["45 más 67", 112],
    ["45 plus 67", 112],
    ["100 menos 25", 75],
    ["suma 45 y 67", 112],
    ["suma de 45 y 67", 112],
    ["resta 25 de 100", 75],
    ["multiplica 6 por 9", 54],
    ["divide 100 entre 4", 25],
    // Formas con nombre.
    ["la mitad de 80", 40],
    ["cuánto es la mitad de 80", 40],
    ["el doble de 35", 70],
    ["el triple de 12", 36],
    ["2 elevado a 10", 1024],
    ["raíz cuadrada de 144", 12],
    ["cuánto es la raíz cuadrada de 144", 12],
    ["cuánto son 3 docenas", 36],
    ["cuánto sería la propina del 15% de 230", 34.5],
    ["cuánto es 1,5 por 4", 6],
    // 0.1.20 (evidencia Tab A9+): paridad EN/PT de las formas con nombre.
    ["Half of 80", 40],
    ["half of 80", 40],
    ["how much is half of 80", 40],
    ["double 35", 70],
    ["the double of 35", 70],
    ["triple of 12", 36],
    ["square root of 144", 12],
    ["cube root of 27", 3],
    ["what is the square root of 144", 12],
    ["a metade de 80", 40],
    ["o dobro de 35", 70],
    ["o triplo de 12", 36],
    ["raiz quadrada de 144", 12],
    ["raiz cúbica de 27", 3],
    ["15 por cento de 200", 30],
  ])("%s", (text, result) => {
    expect(extractCalcAction(text)?.result).toBeCloseTo(result, 10);
  });

  it.each([
    "200", // un número solo no es una cuenta
    "15%", // un porcentaje solo tampoco
    "12/10/2026", // una fecha, no una división
    "3!", // factorial, también sin gatillo
    "cuánto es la población de México", // pregunta con gatillo, sin cuenta
    "suma de los ángulos de un triángulo", // "suma" sin números
    "tengo 3 hijos y 2 perros", // frase normal con cifras
    "compré 2 kilos por 50 pesos", // "por" que no es multiplicación
    "quedamos 2+2 en tu casa", // la cuenta no es todo el mensaje
    "cuánto es 70 kg en libras", // conversión, no calculadora
  ])("%s → not answered by the fast path", (text) => {
    expect(extractCalcAction(text)).toBeNull();
  });
});
