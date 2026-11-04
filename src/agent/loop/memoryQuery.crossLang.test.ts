// Arreglos «todo es todo» (2026-11-03): un dato guardado en otra lengua no
// aparecía («vivo en Tucson» ante «where do I live?»). Pares: una
// pregunta sin relación sigue sin hecho.
import { describe, expect, it } from "vitest";
import { answerMemoryQuery, memoryGateHit, type MemoryQueryData } from "./memoryQuery";

const ES: MemoryQueryData = {
  facts: [
    { content: "vivo en Tucson", category: "general" },
    { content: "soy alérgico a la penicilina", category: "general" },
  ],
  people: [],
};
const EN: MemoryQueryData = { facts: [{ content: "my car is a Toyota", category: "general" }], people: [] };

describe("hechos guardados en otra lengua", () => {
  it.each([
    ["where do I live?", "en", "Tucson"],
    ["onde eu moro?", "pt", "Tucson"],
    ["what am I allergic to?", "en", "penicilina"],
  ])("%s → cita el hecho", (q, lang, word) => {
    expect(memoryGateHit(q, ES)).toBe(true);
    expect(answerMemoryQuery(q, ES, lang as "en" | "pt")).toContain(word);
  });
  it("«¿qué coche tengo?» con «my car is a Toyota»", () => {
    expect(answerMemoryQuery("¿qué coche tengo?", EN, "es")).toContain("Toyota");
  });
  it("par: una pregunta sin relación no cita nada", () => {
    expect(memoryGateHit("what is my blood type?", ES)).toBe(false);
  });
  it("«¿a qué soy alérgico?» con el hecho en inglés y «a que sou alérgico?» con el español", () => {
    const en: MemoryQueryData = { facts: [{ content: "I'm allergic to peanuts", category: "general" }], people: [] };
    expect(answerMemoryQuery("¿a qué soy alérgico?", en, "es")).toContain("peanuts");
    expect(answerMemoryQuery("a que sou alérgico?", ES, "pt")).toContain("penicilina");
    expect(answerMemoryQuery("¿a qué soy alérgico?", ES, "es")).toContain("penicilina");
  });
});
