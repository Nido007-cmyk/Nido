> **Language:** English · [Español](es/AGENT_PROTOCOL.md)
# NIDO Agent Protocol — Specification (draft v0.1)

**Status:** design, DO NOT implement yet. The current envelopes
(`chat`/`agent_task`/`agent_result`) are NOT migrated until this design
survives the red-team review.

**Objective:** a private network of interoperable personal agents. The
protocol must survive changes of models, hardware, operating systems,
transports, cryptography, providers, and programming languages. **THE
MODEL IS NOT NIDO.**

**Future interoperability principle:** written as if Official NIDO
Android/iOS, NIDO Desktop, NIDO Home, and compatible third-party
implementations someday existed, all exchanging tasks under this same
specification, without sharing internal code.

---

## 1. Principles

1. **Model independence.** Agents exchange structured intent,
   capabilities, constraints, and results. **Never internal prompts.**
   Prompts belong to each agent's private implementation. A NIDO with a
   totally different model must be able to talk to a current one.
2. **Transport independence.** A `TASK_REQUEST` is identical whether it
   travels over Bluetooth, LAN, Wi-Fi Direct, Internet P2P, or relay. See
   `TRANSPORT_ARCHITECTURE.md`.
3. **End-to-end security over zero-trust transport.**
   `TRANSPORT ≠ TRUST`.
4. **Crypto agility.** No algorithm is permanent. Negotiated versions,
   no silent downgrade.
5. **Fail-closed.** Unknown version, unknown capability, invalid
   signature, expired, or out of policy → reject, never execute.

### 1.1 Fundamental laws (frozen)

- `USER = AUTHORITY`
- `POLICY ENGINE = ENFORCEMENT`
- `MODEL = REASONING, NOT AUTHORITY`
- `TOOLS = CAPABILITIES`
- `TRANSPORT = DELIVERY, NOT TRUST`
- `REMOTE/EXTERNAL CONTENT = UNTRUSTED DATA`
- `MINIMUM DISCLOSURE BY DEFAULT`
- `A REQUEST CAN DESCRIBE WHAT ANOTHER NIDO WANTS. IT CAN NEVER DEFINE
  WHAT THIS NIDO IS AUTHORIZED TO DO.`
- `AUTONOMY MUST NEVER GROW SILENTLY`: no model, capability, protocol,
  or software update automatically expands granted authority. More
  authority requires a new explicit policy/consent decision.

---

## 2. Multi-device identity

It is not assumed that `1 person = 1 phone = 1 key forever`.

```
User/NIDO Identity  (clave de identidad de largo plazo, p. ej. Ed25519 hoy)
        ↓  firma certificados de dispositivo
Authorized Devices   (cada uno con su propio par de claves)
        ↓  handshake autenticado
Sessions             (claves efímeras por sesión)
```

- **NIDO Identity:** long-term key pair. The public key
  (lowercase hex, 32 bytes) IS the NIDO's address. It is what travels
  in the QR today.
- **Device certificate:** `{v, device_id, device_pubkey,
  identity_pubkey, issued_at, expires_at, device_label?, signature}` where
  `signature` is produced by the identity key. Each device has its
  own keys; compromising one device does **not** compromise the identity.
- **Sessions:** authenticated handshake between *device keys*, with the
  certificate binding device→identity. Authorization (policy) is
  evaluated on the **identity**, not the device.
- **Revocation:** (a) short certificate expiry (implicit revocation); (b)
  revocation list signed by the identity, distributed peer-to-peer **in
  direct contact** (gossip) — no central server and **without depending
  on the relay**: a malicious relay cannot suppress it because it also
  travels via direct contact.
- **Revocation freshness (round 3, C-8):** `sensitivity: high`
  capabilities may require the peer's revocation information to be
  fresher than a policy threshold; short certificate expiry bounds the
  maximum window of a revoked device.
- **Device roles (RT-11):** `primary` — holds the identity private key
  and issues device certificates; `secondary` — only holds its own
  certificate, cannot issue. Stealing a secondary → its certificate is
  revoked and the identity survives. Loss of all primaries →
  rotation with recovery mechanism (open question §14.6).
- **Identity rotation:** signed declaration with the old key:
  `{old_pubkey, new_pubkey, reason, ts, sig_old}`. Verifiable chain with no
  central authority. Contacts verify the chain at next contact; a hop
  without a valid signature is rejected.
- **QR evolution (conceptual, do not implement):** the current QR carries
  the identity public key. QR v2 would carry `{v:2, identity_pubkey,
  device_cert, relay_hints?, expires_at}` — 100% verifiable offline.
  A v1 QR remains accepted as "identity without device cert" during
  transition, with configurable policy.

---

## 3. Crypto agility

