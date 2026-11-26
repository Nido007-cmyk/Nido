/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Tanda de precedencia de la guía (2026-11-25) · pieza 1.
//
// Foto del dueño (Tab A9+, 0.1.114 ×2 y 0.1.115 ×1): «Mi hijo
// se esta ahogando con un pedazo de comida» sirvió como fuente
// principal la guía equivocada «Fiebre según la edad en bebés
// y niños» al 86 %. El diagnóstico (CHECKPOINT-PRECEDENCIA-
// GUIA.md): la elección por coseno corona a la vecina de NIDO
// Niños porque la pregunta nombra a un niño (la capa B no la
// excluye) y ninguna puerta mira la guía servida bajo una
// emergencia DECLARADA. La cura: declarada la situación, la
// guía que se sirve es la de esa emergencia por su IDENTIDAD
// (título + claves v2, máximo único estricto — la misma
// elección que la puerta de coherencia ya juzga), o no se
// sirve ninguna y el turno sigue a la puerta (pieza 2).
//
// Aquí se prueba la vía real de la guía (answerFromGuide con
// la recuperación simulada tal como el aparato la trajo: la
// fiebre por encima del atragantamiento), para la frase del
// dueño y su familia en los tres idiomas, y los controles que
// no deben cambiar.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievedChunk } from "./retrieve.types";
import type { PackSourceDoc } from "./packSource";
import { BGE_SMALL_EN_PROFILE } from "./embeddingProfile";

const retrieveMock = vi.fn();
const readPackSourceMock = vi.fn();
const verifiedImportedPacksMock = vi.fn();
vi.mock("./retrieve", () => ({
  retrieve: (...a: unknown[]) => retrieveMock(...a),
  activeRetrievalProfile: () => BGE_SMALL_EN_PROFILE,
}));
vi.mock("./packs", () => ({ readPackSource: (...a: unknown[]) => readPackSourceMock(...a) }));
vi.mock("../services/packImporter", () => ({
  verifiedImportedPacks: (...a: unknown[]) => verifiedImportedPacksMock(...a),
}));

import { answerFromGuide } from "./guideAnswerRun";

const chunk = (id: string, title: string, body: string, rawScore: number, keys?: string): RetrievedChunk =>
  ({ chunkId: id, docId: id, title, body, score: 1, rawScore, matchType: "semantic", keys }) as RetrievedChunk;

// --- ES: la lista que el aparato trajo (fiebre 0,86 por encima) ---

const FIEBRE_ES = chunk(
  "pack:nido-ninos:12",
  "Fiebre según la edad en bebés y niños",
  "La fiebre en un bebé de menos de 3 meses con 38 °C o más es motivo de ir a urgencias ahora. Entre los 3 y los 6 meses, vigila 39 °C o más.",
  0.86,
  "qué temperatura es fiebre en un bebé | cuándo es peligrosa la fiebre según la edad | qué hago si mi bebé tiene 39 de fiebre | fiebre en niños de 2 años, cuándo ir a urgencias",
);
const ATRAG_ES = chunk(
  "pack:nido-esencial:5",
  "Atragantamiento en adultos, niños y bebés",
  "Si algo bloquea la garganta, la persona no puede respirar. Fíjate en esto: si tose con fuerza, está consiguiendo aire; si no puede hablar, toser ni respirar, o se lleva las manos al cuello, es grave.",
  0.82,
  "qué hago si mi hijo se atraganta con un trozo de comida | mi hijo se está atragantando y no puede toser | cómo se hace la maniobra de heimlich | mi bebé se está ahogando con algo | mi hijo se tragó una moneda y no puede respirar",
);
const WIKI_1 = chunk("pack:wiki-vital5:9", "Fiebre", "La fiebre es la elevación de la temperatura corporal.", 0.7);
const WIKI_2 = chunk("pack:wiki-vital5:10", "Primeros auxilios", "Los primeros auxilios son la ayuda inmediata.", 0.65);

const FIEBRE_DOC: PackSourceDoc = {
  title: "Fiebre según la edad en bebés y niños",
  source: "https://example.org/fiebre",
  parts: [
    { id: 1, body: "Qué hacer\nCon menos de 3 meses y 38 °C o más, ve a urgencias ahora.", used: true },
    { id: 2, body: "Qué no hacer\nNo le des aspirina.", used: false },
  ],
};
const ATRAG_DOC: PackSourceDoc = {
  title: "Atragantamiento en adultos, niños y bebés",
  source: "https://example.org/atragantamiento",
  parts: [
    { id: 1, body: "Si algo bloquea la garganta, la persona no puede respirar.", used: true },
    { id: 2, body: "Grave en adultos y niños mayores de 1 año\n1. Da 5 golpes fuertes entre los omóplatos con el talón de la mano.\n2. Si no sale, da 5 compresiones abdominales (maniobra de Heimlich).", used: false },
  ],
};

