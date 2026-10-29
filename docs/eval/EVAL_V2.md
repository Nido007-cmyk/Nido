# Evaluation v2

Version 2 of NIDO's evaluation measures what matters most for a private,
offline assistant: first aid shown exactly as written, emergency numbers
never guessed, actions that always ask first, honest "I don't know"
answers, and attacks that must not work. Version 1 (17 research questions,
[EVAL_QUERIES.md](../EVAL_QUERIES.md)) stays as it is.

Source of truth: [`src/eval/cases/v2.json`](../../src/eval/cases/v2.json)
(118 cases), typed in [`src/eval/evalSetV2.ts`](../../src/eval/evalSetV2.ts).

## Who checks each case

| Runner | Where it runs | What it proves |
| --- | --- | --- |
| `ci-router`, `ci-safety` (47 cases) | Every PR, in `npm test` ([`evalV2.deterministic.test.ts`](../../src/eval/evalV2.deterministic.test.ts)) | The real routers send the question where it should go, with no model: emergency numbers, carbon monoxide, tools, small talk |
| `pack-retrieval+device` (20 first aid cases) | The knowledge pack workflow, at 100% ([`first-aid-checks.json`](../../knowledge-packs/nido-esencial/first-aid-checks.json)) | The right guide is found with the real embedding model |
| `device` (71 cases) | On a phone | The full answer: guide shown as written, honest abstention, no action from untrusted content |

The routing order comes from `routeOf()` in
[`routerSweep.pure.ts`](../../src/eval/routerSweep.pure.ts), which already
follows the chat and the agent; the evaluation doesn't keep a second router.

[`evalSetV2.test.ts`](../../src/eval/evalSetV2.test.ts) keeps the cases true:
every `guide:` names the start of exactly one real guide title, every phrase
required from a first aid guide is in that guide, and every region exists in
NIDO Local.

## Known failures

A case that fails on purpose goes in
[`src/eval/cases/known-failures.json`](../../src/eval/cases/known-failures.json)
with its issue. If it starts passing, the test fails until it is removed from
the list, so the list can't go stale. It is empty today: the three failures
the first run found (a gas heater with symptoms gave no carbon monoxide
warning; two ways of asking to send a NIDO message) were fixed in 0.1.60.

## Still to do

- Phone runs go through the same path as the chat (today the in-app
  harness calls the model pipeline directly and skips safety answers,
  guides and tools), with fixed decoding settings so results compare across
  releases.
- More Portuguese cases (10 of 118 today).
- A held-out set written by someone who didn't write the fixes.
