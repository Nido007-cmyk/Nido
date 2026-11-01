/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * P-01 paso 1 · La sonda de aptitud, fixturada como puerta de entrada.
 *
 * La sonda original (`nido-prep-p01-sonda-2026-11-01.md`) corrió fuera del
 * árbol sobre el tip `f34c269` y dejó el veredicto APTA CON NOMBRES: p99 de
 * |Δcos| 0,000774 contra la barra 0,01; máximo 0,001103 contra 0,015; cero
 * cambios del conjunto servido en 28/28 corridas; 20/20 esperados servidos
 * en ambos brazos; un único intercambio de orden dentro del conjunto
 * (S12c/bge, hueco fundido 0,00001), fijado como clase esperada.
 *
 * Su banco vivía en /tmp y se perdió con los vaciados de /tmp del día;
 * este fichero lo RECONSTRUYE desde el diseño escrito de aquel papel
 * (mismos escenarios, mismas colocaciones relativas a los pisos de cada
 * perfil, misma construcción a coseno exacto `v = t·q̂ + √(1−t²)·u` con
 * PRNG determinista, misma cadena real) y lo fija como fixture permanente:
 * la puerta se re-corre sobre cada tip, no se hereda de la foto. Las
 * barras que gobiernan son las selladas (p99 ≤ 0,01 · máximo < 0,015 ·
 * cero cambios de conjunto sin nombre), no las cifras históricas.
 *
 * Cadena real, sin excepción en la decisión: `cosineSimilarity`,
 * `cosineSimilarityInt8`, `distinctFloor`, `filterByMinScore`,
 * `pruneSemanticByMargin` y `fuseRetrievalResults` de ./pure, los pisos
 * de ./embeddingProfile, y la cuantización real de la build de packs
 * (`quantizeInt8` de scripts/lib/knowledge-pack-lib.mjs). La consulta
 * queda en float32 en ambos brazos: lo que se cuantiza es lo ALMACENADO.
 * El pegamento replica `semanticSearch` (retrieve.ts): puntuar → ordenar
 * → piso con distintividad → filtro → poda por margen → corte a 12, y la
 * fusión con topK = 6 y `minRawScore` = el piso del perfil.
 */

import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  cosineSimilarityInt8,
  distinctFloor,
  filterByMinScore,
  pruneSemanticByMargin,
  fuseRetrievalResults,
} from "./pure";
import {
  BGE_SMALL_EN_PROFILE,
  MULTILINGUAL_E5_SMALL_PROFILE,
  semanticFloor,
  type EmbeddingProfile,
} from "./embeddingProfile";
import { quantizeInt8 } from "../../scripts/lib/knowledge-pack-lib.mjs";
import type { RetrievedChunk } from "./retrieve.types";

const DIM = 384;
const P99_BAR = 0.01;
const MAX_BAR = 0.015;
/** La clase nombrada: intercambio de orden SOLO con hueco fundido menor. */
const NAMED_SWAP_GAP = 0.002;

// ---------------------------------------------------------------------------
// Construcción determinista del corpus (mulberry32 + gaussiana Box-Muller)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * mul;
    return u * mul;
  };
}

function unitGaussianDirection(gauss: () => number): Float64Array {
  const v = new Float64Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    v[i] = gauss();
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

/** Vector a coseno EXACTO `t` contra `q`: v = t·q̂ + √(1−t²)·u, u ⊥ q̂ unidad. */
function vectorAtCosine(q: Float64Array, t: number, gauss: () => number): Float32Array {
  const g = new Float64Array(DIM);
  let dot = 0;
  for (let i = 0; i < DIM; i++) {
    g[i] = gauss();
    dot += g[i] * q[i];
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    g[i] -= dot * q[i];
    norm += g[i] * g[i];
  }
  norm = Math.sqrt(norm);
  const rest = Math.sqrt(Math.max(0, 1 - t * t));
  const out = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) out[i] = t * q[i] + rest * (g[i] / norm);
  return out;
}

