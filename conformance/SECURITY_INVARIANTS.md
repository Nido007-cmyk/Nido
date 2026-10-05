> **Language:** English · [Español](es/SECURITY_INVARIANTS.md)
# NIDO Protocol — Security Invariants (Conformance Suite v0)

These invariants are the normative security core of the agent protocol.
Each one is stated precisely, then broken down as
**threat → exploit scenario/path → mitigation → test**.
Every invariant has executable coverage in `vectors/v0/final/` and/or
`__tests__/properties.test.ts`. An implementation that violates any of them
is non-conformant, no matter how many vectors it passes.

Status labels used in this repo (never soften them):
`IMPLEMENTED` · `AUTOMATED/UNIT TESTED` · `ANDROID COMPILED` ·
`EMULATOR TESTED` · `PHYSICAL DEVICE TESTED` · `EXTERNALLY AUDITED`

The conformance suite is currently `IMPLEMENTED` + `AUTOMATED/UNIT TESTED`
(TypeScript reference). It is NOT externally audited. The Python
canonicalization re-implementation is a PARTIAL second implementation
(canonicalization + SHA-256 only).

---

## INV-1 · AUTHORITY_MONOTONICITY

**Statement.** Processing a message from a peer can never increase what that
peer is authorized to do. Authority comes only from (a) local user policy
rules, (b) a valid delegation chain rooted in a local trust anchor, or
(c) explicit user consent. Message content is data, never authority.

**Threat → exploit path.** A malicious peer sends `TASK_REQUEST` claiming
`capability: calendar.contacts.read` with `version: v2`, or embeds
`"mode": "AUTO"` / `"admin": true` fields in the payload, hoping the receiver
treats message content as permission.

**Mitigation.**
- Policy decisions are computed from LOCAL rules only; the request only
  supplies (subject, capability, version). Unknown subject/capability/version
  → `DENY` (`decidePolicy`).
- Version matching is exact: `v2` never satisfies a rule pinned to `v1`.
- Unknown fields inside delegation tokens are ignored and grant nothing.
- `__proto__` and other magic keys are parsed as inert data (null-prototype
  objects); they cannot alter parser behavior.

**Tests.** `pol-001` (unknown subject), `pol-003` (version mismatch),
`pol-006/007` (version `v2`/`null`), `neg-002`, `neg-006`, `neg-008`,
`neg-003` (unknown token field ignored), `canon-a05` (`__proto__` is data);
property: "garbage never authorizes" (1000 random requests).

---

## INV-2 · AUTONOMY_NON_EXPANSION

**Statement.** A software, model, capability, or protocol update can never
silently widen previously granted authority. New versions, new capabilities,
and new fields default to DENY until the user (or a live, unexpired rule)
explicitly authorizes them.

**Threat → exploit path.** Peer (or a compromised update channel) requests
`calendar.availability.query` at `version: v2` after the user approved `v1`,
relying on "same capability name" to inherit the old approval. Or a new
optional field appears in a signed structure and an old implementation
misreads it as permission.

**Mitigation.**
- Rules pin exact `(subject, capability, version)` triples; anything else DENY.
- Unknown protocol/capability versions fail closed (`validateVersions`).
- Expiry is inclusive (`now >= expires_at` ⇒ expired) in delegation AND
  consent — no one-millisecond grace window to race.
- Unknown extension names that shadow core capabilities are rejected at
  registration (`EXTENSION_SHADOWING`).

**Tests.** `pol-003`, `ver-002/003/004`, `ext-001`, `del-006` (capability swap),
`con-009` (boundary expiry), `neg-006`.

---

## INV-3 · TRANSPORT_INDEPENDENCE

**Statement.** Security properties (authentication, authorization, privacy
budgeting, idempotency) hold identically regardless of transport
(Bluetooth, LAN, relay, IPC). Switching transports never resets accounting,
never upgrades trust, and never bypasses a check.

**Threat → exploit path.** A peer exhausts its privacy budget over Bluetooth,
then re-opens the "same" conversation over a relay/TCP link hoping for a
fresh budget. Or an attacker replays a captured envelope over a different
transport to double-execute a task.

**Mitigation.**
- Budgets are keyed by **identity**, not by connection or transport; the
  reference accounting has no transport input at all.
- Replay protection is keyed by `message_id` (per sender), independent of
  how the bytes arrived.
- Signature verification is over the canonical form, which contains no
  transport metadata.

**Tests.** `neg-004` (transport switch does not reset budget), `env-016`
(replay), `idem-002` (duplicate task_ids); property: budget monotonicity.

---

## INV-4 · RETRY_SAFETY

**Statement.** Retrying a message (same `message_id`) or re-submitting a task
(same `task_id`) never multiplies side effects. Duplicates are detected and
acknowledged without re-execution: at-most-once side effects, at-least-once
delivery.

**Threat → exploit path.** Network duplication (or a malicious peer
retransmitting) causes a task to run twice: double calendar event, double
message sent, double disclosure charged against the budget.

