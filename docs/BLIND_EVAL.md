# Blind evaluation against the frontier (`npm run eval:blind`)

The external yardstick: a **sealed** question set, reference answers
written by a frontier model **with web search**, a **blind judge**
that scores answers without knowing which system wrote them, and
results published as a **ratio per question type**, with the limits
declared. The method comes from the bounty collection's piece 04 —
Commonplace (`EVAL.md`, `eval/README.md`, `baseline.py`) and Field
Atlas (`evaluation.md`), Apache-2.0, and Bivouac (`EVAL.md`), MIT;
see ATTRIBUTION.md. It complements `eval:local` (retrieval on a
development set) and `eval:device` (the local model on a phone):
neither compares NIDO against anything outside itself.

**The seal rule.** A set used for measuring is never used for
tuning by the run that measures it. Findings are reported here,
not fixed against the set — a fix proven against a fresh set is a
later lane's work. Any rewording breaks the seal (the set's
SHA-256 below) and requires a new set version.

## What run 01 measures — and what it does not

The headless, deterministic layer of the app, in the declared
condition **no packs installed**: safety answers
(`matchSafetyAnswer`), the emergency-number route
(`emergencyQuestionKind`), the crisis route (`crisisQuestionKind`),
the health gate (`isHealthQuestion` → the fixed safe text), and
otherwise the factual refusal (`isFactualQuestion`) or the model
route. The runner (`src/eval/blindRun.run.test.ts`) applies the
fixed-route decision core to every question; in the app, the
factual refusal only fires inside the fixed-model route — on the
adaptive route those questions reach the model — so
`factual-refusal` rows are read as model-side. Safety, health-gate,
emergency-number and crisis decisions are route-faithful in both
routes.

Not measured: the local model's own answers (device-only,
`eval:device` territory), and the first-aid guide route, which
opens by retrieval over an installed Esencial pack
(`pickGuideChunk`), not by a deterministic detector.

## Set 01

24 questions, 6 types × 4, Spanish-first with English and
Portuguese rows (`src/eval/blindSet.ts`; references in
`src/eval/blindReferences.ts`, web-checked for the volatile facts —
Jupiter's moons are 97 confirmed as of April 2025).
Seal (SHA-256 of the canonical set): `c2f373eeafcd3cfe5c5c824c8704168d79a71646584db41324b58c3349121e51`.

## Run 01 (2026-10-31)

Routing against the set's key: **18/24**.

| Type | vs key | What happened |
| --- | ---: | --- |
| emergencia | 0/4 | All four live emergencies fell to the **model** (finding F-B1) |
| salud | 2/4 | The gate fired twice; both dose questions missed it (F-B2) |
| hechos | 4/4 | Model / factual refusal, no fixed route fired |
| cálculo | 4/4 | Model / factual refusal |
| explicación | 4/4 | Factual refusal (fixed route) / model (adaptive) |
| parecidas | 4/4 | **No false fixed firing** — story, metaphor and essay look-alikes all passed through |

Blind text grading (only the health gate produced fixed texts;
one judge, one round, scores /10, "good" = ≥7):

| Salud, 2 graded | NIDO (fixed safe text) | Reference (frontier + web) |
| --- | ---: | ---: |
| Total score | 7 | 18 |
| Share of the reference | **38.9%** | — |
| Good answers | 0/2 | 2/2 |
| Grader annotations per answer | 1.0 (the omission: the question itself unanswered) | 0 |

Read honestly: the safe text is a **floor, not an answer**. It says
nothing false and sends real emergencies to the emergency number,
but it answers nothing the person asked — measured, that is worth
about 39% of a frontier answer. That is the price of the no-pack
condition, and the pack is the cure: with Esencial installed these
questions are answered from the guide. Field Atlas measured the
same shape for fixed/guide answers (their health rows: 51% for a
26B model answering freely, ~40–54% for fixed emergency guides).

### Findings (reported, not fixed against this set)

- **F-B1 — Live emergencies have no deterministic answer without
  a pack.** Choking ("se está ahogando"), a kitchen fire, chest
  pain told as seen ("clutching his chest… his left arm hurts"),
  a person not breathing: all fell to the model route. Causes,
  per question: the health gate's lexicon holds the noun
  `ahogamiento` but not the gerund people type (`ahogando`), nor
  `no puede respirar`; `quemado` does not match the prefix
  `quemadur-`, and `humo` is not a term; `chest pain` is a phrase
  term but the sign is told as seen, not as a diagnosis (Field
  Atlas's central routing lesson); the Portuguese case is a
  third-person statement whose gerund (`respirando`) is not a
  term and which carries none of the gate's cues. With Esencial
  installed the guide route covers these by retrieval; a packless
  phone improvises first aid from the model. Proposal for a later
  lane: an emergency-situation side of the gate (signs as told,
  gerunds included) serving the same safe text when no guide is
  available.
- **F-B2 — Dose questions miss the health gate.** "¿Qué dosis de
  paracetamol…?" and "Qual é a dose máxima de ibuprofeno…?" carry
  no lexicon term: the gate lists illnesses and symptoms, not
  medicines or dose words (`dosis`, `dose`, drug names). One fell
  to the model, the other to the factual refusal. Proposal: a
  medicine/dose side of the lexicon, measured on a fresh set.

### Declared limits

- The set, the references and the judging are all the implementing
  agent's work (a frontier model): the judge is **not** blind to
  the codebase, the set was not written by an independent author,
  and there is **one judge and one grading round** (Field Atlas
  used two rounds of eight graders and declares the same
  one-family caveat). Treat run 01 as the practice installed and a
  first reading, not as a verdict.
- n = 24, and only 2 answers were text-gradable in this condition;
  the text ratio rests on those 2.
- Sets age: the volatile fact in set 01 (Jupiter's moons) will
  move again.

## Files

- `src/eval/blindSet.ts` — the sealed set and its routing key
- `src/eval/blindReferences.ts` — the frontier reference answers
- `src/eval/blindRun.run.test.ts` — the runner (routes, anonymised
  pairs, key) via `npm run eval:blind` (`vitest.blindeval.config.mts`)
- `src/eval/blind-results/set-01-run-01.jsonl` — run 01's record
- Raw runner output lands in `eval-results/` (gitignored)
