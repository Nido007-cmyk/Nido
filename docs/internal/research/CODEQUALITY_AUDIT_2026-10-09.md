# PROFESSIONAL CODE QUALITY AUDIT — NIDO @ 6daf61a5

**Date:** 2026-10-09
**Auditor:** Principal engineer, code-craft review (read-only)
**Scope:** `src/` at commit `6daf61a5` (GREEN on re-audit #7)
**Method:** Direct code reading, pattern greps, data-flow tracing. No files modified.
**Focus:** Engineering craft beyond security — error handling, resources, types, concurrency, API design, dead code, docs, test quality.

---

## Summary

The codebase shows **high discipline** in the audited modules: fail-closed patterns are consistent, crypto code avoids home-grown primitives, and recent fixes include regression tests. The findings below are craft-level — none are ship-blockers on their own, but together they represent the gap between "correct" and "professional."

| Severity | Count |
|---|---|
| BLOCKER | 1 |
| SUGGESTION | 8 |
| NIT | 5 |

---

## BLOCKER

### B1. `taskNegotiation` map never cleaned — unbounded memory growth
**File:** `src/agent/delegation/delegationService.ts:574,428,121`

```ts
private readonly taskNegotiation = new Map<string, string>(); // :574
// ...
this.taskNegotiation.set(body.taskId.toLowerCase(), body.negotiationId); // :428 (in handleTaskRequest)
```

The map is written on every inbound `TASK_REQUEST` and read at `:121` (via `setNegotiationStateLookup`), but **no code path ever calls `.delete()` or `.clear()`** on it. Every task request — including denied, expired, and completed ones — leaves a permanent entry. On a long-lived process handling many delegated tasks, this grows without bound.

**Fix:** Delete the entry when the task lifecycle ends (in `approveTask`/`denyTask` finally paths, or when the approval gate entry expires). At minimum, bound it like `executed` (FIFO cap at 1000, cf. approvalGate.ts).

---

## SUGGESTIONS (should fix)

### S1. Abort discrimination via string matching is fragile
**Files:** `src/agent/delegation/executor.ts:213`, `src/agent/delegation/executor.ts:129-130`

```ts
// checkBudget():
throw new Error("task aborted by peer (TASK_CANCEL)");
// ...
// execute() catch:
if (msg.includes("aborted by peer") || msg.includes("TASK_CANCEL")) {
  return finish(false, undefined, { code: "aborted", ... });
}
```

The `"aborted"` error code — which the entire TASK_CANCEL suppression chain depends on — is derived by **substring-matching an error message**. If anyone rewords the `checkBudget()` throw (localization, clarity), the abort path silently degrades to `"executor_error"` and TASK_RESULT gets sent after cancel. The `isAborted()` flag (H2-RESIDUAL fix) mitigates this in `approveTask`, but the `execute()` return contract itself remains stringly-typed.

**Fix:** Use a dedicated error class (`class TaskAbortedError extends Error`) and `instanceof` check, or set a branded property (`(e as any).isTaskAbort = true` at throw site). String matching should be the fallback, not the primary discriminator.

### S2. `withTimeout` timer never cleared on early settle
**File:** `src/agent/delegation/executor.ts:174-179`

```ts
const withTimeout = <T>(p: Promise<T>): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(...), this.maxDurationMs)
    ),
  ]);
```

When `p` resolves before the timeout, the `setTimeout` handle is never cleared. The timer lingers in the event loop until it fires (up to `maxDurationMs`, default 120s), then rejects an already-settled promise (harmless but wasteful). Under load with many tasks, these accumulate.

**Fix:** Capture the timer handle and `clearTimeout` in a `.finally()` on the raced promise.

### S3. `as never` casts bypass type validation
**Files:**
- `src/agent/delegation/delegationService.ts:124` — `return fn(negId) as never;`
- `src/agent/delegation/delegationService.ts:404` — `negotiationState: negState as never`
- `src/p2p/messenger.ts:1228` — `payload.taskType as never`

Each of these casts a runtime `string` (or `unknown`) to a narrower union type without validation. At `:124`, the lookup function returns `string | undefined` but the provider contract requires `NegotiationState | undefined` — a garbage string flows through unchecked into `approvalGate`, where it's compared against `"ACCEPTED"`. It happens to be safe today (comparison fails closed), but the cast hides the contract boundary.

**Fix:** Validate at the boundary: check the string against the known `NegotiationState` values and return `undefined` for anything else, instead of casting.

### S4. Plaintext DEK staging is undocumented in code
**File:** `src/security/keyRotation.ts:1-30` (module docstring)

The staging file (`rekey-staging.json`) stores `newDekHex` as **plaintext JSON** on disk. The security audits flagged this as a known tradeoff (app-private directory, short-lived), but the module's "Seguridad:" docstring section lists "Nunca loggear DEKs" / "Borrar DEK viejo de memoria" / "Biométrico obligatorio" without mentioning that the staging file itself contains the DEK in the clear. A future reader could reasonably assume the staging is encrypted.

**Fix:** Add one line to the docstring: "TRADEOFF: el staging guarda el DEK nuevo en plaintext (directorio privado de la app, vida corta). En dispositivo rooteado es extraíble."

### S5. Misleading comment: 500MB vs 100MB
**File:** `src/security/backup.ts:162,171`

```ts
* - NEW-H-1: límite de 500MB para evitar OOM     // :162 (comment)
// ...
if (size > 100 * 1024 * 1024) {                   // :171 (code: 100MB)
```

The docstring says 500MB; the code enforces 100MB. (The security audit noted this mismatch too.) A reader trusting the comment will misunderstand the actual limit.

**Fix:** Update the comment to 100MB, or extract a named constant `BUNDLE_MAX_BYTES` used by both.

### S6. Diagnostic instrumentation still in production path
**File:** `src/rag/db.ts:158-165`

```ts
// DIAGNOSTIC (2026-10-05): fine-grained stages to find "undefined is not
// a function" inside getDb(). TODO: remove once root cause fixed.
const dstage = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
```

A `TODO` from 2026-10-05 wraps **every** DB acquisition in a diagnostic stage-tagger. If the root cause was found, this is dead instrumentation adding overhead and noise to stack traces. If it wasn't found, the TODO has been open for 4 days on a hot path.

**Fix:** Resolve the TODO — remove if root cause is fixed, or file it as a tracked issue with the current status.

### S7. `(info as any).size` — untyped FileSystem result
**File:** `src/security/backup.ts:170,222`

```ts
const size = (info as any).size ?? 0;
```

`FileSystem.getInfoAsync` returns a union type where `size` exists only when requested with `{ size: true }`. The `as any` cast bypasses this. The `?? 0` handles the undefined case, so it's functionally safe, but the cast hides whether the call actually requests the size.

**Fix:** Call `getInfoAsync(uri, { size: true })` and use the typed result; or define a minimal interface `{ size?: number }` instead of `as any`.

### S8. `checkBudget()` conflates abort-check with budget accounting
**File:** `src/agent/delegation/executor.ts:128-136`

```ts
private checkBudget(): void {
  if (this.aborted) {
    throw new Error("task aborted by peer (TASK_CANCEL)");
  }
  if (this.toolCalls >= this.maxToolCalls) {
    throw new Error("tool budget exhausted");
  }
  this.toolCalls++;
}
```

One method does three things: abort detection, budget exhaustion check, and counter increment. It's called once per handler invocation (not in a loop), so "budget" is really "single-invocation guard." The abort check is the critical path for TASK_CANCEL, but it's bundled with unrelated accounting.

**Fix:** Split into `throwIfAborted()` and `consumeBudgetSlot()`. Makes the abort path independently testable and the call sites self-documenting.

---

## NITS (polish)

### N1. Bare `catch {}` without logging in non-obvious places
Most bare catches in the codebase are documented (`/* best-effort */`, `/* subscriber errors never break the service */`). These are fine. Two deserve a second look:

- `src/agent/delegation/delegationService.ts:125` — the negotiation-state provider's throw is swallowed and returns `undefined`, which the gate treats as "cannot verify → deny." Correct fail-closed direction, but a buggy provider (as opposed to a missing one) is indistinguishable from "no data." Consider a `console.debug` so provider bugs are diagnosable.
- `src/agent/delegation/delegationService.ts:205,375` — `getSigningKeypair()` failure returns `{ ok: false, reason: "no_identity" }` / silent return. The failure reason (keystore corrupt vs. first launch) is lost. A debug log would help field diagnosis.

### N2. `validateBackup` trusts file extension for bundle routing
**File:** `src/security/backup.ts:216` — `if (uri.endsWith(".nidobackup.json"))`

Extension-based dispatch is case-sensitive and trusts the picker-provided name. A bundle renamed to `.JSON` (uppercase) or with query params would take the raw-DB path and fail with a confusing "not a SQLite file" error instead of being handled as a bundle.

**Fix:** Case-insensitive match: `uri.toLowerCase().endsWith(".nidobackup.json")`.

### N3. `emit()` swallows subscriber errors silently
**File:** `src/agent/delegation/delegationService.ts:152-158`

```ts
} catch {
  /* subscriber errors never break the service */
}
```

The comment documents the intent (good), but in production a throwing UI subscriber will fail silently forever with no diagnostic trail. Consider collecting the error into a debug log.

### N4. Magic numbers without names
- `src/security/backup.ts:171` — `100 * 1024 * 1024` (bundle cap)
- `src/security/backup.ts:174` — `size < 100` (min bundle size)
- `src/security/backup.ts:224` — `size < 1024` (min DB size)
- `src/agent/delegation/executor.ts` — `20000` (document cap, :247), `200` (message slice, :220)

These are scattered and unexplained. Named constants (`BUNDLE_MAX_BYTES`, `MIN_DB_BYTES`, `MAX_DOCUMENT_CHARS`) would make tuning and review easier.

### N5. `let bundle: any` followed by manual validation
**File:** `src/security/backup.ts:178`

`let bundle: any` is the honest type for a `JSON.parse` result, and the subsequent validation (`typeof` checks at :184-195) is thorough. Not a bug — but defining a `PortableBundle` interface and validating into it would let TypeScript check the *consumers* of the parsed object rather than relying on the validator staying in sync.

---

## What's good (confirmed)

- **Fail-closed consistency:** The bare `catch {}` blocks in security paths (`keyRotation.ts`, `backup.ts`, `approvalGate.ts:330`) all fail in the safe direction with comments explaining why. This is the right default and it's applied uniformly.
- **Resource cleanup:** `ackTimers`, `reassemblers`, `pendingSessions`, `reconnectTimers`, `downloadManager` timer maps, and `trackPeakRss` intervals are all cleared on destroy/complete paths. No timer leaks found except S2 (minor).
- **Test style:** Only 3 uses of `(x as any)` across all test files (all in `delegationService.test.ts`, for legitimate internal-state setup). Tests use public APIs elsewhere. No flaky patterns observed (fake timers are used where timing matters).
- **No `console.log` in production paths:** Production code uses `console.debug` (ModelManager) or no logging; `console.log` appears only in `src/eval/` (dev tooling).
- **No commented-out code** found in `src/`.
- **Module boundaries:** `delegationService` / `executor` / `approvalGate` / `delegationToken` have clean separation (transport vs. execution vs. policy vs. crypto). The `isAborted()` addition (H2-RESIDUAL) respects the boundary — it's a query, not a control leak.

---

## Appendix: audit trail (2026-10-09)

Prior audits (security-focused) live in `docs/research/`:
`AUDIT_INDEX`, `AUDIT_BUGS`, `AUDIT_SECURITY`, `AUDIT_TECH_SCOUT`, `AUDIT_ARCHITECTURE`,
`REAUDIT`, `FINAL_AUDIT`, `FINAL_FACEBOOK_AUDIT` (1-3), `REAL_ATTACKS_REVIEW`,
`FINAL_DEVICE_AUDIT`, `DEVICE_AUDIT_WORKER`, `FINAL_COMPREHENSIVE_AUDIT`,
`REAUDIT_6`, `REAUDIT_7` (GREEN).
This report is the first **code-craft** audit (engineering quality beyond security).
