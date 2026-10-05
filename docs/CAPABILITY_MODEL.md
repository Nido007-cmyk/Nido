> **Language:** English · [Español](es/CAPABILITY_MODEL.md)
# NIDO Capability Model — Specification (draft v0.1)

**Status:** design, DO NOT implement yet.

A *capability* is a structured, versioned, schema-bound permission that a
NIDO may request from another NIDO. **Another NIDO never automatically
gets a tool just for being a contact.** Local policy always decides.

---

## 1. Capability definition

```json
{
  "name": "calendar.availability.query",
  "version": "v1",
  "description": "Consulta disponibilidad en un intervalo sin revelar eventos.",
  "input_schema": { "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "interval_start": { "type": "integer" },
      "interval_end": { "type": "integer" }
    },
    "required": ["interval_start", "interval_end"],
    "additionalProperties": false },
  "output_schema": { "type": "object",
    "properties": {
      "free_intervals": { "type": "array",
        "items": { "type": "object",
          "properties": { "start": { "type": "integer" },
                          "end": { "type": "integer" } },
          "required": ["start", "end"] } }
    },
    "required": ["free_intervals"],
    "additionalProperties": false },
  "required_permissions": ["calendar.read.local"],
  "sensitivity": "medium",
  "minimum_disclosure": ["free_intervals[].start", "free_intervals[].end"],
  "human_approval": "conditional",
  "delegation_permitted": true,
  "max_delegation_depth": 1,
  "expiration_behavior": "result_valid_until_interval_end",
  "side_effects": "none"
}
```

Mandatory fields of every capability:

