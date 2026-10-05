# Eval Results Ledger

**Purpose:** track answer quality across releases so regressions are visible and
improvements are proven. What is not measured does not improve.

**Method:** fixed eval set, source of truth `src/eval/evalSet.ts` (`EVAL_SET_VERSION`
bumped on any query change). Run on-device per `../DEVICE_EVALUATION.md`, grade by
hand per `../EVAL_QUERIES.md`. Every row records the eval-set version it was produced
with — scores across different set versions are **not** comparable.

**Scoring (per answer, hand-graded):**
- `2` correct and well-grounded (cites the retrieved source where applicable)
- `1` partially correct / correct but ungrounded when grounding was expected
- `0` wrong, hallucinated, or refused without reason

## Ledger

| Date | Release / APK SHA-256 (short) | Model | Eval set | n | Greeting /2 | Factual /4 | Explanation /4 | Comparison /4 | Synthesis /6 | Reasoning /6 | Grounded /4 | Total /30 | Perf: TTFT p50 | Perf: tok/s p50 | Grader | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | _no releases graded yet_ |

## Rules

1. One row per (release, model) pair. A release tested with two models gets two rows.
2. Never edit a recorded row. If a grading error is found, add a corrected row and
   note the superseded date in Notes.
3. A release **fails G5** of the verification protocol if its Total regresses vs the
   previous release row without a documented reason in Notes.
4. Perf columns come from the same on-device run (real device numbers only —
   no invented data, ever; see R-3 in `../ADAPTIVE_ROUTING.md`).
5. Keep raw grading notes (per-query scores) in `docs/ci-evidence/releases/<version>/G5/`.
