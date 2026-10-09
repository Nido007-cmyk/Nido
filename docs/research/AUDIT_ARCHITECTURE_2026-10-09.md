# Architecture audit — NIDO — 2026-10-09

**Scope:** read-only review of `~/workspace/nido-app/src` (360 TS/TSX files: 201
non-test, 159 test). No source modified. Numbers below are from fresh
measurement, not memory.

**How this relates to the other research docs:** this audit covers
structure/debt/coverage; `IMPLEMENTATION_VERDICT_2026-10-09.md` already
adjudicated the four headline research adoptions (ToolCall unification =
MAYBE/later, logits/RAM = YES, BlueLib = YES, thread split = measure-only).
This document does not re-litigate those verdicts — it adds the structural
findings they didn't cover and slots everything into one priority list.

**Conventions used:** "Quick win" = hours, low risk, do any time.
"Medium refactor" = days, medium risk, needs its own lane. "Major initiative"
= weeks, needs planning. Every recommendation names concrete files.

---

## 1. Executive summary

The architecture is sound at the core — the agent loop (`agentLoop.ts`), the
validate→policy→confirm→execute dispatcher (`dispatcher.ts`), and the pure/testable
separation are genuinely good engineering. The debt is concentrated in five
places, all of the same family: **modules that grew past one responsibility
as features were batched in**, plus a layer of dead code left by superseded
experiments.

Top findings:

1. **God components/modules:** `ChatScreen.tsx` (1942 lines, ~90 imports, 4
   chat pipelines embedded), `p2p/store.ts` (1688 lines, ~45 exports across 8
   concerns), `p2p/messenger.ts` (1651 lines), `NidoScreen.tsx` (1659),
   `models/ModelManager.ts` (1089), `agent/tools/handlers.ts` (1041).
2. **Dead code with real cost:** `dualModelIntegration.ts` (zero production
   callers), `knowledgeGraph.ts` + `knowledgeGraphStore.ts` (no production
   importers), `p2p/sessionManager.ts` (tests only), `p2p/capabilityDiscovery.ts`
   (zero callers). Dead security-adjacent code is the worst kind — it invites
   future callers to trust untested paths.
3. **Duplicated logic, small but corrosive:** reminder→notification
   boilerplate copy-pasted at 4 call sites; `fmtDateTime` living in
   `handlers.ts` and imported by `routines/startup.ts` (layering inversion);
   three telemetry systems recorded in parallel; two parallel intent
   classifiers that can disagree at the most important fork in the app.
4. **Test coverage:** 102 of 201 non-test files have no test. Most is benign
   (UI screens, theme, types). The critical gaps are `ModelManager.ts`
   (1089 lines, zero tests — download/resume/verify logic), the Phase A–C
   tool handlers, and P2P auth/replay code.
5. **Perf:** the user-visible hot path is not the model — it's React.
   `onToken` calls `setMessages` on **every generated token** in a 1942-line
   component, re-rendering the full message list per token. That's the
   cheapest big UX win in the audit. The model-config items (logits term,
   `n_batch`) are already adjudicated in the Verdict doc — referenced, not
   repeated.

Nothing here is on fire. The core loops are correct and heavily tested.
Recommendations are ordered by value/risk below.

---

## 2. Technical debt hotspots

### 2.1 God component: `src/ui/ChatScreen.tsx` (1942 lines, ~90 imports)

Four complete chat pipelines live inside one component's `sendMessage`:

| Pipeline | Trigger | Entry |
|---|---|---|
| Agent loop (recordar/actuar) | `classifyIntent` | `runAgentLoop` (line ~691) |
| Deep Research | `deepResearchModeRef` | `runDeepResearch` (~839) |
| Adaptive routing | feature flag | `runAdaptiveChat` (~917) |
| Fixed-model direct chat | default | inline `genInput` (~860–900) |

Plus: session CRUD via `services/chatHistory`, title/summary generation,
voice, haptics, eval requests, and 15+ embedded screens. A one-line change to
the agent path requires reading through ~300 lines of unrelated RAG
assembly.

**Concrete split (major initiative):**
- `src/ui/hooks/useChatPipeline.ts` — takes `{query, onEvent}` and returns
  the dispatch decision + result. Moves the intent classification fork and the
  four branch invocations out of the component.
