/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { answerMemoryQuery, type MemoryQueryData } from "./memoryQuery";

const MEM: MemoryQueryData = {
  facts: [
    { content: "Me llamo Ruben", category: "general" },
    { content: "mi coche es un Toyota", category: "general" },
    { content: "mi cumpleaños es el 3 de mayo", category: "event" },
    { content: "el cumpleaños de mi mamá es el 15 de marzo", category: "event" },
    { content: "mi color favorito es el azul", category: "preference" },
    { content: "vivo en Tucson", category: "general" },
  ],
  people: [{ name: "Marta", relationship: "mamá" }],
};

describe("0.1.20 (M1) — consultas de memoria deterministas", () => {
  it("nombre de una persona por parentesco, con sinónimo", () => {
    expect(answerMemoryQuery("¿cómo se llama mi mamá?", MEM, "es")).toBe("Tu mamá se llama Marta.");
    expect(answerMemoryQuery("¿cómo se llama mi madre?", MEM, "es")).toBe("Tu madre se llama Marta.");
  });

  it("nombre propio", () => {
    expect(answerMemoryQuery("¿cómo me llamo?", MEM, "es")).toBe("Te llamas Ruben.");
    expect(answerMemoryQuery("what's my name?", MEM, "en")).toBe("Your name is Ruben.");
  });

  it("cumpleaños de una persona y el propio, con fecha formateada", () => {
    expect(answerMemoryQuery("¿cuándo es el cumpleaños de mi mamá?", MEM, "es")).toContain("15 de marzo");
    expect(answerMemoryQuery("¿cuándo es mi cumpleaños?", MEM, "es")).toContain("3 de mayo");
    expect(answerMemoryQuery("when is my birthday?", MEM, "en")).toContain("May 3");
  });

  it("búsqueda genérica en hechos", () => {
    expect(answerMemoryQuery("¿cuál es mi color favorito?", MEM, "es")).toContain("mi color favorito es el azul");
    expect(answerMemoryQuery("¿qué coche tengo?", MEM, "es")).toContain("Toyota");
    expect(answerMemoryQuery("¿dónde vivo?", MEM, "es")).toContain("Tucson");
  });

  it("resumen «¿qué sabes de mí?»", () => {
    const r = answerMemoryQuery("¿qué sabes de mí?", MEM, "es");
    expect(r).toContain("Marta");
    expect(r).toContain("Toyota");
  });

  it("sin el dato: honesto, sin inventar ni citar fuentes", () => {
    expect(answerMemoryQuery("¿cómo se llama mi papá?", MEM, "es")).toContain("Todavía no me has contado eso");
    expect(answerMemoryQuery("¿cuál es mi banco?", MEM, "es")).toContain("Todavía no me has contado eso");
  });

  it("cruce de idiomas: persona guardada en español, pregunta en inglés", () => {
    expect(answerMemoryQuery("what's my mom's name?", MEM, "en")).toBe("Your mom's name is Marta.");
  });

  it("preguntas que NO son de memoria: null (sigue el flujo normal)", () => {
    expect(answerMemoryQuery("¿cómo se llama la capital de Francia?", MEM, "es")).toBeNull();
    expect(answerMemoryQuery("¿cuál es la capital de Francia?", MEM, "es")).toBeNull();
    expect(answerMemoryQuery("¿qué hora es?", MEM, "es")).toBeNull();
    expect(answerMemoryQuery("cuéntame un chiste", MEM, "es")).toBeNull();
  });

  it("memoria vacía: honesto", () => {
    const empty: MemoryQueryData = { facts: [], people: [] };
    expect(answerMemoryQuery("¿cómo se llama mi mamá?", empty, "es")).toContain("Todavía no me has contado eso");
    expect(answerMemoryQuery("¿qué sabes de mí?", empty, "es")).toContain("Todavía no me has contado eso");
  });
});
