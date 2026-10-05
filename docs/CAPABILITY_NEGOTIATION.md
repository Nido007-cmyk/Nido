> **Language:** English · [Español](es/CAPABILITY_NEGOTIATION.md)
# NIDO Capability Negotiation — Specification (draft v0.1)

**Status:** design, DO NOT implement yet.

**Scope:** how two NIDOs discover what they can do together, negotiate
a task in structured form, and complete it with minimal human
intervention — without autonomy becoming unlimited authority.

**Rule above all:**

> *A request can describe what another NIDO wants. It can never define
> what this NIDO is authorized to do.*

Negotiation produces **agreement on terms**, never authorization.
After an `ACCEPT`, each Policy Engine locally decides which final action
is allowed, going through the full pipeline
(`CAPABILITY_MODEL.md` §4).

---

## 1. Selective capability discovery

### 1.1 Conceptual question model

A NIDO doesn't need another's full catalog. It may ask about a
specific capability:

`CAPABILITY_QUERY{query_id, capability_filter: {name, version}}` →
**three-valued** answer:

- `SUPPORTED` — I support it with my default policy.
- `UNSUPPORTED` — I don't support it (or don't want you to know; see §1.3).
- `SUPPORTED_WITH_CONSTRAINTS` — I support it under public constraints,
  with `constraints_summary` (see §1.2).

This refines `CAPABILITY_QUERY`/`CAPABILITY_RESPONSE` from
`AGENT_PROTOCOL.md` §5.2: the answer to a directed query is the
state + constraints summary, not a list.

### 1.2 `constraints_summary`: public, no private data

```json
{
  "status": "SUPPORTED_WITH_CONSTRAINTS",
  "capability": "calendar.availability.query",
  "version": "v1",
  "constraints_summary": {
    "requires": "user_consent_per_request",
    "limits": { "max_interval_hours": 24, "max_queries_per_hour": 20 },
    "sensitivity": "medium"
  }
}
```

The summary describes **public policy** (what to ask, with what limits),
never provider, application, calendar, model, files, internal services,
or user data. It's an interface promise, not an inventory.

### 1.3 Defenses against fingerprinting via discovery

Discovery is a reconnaissance channel. Rules:

1. **Minimal, uniform responses.** All three states return the same
   field set; only the enum and `constraints_summary` change.
   No timings, sizes, or details distinguishing "unsupported" from
   "supported but hidden".
2. **Rate limiting.** The receiver rate-limits discovery queries per
   sending identity (suggested default: 20/hour per peer, configurable).
   Exceeded → `DISCOVERY_RATE_LIMITED`, fail-closed.
3. **No free enumeration.** No wildcards or full listings from strangers
   unless local policy allows it. Queries are for concrete name+version.
4. **Discovery policy for strangers.** Each NIDO configures, globally
   and per peer: `answer` | `answer_minimal` (answer `UNSUPPORTED` to
   everything, revealing nothing) | `ignore`. Default for strangers:
   `answer_minimal`.
5. **Explicit leak prohibition.** A discovery response NEVER contains:
   provider or model used, internal app or service, existing
   calendars/files, paths, internal identifiers, unasked capabilities.
   Violation = security bug, not UX bug.
6. **Discovery ≠ authorization.** B answering `SUPPORTED` grants A
   no permission; it only signals the conversation may continue.
   Authorization happens per task in the Policy Engine.

### 1.4 Normative example

A wants to coordinate a meeting with B. A doesn't need to know B's tools;
it asks conceptually:

```
A → B: CAPABILITY_QUERY{calendar.availability.query, v1}
B → A: SUPPORTED_WITH_CONSTRAINTS{requires: user_consent_per_request,
       limits: {max_interval_hours: 24}}
```

A now knows it can propose an availability negotiation within those
limits, without having learned anything about B's calendar, app, or
model.

---

## 2. Structured task negotiation

### 2.1 Message types (versioned-envelope payloads)

New core `message_type`s (see §5 for schemas):

- `NEGOTIATION_PROPOSE` — `{negotiation_id, capability,
  capability_version, terms, expires_at, max_rounds?}`. `terms` validates
  against the capability's declared `negotiation_terms_schema`.
- `NEGOTIATION_COUNTER` — `{negotiation_id, round, terms, expires_at}`.
  Structured counterproposal (no natural language).
- `NEGOTIATION_ACCEPT` — `{negotiation_id, accepted_terms}`. Agreement
  on terms. **Does not authorize execution.**
