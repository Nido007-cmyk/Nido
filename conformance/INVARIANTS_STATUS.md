> **Language:** English · [Español](es/INVARIANTS_STATUS.md)
# INVARIANTS STATUS — after explicit break attempts (2026-09-27)

Target: `conformance/reference-rs`, attacked per the threat sections of
`conformance/SECURITY_INVARIANTS.md`. Attacks live in
`conformance/reference-rs/tests/invariants.rs` (12 tests, all passing —
i.e. every attack was refused).

## INV-1 · AUTHORITY_MONOTONICITY — HOLDS

Attacks: smuggled `"mode":"AUTO"` / `"admin":true` inside the *request*
object; version spoofing (`v2`, `v1 `, `V1`, `v01`, empty); delegation token
with `max_uses:9999` / `admin:true` outside `scope`. All refused: the policy
evaluator reads only `(subject, capability, version, …)` from the request and
only exact-match rules from local policy; unknown token fields are never
consulted. **No break.**

## INV-2 · AUTONOMY_NON_EXPANSION — HOLDS (with one TS-side finding)

Attacks: unknown protocol versions (`nido/2.0`, `nido/1.1`, `v1`, `1.0`,
empty) — none negotiable; unknown capability version `v99` — no
intersection; consent used at exactly `expires_at` — `CONSENT_EXPIRED`.
`"nido/01.0"` normalizes to `(1,0)` in *both* implementations (numeric parse)
and negotiates the canonical token `nido/1.0` — not a break, documented
normalization. **Rust holds. Finding:** TS *policy* accepts `now ==
expires_at` as live, contradicting AMB-06 (`now >= expires_at` ⇒ expired
everywhere) which Rust, TS-consent, and TS-delegation all follow —
classified **TS_BUG**, awaiting the spec→vector→fix pipeline.

## INV-3 · TRANSPORT_INDEPENDENCE — HOLDS BY CONSTRUCTION

Attack: exhaust a budget, then keep spending while "switching transports".
The accounting functions take **no transport parameter at all** — there is
no dimension to vary, so the attack is vacuous. Verified the meaningful
half: per-identity isolation (spending as A never touches B's window).
Replay protection is keyed by `message_id` per sender; signatures cover the
canonical form with no transport metadata. **No break.**

## INV-4 · RETRY_SAFETY — HOLDS AT PROTOCOL LAYER

Attacks: `task_ids = [t1,t2,t1,t2,t1]` → `executed_count=2`,
`duplicates_rejected=3`, log exactly
`[EXECUTED, EXECUTED, DUPLICATE, DUPLICATE, DUPLICATE]`; duplicate
`message_id` in one envelope batch → `DUPLICATE_MESSAGE`. **No break.**
Known v0 layering: same `task_id` under a *new* `message_id` is a new
message at the protocol layer in both implementations; task-level dedup
("return the recorded outcome") belongs to the agent outbox layer above,
not yet implemented. Documented as `UNSPECIFIED_BEHAVIOR`, not a break.

## INV-5 · DISCLOSURE_ACCOUNTING — HOLDS

Attacks: negative / NaN / Infinite `disclosed_units` (refund or poison
attempts) — all `GRAPH_INVALID`; eleven 1-unit disclosures vs budget 10 —
`GRAPH_BUDGET_EXCEEDED`; mid-vector double-spend — `BUDGET_EXHAUSTED` at
the exact step index with no partial spend leaking into `remaining`;
disclosure projection — empty allow-list ⇒ `null`, never invents fields
(property-tested). **No break.**

## INV-6 · DELEGATION_ATTENUATION — HOLDS

Attacks: delegatee mints a token widening *every* axis — more `max_uses`,
later `expires_at`, wider `peers`, swapped capability, broken
issuer-linkage. All refused (structural checks and/or signature check;
`ok:true` never produced). **No break.** Known v0 layering: neither
implementation's chain verifier consults revocation state — revocation is
enforced by the DELEGATION state machine (`REVOKED` terminal). A verifier
running chain checks alone would accept a revoked-but-unexpired token;
same in TS, documented as `UNSPECIFIED_BEHAVIOR`.

## INV-7 · FAIL_CLOSED — HOLDS (one bug found and fixed)

Attacks: 11-shape parser battery (duplicates, trailing garbage, lone
surrogates, unescaped NUL, unsafe integers, truncated input, BOM,
`__proto__` — the last correctly parsed as *inert data*, not rejected);
unknown machines/events; malformed versions. All typed errors, no panics.
**Break found:** 5k-deep nested input caused a stack overflow abort
(SIGABRT) — remotely triggerable process crash via a malicious envelope.
Classified **RUST_BUG** (TS fails closed: V8 RangeError → caught →
`PARSE_ERROR`, verified at 5k and 100k depth). **Fixed:** explicit
`MAX_PARSE_DEPTH = 128` → typed `NESTING_TOO_DEEP`; canonicalizer hardened
with its own guard. Regression: 5k and 100k depths probed in-test.

## Summary

| Invariant | Break attempts | Result |
|---|---|---|
| INV-1 AUTHORITY_MONOTONICITY | 3 | holds |
| INV-2 AUTONOMY_NON_EXPANSION | 3 | holds in Rust; TS_BUG found (policy expiry equality) |
| INV-3 TRANSPORT_INDEPENDENCE | 1 | holds by construction |
| INV-4 RETRY_SAFETY | 1 | holds at protocol layer; task-layer dedup out of v0 scope |
| INV-5 DISCLOSURE_ACCOUNTING | 2 | holds |
| INV-6 DELEGATION_ATTENUATION | 6 sub-attacks | holds; revocation layering noted |
| INV-7 FAIL_CLOSED | 2 | 1 RUST_BUG found & fixed (nesting DoS) |

No invariant was broken in a way that remains unfixed. Two findings
require the spec→vector→fix pipeline (TS policy expiry equality; the
SPEC_AMBIGUITY items listed in `DIFFERENTIAL_REPORT_RUST.md`).
