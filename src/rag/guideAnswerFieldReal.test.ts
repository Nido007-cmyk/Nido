/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.89 — la revisión del bucle del gas con las listas REALES
 * que el aparato pudo tener (orden del dueño, 2026-11-09 13:17:
 * «Revisa bien el loop de las guías y todo eso»). La lección de
 * la 0.1.88: su regresión de campo ganó con scores puestos a
 * mano (el 131 a 1,0 y el 127 a 0,76, «el rango BM25
 * plausible») y el aparato la desmintió, porque el BM25 real
 * del pack pone el fragmento del monóxido primero. Aquí las
 * listas se CONSTRUYEN con las funciones reales de la casa
 * (normalizeCorpusScores sobre los ranks BM25 reales del
 * sqlite del dueño, fuseRetrievalResults para la fusión) y el
 * clúster es el extraído del pack real
 * (__fixtures__/salvoraGasClusterReal.ts: 23 fragmentos
 * fundados, 127 con bm25 −10,6672 y cobertura 3/3, 131 con
 * −9,3133 y 3/3). La competencia semántica usa los valores de
 * campo que la casa viene midiendo para ese turno (el Esencial
 * de monóxido a 0,85 y un ajeno a 0,91); los cosenos exactos
 * del aparato no son medibles sin él y quedan declarados en el
 * dirimen (research_notes/nido-gas-0.1.88-dirimen-2026-11-09.md).
 *
 * Las tres composiciones de la revisión: (1) el turno e5 con
 * la primera lista de 4, donde la lista solo trae el 127 del
 * pack y la guía de la fuga solo puede llegar por la pasada
 * ancha; (2) el turno e5 con la lista ancha ya fusionada,
 * donde el empate se decide dentro de la elección; (3) el
 * perfil bge, donde la elección la hace la vía de coseno con
 * los cosenos del campo de la 0.1.87. En las tres, la guía
 * servida tiene que ser la de la FUGA.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievedChunk } from "./retrieve.types";
import type { PackSourceDoc } from "./packSource";
import { guideTitleOf } from "./packSource";
import { MULTILINGUAL_E5_SMALL_PROFILE, BGE_SMALL_EN_PROFILE, type EmbeddingProfile } from "./embeddingProfile";
import { ANSWER_CONTEXT_CHUNKS, fuseRetrievalResults, normalizeCorpusScores } from "./pure";
import { GUIDE_PICK_CHUNKS, buildGuidePickCandidates } from "./guidePickCandidates";
import { SALVORA_GAS_CLUSTER_REAL } from "./__fixtures__/salvoraGasClusterReal";

const retrieveMock = vi.fn();
const readPackSourceMock = vi.fn();
const verifiedImportedPacksMock = vi.fn();
let activeProfile: EmbeddingProfile = MULTILINGUAL_E5_SMALL_PROFILE;
vi.mock("./retrieve", () => ({
  retrieve: (...a: unknown[]) => retrieveMock(...a),
  activeRetrievalProfile: () => activeProfile,
}));
vi.mock("./packs", () => ({ readPackSource: (...a: unknown[]) => readPackSourceMock(...a) }));
vi.mock("../services/packImporter", () => ({
  verifiedImportedPacks: (...a: unknown[]) => verifiedImportedPacksMock(...a),
}));

import { answerFromGuide } from "./guideAnswerRun";

const QUESTION = "Que hago si huele a gas en mi casa?";
const SALVORA = "local-salvora-emergencias-casa";
const SALVORA_NAME = "SALVORA Home Emergencies: fire, gas, water and home safety";

function baseChunk(partial: Partial<RetrievedChunk> & { title: string; body: string }): RetrievedChunk {
  return { score: 0, matchType: "lexical", ...partial } as RetrievedChunk;
}

/** La parte léxica del pack tal como sale de searchPacks: slice por el limit y normalización por pack. */
function packLexical(limit: number): RetrievedChunk[] {
  const raw = SALVORA_GAS_CLUSTER_REAL.slice(0, limit).map((c) =>
    baseChunk({
      chunkId: `pack:${SALVORA}:${c.id}`,
      docId: `pack:${SALVORA}:${c.title}`,
      title: c.title,
      body: c.body,
      keys: c.keys,
      sourceKind: "pack",
      score: -c.bm25Rank,
      matchType: "lexical",
    }),
  );
  return normalizeCorpusScores(raw);
}

/** La parte léxica de la base integrada: su propio corpus, normalizado como en lexicalSearch. */
function builtinLexical(): RetrievedChunk[] {
  const raw = [
    baseChunk({ chunkId: "corpus:base:11", title: "Seguridad en el hogar: revisión anual de aparatos", body: "Revisa cada año los aparatos de la casa y guarda sus manuales.", score: 5.2, sourceKind: "builtin" }),
    baseChunk({ chunkId: "corpus:base:12", title: "El clima del desierto en verano", body: "El calor del desierto exige agua y sombra.", score: 3.1, sourceKind: "builtin" }),
    baseChunk({ chunkId: "corpus:base:13", title: "Recetas con garbanzos", body: "Los garbanzos se remojan la noche anterior.", score: 1.4, sourceKind: "builtin" }),
  ];
  return normalizeCorpusScores(raw);
}