- `NEGOTIATION_DECLINE` — `{negotiation_id, reason_code}`. Terminal.
- `NEGOTIATION_EXPIRE` — `{negotiation_id, reason: timeout|withdrawn}`.
  Issued by either side on timeout or negotiation withdrawal.

`negotiation_id`: 128-bit hex, idempotency key of the negotiation cycle
(analogous to `task_id`). A duplicate `PROPOSE` with the same
`negotiation_id` is deduplicated, never opens two negotiations.

### 2.2 State machine

```
PROPOSED ──COUNTER──▶ COUNTERED ──COUNTER──▶ COUNTERED (rondas ≤ max_rounds)
   │                     │  │                      │
   │                     │  └────ACCEPT────▶ ACCEPTED (terminal: acuerdo)
   │                     │                         │
   │                     └────DECLINE───▶ DECLINED (terminal)
   ├────ACCEPT────▶ ACCEPTED
   ├────DECLINE───▶ DECLINED
   └────timeout───▶ EXPIRED (terminal; cualquiera puede emitir NEGOTIATION_EXPIRE)
```

- `ACCEPT` is only valid from `PROPOSED` or `COUNTERED`.
- `COUNTER` only from `PROPOSED`/`COUNTERED` with incremental `round`;
  exceeding `max_rounds` → `NEGOTIATION_INVALID_TRANSITION`.
- Invalid transition, unknown or expired `negotiation_id` →
  `TASK_ERROR` with the corresponding code, fail-closed.
- `ACCEPTED` is terminal **for the negotiation**, not for the task: the
  next step is a `TASK_REQUEST` with the accepted terms, which goes
  through each side's full Policy Engine pipeline. Either side may still
  answer `POLICY_DENIED` or request `ASK_USER`.
- **Rounds against the privacy budget (round 3, C-2):** each `COUNTER`
  reveals information about the counterproposer's constraints; rounds
  consume the peer's disclosure budget and counters must be coarse per
  policy (broad slots, not exact minutes). A negotiation is not a free
  oracle: low `max_rounds` by default.

### 2.3 Timeouts and expiry

- Every `PROPOSE`/`COUNTER` carries `expires_at` (mandatory). Expired
  without answer → local `EXPIRED` state; `NEGOTIATION_EXPIRE` may be
  emitted as a courtesy, but expiry is local and doesn't depend on
  receiving it.
- Clock tolerance: same as the protocol (default 5 min,
  `AGENT_PROTOCOL.md` §4.1).
- An expired negotiation can never be reopened: a new one starts with
  a new `negotiation_id`.

### 2.4 Normative example (no natural language)

A proposes a meeting Tuesday 17:00–20:00; B counterproposes 18:30–19:30;
A accepts. Then each Policy Engine decides:

```
A → B: NEGOTIATION_PROPOSE{
         negotiation_id: "…", capability: "calendar.event.propose", version: "v1",
         terms: { window_start: 1790…, window_end: 1790…, duration_min: 60 },
         expires_at: … }
B → A: NEGOTIATION_COUNTER{
         negotiation_id: "…", round: 1,
         terms: { window_start: 1790…+90min, window_end: 1790…+150min, duration_min: 60 },
         expires_at: … }
A → B: NEGOTIATION_ACCEPT{ negotiation_id: "…", accepted_terms: { …mismos… } }
```

Agreement reached. Now:

```
A → B: TASK_REQUEST{ capability: "calendar.event.propose/v1",
                     parameters: { title: "…", start: …, end: … } }
B: policy local → ASK_USER (su usuario confirma) → TASK_ACCEPT → ejecuta → TASK_RESULT
```

If B's policy said `DENY` for that peer, the negotiation's `ACCEPT`
would be worthless: **agreement is not authorization**.

### 2.5 `negotiation_terms_schema`

Each negotiable capability declares a `negotiation_terms_schema` (JSON
Schema, `additionalProperties: false`). Without a declared terms schema,
the capability is not negotiable and a `NEGOTIATION_PROPOSE` is rejected
with `NEGOTIATION_NOT_SUPPORTED`. Terms are structured data; any free
text inside `terms` is treated as non-sensitive data (RT-2 rule) and
never as instruction.

---

## 3. Extension system

### 3.1 Small core, independent capabilities

