> **Language:** English · [Español](../es/internal/TEN_YEAR_REVIEW.md)

# NIDO — 10-year design review

**Purpose:** assess whether the design can survive changes of device,
operating system, model, and cryptography over 10+ years. It is not
optimized for today's phones.

**Status:** design. Not implemented.

---

## 1. Fundamental laws (candidates for FROZEN CORE)

- `USER = AUTHORITY`
- `POLICY ENGINE = ENFORCEMENT`
- `MODEL = REASONING, NOT AUTHORITY`
- `TOOLS = CAPABILITIES`
- `TRANSPORT = DELIVERY, NOT TRUST`
- `REMOTE/EXTERNAL CONTENT = UNTRUSTED DATA`
- `MINIMUM DISCLOSURE BY DEFAULT`
- `A REQUEST CAN DESCRIBE WHAT ANOTHER NIDO WANTS. IT CAN NEVER DEFINE
  WHAT THIS NIDO IS AUTHORIZED TO DO.`
- `AUTONOMY MUST NEVER GROW SILENTLY`

Plus two invariants: **fail-closed** on the unknown/expired/out-of-policy,
and **no silent security downgrade**.

---

## 2. Evaluation by dimension (10+ year horizon)

| Dimension | Verdict | Reasoning |
|---|---|---|
| Interoperability between independent implementations | **Adequate with reservations** | RFC 8785 canonicalization + official vectors + closed schemas make it possible (S14). Risk: spec ambiguities only discovered with 2+ real implementations. There is no substitute for a second implementation. |
| Crypto agility | **Strong** | Versioned suites, negotiation with transcript binding, logical identity separable from algorithm, rotation chain that can cross suites. Risk: real PQ migration will demand different signature/key sizes — the envelope tolerates it (opaque fields), but small-MTU transports will suffer. |
| Multi-device identity | **Adequate with reservations** | Identity → certificates → sessions is the right model; primary/secondary roles and revocation without a central server scale. Reservation: policy sync between devices (C-11) and recovery after losing all primaries remain open. |
| Revocation | **Adequate with reservations** | Short expiry + gossip on direct contact + enforceable freshness for `high`. No central server = no single point of failure or censorship. Reservation: propagation latency in relay-only networks is the attack window (C-8); bounded, not eliminated. |
| Offline-first | **Strong** | The entire core (identity, policy, memory, protocol, queue) works with no network by design; the relay is optional and replaceable. The two-phones-in-airplane-mode test remains the baseline. |
| Transport independence | **Strong** | The envelope is identical on any medium; the Transport interface is minimal (opaque bytes). Adding a transport in 2032 does not touch the protocol. |
| Provider independence | **Strong** | Providers (model, relay, services) are interchangeable behind interfaces; none is identity or authority. |
| Model independence | **Strong** | It is the central architectural principle (EL MODELO NO ES NIDO). The protocol contains no prompts; a NIDO with a different AI paradigm can interoperate if it respects schemas and policy. |
| Capability versioning | **Strong** | Exact name + version, protocol-independent versioning, anti-shadowing, no silent fallback. Version pinning in autonomy rules (C-5) closes silent expansion. |
| Protocol evolution | **Adequate with reservations** | Fail-closed version negotiation + deprecation with sunset. Reservation: real evolution needs governance (who decides `nido/2.0`), undefined today beyond "no central authority". |
| Migration across decades | **Open** | Identity rotation with a verifiable chain and expiry as implicit revocation provide the mechanism. Missing: proven history. The first real migration (e.g. to PQ) will be the test; until then it is well-formed theory. |

---

## 3. Classification

### FROZEN CORE (principles, not formats — the minimum that must survive)

1. The 9 fundamental laws (§1).
2. Fail-closed on the unknown, expired, or out-of-policy.
3. No silent security downgrade.
4. At-most-once for operations with side effects (idempotency as a
   principle, not the concrete `task_id` field).
5. Consent must be explicit, scoped, and revocable.
6. Revocation must be possible without a central authority.
7. Logical identity survives devices.

No wire formats, algorithms, field names, or concrete timeouts are
frozen: all of that is versioned precisely so it can evolve.

### PROVISIONAL (probably stable; may evolve with experience)

- Current envelope: fields, JCS canonicalization, sign-over-canonical.
- `nido-crypto/1` suites, negotiation, and transcript binding.
- Error taxonomy and message types (task, negotiation, group,
  consent).
- Device certificate format and QR v2.
- Initial catalog capability schemas and their disclosures.
- Autonomy rules (`autonomy.rule/v1`), budgets, and their parameters.
- Epoch-based rendezvous IDs and session aliases (metadata phase 1).

### EXPERIMENTAL (do not freeze; research)

- Blind routing tokens, on-demand sealed-sender, private contact
  discovery.
- DP for multi-subject aggregates.
- Group cryptography (MLS vs sender keys vs permanent pairwise).
- Full IFC between task-graph nodes.
- Multi-device policy sync.
- "Nutrition labels" for remote providers.

### OPEN QUESTION

Recovery after losing all primaries; clock tolerance on long-offline
devices; relay mailbox vs hot forwarding; P2P addressing without a
central server; constraint DSL; ASK dialog fatigue; temporal revalidation
in long graphs; discovery identifier rotation interval; cover traffic;
`nido/2.0` governance.

---

## 4. Decisions that would be costly to change in the future

1. **Identity = long-term public key.** Rotation with a verifiable chain
   provides an exit, but with millions of identities ecosystem inertia
   (contacts, printed QRs) would make an identity-format migration costly.
2. **Canonical JSON as wire format.** Switching to binary later would split
   the network in two; the decision is sticky even though it is correct
   today (debuggable, trivial vectors).
3. **No central infrastructure.** Adding a later "optional" server for
   revocation or discovery would erode offline-first; it is a nearly
   irreversible decision in practice.
4. **Zero default trust between NIDOs.** Moving to a model with "implicitly
   trusted contacts" would break the threat model; keeping default-deny is
   cheap today and extremely expensive to reintroduce tomorrow.
5. **The relay is not an authority and never sees plaintext.** Any future
   concession (e.g. "the relay moderates spam") would reopen RT-9/A-3.

## 5. Still not secure enough to implement

- **Multi-device policy sync** (C-11): until policies converge, there is a
  soft door. Temporary restriction: `high` on primary only.
- **Full IFC in task graphs** (C-3): aggregate accounting is a floor, not a
  verifiable ceiling.
- **Revocation window in relay-only networks** (C-8): bounded by expiry,
  not eliminated.
- **Identity recovery** (loss of all primaries): with no designed
  mechanism, there is no honest implementation.
- **Group crypto**: correctly deferred; the current pairwise mode does not
  scale to large groups without reevaluation.
- **Clock and expiry** on devices offline for weeks: with no real data,
  thresholds are guesses.

## 6. Recommended next step

**Do not implement the protocol yet.** The proposed order:

1. **Close C-1 with real Android verification** (still pending):
   without verified encrypted storage + Keystore, everything else is
   built on sand.
2. **Executable conformance suite before networking:** implement only the
   machine-verifiable, network-free subset — canonicalization,
   envelope parse/validation, in-memory policy pipeline — against the
   official vectors, behind a feature flag, with no transport.
3. **Second implementation of the subset** (e.g. a validator in another
   language) to catch spec ambiguities: it is the only real test of
   interoperability.
4. Only then: real Bluetooth transport with the new protocol, starting
   with single read-only capability `CAPABILITY_QUERY`/`TASK_REQUEST`
   (`availability.query/v1`).

A 10-year foundation is not bought with more features, but with less
frozen surface and more vectors verifying it.
