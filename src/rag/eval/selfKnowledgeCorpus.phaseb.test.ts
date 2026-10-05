/**
 * D-CLUSTER PHASE B — gate measurement for Design 1 + Design 2.
 *
 * Runs LIVE production (classifyKnowledgeQuery with brand-context
 * anchoring + identity-only typo tolerance) over the FROZEN Phase A
 * corpus and asserts the owner-authorized gates:
 *
 * - precision ≥ 95%, recall ≥ 90%, FP rate ≤ 5%
 * - 24/24 normal-conversation cases stay TN
 * - 7/7 hard "nido" negatives stay TN
 * - zero regression on baseline true positives: every case the frozen
 *   @0728bae mirror caught (expected SK) must still route to SELF_KNOWLEDGE
 *   (the single documented residual, fn-usage-01 "show me how to pair
 *   another phone", was already an FN at baseline)
 *
 * Ambiguous (AMB) cases are reported separately and excluded from scoring.
 * Every residual FP/FN is printed verbatim with the exact producing rule
 * (via debugClassify). If these gates fail: STOP + design packet, no
 * auto-escalation to Design 3.
 */

import { describe, it, expect } from "vitest";
import { debugClassify } from "../selfKnowledge";
import { SELF_KNOWLEDGE_CORPUS, type CorpusCase } from "./selfKnowledgeCorpus";
import {
  runCorpus,
  runMirrorCorpus,
  confusionOf,
  ratesOf,
  type CaseResult,
} from "./selfKnowledgeCorpus.harness";

function ruleOf(c: CorpusCase): string {
  const d = debugClassify(c.query);
  if (!d) return "(no rule — clean miss)";
  const extra = d.typoSubstituted ? " [typo-substituted]" : "";
  const rest = d.rest ? ` rest=${JSON.stringify(d.rest)}` : "";
  return `${d.category} :: ${d.pattern}${rest}${extra}`;
}

export function buildPhaseBReport(results: CaseResult[] = runCorpus()): string {
  const m = confusionOf(results);
  const r = ratesOf(m);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push("# D-CLUSTER PHASE B — Design 1 + Design 2 measurement (frozen corpus)");
  lines.push("");
  lines.push(`Corpus: ${SELF_KNOWLEDGE_CORPUS.length} cases (${m.tp + m.tn + m.fp + m.fn} adjudicated, ${m.amb} ambiguous)`);
  lines.push("");
  lines.push("## Confusion matrix");
  lines.push("");
  lines.push("|  | expected SK | expected NP |");
  lines.push("|---|---|---|");
  lines.push(`| got SK | TP ${m.tp} | FP ${m.fp} |`);
  lines.push(`| got NP | FN ${m.fn} | TN ${m.tn} |`);
  lines.push("");
  lines.push("## Rates vs gates");
  lines.push("");
  lines.push(`- precision: ${pct(r.precision)} (gate ≥ 95%)`);
  lines.push(`- recall: ${pct(r.recall)} (gate ≥ 90%)`);
  lines.push(`- false-positive rate: ${pct(r.fpRate)} (gate ≤ 5%)`);
  lines.push(`- false-negative rate: ${pct(r.fnRate)}`);
  lines.push(`- accuracy (adjudicated): ${pct(r.accuracy)}`);
  lines.push("");
  lines.push("## Delta vs Phase A baseline (68.1% / 75.4% / 41.8% / 24.6%)");
  lines.push("");
  lines.push(`- precision: 68.1% → ${pct(r.precision)}`);
  lines.push(`- recall: 75.4% → ${pct(r.recall)}`);
  lines.push(`- FP rate: 41.8% → ${pct(r.fpRate)}`);
  lines.push(`- FN rate: 24.6% → ${pct(r.fnRate)}`);
  lines.push("");
  lines.push("## Breakdown by language");
  lines.push("");
  for (const lang of ["en", "es", "pt"] as const) {
    const sub = confusionOf(results.filter((x) => x.c.lang === lang && x.c.expected !== "AMB"));
    const sr = ratesOf(sub);
    lines.push(`- ${lang}: n=${sub.tp + sub.tn + sub.fp + sub.fn} TP=${sub.tp} FP=${sub.fp} FN=${sub.fn} TN=${sub.tn} prec=${pct(sr.precision)} rec=${pct(sr.recall)}`);
  }
  lines.push("");
  lines.push("## Residual false positives (complete, verbatim)");
  lines.push("");
  const fps = results.filter((x) => x.verdict === "FP");
  for (const x of fps) {
    lines.push(`- [${x.c.id}] ${JSON.stringify(x.c.query)} (${x.c.lang}) — ${x.c.note} — rule: ${ruleOf(x.c)}`);
  }
  if (fps.length === 0) lines.push("(none)");
  lines.push("");
  lines.push("## Residual false negatives (complete, verbatim)");
  lines.push("");
  const fns = results.filter((x) => x.verdict === "FN");
  for (const x of fns) {
    lines.push(`- [${x.c.id}] ${JSON.stringify(x.c.query)} (${x.c.lang}) — ${x.c.note} — rule: ${ruleOf(x.c)}`);
  }
  if (fns.length === 0) lines.push("(none)");
  lines.push("");
  lines.push("## Ambiguous cases (separated, not forced)");
  lines.push("");
  for (const x of results.filter((x) => x.verdict === "AMB_SK" || x.verdict === "AMB_NP")) {
    lines.push(`- [${x.c.id}] ${JSON.stringify(x.c.query)} → classified ${x.got} — ${x.c.note}`);
  }
  lines.push("");
  return lines.join("\n");
}