- `src/ui/hooks/useChatSession.ts` — session create/persist/title/prune
  (`chatHistory`, `summarize` calls currently at ~735–760).
- Keep rendering + streaming UI in `ChatScreen.tsx`. Target: <700 lines.
- **Effort:** 1–2 weeks. **Risk:** MEDIUM-HIGH — the `finally` cleanup at
  ~751 and the agent-branch early return (~746) encode subtle state
  invariants; the existing component tests
  (`ChatScreen.component.test.tsx`, only 103 lines) are thin, so the
  refactor must be gate-tested by the full suite + a physical session.

### 2.2 God module: `src/p2p/store.ts` (1688 lines, ~45 exports)

Eight concerns in one file: identity/key management, boot repair
(`runP2PBootRepair`), contacts, messages/outbox/N6, agent tasks, nonce
cache, identity archive, contact resolution. A change to outbox retry
semantics touches the same file as Ed25519 identity storage — exactly the
coupling that produces crypto-adjacent regressions.

**Concrete split (major initiative):** `src/p2p/store/` →
`identity.ts` (identity, keypairs, archive), `contacts.ts`
(contacts, resolution), `messages.ts` (outbox/N6, acks), `repair.ts`
(boot repair, repair intents), `nonces.ts` (hello nonce cache),
`agentTasks.ts`. Keep `store.ts` as a barrel re-export so the 7 current
importers don't churn.
**Effort:** 3–5 days. **Risk:** MEDIUM — the 65-test fake suite
(`store.test.ts`, `nativeTransport.test.ts`, `n6.test.ts`) is strong and
would gate it; risk is schema migration order, not logic.

### 2.3 God class: `src/p2p/messenger.ts` (1651 lines, `NidoMessenger`)

Session/pairing state machine + N6 retry/ack engine + payload routers for
negotiation, pack-share, and agent tasks + a built-in i18n fallback table
(`EN_P2P_FALLBACK`). The N6 reliability logic (the app's hardest-won
knowledge) is interleaved with envelope routing.

**Concrete split (major initiative):** extract `N6ReliabilityEngine`
(ack timeouts, `ACK_MAX_ATTEMPTS`, retry outcomes, outbox state transitions)
as its own class with the fake-transport tests; leave `NidoMessenger` as
session + routing. **Effort:** 1 week. **Risk:** MEDIUM — P2P changes need
the two-tablet physical gate regardless of tests.

### 2.4 God screen: `src/ui/NidoScreen.tsx` (1659 lines)

Pairing ceremony + QR + chat + identity recovery in one screen.
**Effort:** 1 week to split into `NidoPairingScreen` / `NidoChatScreen` /
`NidoIdentityScreen`. **Risk:** LOW-MEDIUM — mostly UI; the pairing crypto
stays in `p2p/`.

### 2.5 God class: `src/models/ModelManager.ts` (1089 lines)

Download engine (`downloadCatalogModel`, ~500 lines including resume/cancel/
inactivity timeout), checksum verification, bundled-asset install, storage
accounting (`currentStorageUsageBytes`), reconciliation. It is also the
module with **zero tests** (see §5).

**Concrete split (medium refactor):** extract `DownloadEngine`
(statusOf/statusAll/downloadCatalogModel/signalCancelDownload/
deletePartialDownload + the inactivity-timeout logic) from storage
inventory (`measureUsedBytes`, `currentStorageUsageBytes`, install/delete).
**Effort:** 2–3 days. **Risk:** LOW-MEDIUM — pure JS logic; the win is that
it becomes testable (see §5).

### 2.6 `src/agent/tools/handlers.ts` (1041 lines)

24 tool handlers + `fmtDateTime` + open-app classification in one file.
Natural domain split already visible in the code: memory handlers
(notes/reminders/facts/people), device handlers (time/calc/convert/calendar/
contacts/call/sms/file), P2P handlers (nido_*), skill handlers.
**Concrete split (medium refactor):** `tools/handlers/` →
`memoryHandlers.ts`, `deviceHandlers.ts`, `p2pHandlers.ts`,
`skillHandlers.ts`; `buildToolHandlers` becomes composition over four maps.
**Effort:** 1–2 days. **Risk:** LOW — `buildToolHandlers` is the only
production entry point (ChatScreen + tests); handler-name keys stay stable.

