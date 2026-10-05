> **Language:** English · [Español](es/DIFFERENTIAL_REPORT_RUST.md)
# DIFFERENTIAL REPORT — Rust second implementation

Date: **2026-09-27** · Scope: `conformance/reference-rs` vs `conformance/reference-ts`
over `conformance/vectors/v0/final` (**158 vectors** — 157 baseline + `env-029`
regression vector added 2026-09-27 for the replay-ordering RUST_BUG) via the
language-agnostic NDJSON harness.

**Headline: 158 passed / 0 failed.** Every official vector agrees between the
two implementations.

Method: each implementation was driven through
`conformance/harness/runner.py` as a stdin/stdout NDJSON worker. The Rust
results are archived at `conformance/harness/differential-results-rs.json`
(the runner's default output file `differential-results.json` remains the
TS-tracked file and was restored after each run).

Discrepancies found *while building* the Rust implementation were classified
per project rules. The spec was never bent to match an implementation.

## RUST_BUG (found and fixed in reference-rs)

1. **Envelope version parsing.** Rust accepted `nido/01.0` numerically as
   `(1,0)`; TS requires the exact token `nido/1.0`. Fixed: exact token match.
   (`"nido/01.0"` still normalizes to `(1,0)` in *both* implementations when
   it appears as a bound — numeric parse of `01` is `1` in both; the
   negotiated output is always the canonical `nido/1.0`.)
2. **Delegation validation.** `max_uses` accepted `0`; `expires_at <=
   issued_at` accepted; `scope.peers` treated as required; parent-without-
   peers attestation logic inverted. Fixed to match TS/spec: `max_uses`
   integer ≥ 1, `expires_at > issued_at`, `peers` optional (absent ⇒ signed
   body normalizes to `null`), attenuation only when the parent restricts
   peers, unknown scope extensions excluded from the signed body.
3. **Policy precedence.** On tied rules Rust preferred `ASK` over `AUTO`;
   TS rule is "most permissive live rule wins" ⇒ `AUTO` wins. Fixed, and
   `max_disclosure_units` support added.
4. **Deep-nesting stack overflow (robustness).** Rust's recursive parser
   aborted the process (SIGABRT, stack overflow) on ~5k-deep nested input —
   a remotely triggerable crash via a malicious envelope. TS fails closed
   (V8 RangeError → caught → `PARSE_ERROR`, verified empirically at 5k and
   100k depth). Fixed: explicit `MAX_PARSE_DEPTH = 128` → typed error
   `NESTING_TOO_DEEP`; the canonicalizer carries its own guard and is total.
   New invariant attack `inv7_deeply_nested_input_is_rejected_safely` covers
   5k and 100k depths.

## TS_BUG (found by differential reading; TS not yet fixed)

5. **Policy expiry boundary.** AMB-06 (`SPEC_AMBIGUITIES.md`) says
   `now >= expires_at` ⇒ expired *everywhere*. Rust follows it. TS policy
   uses `req.now <= r.expires_at` as the live-rule test, accepting equality.
   (Consent and delegation in TS do expire at equality.) No vector covers
   `now == expires_at` for policy. **Action required:** spec confirmation →
   new vector in `vectors/v0/source/` → regenerate `final/` → fix TS →
   re-verify Rust.

## SPEC_AMBIGUITY (documented, behavior frozen)

6. **RFC 8785 vs NIDO v0 escapes (AMB-01).** RFC 8785 §3.2.2.2 requires
   `\b \t \n \f \r` for five C0 controls; NIDO v0 (spec text,
   `reference-ts/canonicalize.ts`, vector `canon-003`, and now Rust) emits
   `\uXXXX` for *all* C0 controls. The v0 profile is frozen (changing it
   would change every hash/signature); the deviation is documented in
   `reference-rs/src/canon.rs`. `SPEC_AMBIGUITIES.md` AMB-01 needs a formal
   update to record this.
7. **Envelope/cert skew equality.** TS envelope expires at
   `now > expires_at + skew`; Rust at `expires_at <= now - skew` — they
   differ exactly at equality. `env-026` covers only "1ms past skew".
   Same shape for certificate expiry (`now >` vs `now >=`). Needs equality
   vectors + formal classification.
