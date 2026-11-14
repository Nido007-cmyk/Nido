/**
 * CL-12 (caza 0.1.97) · Recuperación sucia: la pata léxica cruzaba
 * idiomas por prefijos y el chunk solo léxico no tenía puerta
 * absoluta tras la fusión.
 *
 * Caso semilla (aparato del dueño, 0.1.96): a «Como cambio la llanta
 * de un carro», tras la guía correcta entraron «Cambodia» (cambodia /
 * cambodian casaban con camb*, carried con carr*) y «River Severn»
 * (cambrian con camb*, llanidloes con llan*) como fuentes 2 y 3.
 */
import { describe, it, expect } from "vitest";
import {
  buildLexicalQuery,
  countMatchedTerms,
  countExactMatchedTerms,
  detectLexicalLang,
  filterByTermCoverage,
  fuseRetrievalResults,
} from "./pure";
import type { RetrievedChunk } from "./retrieve.types";

const LLANTA_Q = "Como cambio la llanta de un carro";

const GUIA_LLANTA = {
  title: "Avería en carretera",
  body:
    "Para cambiar la llanta de un carro, primero apaga el motor y pon el freno de mano. " +
    "Afloja las tuercas de la llanta con la llave de cruz, levanta el carro con el gato y " +
    "cambia la rueda por la de repuesto. Aprieta las tuercas en cruz y baja el carro con cuidado.",
};

const CAMBODIA = {
  title: "Cambodia",
  body:
    "Cambodia is a country in Southeast Asia. The Cambodian people have carried their " +
    "culture through a long history, and the kingdom is known for its temples and rivers. " +
    "The capital is Phnom Penh and the country is bordered by Thailand and Vietnam.",
};

const SEVERN = {
  title: "River Severn",
  body:
    "The River Severn is the longest river in Great Britain. It rises in the Cambrian " +
    "Mountains near Llanidloes and flows through Shrewsbury and Worcester before it " +
    "reaches the Bristol Channel. The river is known for its tidal bore.",
};

describe("CL-12 · detectLexicalLang", () => {
  it("detecta el idioma de la pregunta semilla", () => {
    expect(detectLexicalLang(LLANTA_Q)).toBe("es");
    expect(buildLexicalQuery(LLANTA_Q)?.lang).toBe("es");
  });

  it("detecta inglés y portugués; sin señal suficiente no dice nada", () => {
    expect(detectLexicalLang("What is the best way to change the tyre on the car")).toBe("en");
    expect(detectLexicalLang("Como troco o pneu de um carro")).toBe("pt");
    expect(detectLexicalLang("paracetamol")).toBeNull();
  });
});

describe("CL-12 · filterByTermCoverage con disciplina de idioma", () => {
  it("la guía en el idioma de la pregunta pasa; el ruido extranjero por prefijos, no", () => {
    const q = buildLexicalQuery(LLANTA_Q)!;
    // Sin disciplina, Cambodia alcanzaba la cobertura solo por prefijos.
    expect(countMatchedTerms(`${CAMBODIA.title} ${CAMBODIA.body}`, q.terms)).toBeGreaterThanOrEqual(2);
    expect(countExactMatchedTerms(`${CAMBODIA.title} ${CAMBODIA.body}`, q.terms)).toBe(0);
    const kept = filterByTermCoverage([GUIA_LLANTA, CAMBODIA, SEVERN], q.terms, q.lang);
    expect(kept).toEqual([GUIA_LLANTA]);
  });

  it("sin idioma de la pregunta, manda la regla de cobertura de siempre", () => {
    const q = buildLexicalQuery(LLANTA_Q)!;
    const kept = filterByTermCoverage([CAMBODIA], q.terms, null);
    expect(kept).toEqual([CAMBODIA]);
  });

  it("un acierto extranjero con cobertura total por formas exactas sigue pasando (cognados)", () => {
    const q = buildLexicalQuery("que es el paracetamol y la dosis")!;
    expect(q.lang).toBe("es");
    expect(q.terms).toHaveLength(2);
    const hit = {
      title: "Paracetamol dosis",
      body: "This article is about the medicine and how the dose is measured in the hospital for the patient and the family.",
    };
    expect(detectLexicalLang(`${hit.title} ${hit.body}`)).toBe("en");
    expect(filterByTermCoverage([hit], q.terms, q.lang)).toEqual([hit]);
  });

  it("el puente de prefijo en el mismo idioma sigue vivo (quemo → quemaduras)", () => {
    const q = buildLexicalQuery("se quemo un adulto")!;
    const hit = {
      title: "Quemaduras",
      body:
        "Las quemaduras en adultos se tratan con agua fresca durante varios minutos. " +
        "Si salen ampollas grandes o la zona duele mucho, hay que buscar ayuda medica.",
    };
    expect(filterByTermCoverage([hit], q.terms, q.lang)).toEqual([hit]);
  });
});

describe("CL-12 · puerta absoluta post-fusión sin exención léxica", () => {
  const chunk = (id: string, coverage?: number): RetrievedChunk => ({
    chunkId: id,
    docId: id,
    title: `Titulo ${id}`,
    body: "cuerpo",
    score: 10,
    matchType: "lexical",
    ...(coverage !== undefined ? { termCoverage: coverage } : {}),
  });

  it("media cobertura exacta no basta para un chunk solo léxico; más de la mitad, sí", () => {
    const fused = fuseRetrievalResults([chunk("mitad", 0.5), chunk("dos-tercios", 2 / 3)], [], 6);
    expect(fused.map((c) => c.chunkId)).toEqual(["dos-tercios"]);
  });

  it("sin cobertura estampada (fixtures viejos), el chunk léxico no cae por esta puerta", () => {
    const fused = fuseRetrievalResults([chunk("legado")], [], 6);
    expect(fused.map((c) => c.chunkId)).toEqual(["legado"]);
  });

  it("un chunk con rawScore semántico se sigue juzgando por su rawScore", () => {
    const sem: RetrievedChunk = {
      chunkId: "sem",
      docId: "sem",
      title: "Semantico",
      body: "cuerpo",
      score: 10,
      matchType: "semantic",
      termCoverage: 0,
    };
    // fuseRetrievalResults fija rawScore desde la lista semántica.
    const fused = fuseRetrievalResults([], [{ ...sem, score: 0.9 }], 6, undefined, 0.5);
    expect(fused.map((c) => c.chunkId)).toEqual(["sem"]);
  });
});