// --- EN ---

const FEVER_EN = chunk(
  "pack:nido-ninos:112",
  "Fever by age in babies and children",
  "A fever in a baby under 3 months with 100.4 °F or more is a reason to go to the emergency room now.",
  0.86,
  "what temperature is a fever in a baby | when is fever dangerous by age | what do i do if my baby has a fever of 102",
);
const CHOKING_EN = chunk(
  "pack:nido-esencial:105",
  "Choking in adults, children and babies",
  "If something blocks the throat, the person cannot breathe. Watch for this: if they cough forcefully, they are getting air.",
  0.82,
  "what do i do if my child is choking on food | how do i do the heimlich maneuver on an adult | what do i do if a baby is choking and cannot breathe | what do i do if someone is choking and can't cough",
);
const CHOKING_DOC_EN: PackSourceDoc = {
  title: "Choking in adults, children and babies",
  source: "https://example.org/choking",
  parts: [
    { id: 1, body: "If something blocks the throat, the person cannot breathe.", used: true },
    { id: 2, body: "Severe in adults and children over 1 year\n1. Give 5 sharp blows between the shoulder blades with the heel of your hand.", used: false },
  ],
};
const FEVER_DOC_EN: PackSourceDoc = {
  title: "Fever by age in babies and children",
  source: "https://example.org/fever",
  parts: [{ id: 1, body: "What to do\nUnder 3 months and 100.4 °F or more, go to the emergency room now.", used: true }],
};

// --- PT ---

const FEBRE_PT = chunk(
  "pack:nido-ninos:212",
  "Febre conforme a idade em bebês e crianças",
  "A febre em um bebê de menos de 3 meses com 38 °C ou mais é motivo para ir ao pronto-socorro agora.",
  0.86,
  "que temperatura é febre em um bebê | quando a febre é perigosa conforme a idade | o que faço se meu bebê está com 39 de febre",
);
const ENGASGO_PT = chunk(
  "pack:nido-esencial:205",
  "Engasgo em adultos, crianças e bebês",
  "Se algo bloqueia a garganta, a pessoa não consegue respirar. Repare nisto: se tosse com força, ela está conseguindo ar.",
  0.82,
  "meu filho engasgou com uma uva e não consegue tossir | como desengasgar um bebê | manobra de heimlich, como faz | alguém engasgou e não consegue falar nem respirar | um bebê engasgado, como desengasgar",
);
const ENGASGO_DOC_PT: PackSourceDoc = {
  title: "Engasgo em adultos, crianças e bebês",
  source: "https://example.org/engasgo",
  parts: [
    { id: 1, body: "Se algo bloqueia a garganta, a pessoa não consegue respirar.", used: true },
    { id: 2, body: "Grave em adultos e crianças maiores de 1 ano\n1. Dê 5 golpes fortes entre as omoplatas com a palma da mão.", used: false },
  ],
};
const FEBRE_DOC_PT: PackSourceDoc = {
  title: "Febre conforme a idade em bebês e crianças",
  source: "https://example.org/febre",
  parts: [{ id: 1, body: "O que fazer\nCom menos de 3 meses e 38 °C ou mais, vá ao pronto-socorro agora.", used: true }],
};

// --- CO (control: la familia de la capa fija no se mueve) ---

const CO_ES = chunk(
  "pack:nido-esencial:21",
  "Intoxicaciones, venenos y monóxido de carbono",
  "Si suena la alarma de monóxido de carbono, sal de la casa ahora y llama al número de emergencias desde fuera.",
  0.9,
  "suena la alarma de monóxido de carbono | qué hago si suena la alarma de monóxido | síntomas del monóxido de carbono",
);
const CO_DOC: PackSourceDoc = {
  title: "Intoxicaciones, venenos y monóxido de carbono",
  source: "https://example.org/monoxido",
  parts: [{ id: 1, body: "Monóxido de carbono\nSi suena la alarma, sal de la casa ahora.", used: true }],
};

const DOCS: Record<string, PackSourceDoc> = {
  [FIEBRE_ES.chunkId]: FIEBRE_DOC,
  [ATRAG_ES.chunkId]: ATRAG_DOC,
  [FEVER_EN.chunkId]: FEVER_DOC_EN,
  [CHOKING_EN.chunkId]: CHOKING_DOC_EN,
  [FEBRE_PT.chunkId]: FEBRE_DOC_PT,
  [ENGASGO_PT.chunkId]: ENGASGO_DOC_PT,
  [CO_ES.chunkId]: CO_DOC,
};

beforeEach(() => {
  vi.clearAllMocks();
  verifiedImportedPacksMock.mockResolvedValue(new Map());
  readPackSourceMock.mockImplementation(async (id: string) => DOCS[id] ?? null);
});

