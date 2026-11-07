/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 2026-11-06 (prueba física): mientras el índice de un pack pequeño se
// reconstruye, la búsqueda exacta en JS cumple el mismo contrato que el
// índice nativo, para que la guía correcta no se pierda en esa ventana.
import { describe, expect, it } from "vitest";
import { cosineSimilarityInt8, exactVectorSearch, pruneVectorHits } from "./pure";

const vec = (...xs: number[]) => new Uint8Array(Int8Array.from(xs).buffer);

describe("búsqueda exacta sin índice", () => {
  const rows = [
    { id: 1, vec: vec(100, 0, 0) },
    { id: 2, vec: vec(70, 70, 0) },
    { id: 3, vec: vec(0, 100, 0) },
    { id: 4, vec: vec(-100, 0, 0) },
  ];
  const q = Float32Array.from([1, 0, 0]);

  it("ordena por coseno, de mayor a menor, y respeta el límite", () => {
    const r = exactVectorSearch(rows, q, -1, 2);
    expect(r.ids).toEqual([1, 2]);
    expect(r.scores[0]).toBeCloseTo(1, 5);
    expect(r.scores[1]).toBeCloseTo(cosineSimilarityInt8(q, rows[1].vec), 6);
    expect(r.gatedCount).toBe(4);
  });

  it("el piso deja fuera lo de abajo y cuenta cuántos pasaron (como el índice)", () => {
    const r = exactVectorSearch(rows, q, 0.5, 10);
    expect(r.ids).toEqual([1, 2]);
    expect(r.gatedCount).toBe(2);
    expect(r.gatedMin).toBeCloseTo(cosineSimilarityInt8(q, rows[1].vec), 6);
  });

  it("nada pasa el piso: vacío y gatedMin null", () => {
    expect(exactVectorSearch(rows, q, 1.1, 5)).toEqual({ ids: [], scores: [], gatedCount: 0, gatedMin: null });
  });

  it("su salida entra tal cual en la poda por margen del índice", () => {
    const kept = pruneVectorHits(exactVectorSearch(rows, q, -1, 1), 0.05);
    expect(kept.map((h) => h.id)).toEqual([1]);
  });

  it("un vector roto (todo ceros) no rompe nada", () => {
    const r = exactVectorSearch([{ id: 9, vec: vec(0, 0, 0) }, ...rows], q, -1, 5);
    expect(r.ids[0]).toBe(1);
    expect(r.ids).not.toContain(Number.NaN);
  });
});
