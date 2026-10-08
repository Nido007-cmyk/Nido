/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Local (no-device) retrieval evaluation — the lexical channel only.
 *
 * WHAT IT MEASURES
 * The fixed EVAL_SET (src/eval/evalSet.ts) is run against the bundled
 * 300-article corpus (assets/corpus/corpus.json) using the SAME
 * query-reduction and relevance-gate code the device uses:
 * buildLexicalQuery + filterByTermCoverage from src/rag/pure.ts.
 *
 * WHAT IT DOES NOT MEASURE
 * - The semantic channel: it needs the on-device embedding model, so it
 *   is device-only (see src/eval/evalHarness.ts + `npm run eval:device`).
 * - SQLite FTS5's BM25 ranking: no FTS5 here. Candidate generation is a
 *   small, auditable pure-TS term-frequency scorer (scoreLocalLexical)
 *   that stands in for FTS5's candidate ranking. The interesting
 *   NIDO-specific logic — query reduction to content words and the
 *   term-coverage relevance gate — is the real code, not an imitation.
 * - Answer quality: needs the local LLM, device-only.
 *
 * Read the numbers as "lexical retrieval quality of the bundled corpus",
 * comparable across runs of this harness (same corpus + same eval set
 * version), not as absolute device retrieval quality.
 */
import {
  buildLexicalQuery,
  filterByTermCoverage,
  type LexicalTerm,
} from "../rag/pure";
import { EVAL_SET_VERSION, type EvalCategory, type EvalQuery } from "./evalSet";

export interface LocalCorpusDoc {
  id: string;
  title: string;
  body: string;
}

