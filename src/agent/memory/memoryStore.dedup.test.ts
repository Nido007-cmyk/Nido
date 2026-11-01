/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { normalizeFactText, factSimilarity, mergeFactContent } from "./memoryStore";

describe("DEDUP-2026-10-08: deduplicación de facts", () => {
  it("normaliza texto", () => {
    expect(normalizeFactText("My Mom's Birthday!")).toBe("my mom s birthday");
    expect(normalizeFactText("  hola   mundo  ")).toBe("hola mundo");
  });

  it("detecta facts idénticos", () => {
    expect(factSimilarity("my mom's birthday is March 15th", "my mom's birthday is March 15th")).toBe(1);
  });

  it("detecta facts casi idénticos (caso del screenshot)", () => {
    const a = "my mom's birthday is March 15th and she loves orchids";
    const b = "my mom's birthday is March 15th and she loves orchids. Save it so you can remind me in time.";
    // b contiene a normalizado -> findSimilarFact lo detecta por inclusión
    const na = normalizeFactText(a);
    const nb = normalizeFactText(b);
    expect(nb.includes(na)).toBe(true);
    expect(factSimilarity(a, b)).toBeGreaterThan(0.5);
  });

  it("no confunde facts distintos", () => {
    expect(factSimilarity("my mom's birthday is March 15th", "I like pizza")).toBeLessThan(0.3);
  });
});

describe("N-03 — el plegado de diacríticos en la comparación (la ñ protegida)", () => {
  it("el mismo hecho con y sin acentos es idéntico al comparar", () => {
    expect(factSimilarity("mi hija se llama Lucía", "mi hija se llama Lucia")).toBe(1);
    expect(factSimilarity("vivo en Málaga", "vivo en Malaga")).toBe(1);
    expect(factSimilarity("se llama Rubén", "se llama Ruben")).toBe(1);
    expect(normalizeFactText("Mi hija se llama Lucía")).toBe("mi hija se llama lucia");
  });

  it("la ñ NO se pliega: «un año» y «un ano» son hechos distintos", () => {
    expect(factSimilarity("mi hijo cumple un año", "mi hijo cumple un ano")).toBeCloseTo(0.67, 2);
    expect(factSimilarity("mi hijo cumple un año", "mi hijo cumple un ano")).toBeLessThan(0.75);
    expect(normalizeFactText("El niño cumple un año")).toContain("año");
  });

  it("los pares que ya se resolvían no se mueven", () => {
    // Corrección 3/5 de mayo: sigue siendo el mismo hecho corregido.
    expect(factSimilarity("mi cumpleaños es el 3 de mayo", "mi cumpleaños es el 5 de mayo")).toBeGreaterThanOrEqual(0.75);
    // Distintos de verdad: siguen distintos.
    expect(factSimilarity("mi perro se llama Rocky", "mi perro se llama Toby")).toBeLessThan(0.75);
  });
});

describe("0.1.41 — una corrección no se pierde al deduplicar", () => {
  it("«3 de mayo» corrige a «5 de mayo» (antes ganaba el viejo y NIDO seguía diciendo 5)", () => {
    expect(factSimilarity("Mi cumpleaños es el 3 de mayo", "Mi cumpleaños es el 5 de mayo")).toBeGreaterThanOrEqual(0.75);
    expect(mergeFactContent("Mi cumpleaños es el 3 de mayo", "Mi cumpleaños es el 5 de mayo")).toBe("Mi cumpleaños es el 3 de mayo");
  });

  it("el mismo dato con más detalle conserva el detalle, venga de donde venga", () => {
    expect(mergeFactContent("mi perro se llama Toby", "Mi perro se llama Toby y es café")).toBe("Mi perro se llama Toby y es café");
    expect(mergeFactContent("Mi perro se llama Toby y es café", "mi perro se llama Toby")).toBe("Mi perro se llama Toby y es café");
  });

  it("repetir lo mismo deja lo guardado tal cual", () => {
    expect(mergeFactContent("mi cumpleaños es el 3 de mayo.", "Mi cumpleaños es el 3 de mayo")).toBe("Mi cumpleaños es el 3 de mayo");
  });
});
