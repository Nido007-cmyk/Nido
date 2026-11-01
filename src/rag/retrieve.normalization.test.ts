/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { fuseRetrievalResults, normalizeCorpusScores } from "./pure";
import type { RetrievedChunk } from "./retrieve.types";

/**
 * C-02: per-corpus z-score + sigmoid normalization of BM25 scores.
 *
 * The defect (audit C-02, measured in the 2026-11-01 prep): lexical lists
 * from different corpora (device index, each knowledge pack) were merged
 * RAW and fuseRetrievalResults normalized the merged list by its single
 * maximum. BM25's scale is a property of the corpus (its size and term
 * statistics), not of relevance, so which source won was close to a coin
 * flip: on the prep's judged battery the raw winner was wrong in L1
 * (a cactus chunk over the right guide), NQ2, NQ3 and NQ4. The prep
 * measured six normalizations on a clean battery (18 judged queries) and
 * a human-phrasing battery (15 dictated questions): per-corpus max (the
 * audit's own candidate) scored WORSE than today (8/18 vs 9/18) and is
 * rejected; z-score per corpus (plain or sigmoid) crowned the right
 * source in 13/13 judged queries whose correct chunk reached the fusion.
 * N3b (z + sigmoid) is adopted: bounded in (0,1), and unlike plain
 * z-clipped-at-0 it does not zero out below-mean candidates.
 *
 * These fixtures are synthetic geometries of the measured inversions —
 * the same style as retrieve.relevance.test.ts: they prove the code
 * implements the measured policy, not real-corpus behavior.
 */

function chunk(id: string, score: number): RetrievedChunk {
  return { chunkId: id, docId: id, title: `Doc ${id}`, body: `Body ${id}`, score, matchType: "lexical" };
}

function list(prefix: string, scores: number[]): RetrievedChunk[] {
  return scores.map((s, i) => chunk(`${prefix}${i}`, s));
}

describe("normalizeCorpusScores (z-score + sigmoid, per corpus)", () => {
  it("maps a corpus onto (0,1) preserving internal order, without zeroing below-mean candidates", () => {
    const out = normalizeCorpusScores(list("u", [10, 8, 6, 4, 2]));
    expect(out.map((c) => c.score)).toEqual([
      expect.closeTo(0.804, 3),
      expect.closeTo(0.67, 3),
      expect.closeTo(0.5, 3),
      expect.closeTo(0.33, 3),
      expect.closeTo(0.196, 3),
    ]);
    // The N3b property plain clipped z lacks: below-mean candidates keep
    // a nonzero score and their internal order.
    expect(out[4].score).toBeGreaterThan(0);
    expect(out[3].score).toBeGreaterThan(out[4].score);
  });

  it("does not mutate its input and leaves rawScore untouched", () => {
    const input = list("m", [9, 5, 3, 1]);
    const before = input.map((c) => c.score);
    const out = normalizeCorpusScores(input);
    expect(input.map((c) => c.score)).toEqual(before);
    expect(out.map((c) => c.chunkId)).toEqual(input.map((c) => c.chunkId));
    expect(out.every((c) => c.rawScore === undefined)).toBe(true);
  });

  it("returns an empty list unchanged", () => {
    expect(normalizeCorpusScores([])).toEqual([]);
  });
});

describe("normalizeCorpusScores guard (degenerate source: <3 candidates or ~zero spread)", () => {
  // With fewer than 3 candidates (or no spread) a z-score manufactures
  // confidence out of noise: two nearly tied scores would land at
  // sigmoid(±1), a lone score at ~1.0 — the N1 pathology of a weak
  // solitary fragment carrying near-full weight. The guard therefore
  // scales by the corpus maximum CAPPED AT THE NEUTRAL POINT (0.5):
  // relative gaps survive proportionally, but a degenerate source's
  // best can never outrank a genuine standout from a healthy corpus
  // (whose z > 0 puts it above 0.5). In a single-source fusion the
  // fusion's own max-normalization rescales the cap away, so a lone
  // corpus is unaffected.
  it("caps a solitary candidate at the neutral point", () => {
    const out = normalizeCorpusScores(list("s", [7]));
    expect(out[0].score).toBeCloseTo(0.5, 9);
  });

  it("caps a two-candidate source at the neutral point, preserving the relative gap", () => {
    const out = normalizeCorpusScores(list("t", [10, 5]));
    expect(out[0].score).toBeCloseTo(0.5, 9);
    expect(out[1].score).toBeCloseTo(0.25, 9);
  });

  it("caps a flat list (zero spread) at the neutral point for every candidate", () => {
    const out = normalizeCorpusScores(list("f", [5, 5, 5, 5]));
    expect(out.every((c) => Math.abs(c.score - 0.5) < 1e-9)).toBe(true);
  });

  it("a degenerate source's best stays below a healthy corpus's standout", () => {
    const healthy = normalizeCorpusScores(list("h", [6.3, 3.1, 2.8, 2.5, 2.2, 2.0, 1.8]));
    const solitary = normalizeCorpusScores(list("s", [3.0]));
    expect(healthy[0].score).toBeGreaterThan(solitary[0].score);
  });
});