- Every signed/encrypted structure declares `crypto_suite`, e.g.
  `nido-crypto/1` = `{sig: ed25519, kx: x25519, aead: chacha20poly1305,
  hash: sha256}`. Versioned registry in this specification;
  `nido-crypto/2` is reserved for post-quantum migration.
- **Negotiation:** peers announce supported suites; the highest common
  one is chosen. Local policy defines a minimum acceptable suite.
- **No silent downgrade:** if there is no acceptable common suite →
  `UNSUPPORTED_CRYPTO` error, fail-closed. An attacker forcing a weak
  suite causes failure, not degradation.
- **Transcript binding (RT-7):** the negotiated parameters (protocol
  version + suite) must be confirmed **inside** the handshake's
  authenticated transcript (TLS Finished style). Pre-authentication
  negotiation is MITM-manipulable; without authenticated confirmation →
  `UNSUPPORTED_CRYPTO` / `UNSUPPORTED_VERSION`.
- Keys carry their suite; algorithm rotation does not invalidate the
  logical identity (the rotation chain can cross suites).

---

## 4. Wire format

- **Canonical encoding:** JSON with **RFC 8785 (JCS)** canonicalization:
  sorted keys, no whitespace, UTF-8. Every signature is computed over the
  canonical JSON of the envelope **without** the `signature` field.
- **Rationale:** debuggable, trivial test vectors, implementable in
  any language. A future binary encoding must preserve equivalent
  canonicalization rules.
- **Encryption:** the full envelope travels **inside** the session's
  encrypted channel (AEAD with the handshake's session key). The
  transport only sees ciphertext (see `TRANSPORT_ARCHITECTURE.md`).
- **Signature (agent layer):** each envelope is signed by the **sending
  device's key** (not just encrypted by the session). This gives
  transport-independent authenticity: it works for deferred delegation,
  auditing, and forwarding via relays that only see ciphertext.

### 4.1 Envelope

```json
{
  "protocol_version": "nido/1.0",
  "message_type": "TASK_REQUEST",
  "message_id": "9f2c…(128 bits hex)",
  "task_id": "7a11…(128 bits hex, clave de idempotencia)",
  "nonce": "3d9e…(128 bits hex, frescura)",
  "created_at": 1790000000000,
  "expires_at": 1790000060000,
  "sender": {
    "identity_pubkey": "ab12…(hex)",
    "device_id": "44aa…(hex)",
    "device_cert": { "v": 1, "device_id": "…", "device_pubkey": "…",
      "identity_pubkey": "…", "issued_at": 1789990000000,
      "expires_at": 1821526000000, "signature": "…" }
  },
  "recipient_identity": "cd34…(hex)",
  "crypto_suite": "nido-crypto/1",
  "payload": { "…específico del tipo…": "…" },
  "delegation_chain": [ "…" ],
  "signature": "…(firma del dispositivo emisor sobre el canónico sin este campo)"
}
```

Rules:

- `message_id`: unique per envelope. **Duplicate detection** (seen-set).
- `task_id`: **idempotency** key for the task lifecycle. A retried
  `TASK_REQUEST` carries the same `task_id`; the receiver does not
  execute twice (see §9).
- `nonce`: 128 random bits; binds the signature against replay across contexts.
- `created_at`/`expires_at`: ms since epoch. `expires_at` **mandatory**
  on `TASK_REQUEST`, delegation tokens, and `CONSENT_REQUEST`. Configurable
  clock tolerance (default: 5 min); expired → `EXPIRED`.
- `recipient_identity`: identity of the destination NIDO (not a device:
  any authorized device may receive).
- `device_cert`: may be omitted if the receiver already has it cached and
  current; if missing with no cache → `UNKNOWN_DEVICE` (can be requested
  via an out-of-protocol presentation message or by re-scanning the QR).
- Unknown envelope-level fields → **ignored** (extensibility);
  unknown fields inside `payload` → **reject** (the schema rules).
- **Forbidden:** any field whose name or semantics is "prompt",
  "instructions", "system_prompt", or an imperative order to the receiving
  agent. Protocol validation rejects it with `FORBIDDEN_FIELD`. The
  peer's free text is **data**, never instruction (see
  `CAPABILITY_MODEL.md`).

---

## 5. Message types

### 5.1 Task lifecycle

```
REQUESTED → ACCEPTED → IN_PROGRESS → RESULT
   ↓           ↓            ↓            ↓
REJECTED    CANCELLED    ERROR      (EXPIRED en cualquier punto)
```

- `TASK_REQUEST` — payload: `{capability, capability_version, parameters
  (capability schema), consent_requirement: none|explicit,
  idempotency_key (= task_id), ttl_ms, delegation?}`.
- `TASK_ACCEPT` — `{task_id, accepted_capability_version, eta_ms?}`.
  Execution commitment; does not imply a result. The requester MUST
  verify that `accepted_capability_version` matches the requested one
  (or the negotiated one); an unsolicited different version is treated
  as `UNSUPPORTED_VERSION`.
