> **Language:** English · [Español](es/ADAPTIVE_ROUTING.md)
# Adaptive Offline Intelligence — Phase 0 Architecture Audit

Branch: `adaptive-offline-ai`. This audit is the required Phase 0 deliverable
before any routing/execution-engine code is written, per the build plan.
Everything below reflects the actual current code (checked directly, not
recalled), not aspiration.

## 1. Model catalog and manifest

`src/models/manifest.ts` — `CatalogModel` (id, kind: `llm`/`embedding`/`corpus`,
filename, sizeBytes, sha256, sourceUrl, license, description, required,
bundled?). `MODEL_CATALOG` is the curated list; `TIERS` (Minimum/Standard/Full)
bundle a required-model set + corpus packs for first-run setup.
`src/models/discoveredModels.ts` persists models found via the Hugging Face
search (`src/services/modelBrowser.ts`) — same `CatalogModel` shape, kept in a
separate JSON file rather than merged into `MODEL_CATALOG` since they aren't
vetted the same way.

**No model capability/role metadata exists today.** `CatalogModel` has no
notion of "this model is good at reasoning" or "this model supports role X" —
that's exactly the gap Phase 1's `ModelCapabilities` fills. It will need to be
layered on as a new, optional, separately-stored annotation (curated for
`MODEL_CATALOG` entries, absent/defaulted for discovered/custom ones), not
added as a required field on `CatalogModel` — discovered models have no one
vetting their capabilities.

## 2. Download/install lifecycle

`src/models/ModelManager.ts` — `statusOf()` (verifies on-disk file size matches
catalog, self-heals truncated files by treating them as absent),
`downloadCatalogModel()` (network fetch + post-download size check, no
per-download sha256 verification — reading a multi-GB file into memory for a
hash isn't done routinely, see the class's own doc comments), `installBundled()`
(alternate bundled-APK path, not the default build).

`src/services/downloadManager.ts` — module-level singleton (survives screen
unmount/remount), tracks per-asset progress/speed/ETA, guards against duplicate
concurrent downloads to the same asset id.

## 3. Model loading/unloading and the inference wrapper

**Two independent singletons, each wrapping one `llama.rn` `LlamaContext`:**

- `src/inference/LlamaEngine.ts` (`llamaEngine`) — generation. `load()` first
  calls `unload()` (releases any previous context) before creating a new one —
  this is a hard constraint: **only one generation-capable model can be loaded
  at a time.** `load()` now no-ops if the same file is already loaded (fixed
  earlier this session — re-mounting a screen used to force an unnecessary
  multi-second native reload). Includes a pre-flight RAM estimate
  (src/inference/ramBudget.ts: weights + computed KV cache + compute
  buffers) that throws a clear error before attempting a load likely to
  OOM. `generate()` passes fixed `DEFAULT_STOP_SEQUENCES` matching the app's
  own hand-built prompt template (not a chat-template API — see §9).
  `stop()` calls `context.stopCompletion()`, which resolves the in-flight
  `completion()` promise normally with partial text (llama.cpp's clean-stop
  behavior) — it does **not** raise/reject.

- `src/rag/embed.ts` (`embeddingEngine`) — embeddings, same load-guard pattern.

**Implication for routing/roles:** the two engines can run concurrently with
each other (generation + embedding coexist today, that's how RAG already
works), but there is **no support for two different generation models loaded
at once**. A routing plan that wants, say, a `fast` model and a separate
`reasoning` model can only run them **sequentially**, paying a model-switch
cost (unload + load, which does a RAM pre-flight and can be a multi-second
native operation for a multi-GB model) between them. This directly confirms
the build plan's own guidance: sequential execution only in the first
implementation, no concurrent multi-model execution.

## 4. Chat state and message persistence

`src/services/chatHistory.ts` over `src/rag/db.ts`'s SQLite (`chat_sessions`,
`chat_messages` tables: `id`, `session_id`, `role`, `text`, `created_at`).
`ChatScreen.tsx` holds live message state in React state; persistence happens
via explicit `createSession`/`addMessage` calls, not automatically.

This is the natural join key for feedback records (Phase 6): `messageId` =
`chat_messages.id`, `conversationId` = `chat_sessions.id`, both already stable,
already-persisted identifiers — no new ID scheme needed.

## 5. RAG / retrieval services

`src/rag/retrieve.ts` — hybrid BM25 (FTS5) + cosine (brute-force over stored
float32 embeddings) with a weighted-sum fusion. `semanticSearch` now enforces a
minimum cosine-similarity floor (`MIN_SEMANTIC_SIMILARITY = 0.45`, added this
session) so an irrelevant query doesn't get force-fed unrelated "context" —
relevant precedent for Phase 5's "avoid presenting unsupported citations as
verified facts."

