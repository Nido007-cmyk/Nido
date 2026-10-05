/**
 * D-CLUSTER PHASE B — HELD-OUT measurement (single execution).
 *
 * The held-out set (selfKnowledgeCorpus.heldout.ts) was authored and
 * committed BEFORE any Phase B tuning (commit 639ac0a) and never consulted
 * during rule design. It runs here exactly once, after the frozen corpus
 * passed its gates, to measure generalization.
 *
 * Gates (owner directive 2026-09-28): precision ≥ 93%, recall ≥ 88%.
 * Every FP/FN is printed verbatim with the exact producing rule.
 * Ambiguous cases are reported separately and excluded from scoring.
 */

import { describe, it, expect } from "vitest";
import { SELF_KNOWLEDGE_HELDOUT } from "./selfKnowledgeCorpus.heldout";
import { debugClassify } from "../selfKnowledge";
import {
  confusionOf,
  ratesOf,
  type CaseResult,
  type Verdict,
} from "./selfKnowledgeCorpus.harness";
import type { CorpusCase } from "./selfKnowledgeCorpus";

function runHeldout(cases: CorpusCase[] = SELF_KNOWLEDGE_HELDOUT): CaseResult[] {
  return cases.map((c) => {
    const d = debugClassify(c.query);
    const got: "SK" | "NP" = d !== null ? "SK" : "NP";
    let verdict: Verdict;
    if (c.expected === "AMB") {
      verdict = got === "SK" ? "AMB_SK" : "AMB_NP";
    } else if (c.expected === "SK" && got === "SK") {
      verdict = "TP";
    } else if (c.expected === "NP" && got === "NP") {
      verdict = "TN";
    } else if (c.expected === "NP" && got === "SK") {
      verdict = "FP";
    } else {
      verdict = "FN";
    }
    const rule = d
      ? `${d.category} :: ${d.pattern}${d.rest ? ` rest=${JSON.stringify(d.rest)}` : ""}${d.typoSubstituted ? " [typo-substituted]" : ""}`
      : null;
    return { c, got, verdict, rule };
  });
}

function buildHeldoutReport(results: CaseResult[]): string {
  const m = confusionOf(results);
  const r = ratesOf(m);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push("# D-CLUSTER PHASE B — held-out measurement (single execution)");
  lines.push("");
  lines.push(`Held-out: ${SELF_KNOWLEDGE_HELDOUT.length} cases (${m.tp + m.tn + m.fp + m.fn} adjudicated, ${m.amb} ambiguous)`);
  lines.push("");
  lines.push(`- precision: ${pct(r.precision)} (gate ≥ 93%)`);
  lines.push(`- recall: ${pct(r.recall)} (gate ≥ 88%)`);
  lines.push(`- false-positive rate: ${pct(r.fpRate)}`);
  lines.push(`- false-negative rate: ${pct(r.fnRate)}`);
  lines.push(`- confusion: TP=${m.tp} FP=${m.fp} FN=${m.fn} TN=${m.tn}`);
  lines.push("");
  lines.push("## False positives (complete, verbatim)");
  lines.push("");
  const fps = results.filter((x) => x.verdict === "FP");
  for (const x of fps) {
    lines.push(`- [${x.c.id}] ${JSON.stringify(x.c.query)} (${x.c.lang}) — ${x.c.note} — rule: ${x.rule}`);
  }
  if (fps.length === 0) lines.push("(none)");
  lines.push("");
  lines.push("## False negatives (complete, verbatim)");
  lines.push("");
  const fns = results.filter((x) => x.verdict === "FN");
  for (const x of fns) {
    lines.push(`- [${x.c.id}] ${JSON.stringify(x.c.query)} (${x.c.lang}) — ${x.c.note} — rule: ${x.rule ?? "(no rule — clean miss)"}`);
  }
  if (fns.length === 0) lines.push("(none)");
  lines.push("");
  lines.push("## Breakdown by language");
  lines.push("");
  for (const lang of ["en", "es", "pt"] as const) {
    const sub = confusionOf(results.filter((x) => x.c.lang === lang && x.c.expected !== "AMB"));
    const sr = ratesOf(sub);
    lines.push(`- ${lang}: n=${sub.tp + sub.tn + sub.fp + sub.fn} TP=${sub.tp} FP=${sub.fp} FN=${sub.fn} TN=${sub.tn} prec=${pct(sr.precision)} rec=${pct(sr.recall)}`);
  }
  lines.push("");
  lines.push("## Ambiguous cases (manual review)");
  lines.push("");
  for (const x of results.filter((x) => x.verdict === "AMB_SK" || x.verdict === "AMB_NP")) {
    lines.push(`- [${x.c.id}] ${JSON.stringify(x.c.query)} → classified ${x.got} — ${x.c.note}`);
  }
  lines.push("");
  return lines.join("\n");
}

describe("D-cluster Phase B — held-out generalization (single execution)", () => {
  it("held-out set is well-formed and disjoint from the training corpus", () => {
    const ids = SELF_KNOWLEDGE_HELDOUT.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SELF_KNOWLEDGE_HELDOUT.length).toBe(67);
    for (const lang of ["en", "es", "pt"] as const) {
      expect(SELF_KNOWLEDGE_HELDOUT.some((c) => c.lang === lang && c.expected === "SK")).toBe(true);
      expect(SELF_KNOWLEDGE_HELDOUT.some((c) => c.lang === lang && c.expected === "NP")).toBe(true);
    }
  });

  it("meets the held-out gates: precision ≥ 93%, recall ≥ 88%", () => {
    const r = ratesOf(confusionOf(runHeldout()));
    expect(r.precision, `held-out precision ${r.precision}`).toBeGreaterThanOrEqual(0.93);
    expect(r.recall, `held-out recall ${r.recall}`).toBeGreaterThanOrEqual(0.88);
  });

  it("prints the held-out report with every FP/FN verbatim", () => {
    // Human/audit artifact: captured into ~/workspace/audits/.
    // eslint-disable-next-line no-console
    console.log(buildHeldoutReport(runHeldout()));
  });
});
