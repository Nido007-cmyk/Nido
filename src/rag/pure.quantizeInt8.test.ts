/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * P-01 paso 1: quantizeVectorInt8 (pure.ts) es el espejo en TS de la
 * convención de los packs (quantizeInt8 de
 * scripts/lib/knowledge-pack-lib.mjs). Esta fixture exige ACUERDO BYTE A
 * BYTE con aquella sobre 1.000 vectores sembrados y sobre los casos
 * borde que el diseño nombra — si algún día divergen, la base del
 * usuario y los packs dejarían de hablar el mismo int8, y esta suite
 * debe fallar antes de que eso se almacene.
 */
import { describe, it, expect } from "vitest";
import { cosineSimilarity, cosineSimilarityInt8, quantizeVectorInt8 } from "./pure";
import { quantizeInt8 } from "../../scripts/lib/knowledge-pack-lib.mjs";

const DIM = 384;

/** PRNG determinista (mulberry32) + gaussiana Box-Muller, como la sonda. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianVec(rng: () => number): Float32Array {
  const out = new Float32Array(DIM);
  for (let i = 0; i < DIM; i += 2) {
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    out[i] = u * mul;
    if (i + 1 < DIM) out[i + 1] = v * mul;
  }
  return out;
}

function packsBytes(vec: Float32Array): Uint8Array {
  const { data } = quantizeInt8(vec, DIM);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

describe("P-01 · quantizeVectorInt8 (espejo de la convención de packs)", () => {
  it("acuerdo byte a byte con quantizeInt8 de packs en 1.000 vectores sembrados", () => {
    const rng = mulberry32(20_261_101);
    const flat = new Float32Array(1_000 * DIM);
    const singles: Float32Array[] = [];
    for (let n = 0; n < 1_000; n++) {
      const v = gaussianVec(rng);
      singles.push(v);
      flat.set(v, n * DIM);
    }
    const { data } = quantizeInt8(flat, DIM);
    const allPacks = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let n = 0; n < 1_000; n++) {
      expect(quantizeVectorInt8(singles[n])).toEqual(allPacks.subarray(n * DIM, (n + 1) * DIM));
    }
  });

  it("los empates de medio paso redondean como Math.round (hacia +∞), igual que packs", () => {
    // Escala 1 (máx = 127): 63.5 cae EXACTAMENTE en el medio paso.
    const ties = new Float32Array(DIM);
    ties[0] = 127;
    ties[1] = 63.5;
    ties[2] = -63.5;
    ties[3] = -0.5;
    const mine = quantizeVectorInt8(ties);
    expect(mine).toEqual(packsBytes(ties));
    const codes = new Int8Array(mine.buffer, mine.byteOffset, mine.byteLength);
    expect(codes[0]).toBe(127);
    expect(codes[1]).toBe(64); // 63.5 → 64
    expect(codes[2]).toBe(-63); // -63.5 → -63 (hacia +∞)
    expect(codes[3]).toBe(0); // -0.5 → 0 (hacia +∞); el byte es 0, sin signo
  });

  it("vector cero: bytes todos a cero y sin división por cero", () => {
    const zero = new Float32Array(DIM);
    const bytes = quantizeVectorInt8(zero);
    expect(bytes.length).toBe(DIM);
    expect(bytes.every((b) => b === 0)).toBe(true);
    expect(bytes).toEqual(packsBytes(zero));
    expect(cosineSimilarityInt8(zero, bytes)).toBe(0);
  });

  it("saturación simétrica: el componente máximo llega a ±127 exactos", () => {
    const v = new Float32Array(DIM);
    v[0] = 1;
    v[1] = -1;
    v[2] = 0.5;
    const codes = new Int8Array(quantizeVectorInt8(v).buffer);
    expect(codes[0]).toBe(127);
    expect(codes[1]).toBe(-127);
    expect(codes[2]).toBe(64); // 0.5 * 127 = 63.5 → 64
  });

  it("un outlier de 100× aplasta el resto a casi cero, y packs hace lo mismo", () => {
    const v = new Float32Array(DIM).fill(0.01);
    v[7] = 1; // 100× la mediana
    const mine = quantizeVectorInt8(v);
    expect(mine).toEqual(packsBytes(v));
    const codes = new Int8Array(mine.buffer, mine.byteOffset, mine.byteLength);
    expect(codes[7]).toBe(127);
    expect(codes[0]).toBe(1); // 0.01 * 127 = 1.27 → 1
  });

  it("formas con nombre: one-hot, disperso al 5 %, par opuesto — acuerdo con packs", () => {
    const oneHot = new Float32Array(DIM);
    oneHot[42] = -3.25;
    const sparse = new Float32Array(DIM);
    for (let i = 0; i < DIM; i += 20) sparse[i] = i % 40 === 0 ? 0.75 : -0.75;
    const opposed = new Float32Array(DIM);
    opposed[0] = 2;
    opposed[1] = -2;
    for (const v of [oneHot, sparse, opposed]) {
      expect(quantizeVectorInt8(v)).toEqual(packsBytes(v));
    }
  });

  it("invariancia de escala: la misma dirección a normas 1e-3, 1 y 1e3 da los mismos bytes", () => {
    const rng = mulberry32(777);
    const dir = gaussianVec(rng);
    const norm = Math.sqrt(dir.reduce((acc, x) => acc + x * x, 0));
    const unit = dir.map((x) => x / norm);
    const bytesAt = (k: number) => quantizeVectorInt8(unit.map((x) => x * k));
    expect(bytesAt(1)).toEqual(bytesAt(1e-3));
    expect(bytesAt(1)).toEqual(bytesAt(1e3));
  });

  it("el coseno contra lo cuantizado queda bajo la barra máxima de la sonda (0,015)", () => {
    const rng = mulberry32(31_337);
    const query = gaussianVec(rng);
    let worst = 0;
    for (let n = 0; n < 200; n++) {
      const v = gaussianVec(rng);
      const delta = Math.abs(cosineSimilarity(query, v) - cosineSimilarityInt8(query, quantizeVectorInt8(v)));
      if (delta > worst) worst = delta;
    }
    expect(worst).toBeLessThan(0.015);
  });
});
