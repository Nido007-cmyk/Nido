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
