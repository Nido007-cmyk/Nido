/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  detectTextLang,
  isAbstention,
  isFactualQuestion,
  noSourcesAnswer,
  sentenceSupport,
  splitSentences,
  stripInvalidCitations,
  verifyGroundedAnswer,
  type GroundingChunk,
} from "./grounding";

// Texto REAL de la fuente que el RAG recuperó en la tablet (81%):
// assets/corpus/corpus.json, entrada "Photosynthesis" (Wikipedia, CC BY-SA).
const PHOTOSYNTHESIS: GroundingChunk = {
  title: "Photosynthesis",
  body:
    "Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms, " +
    "such as most plants, algae and cyanobacteria, convert light energy—typically from sunlight—into the chemical " +
    "energy necessary to fuel their metabolism. The term photosynthesis usually refers to oxygenic photosynthesis, " +
    "a process that releases oxygen as a byproduct of water splitting. Photosynthetic organisms store the converted " +
    "chemical energy within the bonds of intracellular organic compounds, typically carbohydrates like sugars, " +
    "starches, phytoglycogen and cellulose. When needing to use this stored energy, an organism's cells then " +
    "metabolize the organic compounds through cellular respiration. Photosynthesis plays a critical role in " +
    "producing and maintaining the oxygen content of the Earth's atmosphere, and it supplies most of the " +
    "biological energy necessary for complex life on Earth.",
};

// Segunda fuente (77%): resumen del artículo "Chloroplast".
const CHLOROPLAST: GroundingChunk = {
  title: "Chloroplast",
  body:
    "A chloroplast is a type of organelle known as a plastid that conducts photosynthesis mostly in plant and " +
    "algal cells. Chloroplasts have a high concentration of chlorophyll pigments which capture the energy from " +
    "sunlight and convert it to chemical energy and release oxygen.",
};

const SOURCES = [PHOTOSYNTHESIS, CHLOROPLAST];

// Respuesta reconstruida de la evidencia física (Qwen2.5-0.5B, v0.1.6).
const HALLUCINATED =
  "Photosynthesis is the process by which plants convert light energy into chemical energy [1]. " +
  "Plants absorb sunlight in a process called phototropism. " +
  "The light is transported to the roots. " +
  "Water is absorbed by the leaves. " +
  "In conclusion, photosynthesis is just a small part of the broader process of photosynthesis.";

describe("verifyGroundedAnswer — evidencia de la fotosíntesis", () => {
  const r = verifyGroundedAnswer(HALLUCINATED, SOURCES, "en");

  it("quita las 4 afirmaciones inventadas y conserva la respaldada", () => {
    expect(r.status).toBe("partial");
    expect(r.removed).toBe(4);
    expect(r.kept).toBe(1);
  });

  it.each(["phototropism", "roots", "absorbed by the leaves", "broader process"])(
    "la respuesta final ya no dice %p",
    (bad) => {
      expect(r.text).not.toContain(bad);
    },
  );

  it("conserva lo que sí dice la fuente, con su cita, y avisa de lo quitado", () => {
    expect(r.text).toContain("convert light energy into chemical energy [1]");
    expect(r.text).toContain("I removed 4 sentence(s) that the offline sources don't support.");
  });

  it("cada frase inventada, por separado, no tiene respaldo suficiente", () => {
    // Una respuesta de una sola frase inventada → abstención honesta.
    for (const s of [
      "Plants absorb sunlight in a process called phototropism.",
      "The light is transported to the roots.",
      "Water is absorbed by the leaves.",
    ]) {
      expect(verifyGroundedAnswer(s, SOURCES, "en").status).toBe("abstained");
    }
  });
});