---

## 3. Dead code inventory (verify, then delete)

Each verified by import-graph grep — no production importers:

| File | Lines | Evidence |
|---|---|---|
| `src/agent/models/dualModelIntegration.ts` | 62 | `runDualModelLoop` has zero callers; only `dualModel.test.ts` touches `dualModel.pure` |
| `src/agent/models/dualModel.pure.ts` | 114 | superseded by `src/routing/` adaptive routing; unreferenced outside its own test |
| `src/agent/memory/knowledgeGraph.ts` | 218 | no production importers (only a security test mentions the name) |
| `src/agent/memory/knowledgeGraphStore.ts` | 183 | imports `knowledgeGraph` types only; no callers |
| `src/p2p/sessionManager.ts` | ~200 | only `negotiation.e2e.test.ts` imports it |
| `src/p2p/capabilityDiscovery.ts` | ~150 | zero callers anywhere |

**Why deletion matters beyond hygiene:** dead crypto-adjacent modules
(`sessionManager`, `replayProtection`'s orphan sibling) invite a future
contributor to wire them in assuming they're maintained — they aren't.
`p2pMemoryMock.ts` and `sqliteTestBridge.ts` are test-only **by design**
(clearly documented); leave them.

**Recommendation (quick win):** confirm with the owner that none of these
are planned for revival (knowledge graph especially — it may be a
roadmap item), then delete in one commit. **Effort:** 2 hours.
**Risk:** LOW — deleting files cannot break what nothing imports; the
suite gates it.

---

## 4. Missing abstractions

### 4.1 Reminder → notification boilerplate ×4 (quick win)

`scheduleReminderNotification(reminder.id, reminder.text, new Date(dueAt))`
wrapped in identical `try { } catch { }` appears at `agentLoop.ts:557`,
`:622`, `:659`, and `handlers.ts:207`. One place should own "persist +
notify": add `saveReminderWithNotification(input)` next to `saveReminder`
in `src/agent/memory/memoryStore.ts` (the notification import can stay
lazy *inside* that one helper). **Effort:** 1 hour. **Risk:** LOW —
behavior-preserving; tests exist for the surrounding paths.

### 4.2 `fmtDateTime` layering inversion (quick win)

`src/routines/startup.ts:26` imports `fmtDateTime` from
`src/agent/tools/handlers.ts` — a startup routine depending on the tool
handler bundle. Move it to `src/utils/dateFormat.ts` (new, ~20 lines),
re-export from `handlers.ts` for compatibility.
**Effort:** 30 minutes. **Risk:** LOW.

### 4.3 Two parallel intent classifiers (medium refactor)

- `src/agent/loop/intent.ts` — `classifyIntent`: conversar/recordar/actuar.
  **Decides the biggest fork in the app**: agent loop vs. RAG pipelines
  (`ChatScreen.tsx:661-664`).
- `src/routing/classify.ts` — `classifyTask`: greeting/calculation/...
  Decides retrieval relevance and the adaptive-routing plan.

Both are regex-based, both were written "in the spirit of" the other, and
nothing documents which wins when they disagree (e.g. "recuérdame comprar
pan mañana a las 8" — `classifyIntent` says actuar→agent; `classifyTask`
may say reminder-ish too, but they use different pattern sets and can
diverge on edge phrasing). **Recommendation:** one `classifyTurn(text)`
entry that returns both the agent intent and the task type from a single
normalization pass, with a documented precedence rule ("agent intent
wins the pipeline fork; task type tunes retrieval within it").
**Effort:** 1–2 days. **Risk:** MEDIUM — the fork is the most
user-visible decision in the app; needs the intent test suites merged,
not just moved.

### 4.4 Context-budget accounting duplicated per pipeline (medium refactor)

`estimatePromptTokens`/`assertPromptBudget`/`adaptiveNPredict` live in
`agentLoop.ts` and serve only the agent path. The fixed-model path
re-implements a budget check inline in ChatScreen (~line 887, "C2-2026-10-06"),
and `orchestrator.ts`/`routing/executor.ts` each manage their own
multi-stage budgets. **Recommendation:** extract
`src/agent/loop/contextBudget.ts` (it exists — 1 file, tested) into a
shared `src/inference/contextBudget.ts` service used by all three
pipelines: one token estimator, one `assertFits`, one adaptive
`nPredict`. **Effort:** 1 day. **Risk:** LOW-MEDIUM — pure functions;
the contract ("never hand llama.cpp an overflowing prompt") is already
test-pinned per path.

### 4.5 Three telemetry systems (medium refactor)

`src/services/telemetry.ts` (QueryStats per query),
`src/services/executionTelemetry.ts` (execution records),
`src/inference/telemetry.ts` (inference events). ChatScreen records all
three in parallel per turn (~717–745). They overlap (latency, model id,
outcome) and nothing joins them. **Recommendation:** a single
`recordTurnEvent({...})` facade that fans out to the three stores —
same data, one call site, joinable by timestamp/session. Do not merge the
stores (different retention/privacy semantics); unify the *write path*.
**Effort:** 1 day. **Risk:** LOW.

### 4.6 Typed P2P errors (medium refactor, pairs with BlueLib batch)

`nativeTransport.ts` string-matches errors (`"read failed, socket might
closed"`). Introduce `P2PError { code, retryable }` mapped **once** at the
transport boundary; retry decisions consume codes. The Implementation
Verdict already scoped this as hygiene under the BlueLib adoption —
implement it in the same lane as state-driven retry, not separately.
**Effort:** included in the BlueLib lane (2–3 days total). **Risk:** MEDIUM
(P2P gate required).

### 4.7 Pre-router → ToolCall unification (deferred, per Verdict)

Already adjudicated: **MAYBE**, dedicated 2–3-day lane, after the P2P and
RAM items, never bundled with features. Two pre-router actions
(`weekly_plan`, `save_person`) have no tool definitions, and the R11
provenance gate would change fast-path confirmation behavior — the Verdict
doc has the concrete steps. This audit endorses that sequencing and adds
one prerequisite: do §4.1 first, so the unification lane has fewer
call-site shapes to convert.

---

## 5. Performance bottlenecks

### 5.1 Per-token `setMessages` re-render (quick win — biggest UX ROI)

`ChatScreen.tsx` `onToken` (~line 810) calls `setMessages(prev =>
prev.map(...))` for **every token**, in a 1942-line component owning a
`FlatList` of the whole conversation. On a Snapdragon 695 this is the
dominant jank source during generation — not the model.

**Recommendation:** buffer tokens and flush to state on a ~100 ms interval
(or `requestAnimationFrame`), keeping the existing first-token TTFT
measurement intact. The streaming contract (`onToken` → engine) doesn't
change; only the React commit rate does.
**Effort:** 2–3 hours. **Risk:** LOW — cosmetic; verify TTFT telemetry
still records the true first token.

### 5.2 Dynamic `await import()` on every agent turn (quick win)

`runAgentLoop` performs up to ~10 lazy imports per message
(`actionRouter`, `calc`, `memoryStore` ×2, `notify/notifications` ×3,
`rememberRouter` ×2 — lines 530–641). They're deliberate (keep the loop
pure for tests — native modules break vitest), but the granularity is
wrong: each extraction branch re-imports.

**Recommendation:** one `src/agent/loop/preRouterActions.ts` module that
statically imports the pure routers and lazily imports the native-touching
stores/notifications **once**; `agentLoop.ts` does a single dynamic import
of it. Test purity preserved, per-turn import count drops to ~1.
**Effort:** half a day. **Risk:** LOW.

### 5.3 Model inference config (already adjudicated — reference)

- `LlamaEngine.ts`: single `n_threads: 4`; `n_batch`/`n_ubatch` unset
  (native defaults, unverifiable from JS).
- `ramBudget.ts`: no logits term, no vocab awareness — optimistic by
  ~300 MB for Qwen2.5 (the 1.5B default).
- Verdict: **YES** to explicit `n_batch`/`n_ubatch` + logits term in the
  estimator (half-day static work + one device measurement); **measure
  first** on thread counts; the 2/8 split is **blocked on llama.rn
  upstream** (`n_threads_batch` not exposed). Not repeated here to avoid
  drift — the Verdict doc is the spec.

### 5.4 P2P frame encoding (medium, future)

Every frame is base64-encoded at the transport boundary
(`nativeTransport.ts:741, 880, 1063`) — +33% bytes on the wire. Fine for
chat; material for pack-share chunks (multi-MB transfers over RFCOMM).
**Recommendation:** when pack sharing matures, add binary frame support
in the native module or chunk-level compression before encode. Not urgent
today. **Effort:** 3–5 days incl. native change. **Risk:** MEDIUM.

### 5.5 `snapshot()` per agent turn (low priority)

`memoryStore.snapshot()` re-reads facts (limit 100) + preferences +
people + recent log from SQLite on **every** agent-path message. Correct
at chat cadence; if multi-turn agent sessions ever batch, add a
generation counter / dirty flag. No action now — noted for the record.

---

## 6. Test coverage gaps

102 of 201 non-test files have no corresponding test. Breakdown:
`ui` 53 (screens/theme — acceptable per project norms; a few component
tests exist), `agent` 11, `p2p` 9, `services` 8, `eval` 6, `rag` 4,
`models` 3, others scattered. The ones that matter:

**High value (test next):**
1. **`src/models/ModelManager.ts`** — 1089 lines, ZERO tests. Download
   resume/cancel, checksum verification, inactivity timeout, storage
   accounting are exactly the logic that corrupts silently. Mock
   `expo-file-system`'s `DownloadResumable` and test the state machine.
   **Effort:** 2–3 days. **Risk of writing:** LOW.
2. **`src/agent/tools/handlers.ts`** — no dedicated test file; Phase A–C
   handlers (notes, reminders, memory, people) are covered only
   incidentally via `handlers-phaseD.test.ts` and `dispatcher.test.ts`.
   Add `handlers.test.ts` with mocked `memoryStore`.
3. **`src/p2p/replayProtection.ts`** — crypto-adjacent, no dedicated test
   (only exercised via integration). Nonce-window edge cases deserve unit
   tests.
4. **`src/p2p/p2pAuthorization.ts`** — authorization decisions untested in
   isolation.
5. **`src/agent/scheduled/taskStore.ts`** + `src/agent/skills/learnedSkillStore.ts`
   — persistence layers with zero tests; silent data-loss risk.

**Medium value:**
- `src/services/chatHistory.ts`, `src/services/summarize.ts`
  (session title/summary generation), `src/services/downloadWakeLock.ts`,
  `src/services/nidoMessenger.ts`, `src/rag/packs.ts`,
  `src/rag/seedCorpus.ts`, `src/voice/VoiceInput.ts`,
  `src/models/compatibility.ts`, `src/models/manifestSignature.ts`.

**Low value / skip:** `eval/*.pure.ts` design docs, `pbkdf2Bench.ts`,
type-only files, `brand.ts`/`branding.ts` (constants), i18n context
wiring, theme files.

---

## 7. Cross-check against the research docs

| Research recommendation | Audit position |
|---|---|
| ToolCall unification (Shinigami/VERDICT) | Endorsed as MAYBE; add §4.1 + §4.2 as prerequisites; never bundled with features |
| Logits cap + `n_batch` (Verdict) | Endorsed; the estimator gap (§5.3) is the cheapest correctness fix in the audit |
| BlueLib patterns: state-driven retry + stop-discovery-before-connect (Verdict) | Endorsed as the #1 lane; §4.6 (typed errors) belongs inside it |
| Thread 2/8 split (LLAMACPP doc) | Blocked upstream — measure-only, per Verdict; audit adds nothing |
| "On-device" trust badge + fast-lane UI + named thinking states (OFFLINE_UX) | The 400ms acknowledgment and "instant vs thinking" treatments map directly onto §5.1 (token batching) and the canned-response path — implement together as one UX lane |
| Signal-style pairing ceremony (OFFLINE_UX) | `pairingCeremony.ts` exists; the UX gap is in `NidoScreen.tsx` (§2.4) — ceremony logic is fine, its presentation is buried in a God screen |
| Sourced answers / honest "I don't know" (OFFLINE_UX, Phase 3) | Served by `selfKnowledge.ts` answer paths; no structural blocker found |
| Denial reasons fed back to the model (Shinigami policy) | `dispatchToolCall` already returns denial text as an observation — good; the gap is only that pre-router actions bypass it (§4.7) |

---

## 8. Prioritized recommendations

### Quick wins (hours, low risk — do in any order, one commit each)

1. **Delete dead code** (§3) — owner confirms nothing is slated for
   revival, then one deletion commit. 2 h, LOW.
2. **`saveReminderWithNotification` helper** (§4.1) — collapse 4 call
   sites into one. 1 h, LOW.
3. **`fmtDateTime` → `src/utils/dateFormat.ts`** (§4.2) — fix the
   layering inversion. 30 min, LOW.
4. **Batch token UI updates** (§5.1) — flush streamed tokens to React
   state at ~100 ms instead of per token. 2–3 h, LOW. Biggest
   device-perceived win in this audit.
5. **Consolidate agent-loop dynamic imports** (§5.2) —
   `preRouterActions.ts`. Half day, LOW.
6. **RAM estimator: logits term + explicit `n_batch`/`n_ubatch`**
   (per Verdict §2) — half-day static work; device measurement when the
   tablet is free. LOW.

### Medium refactors (days, medium risk — each its own lane, suite-gated)

7. **BlueLib P2P batch** (per Verdict §4): state-driven retry on
   `onNativeDisconnected` + `cancelDiscovery()` before `connect()` +
   typed `P2PError` (§4.6) + freshness check. 2–3 days + two-tablet
   physical gate. **This is the #1 lane.**
8. **`handlers.ts` domain split** (§2.6). 1–2 days, LOW.
9. **Single classification entry** (§4.3) — unify
   `classifyIntent`/`classifyTask` with documented precedence. 1–2 days,
   MEDIUM.
10. **Shared context-budget service** (§4.4). 1 day, LOW-MEDIUM.
11. **Single telemetry write path** (§4.5). 1 day, LOW.
12. **ModelManager download-engine extraction + test suite** (§2.5 + §6).
    3–4 days, LOW-MEDIUM. Highest-value test gap.
13. **Handler + P2P-auth/replay test suites** (§6). 2–3 days, LOW.

### Major initiatives (weeks, needs planning — after the P2P lane)

14. **ChatScreen decomposition** (§2.1) — `useChatPipeline` +
    `useChatSession` hooks. 1–2 weeks, MEDIUM-HIGH.
15. **`p2p/store.ts` split** (§2.2). 3–5 days, MEDIUM.
16. **`NidoMessenger` N6-engine extraction** (§2.3). 1 week, MEDIUM.
17. **ToolCall unification lane** (§4.7, per Verdict) — after items 1–2
    and the P2P/RAM lanes. 2–3 days, MEDIUM.
18. **Binary P2P frames for pack sharing** (§5.4) — when pack sharing
    leaves prototype stage. 3–5 days, MEDIUM.

### Explicitly NOT recommended now

- **Thread-count changes without device data** (blocked upstream anyway).
- **Rewriting `src/routing/`** — it's well-tested and cleanly separated;
  the problem is the *fork* in ChatScreen, not the router.
- **Merging the three telemetry stores** — different retention/privacy
  semantics; unify the write path only.
- **UI screen test blitz** — 53 untested screen files; component tests
  have low ROI versus the ModelManager/handler gaps. Add them
  opportunistically during the §2.1/§2.4 splits.

---

## 9. Suggested lane order (respects the single-lane rule)

1. Quick wins 1–6 (batch as one "hygiene" lane — all low-risk, no
   behavior change except §5.1's render batching).
2. **P2P BlueLib lane** (item 7) — the documented physical failures live
   here; everything else waits.
3. RAM estimator + device measurement (item 6's device half).
4. Medium refactors 8–13, one lane each, in listed order.
5. Major initiatives 14–18, planned with the owner.

**Evidence grading:** structural claims above are STATIC (file reads,
import graphs, line counts). "No production callers" was verified by
`grep` over `src/` + `App.tsx` on 2026-10-09 — re-verify before the
deletion commit, since lanes move fast. Performance claims (§5.1, §5.5)
are CODE-LEVEL reasoning, not device measurements — treat the effort
estimates as honest, the speedups as expected-not-proven.
