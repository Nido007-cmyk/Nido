/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Procedencia por frase (regla R8): ninguna frase sin respaldo sale marcada
 * como «de las fuentes», y el resumen cuenta exactamente lo que hay.
 */
import { describe, expect, it } from "vitest";
import { verifyGroundedAnswer, MIN_SUPPORT, type GroundingChunk } from "./grounding";
import { countProvenance, summarizeProvenance, type SentenceProvenance } from "./provenance";
import { composeGuideAnswer, composeShortGuideAnswer, guideAnswerProvenance } from "./guideAnswer";

const PHOTOSYNTHESIS: GroundingChunk = {
  title: "Photosynthesis",
  body:
    "Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms, " +
    "such as most plants, algae and cyanobacteria, convert light energy—typically from sunlight—into the chemical " +
    "energy necessary to fuel their metabolism. The term photosynthesis usually refers to oxygenic photosynthesis, " +
    "a process that releases oxygen as a byproduct of water splitting.",
};
const CHLOROPLAST: GroundingChunk = {
  title: "Chloroplast",
  body:
    "A chloroplast is a type of organelle known as a plastid that conducts photosynthesis mostly in plant and " +
    "algal cells. Chloroplasts have a high concentration of chlorophyll pigments which capture the energy from " +
    "sunlight and convert it to chemical energy and release oxygen.",
};
const SOURCES = [PHOTOSYNTHESIS, CHLOROPLAST];

/** Invariante R8: toda frase «source» apunta a una fuente que existe y la respalda. */
function expectHonest(sentences: SentenceProvenance[], chunks: GroundingChunk[]) {
  for (const s of sentences) {
    if (s.origin.kind !== "source") continue;
    expect(s.origin.n).toBeGreaterThanOrEqual(1);
    expect(s.origin.n).toBeLessThanOrEqual(chunks.length);
    expect(s.origin.support).toBeGreaterThanOrEqual(MIN_SUPPORT);
  }
}

describe("procedencia en verifyGroundedAnswer", () => {
  it("respuesta con frases inventadas: solo la respaldada sale como fuente; la nota es texto fijo", () => {
    const answer =
      "Photosynthesis is the process by which plants convert light energy into chemical energy [1]. " +
      "Plants absorb sunlight in a process called phototropism. " +
      "The light is transported to the roots.";
    const r = verifyGroundedAnswer(answer, SOURCES, "en");
    expect(r.status).toBe("partial");
    const s = r.sentences!;
    expect(s.filter((x) => x.origin.kind === "source").length).toBe(1);
    expect(s.some((x) => /phototropism|roots/.test(x.text))).toBe(false);
    expect(s.at(-1)!.origin.kind).toBe("fixed");
    expectHonest(s, SOURCES);
  });

  it("cada frase del resultado está en el texto final, en orden", () => {
    const answer = "Chloroplasts capture energy from sunlight with chlorophyll pigments. Sure!";
    const r = verifyGroundedAnswer(answer, SOURCES, "en");
    let from = 0;
    for (const s of r.sentences!) {
      const at = r.text.indexOf(s.text, from);
      expect(at).toBeGreaterThanOrEqual(from);
      from = at + s.text.length;
    }
  });

  it("una frase demasiado corta para comprobar no se marca como fuente", () => {
    const r = verifyGroundedAnswer("Chloroplasts capture energy from sunlight with chlorophyll pigments. Sure!", SOURCES, "en");
    const short = r.sentences!.find((x) => x.text.startsWith("Sure"));
    expect(short?.origin).toEqual({ kind: "model", reason: "too-short-to-check" });
  });

  it("negación cambiada: la frase de la fuente sustituye a la del modelo y lo dice", () => {
    const chunk: GroundingChunk = {
      title: "Dolor de pecho",
      body: "Si es un adulto despierto, no es alérgico a la aspirina y no está sangrando, que mastique una aspirina.",
    };
    const r = verifyGroundedAnswer(
      "Si es un adulto despierto, no es alérgico a la aspirina y está sangrando, que mastique una aspirina.",
      [chunk],
      "es",
    );
    const fixed = r.sentences!.find((x) => x.origin.kind === "source");
    expect(fixed?.origin).toMatchObject({ kind: "source", n: 1, negationFixed: true });
    expect(fixed?.text).toContain("no está sangrando");
  });

  it("todo inventado: «no lo sé» + extracto literal de la fuente 1", () => {
    const r = verifyGroundedAnswer("The moon is made of cheese and orbits Mars every Tuesday.", SOURCES, "en");
    expect(r.status).toBe("abstained");
    expect(r.sentences!.map((x) => x.origin.kind)).toEqual(["abstain", "fixed", "source"]);
    expect(r.sentences![2].text).toContain("Photosynthesis is a system");
  });

  it("sin fuentes: todo es del modelo, salvo un «no lo sé»", () => {
    const r = verifyGroundedAnswer("The capital is Canberra. I don't know the population.", [], "en");
    expect(r.sentences!.map((x) => x.origin.kind)).toEqual(["model", "abstain"]);
  });

  it("idioma distinto: lo conservado es del modelo sin poder comprobarlo, nunca «fuente»", () => {
    const r = verifyGroundedAnswer("La fotosíntesis convierte la luz en energía química en las plantas.", SOURCES, "es");
    expect(r.status).toBe("unverified");
    expect(r.sentences!.every((x) => x.origin.kind !== "source")).toBe(true);
  });

  it("modelo razonador o respuesta vacía: sin procedencia (no se toca)", () => {
    expect(verifyGroundedAnswer("<think>…</think> hola", SOURCES, "en").sentences).toBeUndefined();
    expect(verifyGroundedAnswer("   ", SOURCES, "en").sentences).toBeUndefined();
  });
});