describe("verifyGroundedAnswer — paráfrasis fieles NO se castigan", () => {
  it.each([
    "Photosynthesis converts light energy into chemical energy.",
    "It releases oxygen as a byproduct of water splitting.",
    "Plants, algae and cyanobacteria use photosynthesis to convert sunlight into chemical energy.",
    "Chloroplasts contain chlorophyll pigments that capture energy from sunlight.",
    "The stored energy is used later through cellular respiration.",
  ])("%p → grounded", (sentence) => {
    const r = verifyGroundedAnswer(sentence, SOURCES, "en");
    expect(r.status).toBe("grounded");
    expect(r.removed).toBe(0);
  });

  it("añade la cita de la fuente que respalda cada frase (enlace afirmación → fuente)", () => {
    const r = verifyGroundedAnswer(
      "Photosynthesis releases oxygen as a byproduct. Chloroplasts have a high concentration of chlorophyll pigments.",
      SOURCES,
      "en",
    );
    expect(r.text).toBe(
      "Photosynthesis releases oxygen as a byproduct [1]. Chloroplasts have a high concentration of chlorophyll pigments [2].",
    );
  });

  it("frases cortas sin contenido juzgable se dejan tal cual", () => {
    const r = verifyGroundedAnswer("Sure! Photosynthesis converts light energy into chemical energy [1].", SOURCES, "en");
    expect(r.status).toBe("grounded");
    expect(r.text.startsWith("Sure!")).toBe(true);
  });
});

describe("verifyGroundedAnswer — adversarial: las fuentes NO tienen la respuesta", () => {
  it("respuesta de memoria sobre otro tema → 'no lo sé' + extracto literal citado", () => {
    const r = verifyGroundedAnswer("France won the 2018 World Cup in Russia.", [PHOTOSYNTHESIS], "es");
    expect(r.status).toBe("abstained");
    expect(r.text).toContain("No lo sé con certeza");
    expect(r.text).not.toContain("France");
    expect(r.text).toContain("Esto es lo que sí dice la fuente «Photosynthesis»:");
    expect(r.text).toContain("Photosynthesis is a system of biological processes");
    expect(r.text).toMatch(/\[1\]$/);
  });

  it("el modelo dice no saber → abstención honesta (en / pt)", () => {
    const en = verifyGroundedAnswer("The sources don't mention who won the World Cup.", [PHOTOSYNTHESIS], "en");
    expect(en.status).toBe("abstained");
    expect(en.text.startsWith("I don't know for sure")).toBe(true);
    const pt = verifyGroundedAnswer("Não sei.", [PHOTOSYNTHESIS], "pt");
    expect(pt.status).toBe("abstained");
    expect(pt.text.startsWith("Não sei com certeza")).toBe(true);
  });

  it("'no lo sé' + invento detrás → se descarta el invento", () => {
    const r = verifyGroundedAnswer("I don't know. But France won the 2018 World Cup in Russia.", [PHOTOSYNTHESIS], "en");
    expect(r.status).toBe("abstained");
    expect(r.text).not.toContain("France");
  });

  it("todas las frases inventadas → abstención, nunca respuesta vacía", () => {
    const r = verifyGroundedAnswer(
      "The light is transported to the roots. Water is absorbed by the leaves.",
      SOURCES,
      "en",
    );
    expect(r.status).toBe("abstained");
    expect(r.text.length).toBeGreaterThan(0);
  });
});

describe("verifyGroundedAnswer — idioma distinto al de las fuentes", () => {
  it("respuesta en español con fuentes en inglés: no se inventa un veredicto léxico", () => {
    const r = verifyGroundedAnswer(
      "La fotosíntesis convierte la energía de la luz en energía química y libera oxígeno [1].",
      SOURCES,
      "es",
    );
    expect(r.status).toBe("unverified");
    expect(r.text).toContain("libera oxígeno [1]");
  });

  it("…pero una cifra que no está en las fuentes sí se detecta (las cifras no tienen idioma)", () => {
    const r = verifyGroundedAnswer(
      "La fotosíntesis convierte la luz en energía química [1]. Apareció hace 3500 millones de años en los océanos.",
      SOURCES,
      "es",
    );
    expect(r.status).toBe("unverified");
    expect(r.removed).toBe(1);
    expect(r.text).not.toContain("3500");
    expect(r.text).toContain("Quité 1 frase(s)");
  });
});