- `TASK_REJECT` — `{task_id, reason_code, retryable: bool, detail?}`.
  `detail` is for debugging only: **never** contains sensitive data.
- `TASK_PROGRESS` — `{task_id, progress_pct?, note?}`. Progress without
  turning the protocol into streaming; `note` is **non-sensitive** free
  text (audited; codes/enums preferred over free text).
- `TASK_RESULT` — `{task_id, result (capability output schema,
  filtered by minimum disclosure), disclosure_summary}`.
- `TASK_CANCEL` — `{task_id, reason?}`. From the requester; best-effort: if
  a side effect already executed, `TASK_ERROR`/`TASK_RESULT` is answered
  as appropriate, cancellation is never faked.
- `TASK_ERROR` — `{task_id, error_code, retryable: bool, detail?}`.
  Codes: `UNKNOWN_CAPABILITY`, `UNSUPPORTED_VERSION`,
  `UNSUPPORTED_CRYPTO`, `POLICY_DENIED`, `CONSENT_DENIED`, `EXPIRED`,
  `INVALID_SIGNATURE`, `UNKNOWN_DEVICE`, `FORBIDDEN_FIELD`,
  `DUPLICATE_TASK`, `DELEGATION_INVALID`, `MALFORMED`.

### 5.2 Discovery and consent

- `CAPABILITY_QUERY` — `{query_id, capability_filter?}`. Requests the list
  of supported capabilities. No authentication beyond the channel.
- `CAPABILITY_RESPONSE` — `{query_id, capabilities: [{name, version,
  description, input_schema_ref?, sensitivity}]}`. **Announces without
  filtering**: only public name/version/description — never which apps,
  calendars, models, files, or services are behind it.
- `CONSENT_REQUEST` — `{consent_id, action_description (structured),
  capability, parameters_summary, expires_at}`. "Would you authorize X?"
  without executing it. The receiver presents it to **its** user.
- `CONSENT_RESULT` — `{consent_id, decision: granted|denied|expired,
  grant_scope?}`. A `granted` carries `grant_scope: {capability,
  parameters_hash, peer, max_uses, expires_at}` (RT-4): the subsequent
  `TASK_REQUEST` referencing it must match on capability and parameters
  hash; cross reuse → `POLICY_DENIED`. It is not a blank check.

---

## 6. Version negotiation

- The handshake (or the first envelope) exchanges
  `{min_protocol, max_protocol}`. The highest common one is chosen;
  no intersection → `UNSUPPORTED_VERSION`, fail-closed. Final
  confirmation is bound to the authenticated transcript (see §3,
  transcript binding).
- Capabilities version independently (`…/v1`, `…/v2`); the
  `CAPABILITY_RESPONSE` announces the supported ones; the requester
  chooses.
- **Deprecation:** a version may be marked deprecated with a sunset
  date; implementations MUST warn and MUST NOT auto-degrade security
  to accommodate an old peer.

---

## 7. Delegation

Delegation token (signed by the issuer):

```json
{
  "v": 1, "issuer_identity": "…", "subject_identity": "…",
  "capability": "calendar.availability.query", "capability_version": "v1",
  "scope": { "peers": ["…"], "max_uses": 3 },
  "constraints": { "time_window": ["…", "…"], "purpose": "…" },
  "issued_at": …, "expires_at": …,
  "max_depth": 1,
  "parent_hash": "…|null",
  "signature": "…"
}
```

- `max_depth`: maximum re-delegation depth. **Infinite delegation
  forbidden** (default: 1, i.e., no re-delegation without
  explicit authorization).
- Travels in `delegation_chain` (ordered issuer→subject). The executor
  verifies the **entire** chain: signatures, expirations, scopes,
  constraints, and that the delegated capability ⊆ the requested
  capability.
- **Monotonic expiry (round 3, C-6):** no link may expire
  later than its parent; `max_uses` decrements along the chain.
  Fast re-delegation does not extend effective lifetime beyond the root.
- **Revocation:** via short expiry + revocation list signed by the
  issuer (gossip between contacts). No central CRL.
- Use case: "my NIDO asks other NIDOs for availability on my behalf."
  The peer sees who the original issuer is and under what constraints
  the intermediary acts. A link cannot widen what was delegated.

---

## 8. Protocol validation (ingress pipeline)

Every incoming envelope, before any business logic:

1. Valid parse + canonicalization.
2. Supported `protocol_version`.
3. `crypto_suite` acceptable per policy.
4. Valid signature (device) + `device_cert` current and chained to the
   declared identity.
5. `created_at`/`expires_at` within tolerance (replay/expiry).
6. `message_id` unseen (duplicates).
7. Known `message_type`; `payload` validates against its schema;
   no forbidden fields (`FORBIDDEN_FIELD`).