/** La competencia semántica del turno e5, con los cosenos de campo de la casa. */
const SEMANTIC_E5: RetrievedChunk[] = [
  baseChunk({
    chunkId: "pack:nido-esencial-e5:253",
    title: "Intoxicaciones, venenos y monóxido de carbono — Monóxido de carbono (CO)",
    body: "El monóxido de carbono es un gas invisible e inodoro que se produce al quemar combustible. Los síntomas son dolor de cabeza, mareo y náusea.",
    score: 0.85,
    matchType: "semantic",
  }),
  baseChunk({
    chunkId: "corpus:base:99",
    title: "Nota general de mantenimiento del hogar",
    body: "Revisa cada año las instalaciones de la casa y guarda los manuales de los aparatos.",
    score: 0.91,
    matchType: "semantic",
  }),
];

/** La lista fusionada que retrieve(topK) habría devuelto, construida con la fusión real. */
function fusedList(topK: number): RetrievedChunk[] {
  return fuseRetrievalResults(
    [...builtinLexical(), ...packLexical(topK * 2)],
    SEMANTIC_E5,
    topK,
    undefined,
    MULTILINGUAL_E5_SMALL_PROFILE.minSimilarity,
  );
}

/** readPackSource honesto: la guía entera del fragmento, con sus partes del clúster real. */
function docFor(chunkId: string): PackSourceDoc | null {
  const id = Number(chunkId.split(":").pop());
  const self = SALVORA_GAS_CLUSTER_REAL.find((c) => c.id === id);
  if (!self) return null;
  const guide = guideTitleOf(self.title);
  return {
    title: guide,
    source: "SALVORA PACKS",
    parts: SALVORA_GAS_CLUSTER_REAL.filter((c) => guideTitleOf(c.title) === guide)
      .sort((a, b) => a.id - b.id)
      .map((c) => ({ id: c.id, body: c.body, used: c.id === id })),
  };
}

function expectGasGuide(out: { answer: { text: string; chunks: RetrievedChunk[] } | null }, label: string) {
  expect(out.answer, label).not.toBeNull();
  expect(out.answer!.chunks[0].chunkId, label).toBe(`pack:${SALVORA}:131`);
  expect(out.answer!.text, label).toContain("Fuga de gas: cómo reconocerla y salir a tiempo");
  expect(out.answer!.text, label).toContain(SALVORA_NAME);
  expect(out.answer!.text, label).toContain("salir a pie");
  expect(out.answer!.text, label).not.toContain("problemas de salud");
}

describe("0.1.89 — el bucle del gas con las listas reales del aparato", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeProfile = MULTILINGUAL_E5_SMALL_PROFILE;
    verifiedImportedPacksMock.mockResolvedValue(new Map([[SALVORA, { name: SALVORA_NAME }]]));
    readPackSourceMock.mockImplementation(async (chunkId: string) => docFor(chunkId));
  });

  it("las listas reales dejan el 127 por delante del 131 (la medición que el laboratorio no hizo)", () => {
    const first = fusedList(ANSWER_CONTEXT_CHUNKS);
    const wide = fusedList(GUIDE_PICK_CHUNKS);
    const candidates = buildGuidePickCandidates(first, wide);
    const ids = candidates.map((c) => c.chunkId);
    const at127 = ids.indexOf(`pack:${SALVORA}:127`);
    const at131 = ids.indexOf(`pack:${SALVORA}:131`);
    expect(at127).toBeGreaterThanOrEqual(0);
    expect(at131).toBeGreaterThan(at127);
    const s127 = candidates[at127].score;
    const s131 = candidates[at131].score;
    expect(s127).toBeGreaterThan(s131);
  });

  it("composición 1 · e5 con la primera lista de 4: la fuga llega por la pasada ancha y se sirve", async () => {
    const first = fusedList(ANSWER_CONTEXT_CHUNKS);
    const wide = fusedList(GUIDE_PICK_CHUNKS);
    retrieveMock.mockImplementation(async (_q: string, k: number) => (k >= GUIDE_PICK_CHUNKS ? wide : first));
    const out = await answerFromGuide(QUESTION, "es", QUESTION);
    expectGasGuide(out, "primera lista");
  });

  it("composición 2 · e5 con la lista ancha fusionada: el empate se resuelve por el signo", async () => {
    const wide = fusedList(GUIDE_PICK_CHUNKS);
    retrieveMock.mockResolvedValue(wide);
    const out = await answerFromGuide(QUESTION, "es", QUESTION);
    expectGasGuide(out, "lista ancha");
  });

  it("composición 3 · bge por coseno: la misma guía sale por la vía de coseno", async () => {
    activeProfile = BGE_SMALL_EN_PROFILE;
    const cosines: Record<number, number> = { 127: 0.71, 129: 0.66, 131: 0.76, 132: 0.74, 134: 0.67, 140: 0.65 };
    const withCosines = SALVORA_GAS_CLUSTER_REAL.filter((c) => c.id in cosines).map((c) =>
      baseChunk({
        chunkId: `pack:${SALVORA}:${c.id}`,
        docId: `pack:${SALVORA}:${c.title}`,
        title: c.title,
        body: c.body,
        keys: c.keys,
        sourceKind: "pack",
        score: cosines[c.id],
        rawScore: cosines[c.id],
        matchType: "semantic",
      }),
    );
    retrieveMock.mockResolvedValue(withCosines);
    const out = await answerFromGuide(QUESTION, "es", QUESTION);
    expectGasGuide(out, "bge coseno");
  });
});
