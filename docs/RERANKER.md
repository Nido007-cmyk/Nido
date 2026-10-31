# Tiny reranker — measurement design and verdict: not adopted

Piece 03 of the bounty collection: Commonplace's retrieval
recipe (Apache-2.0) — BM25 and binary-code semantic search fused
by RRF, then a 17M-parameter Ettin cross-encoder, distilled from
a 400M teacher over the app's own pools, re-ranks the top 24
passages on the phone. NIDO's candidate use is pack retrieval,
where the house packs audit measured **Portuguese at 84% against
the 90% bar**, concentrated in five Esencial guides (child CPR,
anaphylaxis, carbon monoxide, severe bleeding, drowning).

**The rule this piece was adopted under: no measurement, no
adoption.** This document is the measurement design, the record
of why the measurement cannot run in this copy, and the verdict
that follows from the rule.

## The measurement (exactly this, in the packs lane)

Two arms over the audit's own gate, same pack, same set, same
machine:

```
node scripts/check-pack-retrieval.mjs <nido-esencial-e5.sqlite> \
  <the audit's pt checks.json> --model <multilingual-e5.gguf> \
  --langs pt --top 3 --min 0.9
```

- **Arm A (control)**: the app as it stands — FTS5 + e5 vectors,
  weighted-sum fusion (`fuseRetrievalResults`, src/rag/pure.ts).
  Expected to reproduce ≈84% on the Portuguese Esencial set.
- **Arm B (candidate)**: the same candidates, with a cross-encoder
  re-ranking the fused top 24 before selection (the seam is
  `src/rag/retrieve.ts`, right after the fusion call).
- **Adopt only if all three hold**: Portuguese reaches **≥ 90%**
  (the bar the audit set); Spanish and English on their own check
  files move **no more than 1 point down**; and the added latency
  per query stays inside the search budget on the modest-phone
  profile the game of gates already uses (a 17M cross-encoder
  over 24 short passages is the right order of magnitude — to be
  proven on the phone, not assumed).
- Report both arms per guide, naming the five problem guides
  individually: a mean that crosses 90% while child CPR stays
  broken is not a pass.

## Why it cannot run in this copy (verified 2026-10-31)

- This copy's `knowledge-packs/nido-esencial/` carries the
  Spanish and English guide trees and their check files
  (69 es + 64 en cases). **There are no Portuguese guides and no
  Portuguese check file here** — the 84% was measured in the
  packs working copy, where the Portuguese tree and its checks
  live.
- No built pack and no e5 embedding model are in this copy
  either (`assets/models/` is empty), and the gate needs both.
- The reranker's weights are not downloaded anywhere, and the
  piece's own honest cost applies: a reranker for NIDO must be
  **distilled over NIDO's own trilingual pools or adapted from
  theirs after checking the weight's license on its model card**
  — neither exists yet. A cross-encoder also needs an inference
  runtime the app does not currently ship.

Measuring a different candidate (say, a lexical re-shuffle) on
Spanish/English data and calling it the Portuguese verdict
would be exactly the dishonest shortcut the rule exists to
prevent: the Portuguese gap is a cross-lingual semantic gap, and
only the real set can judge a cure for it.

## Verdict

**Not adopted.** The piece stays as a reference with this design
attached. The work that unblocks it, in order: (1) the
Portuguese Esencial tree and its check file land in this repo
(they exist in the packs lane); (2) a reranker weight with a
verified license, or a distillation run over NIDO's pools;
(3) an inference path for it in the app; (4) the two-arm
measurement above, in the packs lane, judged by the three
conditions. Until (4) prints its numbers, no reranking code
enters the search path.