describe("verifyGroundedAnswer — casos límite", () => {
  it("sin fuentes o respuesta vacía → skipped", () => {
    expect(verifyGroundedAnswer("Hola", [], "es").status).toBe("skipped");
    expect(verifyGroundedAnswer("   ", SOURCES, "es").status).toBe("skipped");
  });
  it("modelos razonadores (<think>) no se tocan", () => {
    const text = "<think>hmm</think>Photosynthesis is magic.";
    expect(verifyGroundedAnswer(text, SOURCES, "en")).toMatchObject({ status: "skipped", text });
  });
  it("quita citas a fuentes que no existen", () => {
    expect(stripInvalidCitations("A [1]. B [7]. C [0]. D [2].", 2)).toBe("A [1]. B. C. D [2].");
  });
});

describe("piezas internas", () => {
  it("splitSentences respeta citas y abreviaturas numéricas", () => {
    expect(splitSentences("Uno [1]. Dos. ¿Tres? 4 cuatro.")).toEqual(["Uno [1].", "Dos.", "¿Tres?", "4 cuatro."]);
  });
  it("detectTextLang distingue en / es / pt y no adivina con poco texto", () => {
    expect(detectTextLang("The term photosynthesis usually refers to the process that is used by plants")).toBe("en");
    expect(detectTextLang("La fotosíntesis es el proceso que usan las plantas para obtener energía")).toBe("es");
    expect(detectTextLang("A fotossíntese é o processo que as plantas usam para obter energia não")).toBe("pt");
    expect(detectTextLang("Hola")).toBeNull();
  });
  it("isAbstention reconoce el 'no lo sé' en los 3 idiomas", () => {
    for (const s of [
      "No lo sé.",
      "Las fuentes no mencionan eso.",
      "I don't know.",
      "The context does not mention it.",
      "Não sei.",
      "As fontes não falam disso.",
    ]) {
      expect(isAbstention(s)).toBe(true);
    }
    expect(isAbstention("Photosynthesis converts light.")).toBe(false);
  });
  it("sentenceSupport mide la fracción respaldada", () => {
    const sets = [new Set(["photosy", "light", "energy"])];
    const s = sentenceSupport("Photosynthesis uses light energy and magic dust.", sets);
    expect(s.total).toBe(5);
    expect(s.novel).toBe(2);
    expect(s.bestChunk).toBe(0);
  });
});

describe("isFactualQuestion / noSourcesAnswer (el 'no lo sé' antes de generar)", () => {
  it.each([
    "¿Qué es la fotosíntesis?",
    "quién fue Simón Bolívar",
    "¿Cuántos huesos tiene el cuerpo humano?",
    "What is photosynthesis?",
    "Who invented the telephone?",
    "how many moons does Mars have",
    "O que é fotossíntese?",
    "Quem descobriu o Brasil?",
  ])("%p es de hechos", (q) => {
    expect(isFactualQuestion(q)).toBe(true);
  });

  it.each([
    "escribe un poema sobre el mar",
    "write a short story about a cat",
    "what is your opinion on pizza",
    "cuéntame un chiste",
    "hola",
    "traduce 'gato' al inglés",
    "resume este texto",
  ])("%p NO es de hechos (el modelo puede contestar)", (q) => {
    expect(isFactualQuestion(q)).toBe(false);
  });

  it("respuesta honesta sin fuentes en los 3 idiomas", () => {
    expect(noSourcesAnswer("es")).toContain("prefiero no inventar");
    expect(noSourcesAnswer("en")).toContain("rather not make up");
    expect(noSourcesAnswer("pt")).toContain("prefiro não inventar");
  });
});