`src/services/orchestrator.ts` — the existing "Deep Research Mode": a
**sequential multi-pass pipeline on the single loaded generation model**
(decompose → per-sub-question retrieve+generate → synthesize), explicitly
documented as not-actually-multi-agent. This is architecturally the closest
existing thing to a "RoutingPlan executor" — Phase 4's execution engine should
generalize this pattern (typed steps, sequential execution over one context)
rather than replace it. `runDeepResearch` already accepts a `shouldStop`
callback checked between stages (added this session, after discovering the
Stop button didn't actually halt multi-stage research) — the same shape
Phase 4's cancellation support needs.

## 6. Embedding pipeline

`src/rag/embed.ts` (above) + `src/rag/seedCorpus.ts` (idempotent bulk seeding:
checks existing `chunk_id` before embedding, so re-running only embeds new
docs). Embeddings are always computed on-device at seed/import time, never
precomputed/shipped — this is deliberate (see `ARCHITECTURE.md`), so they
always match whichever embedding model is actually loaded.

## 7. Settings and localization

`src/models/settings.ts` — single JSON file
(`FileSystem.documentDirectory + "settings.json"`), read-modify-write on every
change, no schema migration system (new fields are just optional with a
default fallback in each getter). Everything from theme to personality to
memory limits lives here. **This is the pattern Phase 2's presets/model-role
assignments should follow** for simple key-value config (e.g.
`routingPreset: RoutingPreset`, `modelRoleAssignments: Record<ModelRole,
string>`) — small, infrequently-written, no query needs.

`src/i18n/` — i18next/react-i18next, English + Portuguese, manual picker only
(no device-locale auto-detection), 261 keys as of this session's localization
pass. Any new user-facing strings (preset names, routing status text, feedback
UI) need entries in both `src/i18n/locales/en.json` and `pt.json` to stay
consistent with the rest of the app — the earlier i18n pass had gaps
specifically where strings lived in module-level object literals rather than
JSX text, worth remembering when the routing UI adds its own status-label maps.

## 8. Model selection UI

`ModelSetupScreen.tsx` (Settings) and `SetupWizardScreen.tsx` (first-run) both
already have model-management UI (download, activate, remove). `ModelBrowser.tsx`
+ `ModelCatalogScreen.tsx` handle Hugging Face search. **The routing layer
should read from/write to this existing model-management state, not introduce
a second one** — e.g. "assign this already-downloaded model to the `reasoning`
role" is a new relationship on top of existing `CatalogModel`/`discoveredModels`
data, not a new model registry.

## 9. Error handling and reset

`src/ui/components/ModelLoadErrorCard.tsx` classifies raw load errors into a
few buckets (corrupted download, missing file, likely OOM, generic) with
retry/Settings/Setup-Wizard actions. `src/services/appReset.ts` does a full
data wipe (unload both engines first, since they hold the model files open via
mmap — deleting out from under a live context is a known bad pattern in this
codebase's history). Any new local storage (routing config, telemetry,
feedback) needs to be included in `resetAllAppData()`'s wipe list.

## 10. Concurrent model loading — see §3

Confirmed: **no.** One generation context, one embedding context, both
singletons. Multi-model routing plans execute sequentially.

## 11. Memory/runtime metrics availability

`modules/ram-monitor` (native module) exposes `getMemoryInfo()` (process RSS)
and `getDeviceTotalRamBytes()`. `src/services/telemetry.ts` already tracks
peak RSS per-query (`trackPeakRss`) and app-lifetime peak RSS
(`startAppMemoryTracking`), plus per-query stats (tokens generated, duration,
time-to-first-token, tokens/sec) via `recordQueryStats`/`getLastQueryStats`.
**This is real infrastructure Phase 7's `ExecutionTelemetry` should build on,
not duplicate** — token/sec and TTFT are already measured per-generation in
`ChatScreen.tsx`'s `send()`.

No per-model "estimated tokens/sec" or "estimated memory" benchmark data
exists yet — `ModelCapabilities.estimatedMemoryMb`/`estimatedTokensPerSecond`
would need to be either hand-curated per catalog entry (rough, same spirit as
the existing RAM-compatibility badge heuristic in `CatalogItemCard.tsx`) or
derived from `telemetry.ts`'s recorded history once enough real executions
exist — the plan's own Phase 8 guidance ("do not invent memory measurements")
argues for starting with the latter, deferred, rather than fabricating numbers.

## 12. Safest existing storage mechanism for routing config / telemetry / feedback

Two mechanisms exist, matching to two different needs:

- **`settings.ts` (JSON file)** — small, singular, human-editable-shaped
  config: active preset, per-role model assignment, telemetry-enabled toggle.
  Matches Phase 2/9 needs.
- **SQLite (`src/rag/db.ts`)** — structured, queryable, growable records with
  natural foreign keys into `chat_messages`/`chat_sessions`. Matches Phase 6
  (`AnswerFeedback`) and Phase 7 (`ExecutionTelemetry`) needs — new tables
  (`answer_feedback`, `execution_telemetry`) following the exact pattern
  already used for `custom_collections`, with the same `db.ts`
  open-once-lazily/migrate-on-open structure (`PRAGMA table_info` check before
  `ALTER TABLE`, as already done for `chunks.collection_id`).

Both mechanisms are already wired into `appReset.ts`'s wipe path (JSON file
deletion, `resetDatabase()`) — new tables/fields need adding to that list, not
a new deletion path.

## 13. Model switching — does it recreate inference contexts?

Yes, always, by design: `load()` unconditionally calls `unload()` (unless the
same file is already loaded, per the no-op guard added this session). This is
correct/necessary given §3 — there's no way to have two generation contexts
resident, so switching models always means releasing native memory for the old
one and mmap'ing the new one from disk. A routing plan that alternates between
two role-mapped models on the same query will pay this cost each time it
switches — worth surfacing in `ExecutionTelemetry` as a distinct
"model-switch-ms" metric so it's visible rather than silently inflating
per-step latency numbers.

## 14. Cancellation, timeouts, and backgrounding

- **Cancellation**: `ChatScreen.tsx` tracks the in-flight `send()` promise
  (`sendTaskRef`) and a `stopRequestedRef` flag; `stopAndAwaitGeneration()`
  sets the flag, calls `llamaEngine.stop()`, and awaits the actual promise —
  added this session after discovering session-switching didn't previously
  wait for generation to actually stop, causing stale-state bugs. Deep
  Research's `runDeepResearch` checks `shouldStop()` between stages (also this
  session) since `llamaEngine.stop()` alone only halts the *current* single
  completion, not a multi-step pipeline.
- **Timeouts**: **none exist anywhere in the codebase.** No per-generation or
  per-step timeout budget. `InferenceBudget`/`RoutingStep.timeoutMs` (Phase 3)
  is entirely new — needs a `Promise.race` against a timer wrapped around
  `llamaEngine.generate()`, plus a decision on what "timeout" does to a
  streaming completion already emitting tokens (calling `stop()` mid-stream is
  the only existing mechanism; a clean timeout should probably just do that,
  reusing the stop path rather than inventing a second cancellation
  mechanism).
