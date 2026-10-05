> **Language:** English · [Español](es/SPEC_AMBIGUITIES.md)
# NIDO Protocol — Spec Ambiguities (Conformance Suite v0)

Questions the documents left open, found while building the executable
reference. Each entry: the question, the evidence, the resolution adopted
for v0, and what would reopen it. Rule: when in doubt, the conservative
(fail-closed) reading wins, and the choice is recorded here — never silently
baked into code.

---

## AMB-01 · Canonicalization: which RFC 8785?

**Question.** Does "canonical JSON" mean byte-identical RFC 8785 (JCS)?

**Evidence.** The design docs said "canonical JSON" without pinning the
profile. A first implementation escaped ALL control characters as `\uXXXX`,
but RFC 8785 §3.2.2.2 keeps JSON's short escapes for `"` and `\` only — and
control characters have no short form in JSON other than `\b \t \n \f \r`,
which JCS does NOT use (it uses `\uXXXX` for all C0 controls).

**Resolution (v0).** Full RFC 8785 compliance is now REQUIRED and TESTED:
UTF-16 code-unit key ordering (verified against astral-plane keys),
`\uXXXX` for all C0 controls, ECMAScript `Number.prototype.toString` for
numbers (differentially tested against a second implementation over 516
floats + 26 vectors, 0 mismatches).

**Reopen if.** A profile with different number formatting is ever needed
(e.g. decimal128) — that would be a new canonicalization version, not a
silent change.

## AMB-02 · Parser: is `__proto__` special?

**Question.** Should a JSON key named `__proto__` be rejected, or treated as data?

**Evidence.** A naive `{}`-based parser silently DROPPED the field
(prototype setter side effect) — found by adversarial testing, not by review.

**Resolution (v0).** Parsed objects use null prototypes; `__proto__` is inert
data like any other key (`canon-a05`). Duplicate detection uses
`hasOwnProperty`, so `{"__proto__":1,"__proto__":2}` is still
`DUPLICATE_FIELD`.

**Reopen if.** Never for the reference parser. Any future parser must pass
`canon-a05`.

## AMB-03 · Key aliases in vectors vs normativity

**Question.** Vectors use `alias:idA` for keys. Is alias resolution part of
the protocol?

**Resolution (v0).** No. Aliases exist ONLY in `source/` vectors and are
resolved by the generator into literal public keys in `final/`. The protocol
never sees an alias. Documented so a second implementation doesn't
"implement" alias resolution as a feature.

## AMB-04 · Extension registration API shape

**Question.** How does a test express "register the same extension twice"?

**Resolution (v0).** Extension vectors take `attempts: string[]` and return
per-attempt results (`results: ("ok" | error)[]`). This models the registry
as stateful across attempts within one evaluation — matching how a real
registry behaves.

## AMB-05 · Empty allow-list projection

**Question.** `projectDisclosed(value, [])` → `{}` or `null`?

**Evidence.** `{}` ("disclosed nothing, successfully") vs `null` ("nothing to
disclose"). `{}` is dangerous: downstream code may treat any object as
"there is disclosed content".

**Resolution (v0).** `null`. An empty allow-list means nothing may leave the
device, and `null` is unambiguous (`dis-004`).

## AMB-06 · Expiry boundary: inclusive or exclusive?

**Question.** At exactly `now == expires_at`, is a grant/token expired?

**Evidence.** Delegation used `now >= expires_at` (expired); consent used
`now > expires_at` (still valid). A one-millisecond semantic split across two
subsystems — exactly the kind of seam an attacker races.

**Resolution (v0).** UNIFIED: `now >= expires_at` ⇒ expired, everywhere
(`con-009`, `del-008`). Rationale: expiry is a safety deadline; the
conservative reading fails closed, and uniformity removes the seam.

**Pinning (2026-09-27, TS_BUG #5).** This resolution covers policy rules
explicitly: a policy rule carrying `expires_at` is *live* iff
`now < expires_at`, and *dead* iff `now >= expires_at`. A rule with no
`expires_at` is live (no deadline). This pinning is derived from the
"everywhere" in the resolution above — not from any implementation's
current comparison operator.

**Reopen if.** A use case proves the inclusive boundary causes real-world
failures AND a cross-subsystem review accepts the risk. Not before.

## AMB-07 · `projectDisclosed` path language

**Question.** The path syntax (`a.b.c`, `arr[].field`) looks like the start of
a query DSL. Should it grow?

**Resolution (v0).** NO. The path language is frozen at exactly these two
forms, documented as provisional. Any richer projection language would be a
new capability version with its own threat model (injection, traversal).

## AMB-08 · Unknown envelope fields: ignore or reject?

**Question.** `env-002` allows unknown fields at envelope level but the
payload schema rejects them. Inconsistent?

**Resolution (v0).** Intended and documented: the envelope is the
forward-compatible transport frame (ignore unknown fields, following the
"must-ignore" rule for extensibility); the payload is the
security-critical section (reject unknown fields — fail closed where
authority is decided). Rationale recorded in `envelope.ts`.

**Reopen if.** A future envelope version needs integrity over extension
fields — then the signature scope changes explicitly.

## AMB-09 · What exactly is signed?

**Question.** Is the signature over the raw bytes or over re-canonicalized bytes?

**Resolution (v0).** Signatures are over the canonical form RECONSTRUCTED by
the verifier (parse → validate → canonicalize → verify). Consequences,
all tested: raw key order is irrelevant (`neg-001`); duplicate fields are
rejected BEFORE canonicalization (`env-023`); the canonical bytes the signer
produced must equal the verifier's reconstruction, or verification fails.
This is what makes the signature transport-independent (INV-3).

## AMB-10 · Unsafe integers: how strict?

**Question.** `9007199254740993` silently becomes `9007199254740992` as a
double. Reject? And what about `1e21`, which IS exactly representable?

**Evidence.** A blanket `>= 2^53 ⇒ reject` rule (first implementation)
wrongly rejected `1e21`. Differential testing against the Python
implementation confirmed the subtle cases.

**Resolution (v0).** Reject an integer-valued literal `>= 2^53` IFF its exact
decimal value differs from the parsed double's exact value (BigInt/Fraction
comparison). `9007199254740993` ⇒ `UNSAFE_INTEGER`; `1e21` ⇒ legal,
canonicalizes to `1e+21`. Huge shortest-repr literals like
`1.7976931348623157e308` are rejected by BOTH implementations (their exact
decimal value is not the double) — conservative and consistent.

**Reopen if.** A decimal-exact number type is adopted (major version change).

---

## Decisions log (v0, all with test coverage)

| # | Decision | Vectors |
|---|---|---|
| AMB-01 | RFC 8785 byte-exact canonicalization | canon-001..a05, differential 26/26 + 516 floats |
| AMB-02 | `__proto__` is inert data | canon-a05 |
| AMB-05 | Empty allow-list → `null` | dis-004 |
| AMB-06 | `now >= expires_at` ⇒ expired, everywhere | con-009, del-008, env-007/026, pol-013 |
| AMB-08 | Envelope: ignore unknown; payload: reject | env-002 |
| AMB-09 | Signature over reconstructed canonical | neg-001, env-023/024 |
| AMB-10 | Exact-representability rule for big integers | canon-b04, canon-e05 |
