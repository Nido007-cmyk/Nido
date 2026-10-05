> **Language:** English · [Español](es/FUZZ_RESULTS.md)
# FUZZ RESULTS — reference-rs

Date: **2026-09-27** · Target: `conformance/reference-rs`
(`nido-conformance-rs v0.1.0`)

## 1. Float-formatting differential corpus (Node vs Rust)

- Generator: `conformance/reference-rs/tests/gen_float_corpus.py`
  (deterministic; seed fixed; MD5 `1956d24aeb77f307264b13e10c7b34cb`
  reproduced on regeneration).
- **20,026** finite f64 patterns: subnormals, min/max, powers of 2 and 10
  around every decimal-exponent boundary, near-halfway round-trip cases,
  random bit patterns.
- Expected outputs: `tests/gen_float_expected.mjs` via
  `Number.prototype.toString` → `tests/float_expected.jsonl`.
- Test: `tests/float_differential.rs`.
- **Result: 20,026 / 20,026 match, 0 mismatches.**
- Corpus files (`tests/float_corpus.txt`, `tests/float_expected.jsonl`) are
  committed so the differential is reproducible without Node.

## 2. Property tests (`tests/properties.rs`, 16 tests)

Deterministic property battery, all passing:

| Area | Properties |
|---|---|
| Parser | round-trip compact; duplicates rejected; trailing data rejected; lone surrogates rejected; unescaped C0 rejected; unsafe-integer boundary (`2^53-1` ok / `2^53` err / `1e21` ok); `__proto__` inert |
| Canonicalization | idempotent; insertion-order independent; UTF-16 code-unit key order; NIDO escape profile (no short escapes, all C0 as `\uXXXX`) |
| Policy | AUTHORITY_MONOTONICITY (garbage never authorizes); AUTONOMY_NON_EXPANSION (DENY is sticky); FAIL_CLOSED (unknown subject/capability/version/mode ⇒ DENY) |
| Delegation | DELEGATION_ATTENUATION (narrower scope / shorter expiry / peer subset accepted; any widening refused; max_uses=0 refused) |
| State machines | terminal states are sinks; unknown machine/event rejected |
| Budget/graph/disclosure | double-spend in one vector refused at step index; negative/NaN/Infinite units refused; empty allow-list ⇒ `null`; projection never invents fields |
| Evaluators | garbage input to every evaluator ⇒ `ok:false`, never a panic |

## 3. Invariant attacks (`tests/invariants.rs`, 12 tests)

Explicit break attempts per `SECURITY_INVARIANTS.md`; all refused:

- INV-1: smuggled `mode`/`admin` in request; version spoofing
  (`v2`, `v1 `, `V1`, `v01`, ``); unknown token fields granting nothing.
- INV-2: unknown protocol/capability versions; expiry-at-equality
  (`CONSENT_EXPIRED` at `now == expires_at`).
- INV-3: budget isolation across identities (no transport parameter exists
  to vary — holds by construction).
- INV-4: duplicate `task_id` retransmission never re-executes.
- INV-5: negative/NaN/Infinite unit refunds; 11×1-unit disclosures vs
  budget 10; mid-vector exhaustion reports the step index.
- INV-6: delegatee minting broader token on every axis (uses, expiry,
  peers, capability, linkage) — all refused.
- INV-7: 11-shape adversarial parser battery; **5k- and 100k-deep nesting
  → typed `NESTING_TOO_DEEP`** (this attack found the stack-overflow bug;
  see below).

## 4. Findings

1. **Stack overflow on deeply nested input (FIXED).** The recursive parser
   aborted the process (SIGABRT) at ~5k nesting depth. Fix: explicit
   `MAX_PARSE_DEPTH = 128` → typed error `NESTING_TOO_DEEP`; writer carries
   its own guard and is total. Classified **RUST_BUG** (TS fails closed via
   V8 RangeError → `PARSE_ERROR`, verified empirically). Regression test:
   `inv7_deeply_nested_input_is_rejected_safely`.
2. **No panics** on any other fuzz/property input: every evaluator returns
   `ok:false` with a typed error on malformed input.

## 5. Not yet done

- No coverage-guided fuzzer (cargo-fuzz / libFuzzer) wired up yet; the
  batteries above are deterministic property tests, not blind fuzzing.
- The float corpus covers finite f64 only (NaN/±Infinity are rejected by
  the strict parser by design).
- Mutation fuzzing of full envelopes (bit-flips, truncation) against the
  NDJSON adapter is future work.
