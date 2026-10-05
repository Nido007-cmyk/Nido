import { describe, it, expect } from "vitest";
import {
  buildReport,
  confusionOf,
  ratesOf,
  runMirrorCorpus,
} from "./selfKnowledgeCorpus.harness";
import { SELF_KNOWLEDGE_CORPUS } from "./selfKnowledgeCorpus";

describe("D-cluster Phase A — adversarial corpus baseline (READ-ONLY)", () => {
  it("corpus is well-formed and self-consistent", () => {
    const ids = SELF_KNOWLEDGE_CORPUS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length); // ids unique
    expect(SELF_KNOWLEDGE_CORPUS.length).toBeGreaterThan(60);
    expect(SELF_KNOWLEDGE_CORPUS.filter((c) => c.expected === "AMB").length).toBeGreaterThanOrEqual(5);
    // every language represented in both SK and NP
    for (const lang of ["en", "es", "pt"] as const) {
      expect(SELF_KNOWLEDGE_CORPUS.some((c) => c.lang === lang && c.expected === "SK")).toBe(true);
      expect(SELF_KNOWLEDGE_CORPUS.some((c) => c.lang === lang && c.expected === "NP")).toBe(true);
    }
  });

  it("frozen mirror reproduces the frozen baseline (Phase A numbers)", () => {
    // The static @0728bae pattern mirror must keep producing the accepted
    // Phase A baseline over the untouched corpus: TP 49 / FP 23 / FN 16 /
    // TN 32, precision 68.1%, recall 75.4%. This guards the historical
    // artifact itself — if the mirror or corpus were tampered with, the
    // Phase B delta would be measured against a lie.
    const m = confusionOf(runMirrorCorpus());
    expect(m).toEqual({ tp: 49, tn: 32, fp: 23, fn: 16, amb: 7 });
    const r = ratesOf(m);
    expect(r.precision).toBeCloseTo(0.681, 3);
    expect(r.recall).toBeCloseTo(0.754, 3);
  });

  it("prints the full baseline report", () => {
    // Human/audit artifact: the printed report is captured into
    // ~/workspace/audits/. The numbers below are frozen as the baseline
    // so any Phase B router change is measured, not silent.
    // eslint-disable-next-line no-console
    console.log(buildReport());
    const m = confusionOf(runMirrorCorpus());
    const r = ratesOf(m);
    expect({ ...m, precision: r.precision, recall: r.recall }).toMatchSnapshot();
  });
});