- **Core (stable):** envelope, protocol validation, base types
  (`TASK_*`, `CAPABILITY_*`, `CONSENT_*`, `NEGOTIATION_*`), delegation,
  versioning, idempotency, auditing.
- **Extension:** every new capability, every new `message_type` outside
  the core, every new `negotiation_terms_schema`. Each extension carries
  `{extension_name, extension_version, schemas}` and versions
  independently of the core.

### 3.2 Hard rule: no extension skips the Policy Engine

1. Every extension payload enters through the **same pipeline**:
   protocol validation → capability validation → policy evaluation →
   consent → execution → filtered result.
2. An unknown extension `message_type` → fail-closed rejection
   (`UNKNOWN_MESSAGE_TYPE`), never "fast lane".
3. An extension **cannot** declare tool privileges: it only declares
   capabilities, and each capability executes under local policy with
   the tool sandbox (`CAPABILITY_MODEL.md` §4, RT-14).
4. **Anti-shadowing (round 3, C-10):** a capability's identity is
   exact `name + version`. An extension **cannot** register a core name
   (or lookalike prefixes) with different disclosure semantics;
   collisions are rejected at capability validation. Requesting
   `availability.query/v1` always invokes the core's definition, never
   an opportunistic "v1-ext".
4. An extension cannot modify the pipeline, another peer's policy,
   or envelope fields signed by third parties.
5. An extension's `constraints_summary` and metadata are descriptive;
   local policy decides whether to believe them (see §4).

### 3.3 Compatibility

- Extensions versioned with deprecation and sunset like capabilities
  (`AGENT_PROTOCOL.md` §6).
- An old NIDO receiving an extension it doesn't understand fails
  explicitly (`UNKNOWN_CAPABILITY` / `UNSUPPORTED_VERSION`), with no
  silent downgrade.

---

## 4. Preparation for a future agent economy (very long term)

**No payment is designed or implemented.** No blockchain, no tokens,
no payment logic. The door is only kept architecturally ajar:
`TASK` and `CAPABILITY` may carry **descriptive** metadata:

```json
"economy_hint": {
  "cost": { "amount": "0", "currency": "USD", "basis": "per_request" },
  "resource_requirements": ["network-egress"],
  "estimated_duration_ms": 30000,
  "conditions": ["requires_contact_consent"]
}
```

Rules:

