# Implementation verdict — research findings under the microscope

Date: 2026-10-09. Read-only investigation (no source modified).
Question from the user: *can these research findings actually help NIDO, and how?*

Each item was checked against NIDO's actual code (not just the research
docs). Verdicts are honest, not optimistic.

---

## 1. ToolCall schema unification (shinigami-core idea)

### Verified current state

- **Model path is already unified.** `parseToolCalls(text)` →
  `ParsedToolCall { name, arguments }` → `dispatchToolCall(call, handlers,
  options)` in `src/agent/tools/dispatcher.ts`, which runs
  validate → policy (`evaluateAction`) → human confirmation → handler.
  (`src/agent/loop/agentLoop.ts:738-814`).
- **Pre-router path bypasses all of it.** Six extract functions return
  bespoke interfaces and `agentLoop.ts` (~lines 519-600+) executes them
  **inline**: `saveReminder`, `scheduleReminderNotification`,
  `evaluateExpression`, `savePerson`, `saveFact` — none go through
  `dispatchToolCall`, `validateToolCall`, or the policy engine.
  - `src/agent/loop/actionRouter.ts`: `extractCalcAction`,
    `extractReminderAction`, `extractWeeklyPlanAction`
  - `src/agent/loop/rememberRouter.ts`: `extractPerson`,
    `extractRememberFact` (`extractDateISO` is a helper, not an action)
- **The manifest has 24 tools, but two pre-router actions have no tool.**
  `calculate` ✅, `create_reminder` ✅, `remember_fact` ✅ exist — but there
  is **no `weekly_plan` tool** and **no `save_person` tool**. Unification is
  not just rewiring; it requires registering new tools (schema + handler +
  policy entry + prompt description).
- **Policy default is permissive for these.** `evaluateAction` defaults to
  `allowed: true, requiresConfirmation: false` for low-risk tools, so
  `create_reminder`/`calculate` would pass through unchanged. **But** the
  R11 provenance gate (`src/agent/policy/policyEngine.ts`) forces human
  confirmation for `remember_fact` when the turn context contains untrusted
  sources — and fails closed if `onConfirm` isn't wired. The pre-router
  caller would have to pass a `policyContext` that correctly labels the
  user's own message as trusted, or reminders/facts from the fast path
  start prompting unexpectedly.
- **Response text would regress.** The pre-router builds rich localized
  responses ("Listo, te recordaré el viernes…"). Tool handlers return plain
  result strings. A presentation adapter per tool is needed to avoid a UX
  downgrade.

### Concrete implementation steps

1. Add `weekly_plan` and `save_person` to `src/agent/tools/manifest.ts`
   (schema, description) + handlers + policy risk tiers.
2. Write adapters: each extract result → `ParsedToolCall`
   (e.g. `extractReminderAction` → `{name:"create_reminder",
   arguments:{text, dueAt}}`).
3. Replace the inline-execution block in `agentLoop.ts` with
   `dispatchToolCall` calls, hoisting `handlers`/`dispatchOptions`
   (with `onConfirm` and a trusted-source `policyContext`) into scope.
4. Add per-tool response formatters to preserve the current localized UX.
5. Update `agentLoop.test.ts` integration expectations (extractors'
   unit tests in `actionRouter.test.ts`/`rememberRouter.test.ts` are pure
   and unchanged).

### Risk / effort

- **Risk: MEDIUM.** Touches the most-tested user-visible path
  (reminders/calc). The policy gate subtlety (R11) is a real behavior trap.
- **Effort: 2–3 days** including test updates.

### Verdict: MAYBE

Architecturally correct, but the bypass has caused **zero incidents** and
covers only six deterministic, low-risk actions on explicit user phrasing.
The two missing tools expand the scope beyond "unification" into "new
tools." Do it as a **dedicated refactor lane with the test suite as the
gate** — never bundled with feature work — and only after the P2P and RAM
items below. It is the right long-term shape, not the next fire to fight.

---

## 2. Logits buffer cap (~300 MB claim)

### Verified current state

- `llama.rn` **0.13.0-rc.6** `NativeContextParams`
  (`node_modules/llama.rn/src/types.ts`): **no `n_outputs_max`, no logits
  cap exposed.** Confirmed by reading the type list.
