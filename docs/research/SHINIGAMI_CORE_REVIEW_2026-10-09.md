# shinigami-core idea review for NIDO — 2026-10-09

**Scope:** read-only research. What in `invokeil/shinigami-core` is worth
adopting as *ideas* for NIDO. Ideas only — no code copied. Studied from the
repo's own docs (README, ARCHITECTURE.md, AUTOMATION.md, PERMISSIONS.md,
SECURITY.md); Kotlin source was not read.

- **Repo:** https://github.com/invokeil/shinigami-core
- **License:** Apache-2.0 (LICENSE file verified; README badge agrees).
  Ideas are safe to reimplement; cite the project in our docs as prior art.
- **What it is:** an offline-first Android automation core: a deterministic
  `OfflineCommandParser` handles everyday commands (alarms, timers, flashlight,
  volume, media, settings) with zero network and zero model tokens, with the
  model as the ambiguity fallback. Includes a policy engine, confirmation
  layer, and on-device audit log.

## Headline idea: one pipeline for both paths

Their strongest structural pattern: the offline parser and the AI both emit
the **same `ToolCall` objects**, which then flow through validate → policy →
confirm → execute. There is no second, unguarded execution path — no "fast
path" that skips the gates.

**Why for NIDO:** NIDO's pre-router currently short-circuits the model but
should emit the exact same structured action the model would request, so
policy, confirmation, and audit are written once and apply uniformly. This is
the single biggest architectural takeaway.

## Parser patterns worth adopting

1. **Normalize → custom commands → curated patterns → structured output →
   model fallback.** Custom (user-defined) phrases match exactly after
   normalization and beat built-ins. For NIDO: exact-match user phrases
   ("modo noche" → fixed-arg actions) as pre-router priority — cheap,
   zero ambiguity, no model call.
2. **Matcher-per-shape, schema-per-intent.** Several forgiving patterns
   ("7", "7:30", "19.45", "8 pm") all fill one typed schema (hour, minute,
   label). Validation lives in the registry, not the parser. Confirms NIDO's
   planned time normalization ("1minuto" → "1 minuto") and adds: normalize
   separators first (19.45 → 19:45), keep **relative (timers) vs. absolute
   (alarms) as separate intents**, and extract optional labels ("…called Work").
3. **Direct replies for pure queries.** Time/date questions are answered
   inline, never become tool calls. Same for NIDO ("¿qué hora es?").
4. **AI as ambiguity backstop, not error handler.** No "did you mean?"
   dialogs in the parser — unmatched input falls through to the (still
   policy-gated) model. Avoids parser bloat; honest about deterministic
   limits.

## Policy engine worth adopting

Decision order: tool known + schema-valid → **mode unlocked** → runtime
permissions held → special accesses → confirmation needed?

- **Modes (Standard / Enhanced / Full Control)** are orthogonal to Android
  permissions: "which tools may the assistant even attempt" is a user-chosen
  trust tier. A tool above the current mode is denied with a human-readable
  reason *even if the Android permission is granted*.
- **Risk levels** LOW / MEDIUM / HIGH / CRITICAL per tool; CRITICAL reserved
  (empty) for future irreversible actions. NIDO should pre-declare the tier
  now (e.g., for future P2P transfers) before needing it.
- **Denials are fed back to the model with the reason** ("denied: requires
  Enhanced mode") so it can explain honestly instead of hallucinating — this
  directly serves NIDO's Model Phase 3 honesty goal.
- **Fail-closed by design:** dial opens the dialer prefilled and never
  auto-calls; SMS opens a draft, never sends. Irreversible-by-design tools
  are absent, not merely policy-disabled.

## Confirmation UX worth adopting

- Three global policies: **Always** (confirm every MEDIUM+), **Sensitive**
  (default; confirm HIGH+), **Minimal** (auto-run what mode+permissions allow).
- **Per-tool `alwaysConfirm` stacks on top** regardless of global policy.
- **Optional biometric for HIGH-risk tools**, explicit opt-in. (Their SECURITY.md
  honestly labels a voice-print heuristic as NOT biometric authentication —
  NIDO should keep the same discipline if it ever adds voice checks.)
- **Confirmation shows a plain-language summary** ("Call Mom", "Set brightness
  to 60%") from a per-tool summariser — the user approves the summary, not JSON.
- **Engine never depends on UI:** a bridge connects policy engine → UI, and
  the executor can't run a confirmation-dependent action without a real user
  decision. Emergency stop cancels pending confirmations too.
- **Unlock friction for the highest tier:** a dedicated warning screen listing
  exactly what Full Control unlocks, requiring an "I understand the risks"
  checkbox.

## Audit logging worth adopting

- Every action attempt (parser, AI, routines, UI) logged locally:
  timestamp, action, source, result (**SUCCESS / FAILED / DENIED /
  CONFIRMED / CANCELLED**), detail, target, risk level. The key insight:
  **log policy decisions, not just outcomes** — denials and cancellations
  included, so it's auditable *why* something didn't happen.
- Secrets handled separately: encrypted blobs + boolean markers; a redactor
  scrubs key/token-looking values from every log line.

## Concrete next steps for NIDO (ordered by value/effort)

1. Unify pre-router and model outputs into one `ToolCall`-like schema (highest
   value; policy/confirmation/audit written once).
2. Add the decision result type `Allow | Confirm(summary, reason) |
   Deny(reason)` with denial reasons fed back to the local model.
3. Adopt the three-layer confirmation stack: global policy
   (Always/Sensitive/Minimal) + per-tool `alwaysConfirm` + optional biometric
   for high-risk — directly serves NIDO's delegated-task approval cards.
4. Exact-match custom phrase commands as pre-router priority (high value, low
   effort).
5. Add LOW/MEDIUM/HIGH/CRITICAL risk to every NIDO action definition now
   (CRITICAL reserved, empty) and drive confirmation defaults off it.
6. User-facing modes (Standard/Enhanced/Full Control equivalent) as a coarse
   agency dial independent of Android permissions — relevant before more
   P2P/approval features ship.
7. Extend NIDO's audit log to record DENIED/CONFIRMED/CANCELLED with source
   and risk (the log exists; the gap is logging decisions).
8. Copy the honesty patterns: "no silent sends", an explicit list of what the
   assistant *cannot* be talked into, labeling heuristics honestly.
9. Add agent-loop bounds (their 3 provider rounds / 8 tool executions per
   request) as a runaway guard.
10. Fold their time-normalization specifics into the planned batch: separator
    normalization, multiple shapes → one schema, relative vs. absolute intents,
    label extraction.

*Caveat: docs-level research; matcher-by-matcher internals weren't read from
source. Structural patterns above are fully documented and Apache-2.0 clean
to reimplement as ideas.*