| Field | Meaning |
|---|---|
| `name` / `version` | Identifier + version (`…/v1`). Versioned independently of the protocol. |
| `input_schema` / `output_schema` | JSON Schema. `additionalProperties: false` by default. |
| `required_permissions` | Local permissions the executor needs (granted by the user, not the peer). |
| `sensitivity` | `low` / `medium` / `high`. Feeds policy defaults and the Model Router. |
| `minimum_disclosure` | **Exact list** of fields the result may reveal. Everything else is forbidden in the output. |
| `human_approval` | `never` / `conditional` / `always`. |
| `delegation_permitted` / `max_delegation_depth` | Whether it can be delegated and how many hops. |
| `limits` | Operational limits the executor applies **even when** the input is schema-valid: max interval, max number of results, minimum precision, etc. (RT-13: valid schema doesn't imply reasonable request). |
| `expiration_behavior` | What result expiry means. |
| `side_effects` | `none` / `read` / `write` / `external`. `write`/`external` ones require idempotency. |

**Semantic interoperability:** in ten years, an agent with a totally
different AI architecture must understand what's being asked from just
the name, version, and schemas. **The protocol never depends on natural
language when a stable schema can exist.**

---

## 2. Initial catalog (normative disclosure examples)

| Capability | Input | Allowed output | Forbidden in output |
|---|---|---|---|
| `message.send/v1` | `{to_identity, text≤4000}` | `{message_id, delivered_at}` | — (the sender supplies the text) |
| `availability.query/v1` | `{interval_start, interval_end}` | `{free_intervals[]}` | titles, participants, location, notes, full calendar |
| `calendar.event.propose/v1` | `{title, start, end, attendees?}` | `{proposal_id, conflicts: bool}` | existing events |
| `calendar.event.create/v1` | `{…}` | `{event_id}` | — · `human_approval: always` |
| `file.request/v1` | `{file_id|query, purpose}` | `{offer: {file_id, name, size, mime}}` | content, paths, full listing |
| `file.send/v1` | `{file_id, transfer_token}` | `{received_bytes}` | other files |
| `reminder.propose/v1` | `{text, at}` | `{proposal_id}` | — · creating requires approval |
| `location.request/v1` | `{purpose, precision}` | `{lat, lon, accuracy}` per `precision` | history · `sensitivity: high`, `human_approval: always`, `delegation_permitted: false` |
| `agent.task/v1` | `{goal, constraints, requested_capabilities[]}` | per sub-task | meta-capability: always passes through policy; may **only** invoke the capabilities declared in `requested_capabilities[]`, each evaluated separately (RT-1) |

Canonical minimum-disclosure example: when asked "free between 5 and
7?", answer "free from 6 to 7" **without** event name, location,
participants, notes, or full calendar. The output schema makes
accidental leaking structurally impossible: `additionalProperties: false`
+ closed field list.

---

## 3. Policy decisions

For each (peer identity, capability, context) triple, local policy
returns one of:

- `DENY` — reject with `POLICY_DENIED`. Default for unknown peers and
  unknown capabilities.
- `ASK_USER` — presented to the user (which peer, which capability, what
  data would leave) and executed only with explicit approval.
- `ALLOW_ONCE` — one execution; creates no precedent.
- `ALLOW_FOR_CONTACT` — allowed for that contact while the rule exists.
- `ALLOW_UNDER_CONDITIONS` — allowed if constraints hold
  (schedule, max interval, location precision, etc.).

Example: the wife's NIDO may `availability.query` (`ALLOW_FOR_CONTACT`),
may `calendar.event.propose` (`ASK_USER`), but `calendar.event.create`
requires her confirmation (`human_approval: always`) and can **never**
read the full calendar (no capability allows it).

---

## 4. Policy Engine contract (define now, implement later)

Every incoming request follows this pipeline, in code, with no exceptions:

```
peer autenticado
  → validación de protocolo (firma, versión, expiración, schema)
  → validación de capability (¿existe? ¿versión soportada?)
  → evaluación de política (DENY/ASK/ALLOW_* + cadena de delegación si la hay)
  → consentimiento si se requiere (usuario local)
  → ejecución de la tool
  → resultado filtrado por minimum_disclosure
```

**Never:** `remote content → model → tool execution`.

- **Model ≠ authority.** The model may *propose* parameters or *summarize*
  results for display, but authorization is deterministic code.
- **Peer ≠ authority.** An authenticated peer has exactly the permissions
  local policy grants it, not one more.
- **Confused deputy:** a task from peer X runs with X's authority, never
  the user's. Tools check "does X hold capability C with these
  parameters?" — not "is the request well formed?". Another NIDO can't
  use my NIDO to do something it isn't itself authorized for.
- **Provenance toward third parties (RT-10):** every action with effects
  on a third party (e.g. A asks B to write to C's calendar) carries the
  `delegation_chain` with the original issuer; **the affected NIDO
  evaluates the chain**, not just the direct executor's identity. No
  valid chain → reject.
- **Delegation never overrides a DENY (RT-5):** local policy is evaluated
  on the original issuer **and** each intermediary; a `DENY` at any
  point breaks the chain.
- **Tool sandbox (RT-14):** tools run with their capability's minimum
  privilege and their output is validated against `output_schema`
  before leaving the device.

---

## 5. Trust boundary: prompt injection

Content trust levels:

1. **SYSTEM** — the user and their local policies. The only authority.
2. **AGENT_LOCAL** — structured output of the user's own model; validated
   against schemas before use.
3. **PEER** — authenticated via protocol, but **UNTRUSTED DATA**.
4. **EXTERNAL** — web, files, QR, remote model, external tool.
   Unauthenticated: **UNTRUSTED DATA**.

Rules:

- PEER/EXTERNAL content is **data**. The model may analyze it,
  summarize it, and display it. **It cannot by itself turn it into
  privileges.**
- Every tool call derived from PEER/EXTERNAL content must pass policy
  evaluation **as if the peer had asked for it in a structured
  `TASK_REQUEST`**. The model proposes; the Policy Engine disposes.
- **Indirect attack** (must be stopped):
  a NIDO sends a file → the file contains malicious instructions →
  the model interprets them → tries to use a tool → **the Policy Engine
  evaluates the tool against the peer's permissions and denies it** (the
  peer lacks that capability, or it requires `ASK_USER`). Escalation dies
  at evaluation, not in the model's "intelligence".
- The peer's free text (descriptions, progress notes) is rendered as
  quoted text, never interpolated into privileged system prompts.
  Syntactic separation between data and system templates.
- **Visible attribution (RT-3):** all peer/external-origin content must
  be shown with attribution ("from X's NIDO — not verified"). The model
  may quote it, never present it as its own fact. This closes user
  deception through the model.

---

## 6. Private discovery

`CAPABILITY_QUERY` → `CAPABILITY_RESPONSE` announces **only** the public
`{name, version, description}`. A NIDO may say "I support
`calendar.availability.query/v1`" without revealing which calendar it
uses, which model it has, which files exist, or which services it
connected. The announcement is an interface promise, not an inventory.

Fine negotiation (which parameters do you accept?) happens per task, not
in the announcement.

---

## 7. Formal minimum disclosure

Each capability declares `minimum_disclosure` as a closed list of field
paths. The executor:

1. Computes the full result locally (e.g. reads the calendar).
2. Projects **only** the listed fields.
3. Validates the result against `output_schema` (`additionalProperties:
   false` guarantees it structurally).
4. Records `disclosure_summary` in audit (categories, not content).

Privacy negotiation (asking for less than the maximum) is a permanent
property: the requester may ask for a smaller interval or lower
precision, and the executor may answer with an even smaller subset.

---

## 8. Open questions

1. Constraint language for `ALLOW_UNDER_CONDITIONS`? (Simple
   declarative rules or a versioned mini-DSL?)
2. Should default policies come signed/updatable, or are they
   100% local and manual?
3. Does `agent.task/v1` need sub-schemas per "task type" to avoid
   becoming a generic hole?
4. How is an `ASK_USER` decision presented to the user without dialog
   fatigue? (Grouping, suggested precedents, rule expiry.)