- NIDO sets **neither `n_batch` nor `n_ubatch`** in `LlamaEngine.ts`
  (`initLlama` gets only `n_ctx`, `n_threads: 4`, `use_mlock: false`,
  `n_gpu_layers: 0`) → the native default applies, which cannot be verified
  from JS (prebuilt `.so`; build 11192 / commit `171e884`).
- **The math checks out, directionally.** Qwen2.5 vocab = 152,064 tokens ×
  4 bytes: at `n_batch=512` → **~297 MB**; at llama.cpp's typical default
  `n_batch=2048` → **~1.16 GB** (which would OOM — the app runs today, so
  the effective default is smaller or allocation is lazy; the exact number
  needs the device or the bundled llama.cpp source).
- `src/inference/ramBudget.ts` models weights + KV cache + a **fixed
  256 MiB compute allowance** (scaled by nCtx). It has **no logits term and
  no vocab awareness** — the estimator is optimistic by up to ~300 MB for
  Qwen2.5 models.

### Is it a real problem NOW?

- **0.5B: no — it runs on the tablet today.** Theoretical, not observed.
- **1.5B (the preferred default): plausibly yes.** The estimator claims
  ~1.28 GiB, but with an unmodeled ~300 MB logits buffer the real footprint
  may be ~1.5–1.6 GiB — material on a 4 GB device, and exactly the kind of
  silent killer that shows up as an LMK kill, not an error.

### Concrete implementation steps

1. Pin down the real default: map llama.rn build 11192 → bundled llama.cpp
   version → `llama_context_default_params().n_batch`, or measure RSS on
   the tablet after loading each model.
2. Set **explicit `n_batch`/`n_ubatch` (512/512)** in `LlamaEngine.ts`
   (both are supported params) — deterministic memory behavior instead of
   relying on native defaults.
3. Add a logits term to `ramBudget.ts`: `nBatch × 152064 × 4` (vocab from
   model metadata, not hardcoded per model family where possible).
4. Do **not** chase `n_outputs_max` — it isn't exposed; that's upstream
   work (llama.rn feature request), not a NIDO patch.

### Risk / effort

- **Risk: LOW.** Steps 1–3 are measurement + config + estimator math; the
  estimator change only affects the pre-flight "fits?" verdict messaging.
- **Effort: half a day** static work + one device measurement session.

### Verdict: YES

Scoped to the estimator fix + explicit `n_batch`/`n_ubatch`. Cheap,
correct, and it closes a real measurement gap that matters most for the
1.5B default. The full cap (`n_outputs_max`) is correctly out of scope.

---

## 3. Thread configuration (2 gen / 8 prefill split)

### Verified current state

- NIDO: **single `n_threads: 4`** (`LlamaEngine.ts:196`).
- `llama.rn` 0.13.0-rc.6: **`n_threads_batch` is NOT in
  `NativeContextParams`** (verified in `src/types.ts`; it appears only in
  bench-result parsing). **The 2/8 split is not achievable through the
  public API today.**
- Workarounds evaluated:
  - `cpu_mask`/`cpu_strict` (supported): applies **one mask to all
    threads** — controls *placement*, not per-phase *count*. Cannot
    implement the split. (The voxsumdroid `sched_setaffinity` trick was
    about EAS parking workers on the big cluster, a placement issue.)
  - Upgrading llama.rn when upstream exposes it: viable, watch don't chase.
  - Native patch: explicitly out of scope.
- The single-value tradeoff on SD695 (2×A78 + 6×A55): decode is
  memory-bandwidth-bound with a per-token thread barrier — little cores
  stall it, so fewer/big-only threads win decode; prefill is
  compute-bound and wants all 8. `n_threads: 4` is an unmeasured compromise.

### Concrete implementation steps

1. **Device A/B first:** `n_threads` ∈ {2, 4, 8} with a fixed prompt;
   measure decode tok/s and prefill tok/s (time-to-first-token) separately.
2. Optionally try `cpu_mask` pinned to the big cluster + `cpu_strict: true`
   as a decode-focused variant.
3. Change the default **only if the data supports it**; otherwise watch
   llama.rn upstream for `n_threads_batch`.

### Risk / effort

- **Risk: LOW for measurement; MEDIUM if the default is changed blind**
  (prefill/TTFT regression would be directly user-visible).
- **Effort: ~1 hour** config + one device A/B session.

### Verdict: MAYBE