describe("resumen de una línea", () => {
  const s: SentenceProvenance[] = [
    { text: "a", origin: { kind: "guide" } },
    { text: "b", origin: { kind: "guide" } },
    { text: "c", origin: { kind: "guide" } },
    { text: "d", origin: { kind: "model", reason: "no-sources" } },
  ];
  it("cuenta y ordena: lo fiable primero, lo que no tiene fuente al final", () => {
    expect(summarizeProvenance(s, "es")).toBe("3 frases de la guía · 1 del modelo sin fuente");
    expect(summarizeProvenance(s, "en")).toBe("3 sentences from the guide · 1 from the model with no source");
    expect(summarizeProvenance(s, "pt")).toBe("3 frases do guia · 1 do modelo sem fonte");
  });
  it("vacío sin frases", () => {
    expect(summarizeProvenance([], "es")).toBe("");
    expect(countProvenance([]).model).toBe(0);
  });
  it("singular y plural", () => {
    expect(summarizeProvenance([{ text: "x", origin: { kind: "source", n: 1, support: 1 } }], "es")).toBe("1 de las fuentes");
  });
});


describe("procedencia de una respuesta de guía", () => {
  const doc = {
    title: "Quemaduras",
    source: "NIDO — Quemaduras (basado en: Cruz Roja)",
    parts: [
      { id: 1, used: true, body: "Enfriar pronto una quemadura con agua reduce el daño. Es lo más importante." },
      { id: 2, used: false, body: "Pasos\n1. Aleja a la persona del calor.\n2. Enfría con agua corriente." },
    ],
  };
  it("las partes son de la guía; encabezado, fuentes y «llama primero» son textos fijos", () => {
    const text = composeGuideAnswer(doc, "es");
    const p = guideAnswerProvenance(text);
    const guide = p.filter((x) => x.origin.kind === "guide").map((x) => x.text).join(" ");
    expect(guide).toContain("Enfriar pronto una quemadura");
    expect(guide).toContain("Enfría con agua corriente");
    const fixed = p.filter((x) => x.origin.kind === "fixed").map((x) => x.text);
    expect(fixed[0]).toMatch(/^Guía «Quemaduras»/);
    expect(fixed.some((t) => t.startsWith("Fuentes de la guía:"))).toBe(true);
    expect(fixed.at(-1)).toBe("Si alguien está en peligro, llama primero al número de emergencias.");
    expect(p.some((x) => x.origin.kind === "model" || x.origin.kind === "source")).toBe(false);
  });
  it("la versión corta también", () => {
    const p = guideAnswerProvenance(composeShortGuideAnswer(doc, "en"));
    expect(p[0].origin.kind).toBe("fixed");
    expect(p.filter((x) => x.origin.kind === "fixed").some((x) => x.text.startsWith("This is only the beginning"))).toBe(true);
    expect(p.some((x) => x.origin.kind === "guide")).toBe(true);
  });
});