1. **Descriptive, not authoritative.** These fields are *self-reported
   claims* from the other side: they inform the UX ("this capability
   declares a cost") and local policy, but **never define
   authorization or obligation**. A malicious peer may lie
   (`cost: 0`); local policy decides whether to believe it and how
   much.
2. **Local policy rules.** A declared cost doesn't authorize charges;
   an estimated duration doesn't grant time; declared conditions don't
   substitute local evaluation.
3. **Validation as data.** Fields validate against schema (form),
   never against reality (substance). They go into audit as "declared
   by the peer", not as facts.
4. **Open door, nothing more.** If an agent economy ever exists
   (another user, a business, a vehicle, a house, a service), these
   fields are the hook to hang it on without redesigning the protocol.
   Until then they're informational.

---

## 5. Machine-verifiable part

### 5.1 JSON Schemas (draft 2020-12, `additionalProperties: false`)

```json
{
  "$defs": {
    "hex128": { "type": "string", "pattern": "^[0-9a-f]{32}$" },
    "millis": { "type": "integer", "minimum": 0 },

    "NegotiationPropose": {
      "type": "object",
      "properties": {
        "negotiation_id": { "$ref": "#/$defs/hex128" },
        "capability": { "type": "string", "minLength": 1 },
        "capability_version": { "type": "string", "pattern": "^v[0-9]+$" },
        "terms": { "type": "object" },
        "expires_at": { "$ref": "#/$defs/millis" },
        "max_rounds": { "type": "integer", "minimum": 1, "maximum": 10, "default": 5 }
      },
      "required": ["negotiation_id", "capability", "capability_version", "terms", "expires_at"]
    },

    "NegotiationCounter": {
      "type": "object",
      "properties": {
        "negotiation_id": { "$ref": "#/$defs/hex128" },
        "round": { "type": "integer", "minimum": 1 },
        "terms": { "type": "object" },
        "expires_at": { "$ref": "#/$defs/millis" }
      },
      "required": ["negotiation_id", "round", "terms", "expires_at"]
    },

    "NegotiationAccept": {
      "type": "object",
      "properties": {
        "negotiation_id": { "$ref": "#/$defs/hex128" },
        "accepted_terms": { "type": "object" }
      },
      "required": ["negotiation_id", "accepted_terms"]
    },

    "NegotiationDecline": {
      "type": "object",
      "properties": {
        "negotiation_id": { "$ref": "#/$defs/hex128" },
        "reason_code": { "enum": ["terms_unacceptable", "policy_would_deny",
                                 "no_longer_needed", "other"] }
      },
      "required": ["negotiation_id", "reason_code"]
    },

    "NegotiationExpire": {
      "type": "object",
      "properties": {
        "negotiation_id": { "$ref": "#/$defs/hex128" },
        "reason": { "enum": ["timeout", "withdrawn"] }
      },
      "required": ["negotiation_id", "reason"]
    },

    "DiscoveryCheck": {
      "type": "object",
      "properties": {
        "query_id": { "$ref": "#/$defs/hex128" },
        "capability": { "type": "string", "minLength": 1 },
        "capability_version": { "type": "string", "pattern": "^v[0-9]+$" }
      },
      "required": ["query_id", "capability", "capability_version"]
    },

    "DiscoveryCheckResponse": {
      "type": "object",
      "properties": {
        "query_id": { "$ref": "#/$defs/hex128" },
        "capability": { "type": "string" },
        "capability_version": { "type": "string" },
        "status": { "enum": ["SUPPORTED", "UNSUPPORTED", "SUPPORTED_WITH_CONSTRAINTS"] },
        "constraints_summary": {
          "type": "object",
          "properties": {
            "requires": { "type": "string" },
            "limits": { "type": "object" },
            "sensitivity": { "enum": ["low", "medium", "high"] }
          },
          "additionalProperties": false
        }
      },
      "required": ["query_id", "capability", "capability_version", "status"]
    }
  }
}
```

Notes: `terms` additionally validates against the capability's
`negotiation_terms_schema`; `constraints_summary` never carries private
data (§1.2). All these payloads travel inside the signed, canonicalized
(RFC 8785) envelope of `AGENT_PROTOCOL.md` §4.

### 5.2 Error codes (extend `AGENT_PROTOCOL.md` §5.1)

| Code | When |
|---|---|
| `NEGOTIATION_UNKNOWN` | unknown `negotiation_id` |
| `NEGOTIATION_EXPIRED` | negotiation expired or `expires_at` elapsed |
| `NEGOTIATION_INVALID_TRANSITION` | `ACCEPT`/`COUNTER` in a disallowed state, non-incremental `round`, `max_rounds` exceeded |
| `NEGOTIATION_NOT_SUPPORTED` | capability declares no `negotiation_terms_schema` |
| `NEGOTIATION_TERMS_MISMATCH` | `accepted_terms` doesn't match the latest terms |
| `DISCOVERY_RATE_LIMITED` | discovery query limit exceeded |
| `DISCOVERY_FORBIDDEN` | local policy doesn't answer discovery to this peer |
| `UNKNOWN_MESSAGE_TYPE` | unregistered extension `message_type` |

### 5.3 Conformance vectors (future)

- Canonicalization + signature of a `NEGOTIATION_PROPOSE` (same rules as
  `AGENT_PROTOCOL.md` §12; full vectors once `nido/1.0` stabilizes).
- Valid/invalid transitions of the state machine (§2.2).
- `NEGOTIATION_TERMS_MISMATCH` on altered `accepted_terms`.
- Discovery: `SUPPORTED_WITH_CONSTRAINTS` without leaking; rate limit
  on burst; `answer_minimal` for strangers.
- Unknown extension → `UNKNOWN_MESSAGE_TYPE`, fail-closed.

---

## 6. Open questions

1. Is default `max_rounds` 5 reasonable, or should it be per capability?
2. Should counterproposals (`COUNTER`) reveal less than the initial
   proposal to limit round-based reconstruction? (Relation to
   privacy budgets: see `AUTONOMY_MODEL.md`.)
3. Should `constraints_summary` be separately signed to allow
   peer-to-peer caching without re-asking?
4. Multi-round negotiation over a days-latency relay: adaptive timeouts
   or does the requester always set generous `expires_at`?
5. Does an extension registry need globally-unique names with no central
   authority? (e.g. `reversed-domain/` like Java/Kotlin.)
6. Group negotiation (A↔B↔C↔D) is out of this document's scope: see
   `GROUP_TASKS.md`.
