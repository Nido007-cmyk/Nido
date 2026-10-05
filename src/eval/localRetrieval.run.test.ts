/**
 * NIDO local retrieval eval RUNNER (not a unit test — it performs the
 * evaluation). Run with: npm run eval:local
 *
 * Runs the fixed EVAL_SET against the bundled 300-article corpus
 * (assets/corpus/corpus.json) through the local lexical path
 * (src/eval/localRetrieval.pure.ts), at topK=6 and topK=4. The 6-vs-4
 * comparison exists to measure the retrieval topK change with our own
 * numbers instead of adopting it blindly.
 *
 * Output: eval-results/local-retrieval-<timestamp>.jsonl (one row per
 * query per topK) plus a printed English summary. Pure local compute —
 * no device, no network, no native modules.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { EVAL_SET } from "./evalSet";
import {
  localRetrievalRowsToJsonl,
  localRetrievalSummaryText,
  runLocalRetrievalEval,
  summarizeLocalRetrieval,
  type LocalCorpusDoc,
  type LocalRetrievalRow,
} from "./localRetrieval.pure";

const CORPUS_ID = "assets/corpus/corpus.json";
const TOP_KS = [6, 4];

function loadBundledCorpus(): LocalCorpusDoc[] {
  const raw = fs.readFileSync(path.resolve(process.cwd(), CORPUS_ID), "utf8");
  const parsed = JSON.parse(raw) as Array<{ title: string; body: string }>;
  return parsed.map((d, i) => ({ id: `corpus-${i}`, title: d.title, body: d.body }));
}

describe("NIDO local retrieval eval", () => {
  it("runs the eval set against the bundled corpus and writes a report", () => {
    const docs = loadBundledCorpus();
    expect(docs.length).toBeGreaterThan(0);

    const allRows: LocalRetrievalRow[] = [];
    const summaries: string[] = [];
    for (const topK of TOP_KS) {
      const rows = runLocalRetrievalEval(docs, EVAL_SET, topK, CORPUS_ID);
      expect(rows.length).toBe(EVAL_SET.length);
      allRows.push(...rows);
      const summary = summarizeLocalRetrieval(rows, CORPUS_ID, topK);
      const text = localRetrievalSummaryText(summary);
      summaries.push(text);
      console.log("\n" + text + "\n");
    }

    const outDir = path.resolve(process.cwd(), "eval-results");
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = path.join(outDir, `local-retrieval-${stamp}.jsonl`);
    fs.writeFileSync(outPath, localRetrievalRowsToJsonl(allRows) + "\n");
    console.log(`[eval:local] wrote ${allRows.length} rows to ${outPath}`);

    // Sanity: the harness itself must stay honest — every scored query's
    // row carries the titles it was judged against.
    for (const r of allRows) {
      if (r.expectedTitles.length > 0) {
        expect(r.hitAt6).not.toBeNull();
      }
    }
    expect(summaries.length).toBe(TOP_KS.length);
  }, 120000);
});