function tokenizeLocal(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Pure-TS stand-in for the device's FTS5 BM25 candidate generation.
 * Score = sum over query terms of (2 x title term-frequency + body
 * term-frequency), counting every word form the term carries
 * (e.g. "vaccines" also matches "vaccine"). Title counts double because
 * on the device the article title is the strongest lexical signal for
 * these short encyclopedia articles. Deterministic; ties broken by
 * document id so runs are reproducible.
 */
export function scoreLocalLexical(
  terms: LexicalTerm[],
  docs: LocalCorpusDoc[]
): Array<{ doc: LocalCorpusDoc; score: number }> {
  const scored = docs.map((doc) => {
    const titleTokens = tokenizeLocal(doc.title);
    const bodyTokens = tokenizeLocal(doc.body);
    let score = 0;
    for (const term of terms) {
      for (const form of term.forms) {
        let titleHits = 0;
        let bodyHits = 0;
        for (const t of titleTokens) if (t === form) titleHits++;
        for (const t of bodyTokens) if (t === form) bodyHits++;
        score += 2 * titleHits + bodyHits;
      }
    }
    return { doc, score };
  });
  scored.sort((a, b) => b.score - a.score || (a.doc.id < b.doc.id ? -1 : 1));
  return scored;
}

/**
 * Runs one query through the local lexical path: query reduction
 * (buildLexicalQuery), candidate scoring (scoreLocalLexical, the FTS5
 * stand-in), then the REAL term-coverage relevance gate
 * (filterByTermCoverage) in score order, capped at topK.
 */
export function retrieveLocalLexical(
  query: string,
  docs: LocalCorpusDoc[],
  topK: number
): LocalCorpusDoc[] {
  const lexicalQuery = buildLexicalQuery(query);
  if (!lexicalQuery) return [];
  const ranked = scoreLocalLexical(lexicalQuery.terms, docs).map((s) => s.doc);
  return filterByTermCoverage(ranked, lexicalQuery.terms).slice(0, topK);
}

export interface LocalRetrievalRow {
  evalSetVersion: string;
  channel: "lexical-local";
  corpusId: string;
  topK: number;
  queryId: string;
  category: EvalCategory;
  query: string;
  retrievedTitles: string[];
  expectedTitles: string[];
  /** Any expected title within the top 1/3/6. Null when no titles are expected. */
  hitAt1: boolean | null;
  hitAt3: boolean | null;
  hitAt6: boolean | null;
  /** Every expected title retrieved within topK. Null when none expected. */
  allExpectedHit: boolean | null;
  /** 1/rank of the first expected title hit. Null when no titles expected or none hit. */
  reciprocalRank: number | null;
  latencyMs: number;
  createdAt: number;
}

function hitWithin(retrieved: string[], expected: string[], k: number): boolean | null {
  if (expected.length === 0) return null;
  return retrieved.slice(0, k).some((t) => expected.includes(t));
}

function reciprocalRank(retrieved: string[], expected: string[]): number | null {
  if (expected.length === 0) return null;
  const rank = retrieved.findIndex((t) => expected.includes(t));
  return rank === -1 ? 0 : 1 / (rank + 1);
}

export function runLocalRetrievalEval(
  docs: LocalCorpusDoc[],
  queries: EvalQuery[],
  topK: number,
  corpusId: string
): LocalRetrievalRow[] {
  return queries.map((q) => {
    const start = performance.now();
    const retrieved = retrieveLocalLexical(q.query, docs, topK);
    const latencyMs = performance.now() - start;
    const retrievedTitles = retrieved.map((d) => d.title);
    return {
      evalSetVersion: EVAL_SET_VERSION,
      channel: "lexical-local",
      corpusId,
      topK,
      queryId: q.id,
      category: q.category,
      query: q.query,
      retrievedTitles,
      expectedTitles: q.expectedKbTitles,
      hitAt1: hitWithin(retrievedTitles, q.expectedKbTitles, 1),
      hitAt3: hitWithin(retrievedTitles, q.expectedKbTitles, 3),
      hitAt6: hitWithin(retrievedTitles, q.expectedKbTitles, 6),
      allExpectedHit:
        q.expectedKbTitles.length === 0
          ? null
          : q.expectedKbTitles.every((t) => retrievedTitles.includes(t)),
      reciprocalRank: reciprocalRank(retrievedTitles, q.expectedKbTitles),
      latencyMs,
      createdAt: Date.now(),
    };
  });
}

export interface LocalRetrievalCategorySummary {
  queries: number;
  scored: number;
  hitRateAt6: number;
}

export interface LocalRetrievalSummary {
  evalSetVersion: string;
  channel: "lexical-local";
  corpusId: string;
  topK: number;
  queryCount: number;
  /** Queries that expect at least one corpus title. */
  scoredQueryCount: number;
  hitRateAt1: number;
  hitRateAt3: number;
  hitRateAt6: number;
  allExpectedHitRate: number;
  meanReciprocalRank: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
  noHitQueryIds: string[];
  byCategory: Record<string, LocalRetrievalCategorySummary>;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function summarizeLocalRetrieval(
  rows: LocalRetrievalRow[],
  corpusId: string,
  topK: number
): LocalRetrievalSummary {
  const scored = rows.filter((r) => r.expectedTitles.length > 0);
  const rate = (f: (r: LocalRetrievalRow) => boolean | null) => {
    const vals = scored.map(f).filter((v): v is boolean => v !== null);
    return vals.length === 0 ? 0 : vals.filter(Boolean).length / vals.length;
  };
  const latencies = [...rows.map((r) => r.latencyMs)].sort((a, b) => a - b);
  const p95 = latencies.length === 0 ? 0 : latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];

  const byCategory: Record<string, LocalRetrievalCategorySummary> = {};
  for (const r of rows) {
    const c = (byCategory[r.category] ??= { queries: 0, scored: 0, hitRateAt6: 0 });
    c.queries++;
    if (r.expectedTitles.length > 0) c.scored++;
  }
  for (const key of Object.keys(byCategory)) {
    const catRows = scored.filter((r) => r.category === key);
    byCategory[key].hitRateAt6 =
      catRows.length === 0 ? 0 : catRows.filter((r) => r.hitAt6).length / catRows.length;
  }

  return {
    evalSetVersion: EVAL_SET_VERSION,
    channel: "lexical-local",
    corpusId,
    topK,
    queryCount: rows.length,
    scoredQueryCount: scored.length,
    hitRateAt1: rate((r) => r.hitAt1),
    hitRateAt3: rate((r) => r.hitAt3),
    hitRateAt6: rate((r) => r.hitAt6),
    allExpectedHitRate: rate((r) => r.allExpectedHit),
    meanReciprocalRank: mean(scored.map((r) => r.reciprocalRank ?? 0)),
    meanLatencyMs: mean(rows.map((r) => r.latencyMs)),
    p95LatencyMs: p95,
    noHitQueryIds: scored.filter((r) => !r.hitAt6).map((r) => r.queryId),
    byCategory,
  };
}

export function localRetrievalRowsToJsonl(rows: LocalRetrievalRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Human-readable English summary printed by the runner and stored with results. */
export function localRetrievalSummaryText(s: LocalRetrievalSummary): string {
  const lines = [
    `NIDO local retrieval eval — channel=${s.channel} corpus=${s.corpusId} topK=${s.topK} evalSet=v${s.evalSetVersion}`,
    `queries: ${s.queryCount} total, ${s.scoredQueryCount} with expected KB titles`,
    `hit@1 ${pct(s.hitRateAt1)}  hit@3 ${pct(s.hitRateAt3)}  hit@6 ${pct(s.hitRateAt6)}  all-expected ${pct(s.allExpectedHitRate)}  MRR ${s.meanReciprocalRank.toFixed(3)}`,
    `latency: mean ${s.meanLatencyMs.toFixed(1)}ms  p95 ${s.p95LatencyMs.toFixed(1)}ms`,
    `no-hit queries: ${s.noHitQueryIds.length === 0 ? "none" : s.noHitQueryIds.join(", ")}`,
    `by category:`,
  ];
  for (const [cat, c] of Object.entries(s.byCategory)) {
    lines.push(`  ${cat}: ${c.queries} queries, ${c.scored} scored, hit@6 ${pct(c.hitRateAt6)}`);
  }
  return lines.join("\n");
}
