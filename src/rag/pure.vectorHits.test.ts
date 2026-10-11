/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { pruneByScoreMargin, pruneVectorHits } from "./pure";

describe("pruneVectorHits — margin over the whole passing range", () => {
  it("equals pruneByScoreMargin over every passing score when all are returned", () => {
    const scores = [0.9, 0.88, 0.85, 0.83, 0.82];
    const hits = { ids: [1, 2, 3, 4, 5], scores, gatedCount: 5, gatedMin: 0.82 };
    const expected = pruneByScoreMargin(scores.map((score, i) => ({ id: i + 1, score })), 0.4);
    expect(pruneVectorHits(hits, 0.4)).toEqual(expected);
  });

  it("uses the lowest passing score even when it wasn't returned (top-k only)", () => {
    // 12 returned, 300 passed; the lowest passing is 0.81. Range 0.95-0.81:
    // cutoff = 0.95 - 0.4*0.14 = 0.894 → keeps 0.95, 0.93, 0.90.
    const scores = [0.95, 0.93, 0.9, 0.89, 0.88, 0.87, 0.86, 0.86, 0.85, 0.85, 0.84, 0.84];
    const hits = { ids: scores.map((_, i) => i + 10), scores, gatedCount: 300, gatedMin: 0.81 };
    expect(pruneVectorHits(hits, 0.4).map((h) => h.id)).toEqual([10, 11, 12]);
  });

  it("never returns the sentinel, and keeps at least the best hit", () => {
    const hits = { ids: [7], scores: [0.9], gatedCount: 50, gatedMin: 0.81 };
    expect(pruneVectorHits(hits, 0.4)).toEqual([{ id: 7, score: 0.9 }]);
    const flat = { ids: [1, 2], scores: [0.85, 0.85], gatedCount: 9, gatedMin: 0.85 };
    expect(pruneVectorHits(flat, 0.4)).toEqual([
      { id: 1, score: 0.85 },
      { id: 2, score: 0.85 },
    ]);
  });

  it("no hits → nothing", () => {
    expect(pruneVectorHits({ ids: [], scores: [], gatedCount: 0, gatedMin: null }, 0.4)).toEqual([]);
  });
});