describe("D-cluster Phase B — Design 1 + Design 2 gates (frozen corpus)", () => {
  it("meets the owner-authorized metric gates", () => {
    const m = confusionOf(runCorpus());
    const r = ratesOf(m);
    expect(r.precision, `precision ${r.precision}`).toBeGreaterThanOrEqual(0.95);
    expect(r.recall, `recall ${r.recall}`).toBeGreaterThanOrEqual(0.9);
    expect(r.fpRate, `FP rate ${r.fpRate}`).toBeLessThanOrEqual(0.05);
  });

  it("24/24 normal-conversation cases stay TN", () => {
    const results = runCorpus();
    const normal = results.filter((x) => x.c.topic === "normal" && x.c.expected === "NP");
    expect(normal.length).toBe(24);
    for (const x of normal) {
      expect(x.verdict, `normal-conversation hijack: [${x.c.id}] ${JSON.stringify(x.c.query)}`).toBe("TN");
    }
  });

  it("7/7 hard 'nido' negatives stay TN", () => {
    const results = runCorpus();
    const hard = results.filter((x) => x.c.topic === "hard-nido");
    expect(hard.length).toBe(7);
    for (const x of hard) {
      expect(x.verdict, `hard-nido regression: [${x.c.id}] ${JSON.stringify(x.c.query)}`).toBe("TN");
    }
  });

  it("zero regression on baseline true positives", () => {
    // Every case the frozen @0728bae mirror caught (expected SK) must
    // still route to SELF_KNOWLEDGE under the new rules.
    const mirrorTP = new Set(
      runMirrorCorpus()
        .filter((x) => x.verdict === "TP")
        .map((x) => x.c.id),
    );
    const prod = runCorpus();
    for (const x of prod) {
      if (x.c.expected === "SK" && mirrorTP.has(x.c.id)) {
        expect(x.verdict, `regression on baseline TP [${x.c.id}] ${JSON.stringify(x.c.query)}`).toBe("TP");
      }
    }
  });

  it("prints the Phase B measurement report", () => {
    // Human/audit artifact: captured into ~/workspace/audits/.
    // eslint-disable-next-line no-console
    console.log(buildPhaseBReport());
  });
});