**Yes to the measurement, no to changing the default without data.**
The headline recommendation (the split) is **blocked on llama.rn
upstream** — NIDO cannot implement it today by any supported means.
Don't let the research's confidence obscure that.

---

## 4. BlueLib transport patterns for Bluetooth reliability

### Verified current state vs. the 6 patterns

| BlueLib pattern | NIDO status |
|---|---|
| Retry on **DISCONNECTED state transition** | **GAP.** NIDO retries outbound connects (`connectWithBackoff`, 3 attempts, 1s/2s/4s) and has a `ReconnectManager`, but it is driven by **`onPeerLost` (presence)**. The documented physical failure is exactly what this pattern fixes: *"retry only fires on onPeerLost, but the screen-off tablet still looks 'visible', so retry never starts."* `onNativeDisconnected` → `forgetRoute()` cleans state but does **not** schedule a retry. |
| Never leak sockets (`close()` every failed socket) | Likely OK — code asserts each attempt uses a fresh socket and "the native side closes the previous one" (`nativeTransport.ts` RETRY-2026-10-07 comment). Needs a native-side audit to be certain. |
| **Stop discovery before connecting** | **GAP.** `connect()` → `ensureLinked()` → `b.connect(mac)` with no discovery stop. Inquiry scan and BR/EDR paging contend for the radio. |
| Scan-then-connect while fresh | **Partial.** MAC comes from the alias string; no timestamp/freshness check on the discovery result behind it. |
| Typed `isRetryable` error taxonomy | **GAP.** NIDO string-matches (`"read failed, socket might closed"`). Retry decisions are not data-driven. |
| Bond-loss awareness (Android 16+) | **Done.** `BOND-LOSS-2026-10-07`, `ACTION_KEY_MISSING` receiver in `NidoP2PManager.kt`. |

### Concrete implementation steps

1. **State-driven retry (the big one):** in `onNativeDisconnected`, after
   `forgetRoute()`, notify `ReconnectManager` to schedule a retry cycle —
   reusing its existing flap guard and backoff — independent of `onPeerLost`
   presence. This is the direct fix for the "visible but dead" peer.
2. **Stop discovery before connect:** `cancelDiscovery()` (native) at the
   top of `connect()`'s socket phase; restart discovery after the handshake
   settles (success or final failure).
3. **Freshness:** timestamp discovery results; `connect()` re-runs a short
   discovery or warns when the result is stale (threshold ~60s).
4. **Error taxonomy:** introduce `P2PError { code, retryable }` at the
   transport boundary; map native error strings **once**, decide on codes
   afterward. (Hygiene; lower priority than 1–2.)
5. Native audit of socket `close()` on every failure path before claiming
   pattern 2.

### Risk / effort

- **Risk: MEDIUM.** P2P is the most fragile subsystem and every change
  needs the physical two-tablet gate — but the existing 65-test fake
  suite (`nativeTransport.test.ts`) covers the transport logic well.
- **Effort: 2–3 days** + physical gate.

### Verdict: YES

Items 1 and 2 **directly attack NIDO's documented physical failures**
(handshake timeouts, the phantom-"visible" peer, silent link loss). This is
the highest-value adoption of the four — and BlueLib is Apache-2.0, so the
patterns are clean to adapt with attribution.

---

## Priority order

1. **#4 BlueLib patterns** (state-driven retry + stop-discovery-before-connect)
   — fixes observed physical failures; do first.
2. **#2 Logits/RAM estimator** (explicit `n_batch`/`n_ubatch` + logits term)
   — cheap, correct, protects the 1.5B default.
3. **#1 ToolCall unification** — right architecture, zero incidents so far;
   dedicated refactor lane, never bundled with features.
4. **#3 Thread split** — measure on device first; the split itself waits on
   llama.rn upstream.

## Cross-cutting honesty notes

- The research docs are confident about the 2/8 thread split, but **NIDO's
  pinned llama.rn cannot implement it** — verified, not assumed.
- The ~300 MB logits figure is **arithmetically sound but the actual
  default is unverified** — the app runs today, so the effective default
  must be smaller than the naive 2048-batch math suggests. The estimator
  gap is real regardless.
- Unification (#1) is less "free" than the research implies: two of the six
  pre-router actions have **no corresponding tool** (`weekly_plan`,
  `save_person`), and the R11 provenance gate means the fast path would
  inherit confirmation behavior it doesn't have today.