**Mitigation.**
- Receivers track seen `message_id`s per sender (`DUPLICATE_MESSAGE`).
- Task execution is keyed by `task_id`; the second submission returns the
  recorded outcome instead of re-running.
- Budget consumption happens once per accepted task, not once per delivery.

**Tests.** `env-016`, `idem-001/002/003/004`; property: duplicates never
increase `executed_count` (300 random sequences).

---

## INV-5 · DISCLOSURE_ACCOUNTING

**Statement.** Every disclosure of user data to a peer is counted against an
explicit, per-identity privacy budget within a time window. Many individually
"small" disclosures cannot sum past the budget. Minimum disclosure is the
default projection; anything not allow-listed is dropped, never sent.

**Threat → exploit path.** A peer (or a compromised agent) issues a long
series of individually innocent queries ("are you free at 6?", "…at 6:15?",
…) whose aggregate answers reconstruct the user's calendar. Or a projection
bug leaks a field that was not allow-listed.

**Mitigation.**
- `consumeBudget`: per-identity, per-window accounting; retries, rejoins,
  and transport switches do not top it up.
- `graphDisclosure`: aggregate accounting over disclosure graphs; the sum —
  not each node — is checked against the budget.
- `projectDisclosed`: strict allow-list projection; empty allow-list ⇒ `null`
  (nothing disclosed); non-object values ⇒ `null`.

**Tests.** `bud-001..007`, `dis-001..006`, `gra-001..005`, `neg-004`,
`neg-009` (eleven tiny disclosures still denied); property: budget
monotonicity within a window.

---

## INV-6 · DELEGATION_ATTENUATION

**Statement.** A delegated authority can only stay equal or shrink along the
chain: narrower scope, shorter expiry, never broader. A delegatee cannot
delegate what it was not given, cannot extend expiry past its delegator's,
and cannot widen the peer set. Revocation is terminal and cannot be undone
by replaying an older token.

**Threat → exploit path.** Alice delegates calendar availability to Bob's
NIDO (max 2 uses, peers=[Bob], expires Friday). Bob's NIDO mints a new token
for Carol with max 99 uses, or with expiry next year, or replays the original
token after Alice revoked it.

**Mitigation.**
- Chain verification checks, per hop: signature by the claimed issuer,
  issuer == previous subject (linkage), scope ⊆ parent scope
  (max_uses/peers subset), `expires_at` ≤ parent `expires_at`,
  capability identical, `now < expires_at`.
- Revocation is a terminal state-machine transition; a revoked token never
  becomes valid again.

**Tests.** `del-001..009`, `neg-003`, `neg-007` (use after revoke);
state machines `sm-012/013`.

---

## INV-7 · FAIL_CLOSED

**Statement.** Any input the implementation does not positively understand is
rejected. There is no "best effort" parsing, no lenient fallback, no silent
field dropping, no default-allow. Malformed, ambiguous, expired, or
not-yet-valid input produces a typed error, never a partial acceptance.

**Threat → exploit path.** Attacker sends: JSON with duplicate fields
(smuggling two values for one key), trailing garbage after the JSON document,
lone surrogates / unescaped control characters, integers that lose precision
(`9007199254740993`), a `__proto__` key hoping for prototype pollution, an
envelope with unknown version, or a message outside its validity window —
hoping one of these slips through as "close enough".

**Mitigation.**
- Strict JSON parser: rejects duplicates, trailing data, lone surrogates,
  unescaped controls, unsafe integers (with exact BigInt check so `1e21`
  stays legal), non-finite numbers.
- Null-prototype objects: magic keys are inert data.
- Envelope validation order: parse → schema → timestamps → replay →
  certificate → signature. Any failure ⇒ typed error before any authority
  decision is made.
- Unknown state-machine events/machines ⇒ `INVALID_TRANSITION`/
  `UNKNOWN_MACHINE`, never a no-op acceptance.

**Tests.** `canon-e01..e07`, `canon-a01/a04/a05`, `env-001..027`,
`sm-015/016/017`, `neg-007`; properties: parser never throws (2000 fuzz
inputs), state-machine walks never throw, terminal states stay terminal.

---

## How to read a failure

If a vector fails, the classification is:

1. **Reference bug** — the TypeScript reference mis-implements the intended
   rule. Fix the reference, regenerate vectors, document in SPEC_AMBIGUITIES.
2. **Vector bug** — the source vector's `expected` encodes a wrong expectation.
   Fix the source, regenerate.
3. **Spec ambiguity** — the intended rule is genuinely unclear. Do NOT guess:
   record in `SPEC_AMBIGUITIES.md`, pick the conservative (fail-closed)
   reading, and mark the vector accordingly.
4. **Second-implementation disagreement** — investigate as (3); never
   auto-resolve in favor of either side.

The suite measures **verified attack-surface reduction**, not feature count.
A release that adds vectors and fixes an invariant is progress; a release
that adds capabilities without new invariant coverage is not.
