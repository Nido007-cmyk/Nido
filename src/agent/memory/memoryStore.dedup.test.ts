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
