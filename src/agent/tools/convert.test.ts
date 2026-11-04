/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { convertUnits, validUnits, ConvertError } from "./convert";

describe("convertUnits", () => {
  it("convierte longitud", () => {
    expect(convertUnits(1, "km", "m").value).toBe(1000);
    expect(convertUnits(1, "mi", "km").value).toBeCloseTo(1.609344);
    expect(convertUnits(12, "in", "cm").value).toBeCloseTo(30.48);
  });

  it("acepta alias en español", () => {
    expect(convertUnits(2, "metros", "cm").value).toBe(200);
    expect(convertUnits(1, "libra", "kg").value).toBeCloseTo(0.45359237);
    expect(convertUnits(3, "pulgadas", "cm").value).toBeCloseTo(7.62);
    expect(convertUnits(1, "kilómetros", "m").value).toBe(1000);
  });

  it("convierte temperatura con desplazamiento", () => {
    expect(convertUnits(0, "c", "f").value).toBeCloseTo(32);
    expect(convertUnits(100, "c", "f").value).toBeCloseTo(212);
    expect(convertUnits(32, "f", "c").value).toBeCloseTo(0);
    expect(convertUnits(0, "c", "k").value).toBeCloseTo(273.15);
    expect(convertUnits(25, "celsius", "fahrenheit").value).toBeCloseTo(77);
  });

  it("convierte peso, volumen y tiempo", () => {
    expect(convertUnits(1, "kg", "g").value).toBe(1000);
    expect(convertUnits(1, "l", "ml").value).toBe(1000);
    expect(convertUnits(2, "h", "min").value).toBe(120);
    expect(convertUnits(1, "gal", "l").value).toBeCloseTo(3.785411784);
  });

  it("rechaza unidades desconocidas o incompatibles", () => {
    expect(() => convertUnits(1, "parsec", "m")).toThrow(ConvertError);
    expect(() => convertUnits(1, "m", "kg")).toThrow(ConvertError);
    expect(() => convertUnits(NaN, "m", "km")).toThrow(ConvertError);
  });

  it("expone la lista de unidades válidas", () => {
    const units = validUnits();
    expect(units).toContain("m");
    expect(units).toContain("kg");
    expect(units).toContain("c");
  });
});

describe("cero absoluto (0.1.75)", () => {
  it("por debajo no hay temperatura: -10 K y -500 °F se rechazan", () => {
    expect(() => convertUnits(-10, "kelvin", "celsius")).toThrow(ConvertError);
    expect(() => convertUnits(-500, "f", "c")).toThrow(ConvertError);
    expect(() => convertUnits(-300, "c", "k")).toThrow(ConvertError);
  });
  it("par: el propio cero absoluto y lo que está por encima sí", () => {
    expect(convertUnits(0, "kelvin", "celsius").value).toBeCloseTo(-273.15);
    expect(convertUnits(-459.67, "f", "k").value).toBeCloseTo(0);
    expect(convertUnits(-40, "c", "f").value).toBeCloseTo(-40);
  });
  it("el error lleva un código para traducirlo", () => {
    try { convertUnits(1, "parsec", "m"); } catch (e) { expect((e as ConvertError).code).toBe("unknownUnit"); }
    try { convertUnits(1, "m", "kg"); } catch (e) { expect((e as ConvertError).code).toBe("mismatch"); }
    try { convertUnits(-1, "k", "c"); } catch (e) { expect((e as ConvertError).code).toBe("belowAbsoluteZero"); }
  });
});
