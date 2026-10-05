/**
 * D-CLUSTER eval harness (NOT a test file — no describe/it here).
 *
 * Shared by:
 * - selfKnowledgeCorpus.baseline.test.ts — verifies the FROZEN Phase A
 *   baseline as a historical artifact: the static BASELINE_PATTERN_MIRROR
 *   (@0728bae patterns) must keep reproducing TP 49 / FP 23 / FN 16 /
 *   TN 32 over the untouched corpus. The corpus data file and snapshot
 *   are NOT modified by Phase B.
 * - selfKnowledgeCorpus.phaseb.test.ts — runs LIVE production over the
 *   frozen corpus and asserts the Phase B gates.
 * - selfKnowledgeCorpus.heldout.test.ts — runs LIVE production over the
 *   held-out set (frozen pre-tuning) exactly once.
 *
 * Ambiguous (AMB) cases are reported separately and excluded from
 * precision/recall everywhere.
 */

// Non-test harness module (imported by the baseline, Phase B, and held-out tests).
import { classifyKnowledgeQuery } from "../selfKnowledge";
import { classifyTask } from "../../routing/classify";
import {
  SELF_KNOWLEDGE_CORPUS,
  BASELINE_PATTERN_MIRROR,
  type CorpusCase,
  type ExpectedRoute,
} from "./selfKnowledgeCorpus";

export type Verdict = "TP" | "TN" | "FP" | "FN" | "AMB_SK" | "AMB_NP";

export interface CaseResult {
  c: CorpusCase;
  got: "SK" | "NP";
  verdict: Verdict;
  /** Exact producing rule (frozen mirror), or null for clean misses. */
  rule: string | null;
}

export interface Confusion {
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  amb: number;
}