8. **Rate limiting (RT-12, round 3 C-7):** the receiver rate-limits per
   **sending identity**, aggregated **across all transports** at the
   protocol layer — hopping from Bluetooth to LAN does not reset
   counters. Malformed input is discarded before any expensive work.
   Default-deny for strangers is cheap by design.

Only then does it reach the Policy Engine (see `CAPABILITY_MODEL.md`).
**Never:** remote content → model → tool.

---

## 9. Offline queueing, idempotency, and deliveries

- **Persistent outbox** (encrypted at rest): undelivered tasks
  survive restarts.
- **Idempotency:** the receiver keeps `executed_tasks: task_id →
  result`. A `TASK_REQUEST` with an already-executed `task_id` returns
  the cached result (or `DUPLICATE_TASK` if still in progress), **never
  re-executes** a side effect.
- **Transport duplicates:** `message_id` in seen-set with TTL; a repeated
  frame is silently discarded.
- **Retries:** backoff with jitter; `expires_at` rules: expired →
  discarded and `EXPIRED` notified if there is a channel.
- **Late delivery:** a `TASK_RESULT` arriving after local expiry
  is accepted only if the task is still open; otherwise discarded with
  an audit event (`late_result_dropped`).
- **Cancellation:** propagates best-effort; does not guarantee undoing
  side effects that already occurred (each capability declares its
  semantics).
- **Partial failure:** `TASK_PROGRESS` may report `completed_items` /
  `failed_items` with per-capability schemas; already-confirmed work is
  never blindly retried.
- **Single executor (RT-6):** for capabilities with `side_effects !=
  none`, the requester uses the first `TASK_ACCEPT` received and sends
  `TASK_CANCEL` to the other accepters (two devices of the same NIDO
  could accept the same task). Until inter-device coordination exists,
  one primary device per side-effecting capability is recommended.

---

## 10. Long-running tasks

A task may last seconds, hours, or days. `TASK_PROGRESS` allows
reporting without mandatory streaming. The requester may set
`ttl_ms` and `progress_interval_hint`; the executor may answer
`TASK_ERROR`/`TASK_REJECT` if it cannot commit. Expiry does not
erase the obligation not to duplicate side effects (see §9).

---

## 11. Auditing

Local events (encrypted at rest, visible/exportable/deletable by the
user; see `MODEL_ROUTER.md` for the activity screen):

```
{ts, event: task.received, peer_identity, capability, capability_version,
 policy_decision, disclosure_summary, transport, model_used, device_id}
```

**No sensitive content:** records *which* capability and *which
categories* of data left (`disclosure: availability interval`), never
event titles, message texts, or full parameters.

---

## 12. Conformance suite (future)

A compatible implementation must demonstrate:

- correct parsing and canonicalization (JCS) — test vectors included below;
- valid/invalid signatures (vectors with fixed keys);
- version handling (accepts `nido/1.0`, rejects `nido/9.9`);
- idempotency (repeated `task_id` does not re-execute);
- rejection of malformed input, unknown capability, `FORBIDDEN_FIELD`;
- downgrade rejection (weak suite offered → `UNSUPPORTED_CRYPTO`);
- capability schemas (valid/invalid input).

### Test vector 1 — canonicalization

Input (unordered keys, whitespace):
`{ "b": 2, "a": 1 }` → canonical: `{"a":1,"b":2}`.

### Test vector 2 — minimal signed envelope

(Example keys — DO NOT use in production.)
`device_seed`: `0001…00` (32 bytes) → pubkey `…` *(to be generated when
publishing the suite)*. The canonical envelope without `signature`,
signed with Ed25519, must produce the vector's signature. *(Full vectors
once `nido/1.0` stabilizes.)*

---

## 13. Migration from current envelopes (note, not implemented)

Current `agent_task`/`agent_result` are the embryo. Future migration:
`agent_task` → `TASK_REQUEST{capability: agent.task/v1, …}`;
`agent_result` → `TASK_RESULT`. **Do not do this until this design
survives the review.**

---

## 14. Open questions

1. Is revocation gossip between contacts enough, or is an emergency
   channel needed (e.g. revocation QR)?
2. `device_cert` inline always, or cache with `UNKNOWN_DEVICE` + re-request?
   (Tradeoff between size and offline robustness.)
3. Clock tolerance on devices offline for days: is 5 min
   viable or is a larger window needed with stricter nonces?
4. Should the future relay support "mailbox" (store-and-forward) or only
   hot forwarding? (Affects §9.)
5. Future binary format (CBOR with canonicalization?) — don't decide yet.
6. Recovery mechanism on loss of all `primary` devices: printed recovery
   code, trusted contacts, other? (RT-11.)
7. Blind routing tokens so the relay can't profile contact frequency by
   stable destination hash (RT-8).