- **Backgrounding**: **not handled at all.** No `AppState` listener anywhere
  in the app. `ModelManager`'s own doc comments cite "app backgrounded... mid-transfer"
  as a known cause of truncated downloads, but nothing currently detects or
  reacts to backgrounding for chat generation, routing execution, or anything
  else. This is a real, pre-existing gap the build plan's constraint
  ("cancellable and resource-aware... do not implement... unexpected
  background inference") implicitly assumes is handled — it isn't yet. Worth
  a decision: should backgrounding auto-stop an in-flight generation/pipeline
  (safest, matches "no unexpected background inference"), or just let it keep
  running (simpler, but risks the OS killing the process mid-generation on
  memory pressure with no clean state)? Recommend auto-stop, matching the
  existing `stopAndAwaitGeneration` path — deferred to whichever phase adds
  the execution engine, since it's the first place a background stop actually
  has multi-step state worth protecting.

## Summary: what Phase 1+ builds on top of, unchanged

- Single generation context + single embedding context (sequential execution
  only, confirmed necessary, not just recommended).
- `orchestrator.ts`'s Deep Research pipeline is the closest existing precursor
  to the execution engine — generalize its shape, don't replace it outright.
- `telemetry.ts` already measures the core per-generation metrics
  Phase 7 needs; extend, don't duplicate.
- `settings.ts` (JSON) for routing config, SQLite for feedback/telemetry —
  matches existing storage-choice conventions in this codebase exactly.
- No timeout mechanism and no backgrounding handling exist yet — both are new
  work, not gaps in this audit.

## Status

**Phase 0 (this document) and Phase 1 (`src/routing/types.ts`): done.**

**Phase 2 — model profiles and presets: done**, config layer only, no UI yet
(per the plan's own phasing — Phase 9 adds the UI):

- `src/models/compatibility.ts` — the RAM-fit heuristic extracted out of
  `CatalogItemCard.tsx` so the catalog UI and routing resolution share one
  formula instead of drifting.
- `CatalogModel.capabilities?: ModelCapabilities` (`src/models/manifest.ts`)
  — hand-curated per §1: Phi-3.5-mini → `general`+`reasoning`, Qwen2.5-1.5B →
  `fast`, Qwen2.5-7B → `reasoning`+`verifier`, bge-small → `embedding`.
  Absent for discovered/Hugging-Face-search models — not vetted the same way.
- `src/routing/profiles.ts` — `ModelProfile`, `PRESET_DEFINITIONS` (Simple/
  Balanced/Research/Custom, as data, not execution logic),
  `resolveModelForRole()`/`buildModelProfiles()`. Resolution order: user
  override (if present on disk) → curated catalog match (if present) →
  fallback to the active default model → explicit disabled profile, never a
  silent route to an unavailable model. `simple` needs only the `general`
  role — deliberately near-identical to today's existing single-model chat,
  so a user who never touches routing settings sees no behavior change.
- `src/models/settings.ts` — `routingPreset` (default `"simple"`) and
  `modelRoleAssignments`, same JSON-file pattern as theme/personality/language.
- Tests: `src/routing/profiles.test.ts`, 10 cases. Caught a real bug during
  writing: `resolveModelForRole` was searching the global `MODEL_CATALOG`
  import instead of the injected `available` list — fixed before it shipped.

**Runtime-safety prerequisite (requested before Phase 3): done.**

- **Timeout**: `LlamaEngine.generate()` gained `timeoutMs`/`onTimeout`
  (`src/inference/LlamaEngine.ts`) — reuses the exact existing clean-stop
  path (`context.stopCompletion()`), no second cancellation mechanism. Not
  applied to regular single-pass chat (already indirectly bounded by
  `nPredict`, and an arbitrary timeout there risks cutting off a legitimate
  slow-but-working generation on a weaker phone). Applied to
  `orchestrator.ts`'s three Deep-Research stages as a 2-minute
  safety-net-not-a-performance-target (`STAGE_TIMEOUT_MS`) — that pipeline
  previously had zero time ceiling across its several sequential calls.
  `ResearchResult.timedOut` surfaces whether any stage hit it; `ChatScreen.tsx`
  shows a badge on the affected message ("⏱ stage timed out") rather than
  leaving a silently-truncated answer unexplained.
- **Backgrounding**: `ChatScreen.tsx` now subscribes to `AppState` — going to
  `"background"` while a generation/pipeline is in flight calls the same
  `stopAndAwaitGeneration()` the Stop button already uses (no new
  cancellation path), then marks the interrupted message with a distinct
  badge ("⏸ paused, app was backgrounded") so it reads as explained-and-
  retriable, not broken. This is the first AppState handling anywhere in the
  app.

**Unresolved / deferred, on purpose:**

- No timeout is applied to regular (non-Deep-Research) chat generation —
  revisit once Phase 3's `InferenceBudget` gives a principled per-task value
  instead of an arbitrary constant.
- Backgrounding policy is "always cancel," per the teammate's explicit
  recommendation. Not configurable yet — no setting to change this behavior.
- `estimatedTokensPerSecond`/`estimatedMemoryMb` in `ModelCapabilities`
  remain unset for all curated models — no benchmarked data exists yet (see
  §11); still correctly deferred rather than invented.

Typecheck and the full test suite (32 tests) pass. Not yet tested on a real
device — background-cancellation behavior in particular should be verified
hands-on (background the app mid-generation, confirm the badge appears and
the model context is actually released, not just that the promise resolves).

**Phase 3 — deterministic routing policy: done.**

- `src/routing/classify.ts` — rule-based `classifyTask()`, deliberately not
  an LLM call per the plan ("do not initially ask an LLM to freely invent a
  pipeline"). Ordered pattern list (compare/summarize/translate/code/
  calculate/extract checked before the broader lookup/research/chat
  fallbacks) — a query matching two patterns takes the more specific one,
  e.g. "research the tradeoffs of X versus Y" classifies as `compare`, not
  `research`. 11 tests.
- `src/routing/router.ts` — `planRoute(context): RoutingPlan`, pure and
  deterministic (no I/O, same input always produces the same output —
  asserted directly in the tests). Implements every explicit rule from the
  plan: simple task → fast/general role; retrieval skipped for
  calculate/translate/code; complex task or research/compare task type →
  reasoning role regardless of preset; verification only for research-preset
  research/compare tasks with retrieved evidence *and* a verifier model
  distinct from the generator (asking a model to grade its own answer isn't
  verification); missing preferred model → graceful role-fallback chain,
  never an empty/broken plan; low-power device state → forces the `fast`
  role and caps the token budget, overriding task/preset. `reasonCodes` on
  every plan explain each decision made (retrieval skipped and why,
  which role resolved to which model, why verification did or didn't run) —
  this is the "explain routing decisions" surface from Phase 9, arriving
  earlier because the router already needed to justify its own choices to
  be testable. 15 tests, including one asserting two `planRoute()` calls
  with identical input produce a deep-equal plan.

**Phase 4 — execution engine: done.**

- `src/routing/executor.ts` — `executeRoutingPlan(plan, input, resolveModel,
  callbacks)` runs a RoutingPlan's steps in order against the real
  `llamaEngine`/`retrieve()`. Generalizes orchestrator.ts's existing
  step-loop shape (shouldStop checked between every step, per-step timeout
  reusing the same `timeoutMs`/`onTimeout` LlamaEngine gained for the
  runtime-safety work) rather than inventing a different pattern —
  orchestrator.ts itself is untouched, Deep Research Mode keeps working
  exactly as before; this is new, separate infrastructure sitting alongside
  it, not a replacement.
  - Model loading is sequential and switch-aware: `ensureModelLoaded` only
    calls `llamaEngine.load()` when the step's model actually differs from
    what's resident, and counts genuine switches into `modelSwitches` on
    the result — the real cost the teammate asked to make part of the
    routing budget, now visible per-execution rather than implicit.
  - `resolveModel` is injected (a `(modelId) => ExecutableModel | undefined`
    callback), not imported from `MODEL_CATALOG` directly — same lesson as
    Phase 2's bug (a hardcoded global instead of injected data breaks both
    testability and correctness for discovered/custom models).
  - Verification is evidence-grounded, not "ask if correct": the verify
    step's prompt asks specifically whether the answer's claims are
    supported by the retrieved chunks, parsed from a constrained
    SUPPORTED/PARTIAL/UNSUPPORTED response format into `passed`/
    `uncertain`/`failed`; an off-format response is `uncertain` (a real,
    honest outcome — not a bug), and no retrieved evidence at all is
    `not_applicable` rather than a meaningless check.
  - 9 tests, run against a **mocked** `llamaEngine`/`retrieve()`
    (`vi.mock`) — `assemblePrompt`/`ConversationHistory` are imported
    directly from the native-module-free `rag/pure.ts` rather than
    `rag/retrieve.ts`, so only `retrieve()` itself needs mocking. This
    proves the orchestration logic (right model loaded for each step, model
    switches counted correctly, required-step failure aborts cleanly,
    optional-step failure just skips, verification parsing) is correct —
    it does **not** prove real Phi/Qwen inference works end-to-end, which
    this sandbox has no way to run (no Android device attached here).

**Scope boundary — read before assuming this is live:** Phase 3 and 4 exist
as complete, tested, standalone infrastructure. **Nothing in `ChatScreen.tsx`
calls `planRoute`/`executeRoutingPlan` yet** — the existing chat send() flow
and Deep Research Mode are both completely unchanged. Wiring this into the
live chat UI is a real, separate decision (touches the main chat path every
user goes through) that hasn't been made — that's Phase 9 (UI/UX) territory,
and per this branch's whole pattern so far, worth doing deliberately with
real-device verification of the routing/execution path first, not folded
into "build the engine."

Typecheck and the full test suite (68 tests total, up from 32) pass.

**Download backgrounding fix (unrelated to Phases 3/4, same runtime-safety
theme): done.**

The mandatory-setup download-stall fix (inactivity timeout + retry UI,
committed earlier) had a gap surfaced by hands-on testing: backgrounding the
app during a download looked identical to a real stall from
`ModelManager`'s point of view (expo-file-system's own docs: progress
callbacks "won't be fired until it's moved to foreground"), so the
inactivity timer fired — but it then **cancelled and deleted** the partial
file, so returning to the app meant restarting a multi-GB download from 0%.

- `ModelManager.downloadCatalogModel` now **pauses** on timeout instead of
  cancelling+deleting, keeping the `DownloadResumable` handle in a
  `pausedDownloads` map keyed by asset id. A subsequent call for the same
  asset reuses that handle and calls `resumeAsync()` instead of starting
  over — genuine (non-timeout) failures are still treated as unrecoverable
  and clean up the partial file as before.
- `SetupWizardScreen.tsx` now auto-retries (`retryFailedDownloads()`) when
  `AppState` returns to `"active"` and a failed/paused asset exists, so the
  user doesn't have to notice the error card and tap Retry manually after
  switching back to the app — it resumes on its own.
- Explicit "keep NIDO open" notice added to Step 3 while a download is
  active, since true background downloading would need a native Android
  Foreground Service — a disproportionate cost for a one-time setup
  download — so the honest fix is graceful pause/resume, not silently
  promising background progress that doesn't happen.

Typecheck and the full test suite (68 tests) still pass. Not yet verified
hands-on: whether `resumeAsync()` on a real device actually continues from
the paused byte offset as expected (the code defensively treats both a
thrown timeout-error and a `resumeAsync()` resolving to `undefined` as the
same pause outcome, since expo-file-system's own type signature only
documents `undefined` for "cancelled" — pause's exact resolution shape
wasn't confirmed against a real device in this sandbox).

**New `TaskType`: `"greeting"`, and a narrow live-path retrieval skip
(first real crossing of the ChatScreen ↔ routing scope boundary): done.**

Hands-on testing of "wake up!" surfaced a real gap in both places: the live
chat path (`ChatScreen.tsx` `send()`) calls `retrieve(query)`
unconditionally for *every* message, with zero classification — it never
called `classifyTask`/`planRoute` at all, so the router's own rules never
applied. But tracing what `planRoute` *would* have done revealed the router
had the same gap: `retrievalIrrelevant` only excluded
`calculate`/`translate`/`code` — a plain `"chat"`-classified greeting still
retrieved in the unwired module too.

- Added a `"greeting"` `TaskType` (`src/routing/types.ts`), deliberately
  **not** folded into the existing `"chat"` fallback — `"chat"` is a broad
  bucket that also catches real informational requests phrased as commands
  ("Tell me about black holes"), which should still retrieve. Only pure
  social small talk (an anchored regex matching the *whole* trimmed query —
  "hi, can you compare X and Y" must not match) classifies as `"greeting"`.
- `classify.ts` gained `isRetrievalIrrelevant(taskType)` — the
  calculate/translate/code/greeting skip rule, now defined in exactly one
  place instead of inlined in `router.ts`.
- `router.ts`'s `retrievalIrrelevant` and `preferredRole` (greeting → always
  `"fast"` role, even under the `"research"` preset) both now use it.
- **`ChatScreen.tsx`'s live `send()` now also uses it** — a narrow, additive
  change, not the full router: `classifyTask(query)` gates the existing
  unconditional `retrieve()` call, nothing else changes (model selection,
  step count, verification are all still untouched — those still require
  the deliberate `planRoute`/`executeRoutingPlan` wiring decision described
  above, which remains deferred). This is the first place any routing
  module code runs against real chat traffic, but it's a single `if` around
  an existing call, not the scope-boundary-crossing decision itself.
- Regression tests: `classify.test.ts` (greeting detection, the
  chat-vs-greeting disambiguation case, `isRetrievalIrrelevant`) and
  `router.test.ts` (greeting skips retrieval, prefers `"fast"` role under
  every preset, produces a single generate step with no verification —
  directly modeling the "wake up!" trace). 73 tests total, up from 68.

**Follow-up: fixing retrieval didn't fix the actual response — hallucinated
actions traced and fixed (`rag/pure.ts`'s `assemblePrompt`): done.**

With retrieval correctly skipped, real-device testing surfaced the deeper
problem: "wake up" → *"morning alarm set to standard wake up / room
temperature adjusted."* — a fabricated action; NIDO has no alarm or
smart-home capability at all. Traced the exact final prompt sent to Phi for
this input (no chat template in use anywhere — see `LlamaEngine.ts`'s
`DEFAULT_STOP_SEQUENCES` comment, `assemblePrompt` hand-builds a generic
`"...Question: <query>\n\nAnswer:"` completion shape, not Phi-3.5's actual
fine-tuned `<|system|>/<|user|>/<|assistant|>` template). Root cause:
combination of (a) the off-template prompt shape, which lets a small model
free-associate into a narrative continuation instead of a grounded chat
reply on short, ambiguous, command-shaped input, and (b) no instruction
anywhere telling the model it has no real-world capabilities or that
casual talk should get a conversational reply rather than a "task" answer.

Fix: a universal `GROUNDING_INSTRUCTION` in `assemblePrompt`, always
appended regardless of persona/content — **not** a hardcoded response to
any specific phrase. States NIDO can't control real-world devices or take
physical actions, that casual small talk should get a brief conversational
reply, and that it must never claim to have done something it can't
actually do. `assemblePrompt` is shared with Deep Research's
`researchSubQuestion` stage (`orchestrator.ts`) — deliberately not
duplicated into two versions, since the instruction is a no-op for genuine
questions (Deep Research's decomposed sub-questions are never action
requests), so Deep Research's actual behavior is unaffected.

Switching to Phi-3.5's real chat template would likely help further but is
a bigger, separate change (touches Deep Research's exact prompt shape and
stop-token behavior too) — identified as a contributing factor and
deliberately deferred, not attempted in this pass.

Regression tests: `rag/pure.test.ts` (grounding instruction present
regardless of persona/context/history) and `classify.test.ts` (the three
real-device inputs — "hey!", "what's up?!", "wake up" — all classify as
`"greeting"`; "turn on the lights" does NOT, since it's a genuine action
request, not small talk, and must keep going through the normal path where
the grounding instruction — not classification — is what stops a false
success claim; "tell me about black holes" remains "chat", not
"greeting"). 78 tests total, up from 73.

**Follow-up: retrieval skip was insufficient for compound greetings, and
an empty-but-present context section leaked framing even when it wasn't:
done.**

Real-device testing of "hey, what's up?" surfaced two compounding gaps:

1. `classifyTask`'s greeting detection was a single anchored regex matching
   ONE literal phrase end-to-end — "hey, what's up?" (two phrases joined by
   a comma) never matched any single alternative, so it classified as
   `"chat"`, not `"greeting"`. `retrieve()` therefore still ran, and since
   it has no relevance floor (always returns its top-K hybrid matches,
   never zero), it surfaced essentially random corpus chunks (Pikachu,
   Deadmau5, Weezer — Wikipedia-padding topics) that ended up quoted in
   the response.
2. Separately, even with `chunks = []`, `assemblePrompt` still emitted an
   empty-but-present `"Context:\n\n"` section plus the "cite sources as
   [n]" instruction — dangling framing that tells a small model there's
   supposed to be something there.

Fixes, both in `src/routing/classify.ts` / `src/rag/pure.ts`:

- `classifyTask` now splits the query on comma/semicolon/`"and"` and
  requires every resulting segment to independently match a known greeting
  phrase (`isGreeting`, not exported — an implementation detail of
  `classifyTask`) — generalizes to any combination of the known phrases
  ("hey, what's up?", "hi, how are you?") without hardcoding each
  combination as its own literal string, and still correctly rejects a
  greeting with a real request tacked on ("hi, can you compare X and Y?",
  "hey, turn on the lights").
- `assemblePrompt` now omits the entire context/citation section (not just
  the chunk list) when `chunks` is empty, for any task type — not
  greeting-specific, so it also cleans up prompts for
  calculate/translate/code and any `"chat"`-classified query `retrieve()`
  genuinely found nothing relevant for.
- Confirmed (and grepped for) there is no separate/unconditional
  memory-context pipeline anywhere in `ChatScreen.tsx` — `retrieve()` is
  the only call site, already gated. Conversation history
  (`assemblePrompt`'s `summary`/`turns` params) is a completely separate,
  unconditional mechanism, untouched by any of this — "what did I just
  tell you?" still works exactly as before.

Regression tests: `classify.test.ts` (compound greetings classify
correctly; a real request tacked onto a greeting still disqualifies it) and
`rag/pure.test.ts` (an end-to-end test mirroring `ChatScreen.send()`'s
exact decision logic for "hey, what's up?" — asserts the final prompt has
no `"Context:"` section, no citation instruction, and no leaked chunk
content, while conversation history passed alongside it still appears).
82 tests total, up from 78. Deep Research Mode (`orchestrator.ts`) was not
touched.

**Follow-up: validated the retrieval relevance layer itself, ahead of full
adaptive-router integration: done.**

Inspected `src/rag/retrieve.ts`'s actual scoring (not assumed) before
changing anything. Findings:

- **Semantic search already had a raw-score floor**: `MIN_SEMANTIC_SIMILARITY
  = 0.45`, applied to cosine similarity before any chunk is returned from
  `semanticSearch`. Left unchanged — there is no real bge-small-en-v1.5
  embedding runtime available in this sandbox to measure this corpus's
  actual score distribution, and moving an existing, previously-justified
  threshold without real evidence would be the exact mistake this task
  warned against.
- **Lexical search already had its own gate, just not a numeric one**: the
  query is passed to FTS5's `MATCH` wrapped in double quotes, which is a
  PHRASE query — the words must appear consecutively, in that order, in
  the indexed text. Gibberish or an unmatched phrasing returns zero rows,
  not a weak match; every row that *does* come back already cleared that
  bar. No additional bm25-magnitude threshold was added on top — bm25's
  raw scale is corpus/query-dependent and unmeasured here, and layering an
  invented cutoff on it risks discarding genuine exact-phrase matches
  (violates "don't aggressively discard potentially useful results") for
  no evidenced benefit.
- **The actual gap**: none of this was tested, and the *fused* (hybrid)
  score `retrieve()` returned was a relative, max-normalized number —
  meaningful as a ranking within one query's results, meaningless as an
  absolute confidence signal (normalizing to each source's own max means
  the top hit for ANY query, including pure gibberish, always looks
  "confident" relative to itself). A floor has to apply to raw scores,
  before normalization — which the semantic/lexical gates above already
  do; fusion was never the place a floor could meaningfully live.

**Fix, not a new threshold — extraction + tests**: `MIN_SEMANTIC_SIMILARITY`,
`filterByMinScore()`, and `fuseRetrievalResults()` moved into `rag/pure.ts`
(native-module-free, same pattern as `assemblePrompt`), so the fusion and
floor mechanics are independently unit-testable without a real device.
`retrieve.ts` now calls these instead of duplicating the logic inline —
external behavior (the `retrieve()` signature and what it returns) is
unchanged, this is a refactor for testability, not a policy change.

New `src/rag/retrieve.relevance.test.ts` (9 tests, synthetic scores — no
real embeddings/bm25 available here, so these validate the CODE's policy
mechanics, not real corpus behavior for specific queries): a floor
correctly excludes below/keeps at-or-above; all-below-floor produces
empty (the gibberish-query shape); a single-source match survives fusion
uncorroborated (the weak/partial-wording requirement); a two-source
agreement promotes to `"hybrid"` and outranks single-source matches;
topK is respected; configurable weights work; fusion is deterministic.

91 tests total, up from 82 (the requested baseline). Deep Research Mode
untouched. **Not verified in this pass**: the specific example queries
("what is a black hole?", "explain photosynthesis", "asdfghjkl qwerty",
"tell me something") against the real bge-small model and this corpus on
an actual device — no on-device runtime exists in this sandbox to compute
that. Worth doing by hand on a real device as a follow-up, ideally with
score logging added temporarily to capture real distributions before
considering whether `MIN_SEMANTIC_SIMILARITY` itself should move.

**Phase 9 (+ minimal telemetry instrumentation) — wire `planRoute`/
`executeRoutingPlan` into ordinary chat: done, feature-flagged, off by
default.** See the full report in the conversation for exact files/flow —
summary here:

- New `src/services/adaptiveChat.ts` (`runAdaptiveChat`) is the ONLY new
  integration point: resolves on-device model presence, routing
  preset/overrides, and device RAM, then runs classify → planRoute →
  executeRoutingPlan, reusing Phases 3/4 entirely unmodified.
- `ChatScreen.tsx`'s `send()` (non-Deep-Research branch) calls it behind a
  new `getAdaptiveRoutingEnabled()` setting (default `false`). Deep
  Research Mode's branch is untouched — separate code path, never calls
  `runAdaptiveChat`.
- Fail-safe by construction: a thrown exception OR an empty answer with no
  cancellation both fall back to the exact pre-existing fixed-active-model
  path (`runFixedModelChat`, extracted verbatim from the prior code, not
  rewritten) — a routing failure or "nothing available" never leaves the
  user without a response.
- Single-resident-model constraint unchanged — routing switches still go
  through the same `LlamaEngine.load()`/`executor.ts` `ensureModelLoaded`
  already governing this everywhere else; nothing here allows two models
  resident at once.
- Minimal, in-memory-only telemetry (`telemetry.ts`'s `QueryStats`, new
  optional fields — not the persisted SQLite `execution_telemetry` Phase 7
  describes): `adaptiveRoutingUsed`, `modelId`, `taskType`, `reasonCodes`,
  `modelSwitches`, `retrievalUsed`, `generationLatencyMs`,
  `totalLatencyMs` (now recorded for every path, not just adaptive),
  `outcome`. Deliberately not Phase 7 itself — no persistence, no new
  DB table, per the explicit "stop after Phase 9" instruction.
- Settings UI: new "Adaptive Routing (Experimental)" toggle in
  `PersonalitySettings.tsx`, same pattern/styling as the existing Deep
  Research toggle.
- Tests: `src/services/adaptiveChat.test.ts`, 8 cases (greeting → no
  retrieval + fast model; chat → fast model + retrieval; research → 
  reasoning model, under the "research" preset specifically — "balanced"/
  "simple" don't even declare a reasoning role slot; preferred role
  unavailable → graceful fallback, no empty answer; model switch across
  two requests → real `LlamaEngine.load()` calls; `shouldStop` already
  true → model never loaded; nothing installed at all → empty answer with
  `reasonCodes` explaining why, not a throw; callback propagation). 99
  tests total, up from 91.
- **Known, disclosed scope gap**: `routingPreset` defaults to `"simple"`
  (pre-existing default, unchanged) and there's still no UI to change it —
  only "research" preset even declares a `reasoning` role slot, and
  "balanced" is needed to unlock the `fast` role at all. Turning on the
  new toggle alone, with preset left at `"simple"`, only ever resolves to
  the `general` role (effectively the same single model as today) — real
  model-switching requires manually setting `routingPreset` via
  `settings.ts` for now (no picker UI built in this pass, out of scope per
  the "keep it minimal" instruction).
- **Not done, deliberately**: Phase 7 (persistent/model-tagged
  `ExecutionTelemetry`), Phase 8 (feedback-based routing improvement), any
  UI display of the new telemetry fields (not touched — avoided
  `UsageStatsContent.tsx`, being concurrently edited by another session),
  a `routingPreset` picker UI, real-device verification.

**Follow-up (0c19812): adaptive routing decisions now surface in Usage
Stats** — new "LAST ADAPTIVE ROUTING DECISION" card (model used, task
type, retrieval used, switches, latency, outcome), shown only when the
last message actually went through `runAdaptiveChat`. The gap above is
now closed.

**Follow-up: real-device testing surfaced a generation-quality bug, fixed
narrowly (routing decisions themselves unchanged).** First adaptive-routing
device test — `"whats up?"` — produced a long, free-associated,
multi-question ramble from Qwen2.5-1.5B (unrelated invented follow-up
questions, emoji, ~4 fake "turns"). Root-caused to two compounding,
disclosed causes, both fixed:

1. **No real chat template.** `assemblePrompt` hand-builds a generic
   `"Question: ...\n\nAnswer:"` completion shape rather than a model's
   actual fine-tuned template — flagged as a known risk when the earlier
   "wake up" hallucination was fixed, now confirmed as a real-device issue
   with Qwen specifically (likely the first time Qwen-1.5B ever generated
   a real chat response in this project — Phi was always the sole
   generator before Phase 9). Fixed via `src/rag/pure.ts`'s new
   `assembleChatMessages()` (role-separated messages, same content/
   grounding as `assemblePrompt`) plus `LlamaEngine.generate()`'s new
   `messages` param, which passes straight through to llama.rn's
   `completion({messages, jinja: true, ...})` — llama.cpp then applies
   the loaded GGUF's own embedded chat_template. No template string is
   hand-typed/guessed anywhere in this app; llama.cpp's own template
   engine decides the exact syntax from the model file itself.
   Model-aware, not global: only `CatalogModel`s with the new
   `ModelCapabilities.usesChatTemplate` flag (currently only
   Qwen2.5-1.5B-Instruct — `MODEL_CATALOG`) use this path;
   `executor.ts`'s generate step branches on it per-step. Phi (no flag)
   is byte-for-byte unaffected — confirmed by a dedicated test asserting
   its `generate()` call still receives a plain `prompt` string, not
   `messages`. Qwen2.5-7B has the same underlying risk but was
   deliberately left untouched (narrower scope than requested).
2. **No task-appropriate token budget.** `router.ts`'s `effectiveMaxTokens`
   only ever scaled down for low-power-mode — a greeting got the exact
   same budget (512 by default) as a research question, with nothing
   telling the model "this should be short." New `GREETING_MAX_TOKENS =
   128` caps (never raises) the budget specifically for `taskType ===
   "greeting"`, living in router.ts's own task-configuration logic per
   explicit request, not a UI-side truncation hack. `reasonCodes` gains
   `"budget:greeting-caps-tokens"` when it applies, same convention as the
   existing low-power-mode reason code.

Explicitly NOT touched: `classifyTask()`, model-selection/role rules,
retrieval thresholds, the "balanced" preset's role declarations, Deep
Research (`orchestrator.ts`) — routing *decisions* are unchanged, this was
scoped as a generation-quality fix.

12 new regression tests across `router.test.ts` (budget cap, cap never
raises a smaller user setting, non-greeting unaffected), `executor.test.ts`
(Phi still gets a plain prompt string; Qwen gets a role-separated messages
array with system/history/user structure), `pure.test.ts`
(`assembleChatMessages` unit tests: grounding instruction present, context/
citation framing included only with chunks, history threaded as separate
messages, summary included), and `classify.test.ts` (the exact real-device
input `"whats up?"`, no apostrophe, classifies as `"greeting"`). 111 tests
total, up from 99. Typecheck clean.

**Not verifiable in this sandbox**: whether `getFormattedChat`/`jinja:
true` actually applies Qwen2.5-1.5B-Instruct-GGUF's real embedded
chat_template as expected on a real device — no native llama.cpp runtime
exists here to execute it. Using llama.rn's own public, documented chat-
formatting API (rather than hand-typing a guessed ChatML string) is the
most defensible approach available without that runtime, but real-device
confirmation is the next step.

**Follow-up: telemetry gap fixed — `modelSwitches` vs. cross-message model
change.** Real-device test: "compare Linux and Windows" correctly switched
from Qwen to Phi (confirmed via "Model Used: Phi" and response quality),
but Usage Stats showed `modelSwitches: 0`, which read as a bug. It wasn't
a routing bug — `modelSwitches` is plan-local by design (a single plan
needing multiple roles, e.g. retrieve+generate+verify with a distinct
verifier) and every `executeRoutingPlan()` call starts counting from a
fresh `loadedModelId = null`, so a single-generate-step plan always
reports 0 regardless of what was resident before that call began. There
was no field answering "did the model actually change since the last,
separate request" at all.

Added `PipelineResult.crossMessageModelSwitch: boolean` (`executor.ts`),
computed from `llamaEngine.getModelInfo()`'s real resident filename read
before and after execution — never an assumption about what a previous
request supposedly left loaded. False for a cold start (nothing resident
before — nothing to have switched from) and false when a load fails or is
skipped (residency genuinely unchanged, so no false positive); true for a
genuine Qwen<->Phi transition, whether it happens within one plan or is
carried over from a separate, earlier request. `modelSwitches`'s existing
plan-local meaning is unchanged — both fields now coexist, answering
different questions, and are documented as such on `PipelineResult`
itself. Flows through `AdaptiveChatResult` (`adaptiveChat.ts`, via its
existing `...result` spread — no change needed there) into
`QueryStats.crossMessageModelSwitch` (`telemetry.ts`) and a new
"Switched Since Last Message" row in Usage Stats
(`UsageStatsContent.tsx`).

5 new tests in `executor.test.ts` (mock `llamaEngine.getModelInfo()` now
actually mutates on `load()`, mirroring the real engine, so it correctly
reflects what a *previous* `executeRoutingPlan()` call left resident):
cold start -> false; Qwen then Phi -> true; Phi then Phi -> false; Phi
then Qwen -> true; a failed/unresolvable model load leaves residency
(and thus the field) correctly unchanged. Existing plan-local
`modelSwitches` test extended to also assert `crossMessageModelSwitch:
false` for that scenario (cold start, even though the plan itself
switches models internally) — the two fields' independence is itself
tested, not just each field alone. 116 tests total, up from 111.
Routing rules/classification/model-selection/retrieval thresholds/
generation prompts/Deep Research: untouched.

**Phase 7 — persistent, model-tagged execution telemetry: done.** Real
numbers from a real device (Qwen: 13 tok/s, TTFT reported as 18.71s) made
the case for this directly — with the old undifferentiated `ttftMs`
(message-send start to first token), that 18.71s could have been mostly
model-load time, mostly prompt processing, or genuinely slow generation;
there was no way to tell, and no way to compare runs after a reload since
`telemetry.ts` was always in-memory-only.

- **Timing semantics, made explicit and precisely scoped** (`executor.ts`,
  `PipelineResult`): `modelLoadMs` (time in `llamaEngine.load()` for the
  generate step's model — 0 when nothing needed loading), `ttftMs` (from
  the moment `generate()` was actually called, model already ready, to
  the first streamed token — model load time is NOT included), `generationLatencyMs`
  (first token to `generate()` resolving — i.e. the whole call's duration
  MINUS `ttftMs`, matching this app's existing `tokPerSec` convention).
  `totalLatencyMs` (unchanged, `ChatScreen.tsx`-level, the full request
  span). **Not a rename of the old `ttftMs`/`generationLatencyMs`** — the
  old `generationLatencyMs` (`adaptiveChat.ts`) measured the WHOLE
  `executeRoutingPlan()` call (retrieve+generate+verify combined) and was
  removed outright, superseded by the new, correctly-scoped field.
- **Model residency**, captured once per execution for the primary
  generate step: `"cold"` (nothing resident in `LlamaEngine` before this
  request), `"switched"` (something else was resident), `"resident"`
  (already the right model — no `load()` call even made). Also fixed a
  real inefficiency this surfaced: `ensureModelLoaded` previously called
  `llamaEngine.load()` on the first step of every plan unconditionally
  (its own per-execution `loadedModelId` tracker starts `null` every
  time), even when the target model was already genuinely resident from a
  separate, earlier request — now checked against `llamaEngine.
  getModelInfo()`'s real state first. `LlamaEngine.load()` already
  no-opped internally in that case, so this doesn't change observable
  engine behavior, only what gets measured/called.
- **New `src/services/executionTelemetry.ts` + `.pure.ts`** (the split
  matches `rag/pure.ts`'s established pattern — `.pure.ts` has zero
  native-module imports, so it's unit-testable under plain vitest; `.ts`
  is the thin SQLite/file-system/sharing glue around it). New
  `execution_telemetry` SQLite table (`rag/db.ts`, same migration pattern
  as `answer_feedback`) — local/offline only, **never stores the user's
  prompt or the generated response text**, only timing/model/task
  metadata. `src/services/telemetry.ts`'s in-memory `QueryStats` stays as
  an unmodified compatibility layer for the existing live Usage Stats
  display (its `ttftMs`/`generationLatencyMs` semantics were corrected
  the same way for the adaptive path specifically, via `ChatScreen.tsx`
  overriding the generic message-send-to-first-token measurement with
  the precise executor-measured one — care taken not to overwrite the
  required `ttftMs` field with `undefined` when no generate step ran).
  `ChatScreen.tsx` calls both `recordQueryStats` (unchanged) and the new
  `recordExecution` (fire-and-forget, including a minimal failure record
  in the outer catch block) after every message — adaptive, fixed-model,
  and Deep Research alike.
- **New dedicated screen** (`ExecutionTelemetryScreen.tsx`, opened via a
  new drawer item — **not** Settings): browses recent runs (model, task,
  tok/s, load time, TTFT, total time, peak memory, outcome, residency
  icon), a "Clear" action, and JSON/CSV export via `expo-sharing` (already
  a dependency, same pattern as `documentImporter.ts`'s existing
  `exportCollection` — no new native dependency added).
- **Not done, deliberately**: no routing/optimization decisions made from
  any of this data yet, per explicit instruction; Phase 8 not started.
- Tests: 8 new in `executor.test.ts` (cold/warm/switched residency, Qwen→
  Phi and Phi→Qwen switch timing, ttftMs verified NOT inflated by a
  deliberately slow mocked `load()`, generationLatencyMs verified as the
  post-first-token portion specifically, undefined-not-fabricated timing
  when no generate step ran or the plan was cancelled before one did) and
  7 new in `executionTelemetry.test.ts` (JSON round-trips every field and
  confirms no prompt/response-shaped keys leak in; CSV header/row shape,
  `reasonCodes` pipe-joined so it can't split across columns, proper
  comma/quote escaping, empty-not-"undefined" cells, empty-list handling).
  131 tests total, up from 116. **Not testable in this sandbox** (native
  SQLite/file-system/sharing): actual insert/read round-trips,
  persistence across a real reload/restart, and the real share-sheet
  export flow — these need real-device verification.

**Update 2026-09-24: adaptive routing is on by default** (`getAdaptiveRoutingEnabled()` defaults to `true`; Settings → Tone & Reasoning toggles it, no longer labelled experimental). It still routes only among `MODEL_CATALOG` models with roles, using the `balanced` preset, so a Hugging Face model chosen with "Select & Use" is only used when adaptive routing is off. Deep Research is now switched in Settings only; the chat header shows a read-only badge while it is on.

---

## Roadmap: verifiable escalation for hard queries (2026-09-27)

**Source:** Vitalik Buterin's public test of mobile offline knowledge apps
(2026-09-26, 269K views): local models are "definitely getting much better"
but remain "much slower and less effective at difficult questions." His
thesis: *"local will be good enough for the common questions but lag behind
at difficult ones, meaning we'll need ways to (verifiably?) send harder
queries out to a global network."* One of the three apps he tested is the upstream project —
the codebase NIDO is built on.

**Status: ROADMAP ONLY — not designed in detail, not implemented.** This
section records design direction so future work doesn't contradict it.

### R-1. Explicit, verifiable escalation path (the "(verifiably?)" answer)

Vitalik's open question is our design requirement. This maps directly onto
the three modes in `NIDO_PRINCIPLES.md` (OFFLINE ONLY / LOCAL-FIRST /
ONLINE ENHANCED, selectable globally and per capability). Future design
must satisfy:

- **Never silent.** Escalation to any external network happens only on
  explicit user initiation (or explicit pre-authorization per capability),
  never as an automatic fallback the user didn't ask for.
- **Verifiable by the user.** Before anything leaves the device, the user
  sees exactly what will be sent (the query text, nothing else — no
  memory, no identity, no history unless explicitly included). After the
  response returns, it is marked as externally obtained, with its source.
- **No dependency creep.** OFFLINE ONLY must remain a complete, working
  product. Escalation is an enhancement for hard queries, not a crutch the
  local path secretly depends on.
- **Untrusted by default.** A remote model/network is an untrusted party
  until authenticated + authorized (per `NIDO_PRINCIPLES.md` authority
  separation: Model = reasoning, never authority). Its output is
  information, not instruction.

### R-2. Honest capability signaling + source-verified answers

- The router should know — and the UI should show — that the local path
  has limits on difficult questions. Never present a local-model answer as
  frontier-equivalent; say what it is.
- Every knowledge answer should carry its offline sources visibly (inline
  citations, "offline verified sources" display), so the user can check
  the answer themselves — the pattern the tested apps already use, which
  NIDO must match or exceed.

### R-3. Benchmark-driven routing data

- `ModelCapabilities.estimatedTokensPerSecond` / `estimatedMemoryMb` remain
  deliberately unset (see §11) until real device numbers exist — no
  invented data, ever.
- When `DEVICE_EVALUATION.md`'s on-device evals produce real numbers, they
  become the routing data source (per-model tok/s, TTFT, peak memory) and
  the basis for honest public benchmark tables (model, tok/s, first token,
  peak memory, raw results linked) — the format NIDO now publishes at
  boarapp.com, which is the right transparency bar.
- Speed is the other half of Vitalik's critique ("much slower" — one hard
  query took ~5 min in the tested apps). The common-question path must be
  fast; per-query timing (TTFT, tok/s) is already measured by
  `telemetry.ts` — surfacing it honestly to the user is future UI work.

### R-4. E2E by default + minimal metadata (cited principle)

Vitalik left Telegram for Signal on an argument we adopt as a principle:
**end-to-end encryption by default on everything, and minimal metadata** —
Telegram only encrypts in optional secret chats and keeps messages/metadata
on its servers; Signal encrypts everything and retains the minimum. For
NIDO this means:

- NIDO↔NIDO P2P is E2E always, with no "unencrypted mode" available.
- Metadata (who talks to whom, when, how much) is minimized by design:
  with no central server there is nobody to hand it to, and the protocol
  must not create unnecessary records even locally.
- Any future escalation path (R-1) inherits this principle: if anything
  leaves the device, it leaves encrypted with the minimum possible
  metadata, and the user knows beforehand.

### R-5. Local must feel frictionless (product directive)

Vitalik: for local models to become "the seamless default," what is missing
is not just better models but **better user interfaces, integrations, and
efficiency** — with "huge progress" already visible versus a year ago. And
his CROPS AI concept: genuinely decentralized AI must run on more than one
chip manufacturer, not depend on a single ecosystem.

Directive for NIDO:

- The quality bar is not "it runs locally," it is "it runs locally and
  feels natural": response times, TTFT, and fluidity measured on a real
  device (see R-3) as product metrics, not just engineering metrics.
- Integrations that avoid leaving the device: offline knowledge, local
  memory, and local tools first; the network is the explicit exception
  (R-1), not the easy path.
- Hardware portability: NIDO must run on generic Android (arm64 today),
  tied to no chip, no manufacturer, no cloud provider.

**Explicitly out of scope for now:** any network escalation
implementation, any external API integration, any change to the offline
default. The immediate priority remains unchanged: first real APK,
on-device verification, pre-alpha corrections.