export function normalizeLikeProduction(query: string): string {
  return (
    query
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/['‘’]/g, "")
      .replace(/[?!¡¿.,;:()"«»—–-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** First production-ordered pattern that matches — eval diagnosis only. */
export function attributeRule(query: string): { category: string; label: string } | null {
  const normalized = normalizeLikeProduction(query);
  if (normalized.length === 0) return null;
  for (const { category, label, re } of BASELINE_PATTERN_MIRROR) {
    if (re.test(normalized)) return { category, label };
  }
  return null;
}

export function runCorpus(cases: CorpusCase[] = SELF_KNOWLEDGE_CORPUS): CaseResult[] {
  return cases.map((c) => {
    const got: "SK" | "NP" = classifyKnowledgeQuery(c.query) !== null ? "SK" : "NP";
    const rule = attributeRule(c.query);
    const ruleLabel = rule ? `${rule.category}/${rule.label}` : null;
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
    return { c, got, verdict, rule: ruleLabel };
  });
}

/**
 * Runs the FROZEN @0728bae mirror over the corpus — the historical
 * baseline, independent of whatever production does today. The mirror is
 * a static copy of the old patterns; it cannot drift.
 */
export function runMirrorCorpus(cases: CorpusCase[] = SELF_KNOWLEDGE_CORPUS): CaseResult[] {
  return cases.map((c) => {
    const got: "SK" | "NP" = attributeRule(c.query) !== null ? "SK" : "NP";
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
    const rule = attributeRule(c.query);
    return { c, got, verdict, rule: rule ? `${rule.category}/${rule.label}` : null };
  });
}

export function confusionOf(results: CaseResult[]): Confusion {
  const m: Confusion = { tp: 0, tn: 0, fp: 0, fn: 0, amb: 0 };
  for (const r of results) {
    if (r.verdict === "TP") m.tp++;
    else if (r.verdict === "TN") m.tn++;
    else if (r.verdict === "FP") m.fp++;
    else if (r.verdict === "FN") m.fn++;
    else m.amb++;
  }
  return m;
}

export interface RateSummary {
  precision: number;
  recall: number;
  fpRate: number;
  fnRate: number;
  accuracy: number;
}

export function ratesOf(m: Confusion): RateSummary {
  const precision = m.tp + m.fp === 0 ? 1 : m.tp / (m.tp + m.fp);
  const recall = m.tp + m.fn === 0 ? 1 : m.tp / (m.tp + m.fn);
  const fpRate = m.fp + m.tn === 0 ? 0 : m.fp / (m.fp + m.tn);
  const fnRate = m.fn + m.tp === 0 ? 0 : m.fn / (m.fn + m.tp);
  const accuracy = m.tp + m.tn + m.fp + m.fn === 0 ? 1 : (m.tp + m.tn) / (m.tp + m.tn + m.fp + m.fn);
  return { precision, recall, fpRate, fnRate, accuracy };
}

export interface FnTrace {
  id: string;
  query: string;
  expected: ExpectedRoute;
  taskType: string;
  destination: string;
  falseIdentityPossible: boolean;
}

/**
 * Traces an FN to its real next destination. After the KB intercept misses,
 * ChatScreen sends the query to classifyTask → (fixed-model or adaptive
 * path) → retrieval (unless retrieval-irrelevant) → llamaEngine.generate
 * with the system prompt ("You are Nido, a concise offline research
 * assistant" — which names the brand but carries NO canonical
 * self-knowledge). A small model with zero relevant chunks free-associates
 * → the exact failure class seen in the Tab A9+ live evidence.
 */
export function traceFalseNegative(c: CorpusCase): FnTrace {
  const taskType = classifyTask(c.query);
  const retrievalIrrelevant =
    taskType === "calculate" || taskType === "translate" || taskType === "code" || taskType === "greeting";
  const destination = retrievalIrrelevant
    ? "model only (no retrieval)"
    : "retrieval → model (llamaEngine.generate)";
  // "research"/"lookup"/"chat" all end at the model with the brand-naming
  // system prompt and typically zero relevant chunks — the model
  // improvises the identity answer.
  const falseIdentityPossible = true;
  return { id: c.id, query: c.query, expected: c.expected, taskType, destination, falseIdentityPossible };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function buildReport(results: CaseResult[] = runMirrorCorpus()): string {
  const m = confusionOf(results);
  const r = ratesOf(m);
  const lines: string[] = [];
  lines.push("# D-CLUSTER PHASE A — self-knowledge baseline @ 0728bae");
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
  lines.push("## Rates");
  lines.push("");
  lines.push(`- precision: ${pct(r.precision)}`);
  lines.push(`- recall: ${pct(r.recall)}`);
  lines.push(`- false-positive rate: ${pct(r.fpRate)}`);
  lines.push(`- false-negative rate: ${pct(r.fnRate)}`);
  lines.push(`- accuracy (adjudicated): ${pct(r.accuracy)}`);
  lines.push("");
  lines.push("## Breakdown by language");
  lines.push("");
  for (const lang of ["en", "es", "pt"] as const) {
    const sub = confusionOf(results.filter((x) => x.c.lang === lang && x.c.expected !== "AMB"));
    const sr = ratesOf(sub);
    lines.push(`- ${lang}: n=${sub.tp + sub.tn + sub.fp + sub.fn} TP=${sub.tp} FP=${sub.fp} FN=${sub.fn} TN=${sub.tn} prec=${pct(sr.precision)} rec=${pct(sr.recall)}`);
  }
  lines.push("");
  lines.push("## Breakdown by topic");
  lines.push("");
  const topics = [...new Set(results.map((x) => x.c.topic))].sort();
  for (const topic of topics) {
    const sub = confusionOf(results.filter((x) => x.c.topic === topic));
    const adj = sub.tp + sub.tn + sub.fp + sub.fn;
    const sr = ratesOf(sub);
    lines.push(`- ${topic}: n=${adj}${sub.amb ? ` (+${sub.amb} amb)` : ""} TP=${sub.tp} FP=${sub.fp} FN=${sub.fn} TN=${sub.tn} prec=${pct(sr.precision)} rec=${pct(sr.recall)}`);
  }
  lines.push("");
  lines.push("## False positives (complete)");
  lines.push("");
  const fps = results.filter((x) => x.verdict === "FP");
  for (const x of fps) {
    lines.push(`- [${x.c.id}] ${JSON.stringify(x.c.query)} (${x.c.lang}) — expected NP, got SK — rule: ${x.rule ?? "?"} — ${x.c.note}`);
  }
  if (fps.length === 0) lines.push("(none)");
  lines.push("");
  lines.push("## False negatives (complete)");
  lines.push("");
  const fns = results.filter((x) => x.verdict === "FN");
  for (const x of fns) {
    lines.push(`- [${x.c.id}] ${JSON.stringify(x.c.query)} (${x.c.lang}) — expected SK, got NP — ${x.c.note}`);
  }
  if (fns.length === 0) lines.push("(none)");
  lines.push("");
  lines.push("## Ambiguous cases (separated, not forced)");
  lines.push("");
  for (const x of results.filter((x) => x.verdict === "AMB_SK" || x.verdict === "AMB_NP")) {
    lines.push(`- [${x.c.id}] ${JSON.stringify(x.c.query)} → classified ${x.got} — ${x.c.note}`);
  }
  lines.push("");
  lines.push("## FN trace — next real destination after the KB intercept misses");
  lines.push("");
  for (const x of fns) {
    const t = traceFalseNegative(x.c);
    lines.push(`- [${t.id}] ${JSON.stringify(t.query)} → classifyTask=${t.taskType} → ${t.destination} → false identity response possible: ${t.falseIdentityPossible ? "YES" : "no"}`);
  }
  lines.push("");
  return lines.join("\n");
}