describe("fusion after per-corpus normalization (the measured inversions)", () => {
  // L1 geometry: the device index's raw BM25 scale runs high (its top
  // raw score is more than double the pack's), so raw fusion crowns the
  // device cactus chunk; within its own corpus the cactus is a modest
  // standout, while the correct guide dominates its pack's list.
  const deviceRaw = [14.2, 13.9, 12.5, 11.8, 11.0, 10.4, 9.7, 9.1, 8.6, 8.0, 7.5, 7.0];
  const packRaw = [6.3, 3.1, 2.8, 2.5, 2.2, 2.0, 1.8];

  it("BEFORE (defect documented): raw merged lists crown the cactus chunk", () => {
    const fused = fuseRetrievalResults([...list("dev", deviceRaw), ...list("pack", packRaw)], [], 6);
    expect(fused[0].chunkId).toBe("dev0");
  });

  it("cactus inversion cured: per-corpus z-sigmoid crowns the pack's guide", () => {
    const fused = fuseRetrievalResults(
      [...normalizeCorpusScores(list("dev", deviceRaw)), ...normalizeCorpusScores(list("pack", packRaw))],
      [],
      6
    );
    expect(fused[0].chunkId).toBe("pack0");
  });

  it("solitary guard (NQ4 geometry): one weak candidate cannot crown over a healthy corpus of 12", () => {
    const healthyRaw = [25, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2];
    const fused = fuseRetrievalResults(
      [...normalizeCorpusScores(list("solo", [3.0])), ...normalizeCorpusScores(list("big", healthyRaw))],
      [],
      6
    );
    expect(fused[0].chunkId).toBe("big0");
  });

  it("D2 serum regression (anti-N1): the ORS guide crowns over a tighter, higher-scale corpus", () => {
    // Oral rehydration: the Esencial ORS guide is the standout of its
    // corpus; the competing corpus's top chunk (cyclones) sits in a
    // tight pack at a higher raw scale. Per-corpus MAX (N1, the audit's
    // rejected candidate) ties both tops at exactly 1.0 and cannot
    // separate them; z-sigmoid separates them by standout-ness.
    const esencial = [8.0, 3.0, 2.6, 2.2, 1.9, 1.6];
    const other = [11.0, 10.6, 10.2, 9.8, 9.4, 9.0, 8.6, 8.2];
    const maxNorm = (xs: number[]) => {
      const m = Math.max(...xs);
      return xs.map((x) => x / m);
    };
    expect(maxNorm(esencial)[0]).toBe(maxNorm(other)[0]); // N1: exact tie at the top
    const fused = fuseRetrievalResults(
      [...normalizeCorpusScores(list("ors", esencial)), ...normalizeCorpusScores(list("cyc", other))],
      [],
      6
    );
    expect(fused[0].chunkId).toBe("ors0");
  });

  it("preservation (L2-L6 geometry): a lone corpus's standout still crowns after normalization", () => {
    const fused = fuseRetrievalResults(normalizeCorpusScores(list("one", [9.0, 4.0, 3.5, 3.0, 2.5, 2.0])), [], 6);
    expect(fused[0].chunkId).toBe("one0");
  });

  it("preservation: a lone degenerate source keeps its internal order through the fusion", () => {
    const fused = fuseRetrievalResults(normalizeCorpusScores(list("two", [10, 5])), [], 6);
    expect(fused.map((c) => c.chunkId)).toEqual(["two0", "two1"]);
  });
});
