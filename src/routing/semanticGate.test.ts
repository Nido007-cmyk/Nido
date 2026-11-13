/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.93 — la puerta por significado, contra el examen: los vectores de
// las 95 frases de la tanda que ni la lista de palabras ni el
// entrenamiento habían visto, calculados con los archivos exactos del
// catálogo (scripts/benchmarks/semantic-gate). Aquí se comprueba que el
// código de la app llega al mismo veredicto que la medida.
import { describe, expect, it } from "vitest";
import exam from "./__fixtures__/semanticGateExam.json";
import { decodeFloat32, hasSemanticGate, semanticDangerScore, semanticGateParity } from "./semanticGate";
import { SEMANTIC_GATE_WEIGHTS } from "./semanticGateWeights";
import { MODEL_CATALOG } from "../models/manifest";
import { isEmergencySituation, isHealthQuestion } from "./emergencyGate";

type Row = { text: string; danger: boolean; score: number; vec: string };
const E5 = "802c868f57ccddd2e0c80645c3db1cb96a1aa50986a057cbaee2526f6e474cde";
const BGE = "ec38e8da142596baa913124ae50550de284b6916bf59577ef2f0cb9660c2f514";
const rows = (sha: string) => (exam as Record<string, Row[]>)[sha];
const verdict = (sha: string, r: Row) => (semanticDangerScore(decodeFloat32(r.vec), sha) ?? -1) >= 0;

describe("puerta por significado", () => {
  it("los pesos son de los dos modelos de búsqueda del catálogo, por su huella exacta", () => {
    const catalog = MODEL_CATALOG.filter((m) => m.kind === "embedding").map((m) => m.sha256).sort();
    expect(Object.keys(SEMANTIC_GATE_WEIGHTS).sort()).toEqual(catalog);
    expect(hasSemanticGate(E5)).toBe(true);
    expect(hasSemanticGate("f".repeat(64))).toBe(false);
    expect(hasSemanticGate(null)).toBe(false);
  });

  it("el código de la app da la misma puntuación que la medida", () => {
    for (const sha of [E5, BGE]) {
      for (const r of rows(sha)) {
        expect(semanticDangerScore(decodeFloat32(r.vec), sha)!).toBeCloseTo(r.score, 3);
      }
    }
  });

  it("examen, modelo multilingüe: 39 de 45 de salud y emergencia; ninguna de 50 corrientes", () => {
    const r = rows(E5);
    expect(r.filter((x) => x.danger && verdict(E5, x)).length).toBe(39);
    expect(r.filter((x) => x.danger).length).toBe(45);
    expect(r.filter((x) => !x.danger && verdict(E5, x))).toEqual([]);
    expect(r.filter((x) => !x.danger).length).toBe(50);
  });

  it("examen, modelo por defecto (inglés): 22 de 45; ninguna de 50 corrientes", () => {
    const r = rows(BGE);
    expect(r.filter((x) => x.danger && verdict(BGE, x)).length).toBe(22);
    expect(r.filter((x) => !x.danger && verdict(BGE, x))).toEqual([]);
  });

  it("la lista de palabras sola, en el mismo examen: 4 de 45 (por eso existe esta capa)", () => {
    const r = rows(E5);
    const lexical = (q: string) => isHealthQuestion(q) || isEmergencySituation(q);
    expect(r.filter((x) => x.danger && lexical(x.text)).length).toBe(4);
    expect(r.filter((x) => !x.danger && lexical(x.text))).toEqual([]);
  });

  it("las dos capas juntas, modelo multilingüe: lo que cierra cualquiera de las dos", () => {
    const r = rows(E5);
    const lexical = (q: string) => isHealthQuestion(q) || isEmergencySituation(q);
    const closed = r.filter((x) => x.danger && (lexical(x.text) || verdict(E5, x))).length;
    expect(closed).toBeGreaterThanOrEqual(39);
  });

  it("paridad: el vector esperado de la frase conocida pasa; otro vector no", () => {
    const probe = decodeFloat32(SEMANTIC_GATE_WEIGHTS[E5].probe);
    expect(semanticGateParity(probe, E5)).toBe(true);
    // El vector de OTRA frase del mismo modelo no es el de la frase conocida.
    expect(semanticGateParity(decodeFloat32(rows(E5)[60].vec), E5)).toBe(false);
    // Un vector de otra dimensión o vacío: sin paridad y sin puntuación.
    expect(semanticGateParity(new Float32Array(10), E5)).toBe(false);
    expect(semanticDangerScore(new Float32Array(384), E5)).toBeNull();
    expect(semanticDangerScore(probe, "f".repeat(64))).toBeNull();
  });

  it("un vector sin normalizar da el mismo veredicto (la capa normaliza)", () => {
    const r = rows(E5)[0];
    const v = decodeFloat32(r.vec);
    const scaled = Float32Array.from(v, (x) => x * 4.7585);
    expect(semanticDangerScore(scaled, E5)!).toBeCloseTo(r.score, 3);
  });
});