describe("pieza 1 · la frase del dueño y su familia (la recuperación del aparato)", () => {
  it("ES · la frase exacta del dueño sirve la guía de atragantamiento, no la de fiebre", async () => {
    retrieveMock.mockResolvedValue([FIEBRE_ES, ATRAG_ES, WIKI_1, WIKI_2]);
    const out = await answerFromGuide("Mi hijo se esta ahogando con un pedazo de comida", "es");
    expect(out.answer).not.toBeNull();
    expect(out.answer?.chunks[0]?.chunkId).toBe(ATRAG_ES.chunkId);
    expect(out.answer?.text).toContain("Atragantamiento en adultos, niños y bebés");
    expect(out.answer?.text).not.toContain("Fiebre según la edad");
    expect(readPackSourceMock).toHaveBeenCalledWith(ATRAG_ES.chunkId);
  });

  it("ES · otra forma de la familia («mi bebé se está ahogando») también elige por identidad", async () => {
    retrieveMock.mockResolvedValue([FIEBRE_ES, ATRAG_ES, WIKI_1, WIKI_2]);
    const out = await answerFromGuide("Mi bebé se está ahogando con algo", "es");
    expect(out.answer?.chunks[0]?.chunkId).toBe(ATRAG_ES.chunkId);
    expect(out.answer?.text).not.toContain("Fiebre según la edad");
  });

  it("ES · sin la guía de atragantamiento en la lista, no se sirve ninguna (el turno sigue a la puerta)", async () => {
    retrieveMock.mockResolvedValue([FIEBRE_ES, WIKI_1, WIKI_2]);
    const out = await answerFromGuide("Mi hijo se esta ahogando con un pedazo de comida", "es");
    expect(out.answer).toBeNull();
    expect(out.retrieved).toEqual([FIEBRE_ES, WIKI_1, WIKI_2]);
    expect(readPackSourceMock).not.toHaveBeenCalled();
  });

  it("EN · the owner's family in English serves the choking guide, not the fever guide", async () => {
    retrieveMock.mockResolvedValue([FEVER_EN, CHOKING_EN, WIKI_1, WIKI_2]);
    const out = await answerFromGuide("My son is choking on a piece of food", "en");
    expect(out.answer).not.toBeNull();
    expect(out.answer?.chunks[0]?.chunkId).toBe(CHOKING_EN.chunkId);
    expect(out.answer?.text).toContain("Choking in adults, children and babies");
    expect(out.answer?.text).not.toContain("Fever by age");
  });

  it("PT · a forma da família nas palavras do próprio guia serve o guia de engasgo", async () => {
    retrieveMock.mockResolvedValue([FEBRE_PT, ENGASGO_PT, WIKI_1, WIKI_2]);
    const out = await answerFromGuide("Meu filho engasgou com uma uva e não consegue tossir", "pt");
    expect(out.answer).not.toBeNull();
    expect(out.answer?.chunks[0]?.chunkId).toBe(ENGASGO_PT.chunkId);
    expect(out.answer?.text).toContain("Engasgo em adultos, crianças e bebês");
    expect(out.answer?.text).not.toContain("Febre conforme a idade");
  });
});

describe("pieza 1 · controles que no deben cambiar", () => {
  it("la pregunta de guía sin emergencia se sirve como siempre (la pieza no corre)", async () => {
    retrieveMock.mockResolvedValue([ATRAG_ES, WIKI_1]);
    const out = await answerFromGuide("¿Cómo se hace la maniobra de Heimlich?", "es");
    expect(out.answer).not.toBeNull();
    expect(out.answer?.chunks[0]?.chunkId).toBe(ATRAG_ES.chunkId);
  });

  it("la pregunta de prevención se sirve como siempre (la puerta no declara: la pieza no corre)", async () => {
    const prev = chunk(
      "pack:nido-esencial:5",
      "Atragantamiento en adultos, niños y bebés",
      ATRAG_ES.body,
      0.88,
      ATRAG_ES.keys,
    );
    retrieveMock.mockResolvedValue([prev, WIKI_1]);
    const out = await answerFromGuide("¿Cómo puedo evitar que mi hijo se atragante con la comida?", "es");
    expect(out.answer).not.toBeNull();
    expect(out.answer?.chunks[0]?.chunkId).toBe(prev.chunkId);
  });

  it("la familia del monóxido: su guía se sirve igual por esta vía (su capa es la fija, en ChatScreen)", async () => {
    retrieveMock.mockResolvedValue([CO_ES, FIEBRE_ES, WIKI_1]);
    const out = await answerFromGuide("Está sonando la alarma de monóxido de carbono ahorita", "es");
    expect(out.answer).not.toBeNull();
    expect(out.answer?.chunks[0]?.chunkId).toBe(CO_ES.chunkId);
    expect(out.answer?.text).toContain("Intoxicaciones, venenos y monóxido de carbono");
  });
});
