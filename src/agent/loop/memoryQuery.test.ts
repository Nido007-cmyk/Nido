/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import {
  answerMemoryQuery,
  isGenericMemoryQuestionShape,
  memoryGateHit,
  scoreMemoryFacts,
  type MemoryQueryData,
} from "./memoryQuery";

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

// Batería trilingüe 0.1.20 (directiva del usuario: probar en los TRES
// idiomas; el portugués no lo había probado en dispositivo). Huecos
// cazados: la puerta de primera persona no reconocía el «I» inglés;
// «favorito/favorite» estaban como stopwords y la búsqueda genérica se
// quedaba sin términos; «car»/«cor» (3 letras) quedaban fuera.
describe("batería trilingüe: consultas genéricas EN/PT", () => {
  const en: MemoryQueryData = {
    facts: [
      { content: "my car is a Toyota", category: "general" },
      { content: "my favorite color is blue", category: "preference" },
      { content: "I live in Tucson", category: "general" },
    ],
    people: [],
  };
  const pt: MemoryQueryData = {
    facts: [
      { content: "meu carro é um Toyota", category: "general" },
      { content: "minha cor favorita é azul", category: "preference" },
      { content: "moro em Tucson", category: "general" },
    ],
    people: [],
  };
  it("EN: coche, favorito y casa responden desde lo guardado", () => {
    expect(answerMemoryQuery("what car do I have?", en, "en")).toContain("Toyota");
    expect(answerMemoryQuery("what's my favorite color?", en, "en")).toContain("blue");
    expect(answerMemoryQuery("where do I live?", en, "en")).toContain("Tucson");
  });
  it("PT: carro, cor favorita e moradia respondem do guardado", () => {
    expect(answerMemoryQuery("qual carro eu tenho?", pt, "pt")).toContain("Toyota");
    expect(answerMemoryQuery("qual é minha cor favorita?", pt, "pt")).toContain("azul");
    expect(answerMemoryQuery("onde moro?", pt, "pt")).toContain("Tucson");
  });
  it("ES: el favorito también pasa por la búsqueda genérica", () => {
    const es: MemoryQueryData = {
      facts: [{ content: "mi color favorito es el azul", category: "preference" }],
      people: [],
    };
    expect(answerMemoryQuery("¿cuál es mi color favorito?", es, "es")).toContain("azul");
  });
});

// 0.1.23: la sonda de la puerta (ChatScreen) reutiliza la puntuación de
// la rama genérica. Una sola fuente: scoreMemoryFacts elige el hecho
// que la rama 5 cita Y alimenta memoryGateHit, para que puerta y
// respuesta nunca discrepen. Umbral aprobado: score >= 2, o score == 1
// cuando la pregunta tiene un único término de contenido.
describe("0.1.23 — scoreMemoryFacts / memoryGateHit / forma genérica", () => {
  it("scoreMemoryFacts devuelve el mejor hecho, su score y el conteo de términos", () => {
    expect(scoreMemoryFacts(MEM, "¿cuál es mi color favorito?")).toEqual({
      fact: "mi color favorito es el azul",
      score: 2,
      tokenCount: 2,
    });
    expect(scoreMemoryFacts(MEM, "¿dónde vivo?")).toEqual({
      fact: "vivo en Tucson",
      score: 1,
      tokenCount: 1,
    });
    expect(scoreMemoryFacts(MEM, "¿qué coche tengo?")).toEqual({
      fact: "mi coche es un Toyota",
      score: 1,
      tokenCount: 1,
    });
  });

  it("sin coincidencia: fact null y score 0; stopwords y tokens cortos no cuentan", () => {
    const r = scoreMemoryFacts(MEM, "¿qué dice mi documento sobre la renovación?");
    expect(r.fact).toBeNull();
    expect(r.score).toBe(0);
    expect(r.tokenCount).toBe(3); // dice, documento, renovacion
    // «tengo» es stopword y «qué» también: solo queda «coche».
    expect(scoreMemoryFacts(MEM, "¿qué coche tengo?").tokenCount).toBe(1);
  });

  it("memoryGateHit: score 2 entra; score 1 con término único entra", () => {
    expect(memoryGateHit("¿cuál es mi color favorito?", MEM)).toBe(true);
    expect(memoryGateHit("¿dónde vivo?", MEM)).toBe(true);
    expect(memoryGateHit("¿qué coche tengo?", MEM)).toBe(true);
  });

  it("memoryGateHit: score 1 con varios términos NO entra (documentos/charla a salvo)", () => {
    // El hecho comparte UN término («documento») con la pregunta de la
    // guía, pero la pregunta trae 3 términos: no es hit de puerta.
    const mem: MemoryQueryData = {
      facts: [{ content: "mi documento importante es azul", category: "general" }],
      people: [],
    };
    expect(scoreMemoryFacts(mem, "¿qué dice mi documento sobre la renovación?").score).toBe(1);
    expect(memoryGateHit("¿qué dice mi documento sobre la renovación?", mem)).toBe(false);
    expect(memoryGateHit("¿qué tengo que hacer para aprender inglés?", MEM)).toBe(false);
  });

  it("memoryGateHit: score 0 o memoria vacía, no entra", () => {
    expect(memoryGateHit("¿cuál es mi color favorito?", { facts: [], people: [] })).toBe(false);
    expect(memoryGateHit("¿cuál es mi banco?", MEM)).toBe(false);
  });

  it("isGenericMemoryQuestionShape: interrogativa + primera persona (el guardia de la rama 5)", () => {
    for (const q of [
      "¿cuál es mi color favorito?",
      "¿dónde vivo?",
      "¿qué coche tengo?",
      "What's my favorite color?",
      "Where do I live?",
      "What car do I have?",
      "Qual é a minha cor favorita?",
      "Onde eu moro?",
      // La forma SÍ caza las frases de documentos y de charla: lo que
      // las rechaza es el hit, no la forma (diseño §3).
      "¿qué dice mi documento sobre la renovación?",
      "¿qué tengo que hacer para aprender inglés?",
    ]) {
      expect(isGenericMemoryQuestionShape(q)).toBe(true);
    }
    for (const q of [
      "Mi color favorito es el verde", // afirmación, no pregunta
      "¿cuál es la capital de Francia?", // pregunta sin primera persona
      "¿qué hora es?",
      "cuéntame un chiste",
      "",
    ]) {
      expect(isGenericMemoryQuestionShape(q)).toBe(false);
    }
  });
});
