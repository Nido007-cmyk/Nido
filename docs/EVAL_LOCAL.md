# NIDO local retrieval eval (`npm run eval:local`)

Runs the fixed evaluation set (`src/eval/evalSet.ts`) against the bundled
300-article corpus (`assets/corpus/corpus.json`) **on this machine** — no
device, no network, no native modules. It measures the **lexical retrieval
channel only**.

## What it runs

For each of the 17 eval queries, at `topK = 6` and `topK = 4`:

1. **Query reduction** — the real `buildLexicalQuery` (src/rag/pure.ts):
   the question is reduced to its content words (stopwords dropped,
   plurals expanded), exactly as on device.
2. **Candidate scoring** — `scoreLocalLexical`, a small pure-TS
   term-frequency scorer (2x title weight). This is a stand-in for
   SQLite FTS5's BM25 ranking, which isn't available here. It is
   deliberately simple and auditable.
3. **Relevance gate** — the real `filterByTermCoverage` (src/rag/pure.ts):
   hits must cover enough of the query's content terms. Same code as the
   device path.

Per query it records: retrieved titles, expected titles, hit@1/3/6,
all-expected-hit, reciprocal rank, and latency. Results go to
`eval-results/local-retrieval-<timestamp>.jsonl` (gitignored), one JSON
object per line, plus a printed summary.

## Latest baseline (2026-09-28, eval set v1, bundled corpus)

| | topK=6 | topK=4 |
|---|---|---|
| hit@1 / hit@3 / hit@6 | 60.0% | 60.0% |
| all-expected-hit | 60.0% | 60.0% |
| mean reciprocal rank | 0.600 | 0.600 |
| mean latency | ~52ms | ~50ms |

Scored queries: 10 of 17 (7 expect no KB titles by design). Every hit is
at rank 1 — no expected title ever appears at rank 2-6, which is why
topK 6 vs 4 changes nothing on this set.

**Misses (4):** `comparison-2`, `synthesis-1`, `synthesis-2`,
`synthesis-3` — all long, multi-part questions. The term-coverage gate
requires half of the (up to 12) content terms, and no article covers
that many, so the gate rejects everything. The articles exist in the
corpus; the gate is what filters them out.

## How to read the numbers

- These are **lexical-channel** numbers with an approximate ranker. They
  are comparable across runs of this harness (same corpus, same eval set
  version), and they are the input for retrieval-tuning decisions
  (e.g. the topK 6→4 question: measured, no quality change on this set).
- They are **not** device retrieval quality: on device, FTS5 ranks
  candidates and the **semantic channel** (embedding model, device-only)
  can rescue queries the lexical gate rejects. Answer quality needs the
  local LLM — also device-only (see `npm run eval:device` and
  docs/DEVICE_EVALUATION.md).
- A miss here is a hypothesis about the lexical path, not a proven
  device bug. Confirm on device before changing retrieval code.

## Files

- `src/eval/localRetrieval.pure.ts` — scorer, metrics, report formatting
  (unit-testable, no native deps)
- `src/eval/localRetrieval.pure.test.ts` — unit tests (synthetic corpus)
- `src/eval/localRetrieval.run.test.ts` — the eval runner (excluded from
  `npm test`; launched via `npm run eval:local`)
- `vitest.eval.config.mts` — runner-only vitest config