function quantizeOne(vec: Float32Array): Uint8Array {
  const { data } = quantizeInt8(vec, DIM);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

// ---------------------------------------------------------------------------
// Escenarios: las colocaciones son relativas al piso del perfil salvo donde
// el diseño las fija absolutas (S8 distintividad, S9 poda, S10 corte, S11
// reserva). `expected` = el trozo diseñado para servirse en AMBOS brazos.
// ---------------------------------------------------------------------------

type SourceKind = "user" | "builtin" | "pack";

interface DesignedChunk {
  id: string;
  target: number;
  sourceKind: SourceKind;
  expected?: boolean;
}

interface Scenario {
  id: string;
  query: string;
  designed: (profile: EmbeddingProfile, floor: number) => DesignedChunk[];
  fillerCount: number;
  /** Banda de rellenos bajo el piso; null = el escenario trae su propio fondo (S8, S12). */
  fillerBand: ((floor: number) => [number, number]) | null;
  /** Objetivos absolutos en orden (S8: la rampa; S12: la banda uniforme). */
  absoluteTargets?: (rng: () => number) => number[];
  /** Pata léxica construida (solo S11, la reserva): id → puntuación cruda. */
  lexicalRaw?: Record<string, number>;
}

const belowFloor = (floor: number): [number, number] => [floor - 0.3, floor - 0.03];

const SCENARIOS: Scenario[] = [
  {
    id: "S1",
    query: "¿En qué sala?",
    // Piso de un término: correcto a +0,015; un vecino a +0,002 que la poda
    // retira en ambos brazos (cutoff 0,8798 en la foto de la sonda, e5);
    // dos colocados bajo el piso.
    designed: (_p, F) => [
      { id: "cita", target: F + 0.015, sourceKind: "user", expected: true },
      { id: "vecino", target: F + 0.002, sourceKind: "builtin" },
      { id: "bajo1", target: F - 0.005, sourceKind: "builtin" },
      { id: "bajo2", target: F - 0.025, sourceKind: "builtin" },
    ],
    fillerCount: 60,
    fillerBand: belowFloor,
  },
  {
    id: "S2",
    query: "¿Cuál es el número de la clínica?",
    // El par casi empatado teléfono/tarjeta a Δ=0,005; expediente sobre el piso.
    designed: (_p, F) => [
      { id: "telefono", target: F + 0.1, sourceKind: "user", expected: true },
      { id: "tarjeta", target: F + 0.095, sourceKind: "builtin" },
      { id: "expediente", target: F + 0.01, sourceKind: "builtin" },
      { id: "otro", target: F + 0.005, sourceKind: "builtin" },
    ],
    fillerCount: 60,
    fillerBand: belowFloor,
  },
  {
    id: "S3",
    query: "oye, ¿a qué hora es la cita del martes?",
    // Forma de dictado; distractor a +0,005 (bge) / +0,002 (e5) del piso.
    designed: (p, F) => [
      { id: "cita", target: F + 0.05, sourceKind: "user", expected: true },
      { id: "distractor", target: F + (p.id === "bge-small-en" ? 0.005 : 0.002), sourceKind: "builtin" },
    ],
    fillerCount: 60,
    fillerBand: belowFloor,
  },
  {
    id: "S4",
    query: "¿número de emergencias en México?",
    // El par de la inversión C-02: la guía 911 contra el cactus, a Δ=0,005.
    designed: (_p, F) => [
      { id: "guia911", target: F + 0.08, sourceKind: "builtin", expected: true },
      { id: "cactus", target: F + 0.075, sourceKind: "builtin" },
    ],
    fillerCount: 60,
    fillerBand: belowFloor,
  },
  {
    id: "S5",
    query: "what is the emergency number in Mexico?",
    designed: (_p, F) => [
      { id: "guia", target: F + 0.08, sourceKind: "builtin", expected: true },
      { id: "vecina", target: F + 0.073, sourceKind: "builtin" },
    ],
    fillerCount: 60,
    fillerBand: belowFloor,
  },
  {
    id: "S6",
    query: "qual é o número de emergência no México?",
    designed: (_p, F) => [
      { id: "guia", target: F + 0.08, sourceKind: "builtin", expected: true },
      { id: "vecina", target: F + 0.07, sourceKind: "builtin" },
    ],
    fillerCount: 60,
    fillerBand: belowFloor,
  },
  {
    id: "S7",
    query: "¿cuánto jarabe le doy?",
    // La cima casi empatada: dosis contra jarabe vecino a Δ=0,002/0,0015.
    designed: (p, F) => [
      { id: "dosis", target: F + 0.08, sourceKind: "user", expected: true },
      { id: "jarabeVecino", target: F + 0.08 - (p.id === "bge-small-en" ? 0.002 : 0.0015), sourceKind: "builtin" },
    ],
    fillerCount: 60,
    fillerBand: belowFloor,
  },
  {
    id: "S8",
    query: "¿a qué hora abre la farmacia de la esquina?",
    // Distintividad (e5): 64 rellenos en rampa fijan el fondo; X sobre el
    // piso efectivo (~0,863), Y a −0,0023 de él. Objetivos absolutos.
    designed: () => [
      { id: "equis", target: 0.866, sourceKind: "builtin", expected: true },
      { id: "ye", target: 0.8565, sourceKind: "builtin" },
    ],
    fillerCount: 64,
    fillerBand: null,
    absoluteTargets: () => Array.from({ length: 64 }, (_, i) => 0.86 - i * (0.06 / 63)),
  },
  {
    id: "S9",
    query: "¿qué día y en qué sala es la cita?",
    // Poda por margen: el borde a +0,0015 del cutoff de cada perfil
    // (bge: cutoff 0,814 con [0,95 · 0,8155 · 0,61]; e5: 0,896 con
    // [0,94 · 0,8975 · 0,83]).
    designed: (p) =>
      p.id === "bge-small-en"
        ? [
            { id: "lider", target: 0.95, sourceKind: "user", expected: true },
            { id: "borde", target: 0.8155, sourceKind: "user", expected: true },
            { id: "bajo", target: 0.61, sourceKind: "builtin" },
          ]
        : [
            { id: "lider", target: 0.94, sourceKind: "user", expected: true },
            { id: "borde", target: 0.8975, sourceKind: "user", expected: true },
            { id: "bajo", target: 0.83, sourceKind: "builtin" },
          ],
    fillerCount: 60,
    fillerBand: belowFloor,
  },
  {
    id: "S10",
    query: "¿qué dice la nota del doctor?",
    // Corte del límite (12): 14 sobre el piso; el par 12/13 a Δ=0,0005;
    // el 14 fija el mínimo del rango para que la poda no se coma el par.
    designed: () =>
      [0.95, 0.946, 0.942, 0.938, 0.934, 0.93, 0.926, 0.922, 0.918, 0.914, 0.91, 0.908, 0.9075, 0.84].map(
        (target, i) => ({ id: `n${i + 1}`, target, sourceKind: "builtin" as SourceKind })
      ),
    fillerCount: 56,
    fillerBand: belowFloor,
  },
  {
    id: "S11",
    query: "¿En qué sala es la cita del martes?",
    // La reserva personal: un híbrido (B-d) con pata léxica débil desplaza
    // por los pelos al trozo del usuario (U): 1,25·U supera al último no
    // usuario por ~0,0015 en ambos perfiles (medido en la sonda).
    designed: (p) =>
      p.id === "bge-small-en"
        ? [
            { id: "btop", target: 0.96, sourceKind: "builtin" },
            { id: "h1", target: 0.955, sourceKind: "pack" },
            { id: "h2", target: 0.945, sourceKind: "pack" },
            { id: "h3", target: 0.935, sourceKind: "pack" },
            { id: "h4", target: 0.925, sourceKind: "pack" },
            { id: "h5", target: 0.915, sourceKind: "pack" },
            { id: "bd", target: 0.9, sourceKind: "builtin" },
            { id: "u", target: 0.87, sourceKind: "user" },
            { id: "w", target: 0.62, sourceKind: "builtin" },
          ]
        : [
            { id: "btop", target: 0.99, sourceKind: "builtin" },
            { id: "h1", target: 0.99, sourceKind: "pack" },
            { id: "h2", target: 0.97, sourceKind: "pack" },
            { id: "h3", target: 0.96, sourceKind: "pack" },
            { id: "h4", target: 0.95, sourceKind: "pack" },
            { id: "h5", target: 0.94, sourceKind: "pack" },
            { id: "bd", target: 0.95, sourceKind: "builtin" },
            { id: "u", target: 0.93, sourceKind: "user" },
            { id: "w", target: 0.82, sourceKind: "builtin" },
          ],
    fillerCount: 53,
    fillerBand: belowFloor,
    lexicalRaw: undefined, // se fija por perfil en buildRun
  },
  {
    id: "S12a",
    query: "¿cómo trato una quemadura leve?",
    designed: () => [],
    fillerCount: 200,
    fillerBand: null,
    absoluteTargets: (rng) => Array.from({ length: 200 }, () => 0.3 + rng() * 0.67),
  },
  {
    id: "S12b",
    query: "how do I treat a mild burn?",
    designed: () => [],
    fillerCount: 200,
    fillerBand: null,
    absoluteTargets: (rng) => Array.from({ length: 200 }, () => 0.3 + rng() * 0.67),
  },
  {
    id: "S12c",
    query: "como trato uma queimadura leve?",
    designed: () => [],
    fillerCount: 200,
    fillerBand: null,
    absoluteTargets: (rng) => Array.from({ length: 200 }, () => 0.3 + rng() * 0.67),
  },
];

const S11_LEXICAL: Record<string, Record<string, number>> = {
  "bge-small-en": { h1: 10, h2: 9.8, h3: 9.6, h4: 9.4, h5: 9.2, bd: 1.923 },
  "multilingual-e5-small": { h1: 10, h2: 9.8, h3: 9.6, h4: 9.4, h5: 9.2, bd: 2.116 },
};

// ---------------------------------------------------------------------------
// El banco: construir el corpus, puntuar en ambas precisiones, servir con
// el pegamento de semanticSearch + la fusión de retrieve.
// ---------------------------------------------------------------------------

interface ScoredRow {
  chunk: RetrievedChunk;
  score: number;
}

interface RunResult {
  scenario: string;
  profileId: string;
  pairs: { id: string; floatScore: number; int8Score: number }[];
  semanticFloat: string[];
  semanticInt8: string[];
  fusedFloat: RetrievedChunk[];
  fusedInt8: RetrievedChunk[];
  expected: string[];
  semanticFloatOrder: string[];
  semanticInt8Order: string[];
}

function toRetrieved(id: string, sourceKind: SourceKind, score: number): RetrievedChunk {
  return {
    chunkId: `${id}-chunk`,
    docId: `${id}-doc`,
    title: `titulo-${id}`,
    body: `cuerpo-${id}`,
    source: "semantic",
    sourceKind,
    score,
    rawScore: score,
  };
}

function semanticLeg(scored: ScoredRow[], profile: EmbeddingProfile, query: string): RetrievedChunk[] {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const floor = distinctFloor(
    semanticFloor(profile, query),
    sorted.map((s) => s.score),
    profile.distinctGap
  );
  const gated = filterByMinScore(sorted, floor);
  const pruned = pruneSemanticByMargin(
    gated.map((g) => g.chunk),
    profile.margin
  );
  return pruned.slice(0, 12);
}

function buildRun(scn: Scenario, profile: EmbeddingProfile, streamSeed: number): RunResult {
  const rng = mulberry32(streamSeed);
  const gauss = gaussian(rng);
  const q = unitGaussianDirection(gauss);
  const queryVec = Float32Array.from(q);
  const floor = semanticFloor(profile, scn.query);

  const designed = scn.designed(profile, floor);
  const spec: { id: string; target: number; sourceKind: SourceKind; expected?: boolean }[] = [...designed];
  if (scn.absoluteTargets) {
    const targets = scn.absoluteTargets(rng);
    targets.forEach((target, i) => {
      // S8: los rellenos son la rampa; S12: son todo el corpus (W1..W200).
      const id = scn.id === "S8" ? `rampa${i + 1}` : `W${i + 1}`;
      spec.push({ id, target, sourceKind: "builtin" });
    });
  } else if (scn.fillerBand) {
    const [lo, hi] = scn.fillerBand(floor);
    for (let i = 0; i < scn.fillerCount; i++) {
      spec.push({ id: `relleno${i + 1}`, target: lo + rng() * (hi - lo), sourceKind: "builtin" });
    }
  }

  const floatScored: ScoredRow[] = [];
  const int8Scored: ScoredRow[] = [];
  const pairs: RunResult["pairs"] = [];
  for (const s of spec) {
    const vec = vectorAtCosine(q, s.target, gauss);
    const f = cosineSimilarity(queryVec, vec);
    const q8 = cosineSimilarityInt8(queryVec, quantizeOne(vec));
    pairs.push({ id: s.id, floatScore: f, int8Score: q8 });
    floatScored.push({ chunk: toRetrieved(s.id, s.sourceKind, f), score: f });
    int8Scored.push({ chunk: toRetrieved(s.id, s.sourceKind, q8), score: q8 });
  }

  const semF = semanticLeg(floatScored, profile, scn.query);
  const semI = semanticLeg(int8Scored, profile, scn.query);

  const lexicalById = scn.id === "S11" ? S11_LEXICAL[profile.id] : undefined;
  const lexicalFloat: RetrievedChunk[] = [];
  const lexicalInt8: RetrievedChunk[] = [];
  if (lexicalById) {
    for (const [id, raw] of Object.entries(lexicalById)) {
      const base = toRetrieved(id, id.startsWith("h") ? "pack" : "builtin", raw);
      lexicalFloat.push({ ...base, source: "lexical" });
      lexicalInt8.push({ ...base, source: "lexical" });
    }
  }
  const fusedF = fuseRetrievalResults(lexicalFloat, semF, 6, undefined, profile.minSimilarity);
  const fusedI = fuseRetrievalResults(lexicalInt8, semI, 6, undefined, profile.minSimilarity);

  const idOf = (c: RetrievedChunk) => c.chunkId.replace(/-chunk$/, "");
  return {
    scenario: scn.id,
    profileId: profile.id,
    pairs,
    semanticFloat: semF.map(idOf),
    semanticInt8: semI.map(idOf),
    fusedFloat: fusedF,
    fusedInt8: fusedI,
    expected: designed.filter((d) => d.expected).map((d) => d.id),
    semanticFloatOrder: semF.map(idOf),
    semanticInt8Order: semI.map(idOf),
  };
}

const PROFILES: EmbeddingProfile[] = [BGE_SMALL_EN_PROFILE, MULTILINGUAL_E5_SMALL_PROFILE];
const RUNS: RunResult[] = [];
SCENARIOS.forEach((scn, i) => {
  PROFILES.forEach((profile, j) => {
    RUNS.push(buildRun(scn, profile, 10_000 + i * 1_009 + j * 50_011));
  });
});

const runOf = (scenario: string, profileId: string): RunResult =>
  RUNS.find((r) => r.scenario === scenario && r.profileId === profileId)!;

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

function percentileNearestRank(sortedAsc: number[], p: number): number {
  const idx = Math.min(sortedAsc.length - 1, Math.ceil(p * sortedAsc.length) - 1);
  return sortedAsc[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// La puerta. Unidad de aceptación: el CONJUNTO SERVIDO, en las dos patas.
// ---------------------------------------------------------------------------

describe("P-01 · sonda de aptitud int8 (la puerta de entrada)", () => {
  it("el banco cubre los 14 escenarios en los dos perfiles (28 corridas)", () => {
    expect(RUNS.length).toBe(28);
    const totalPairs = RUNS.reduce((acc, r) => acc + r.pairs.length, 0);
    expect(totalPairs).toBeGreaterThan(2_000);
  });

  it("p99 de |Δcos| ≤ 0,01 y máximo < 0,015, global y por perfil", () => {
    const byProfile = new Map<string, number[]>();
    for (const run of RUNS) {
      const deltas = run.pairs.map((p) => Math.abs(p.floatScore - p.int8Score));
      byProfile.set(run.profileId, [...(byProfile.get(run.profileId) ?? []), ...deltas]);
    }
    const all = [...byProfile.values()].flat();
    const sorted = [...all].sort((a, b) => a - b);
    // La medición queda impresa en cada corrida: la puerta no solo pasa,
    // deja la cifra asentada en el log de la batería.
    const perProfile = [...byProfile.entries()]
      .map(([id, ds]) => {
        const s = [...ds].sort((a, b) => a - b);
        return `${id}: pares ${ds.length} · p99 ${percentileNearestRank(s, 0.99).toFixed(6)} · máx ${s[s.length - 1].toFixed(6)}`;
      })
      .join(" | ");
    console.info(
      `[sonda-p01] pares ${all.length} · p99 global ${percentileNearestRank(sorted, 0.99).toFixed(6)} · máx ${sorted[sorted.length - 1].toFixed(6)} · ${perProfile}`
    );
    expect(percentileNearestRank(sorted, 0.99)).toBeLessThanOrEqual(P99_BAR);
    expect(sorted[sorted.length - 1]).toBeLessThan(MAX_BAR);
    for (const deltas of byProfile.values()) {
      const s = [...deltas].sort((a, b) => a - b);
      expect(percentileNearestRank(s, 0.99)).toBeLessThanOrEqual(P99_BAR);
      expect(s[s.length - 1]).toBeLessThan(MAX_BAR);
    }
  });

  it("28/28 conjuntos servidos idénticos entre precisiones (pata semántica y fusión)", () => {
    for (const run of RUNS) {
      expect(
        sameSet(run.semanticFloat, run.semanticInt8),
        `${run.scenario}/${run.profileId} pata semántica: [${run.semanticFloat}] vs [${run.semanticInt8}]`
      ).toBe(true);
      const fusedF = run.fusedFloat.map((c) => c.chunkId);
      const fusedI = run.fusedInt8.map((c) => c.chunkId);
      expect(sameSet(fusedF, fusedI), `${run.scenario}/${run.profileId} fusión`).toBe(true);
    }
  });

  it("ningún esperado fuera del conjunto servido en ninguna precisión", () => {
    for (const run of RUNS) {
      for (const id of run.expected) {
        expect(run.semanticFloat, `${run.scenario}/${run.profileId} float32`).toContain(id);
        expect(run.semanticInt8, `${run.scenario}/${run.profileId} int8`).toContain(id);
      }
    }
  });

  it("todo intercambio de orden es de la clase nombrada (hueco fundido < 0,002)", () => {
    let swaps = 0;
    let maxSwapGap = 0;
    for (const run of RUNS) {
      const fusedScoreF = new Map(run.fusedFloat.map((c) => [c.chunkId, c.score]));
      const orderF = run.fusedFloat.map((c) => c.chunkId);
      const orderI = run.fusedInt8.map((c) => c.chunkId);
      for (let a = 0; a < orderF.length; a++) {
        for (let b = a + 1; b < orderF.length; b++) {
          const posIa = orderI.indexOf(orderF[a]);
          const posIb = orderI.indexOf(orderF[b]);
          if (posIa > posIb) {
            // Invertidos entre precisiones: solo vale si en float32 ya
            // estaban casi empatados (la clase del W126↔W143 de la foto).
            const gap = Math.abs((fusedScoreF.get(orderF[a]) ?? 0) - (fusedScoreF.get(orderF[b]) ?? 0));
            swaps++;
            if (gap > maxSwapGap) maxSwapGap = gap;
            expect(
              gap,
              `${run.scenario}/${run.profileId}: ${orderF[a]} vs ${orderF[b]} invertidos con hueco ${gap}`
            ).toBeLessThan(NAMED_SWAP_GAP);
          }
        }
      }
    }
    console.info(`[sonda-p01] intercambios de orden en el conjunto fundido: ${swaps} · hueco máximo ${maxSwapGap.toFixed(6)}`);
  });

  it("los pares diseñados casi empatados no se invierten (S2, S4, S5, S6, S7)", () => {
    const pairs: [string, string, string][] = [
      ["S2", "telefono", "tarjeta"],
      ["S4", "guia911", "cactus"],
      ["S5", "guia", "vecina"],
      ["S6", "guia", "vecina"],
      ["S7", "dosis", "jarabeVecino"],
    ];
    for (const [scn, winner, loser] of pairs) {
      for (const profile of PROFILES) {
        const run = runOf(scn, profile.id);
        for (const order of [run.semanticFloatOrder, run.semanticInt8Order]) {
          const wi = order.indexOf(winner);
          const li = order.indexOf(loser);
          if (wi !== -1 && li !== -1) expect(wi).toBeLessThan(li);
        }
        // La medida bruta del par tampoco se invierte en ninguna precisión.
        const wf = run.pairs.find((p) => p.id === winner)!;
        const lf = run.pairs.find((p) => p.id === loser)!;
        expect(wf.floatScore).toBeGreaterThan(lf.floatScore);
        expect(wf.int8Score).toBeGreaterThan(lf.int8Score);
      }
    }
  });

  it("S8: la distintividad e5 sirve X y deja Y bajo el piso efectivo en ambos brazos", () => {
    const run = runOf("S8", "multilingual-e5-small");
    expect(run.semanticFloat).toContain("equis");
    expect(run.semanticInt8).toContain("equis");
    expect(run.semanticFloat).not.toContain("ye");
    expect(run.semanticInt8).not.toContain("ye");
  });

  it("S10: el corte a 12 sirve el 12 y deja el 13 fuera, en ambos brazos y perfiles", () => {
    for (const profile of PROFILES) {
      const run = runOf("S10", profile.id);
      expect(run.semanticFloat).toContain("n12");
      expect(run.semanticInt8).toContain("n12");
      expect(run.semanticFloat).not.toContain("n13");
      expect(run.semanticInt8).not.toContain("n13");
    }
  });

  it("S11: la reserva desplaza al híbrido y sirve al usuario en ambos brazos y perfiles", () => {
    for (const profile of PROFILES) {
      const run = runOf("S11", profile.id);
      const fusedF = run.fusedFloat.map((c) => c.chunkId.replace(/-chunk$/, ""));
      const fusedI = run.fusedInt8.map((c) => c.chunkId.replace(/-chunk$/, ""));
      expect(fusedF).toContain("u");
      expect(fusedI).toContain("u");
      expect(fusedF).not.toContain("bd");
      expect(fusedI).not.toContain("bd");
    }
  });
});