8. **Validation order / replay-cache poisoning.** `AGENT_PROTOCOL.md §8`
   orders: parse → version → crypto suite → signature+cert → timestamps →
   replay → type/payload. TS checks timestamps before cert/signature; both
   implementations deviate from §8 there (no vector distinguishes).
   **RUST_BUG found by independent audit 2026-09-27:** the delivered
   `reference-rs` inserted `message_id` into the replay `seen`-set *before*
   signature verification — an unauthenticated envelope poisoned the set for
   later envelopes in the same batch, and error precedence was wrong
   (`DUPLICATE_MESSAGE` instead of `INVALID_SIGNATURE`). The v1 report text
   above incorrectly claimed this was already fixed; the code contradicted
   the claim. **Fixed:** `seen` is now checked after signature verification
   and populated only on the success path, mirroring `reference-ts`
   (`envelope.ts`: `seen.has` after `edVerify`, `seen.add` on success).
   **Regression vector** `env-029` (source → regenerated final/): tampered
   envelope whose `message_id` is pre-seeded in `ctx.seen` → both
   implementations must answer `INVALID_SIGNATURE`. Proven empirically:
   pre-fix binary answered `DUPLICATE_MESSAGE`; fixed binary answers
   `INVALID_SIGNATURE`; TS answers `INVALID_SIGNATURE`.
9. **Payload `delegation?`.** `AGENT_PROTOCOL.md §5.1` documents `delegation`
   as an optional `TASK_REQUEST` payload field, but `reference-ts` rejects it
   and Rust follows TS. Classification pending; spec text vs both
   implementations disagree.
10. **Consent vs policy expiry precedence.** TS consent checks
    expiry → exhausted → binding; Rust checks binding → expiry → exhausted.
    Current vectors are single-fault, so both pass; needs a multi-fault
    vector to pin the observable order.
11. **Forbidden-field matching.** TS uses substring regex
    `/prompt|instructions|system_prompt/i`; Rust matches exact lowercased
    field names. No vector distinguishes them.
12. **Certificate signing scope.** TS signs/verifies four known cert fields;
    Rust signs all cert fields except `signature`. No vector distinguishes.
13. **Delegation revocation layering.** Neither implementation's chain
    verifier consults revocation state; revocation is enforced by the
    DELEGATION state machine (`REVOKED` terminal). A verifier that only runs
    chain verification would accept a revoked-but-unexpired token. Same in
    both → v0 layering note, not a divergence.
14. **Task-id redelivery (INV-4 layering).** Same `task_id` under a *new*
    `message_id` is a new message at the protocol layer in both
    implementations; task-level dedup ("return the recorded outcome") lives
    above the protocol layer (agent outbox), unimplemented in v0.

## UNSPECIFIED_BEHAVIOR (no vector, both fail closed)

- Unknown envelope `message_type`s other than `TASK_REQUEST`: TS validates
  all documented types, Rust only `TASK_REQUEST` (Rust rejects the rest as
  unknown — fail-closed, narrower surface).
- TS accepts `TEST_KEYS` aliases (`idA`, `idB`, `devA1`); Rust accepts only
  64-char lowercase hex pubkeys. The 157 vectors use hex only, so this is
  untested-differential territory.

## WHAT WAS PROVEN

- The 158 official vectors produce byte-identical verdicts in two
  independently written implementations (TS + Rust), including the `env-029`
  regression vector that pins replay-check-after-authentication.
- f64 → string formatting is bit-identical to `Number.prototype.toString`
  on 20,026 adversarial patterns (0 mismatches).
- 12 explicit invariant-breaking attempts (request smuggling, version
  spoofing, token widening, budget refunds, parser attacks, 100k-deep
  nesting) all fail against the Rust implementation.

## WHAT FAILED

- One genuine robustness bug found and fixed: deep-nesting stack overflow
  (RUST_BUG #4 above).
- One genuine ordering bug found by independent audit and fixed: replay
  `seen`-set insert before authentication (RUST_BUG, item 8 above) — the
  v1 report incorrectly claimed it was already fixed; the delivered code
  proved otherwise. Regression vector `env-029` now pins the correct order.
- One probable TS bug found, not yet fixed: policy expiry at equality
  (TS_BUG #5) — needs the spec→vector→fix pipeline.

## WHAT REMAINS UNVERIFIED

- Items 5–14 above: each needs spec confirmation, a new `source/` vector,
  `final/` regeneration, and re-verification in both implementations.
- No third implementation; no external audit.
- Android (C-1) untouched by this work.
