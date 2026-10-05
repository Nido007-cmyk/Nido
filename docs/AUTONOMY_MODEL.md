> **Language:** English · [Español](es/AUTONOMY_MODEL.md)
# NIDO Autonomy Model — Specification (draft v0.1)

**Status:** design, DO NOT implement yet.

**Question it answers:** how can two NIDO agents discover what they can
do together, negotiate a task, and complete it with minimal human
intervention **without turning autonomy into unlimited authority**?

**Rule above all:**

> *A request can describe what another NIDO wants.*
> *It can never define what this NIDO is authorized to do.*

Inviolable principles: **THE MODEL IS NOT NIDO**; greater intelligence
never implies greater authority — authority is always bounded by the user;
fail-closed; minimum disclosure.

**Additional law: `AUTONOMY MUST NEVER GROW SILENTLY`.** No model,
capability, protocol, or software update automatically expands granted
authority. Autonomy rules pin `capability + version` exactly: if
`availability.query/v2` appears with more disclosure, or a new model with
more capabilities, old rules are **not** silently inherited — the system
detects the scope expansion and requires a new explicit
policy/consent decision. What was already granted stays valid for what was
already granted, not one bit more.

This document extends `CAPABILITY_MODEL.md` (policy decisions),
`AGENT_PROTOCOL.md` (envelopes, auditing), and `MODEL_ROUTER.md`
(transparency). It doesn't contradict them: it makes them operate over
time.

---

## 1. Autonomy budget: user-defined bounded autonomy

The user authorizes **categories of behavior**, not individual prompts or
one-off tasks. An autonomy rule is a user-signed (locally) contract that
says: "this subject may do this, under these conditions, until this date."

### 1.1 Normative examples

The system must be able to express, at minimum:

1. "My family can check my availability automatically."
   → subject: group `family`; capability: `availability.query/v1`;
   mode: `AUTO`; constraints: interval ≤ 48 h, granularity ≥ 30 min.
2. "My wife can add items to our shared list."
   → subject: peer (wife); capability: `list.item.add/v1`;
   mode: `AUTO`; constraints: only list `home-groceries`.
3. "Other NIDOs may propose events, but never create them without asking me."
   → subject: `any`; `calendar.event.propose/v1`: `ASK`;
   `calendar.event.create/v1`: `DENY` except explicit per-task `ASK`.
4. "Nobody may request location automatically."
   → subject: `any`; `location.request/v1`: `DENY` (or `ASK` every time).

### 1.2 Mandatory properties of every autonomy rule

- **Scoped:** the rule names subject + capability + version + constraints.
  Nothing outside the scope is allowed. No wildcards over capabilities.
- **Revocable:** the user may revoke at any time; revocation takes effect
  at the next *node boundary* (see §4.5).
- **Auditable:** every execution under a rule generates audit events
  referencing the `rule_id` (see §5).
- **Time-limited where appropriate:** `valid_until` mandatory for rules
  over non-intimate subjects; recommended always. No expiry date means
  no silent permanent rule.
- **Bounded by limits:** operational `limits` (frequency, volume,
  granularity) inherited from the capability (`CAPABILITY_MODEL.md` §1)
  and tighten-able per rule.

### 1.3 Where the decision lives

The autonomy rule does **not** replace the Policy Engine: it is its
*input*. Every incoming request is evaluated against the user's current
rules; the result feeds the pipeline (`CAPABILITY_MODEL.md` §4). No
applicable rule → `DENY` (fail-closed). Rules are the user's data,
encrypted at rest, visible, exportable, and deletable like the rest of
the vault.

---

## 2. Execution classes and rich policies

### 2.1 Base classes

| Class | Meaning | Policy-decision mapping |
|---|---|---|
| `AUTO` | Executes without asking, if constraints hold. | `ALLOW_FOR_CONTACT` / `ALLOW_UNDER_CONDITIONS` / `ALLOW_ONCE` |
| `ASK` | Requires user confirmation. | `ASK_USER` |
| `DENY` | Never, for that subject. | `DENY` |

### 2.2 Rich policies (supported combinations)

- `AUTO under constraints` — automatic only if `constraints` hold
  (schedule, max interval, precision, specific list…).
- `ASK once` — asks once per task/graph; approval covers that task's
  nodes (bound to `task_id`, not reusable — RT-4).
- `ASK every time` — asks per individual execution.
- `ALLOW until date` — `AUTO`/`ASK once` with explicit `valid_until`.
- `ALLOW for this peer` — subject = specific identity; not inherited by
  others or groups.
- `ALLOW while device nearby` — only with transport-verified proximity
  (Bluetooth/LAN); meant for physical contexts ("at home").

### 2.3 UX guidance: the user is not a security expert

Policies are presented in **plain language**, never as enums:

- Card per rule: *"Family → can see when I'm free → always,
  without asking · until 12/31/2027 · [see detail] [revoke]"*.
- When creating a rule, the system suggests defaults by sensitivity:
  `location.request` suggests `ASK every time` or `DENY`; the user just
  confirms or adjusts.
- Each `ASK` shows: who asks, which capability, **what data would leave**
  (categories, not content), and options *"just this once" / "always
  for this contact" / "never"*.
- Anti-fatigue: grouping of similar decisions, suggested precedents
  ("you usually allow this for Family"), and visible expiry. An
  `ASK every time` rule approved 20 times in a row suggests —without
  imposing— becoming `ASK once` or `AUTO under constraints`.
- **Visible attribution** (RT-3): everything from a peer is shown as
  *"from X's NIDO — not verified"*, including inside confirmation
  dialogs.

---

## 3. Privacy budget: defense against accumulation

**Threat:** a peer makes 100 individually-allowed queries ("free at 5?",
"5:15?", "5:30?"…) and reconstructs the calendar. Each answer respects
`minimum_disclosure`; the *set* leaks.

### 3.1 Defenses (layered, all configurable per capability)

1. **Rate limits per (peer, capability, window):** e.g.
   `availability.query`: 20 queries/hour per peer. Exceeded → error
   `BUDGET_EXHAUSTED` with `retryable: true` and `retry_after_ms`.
2. **Minimum query and response granularity:** the executor rejects
   (`GRANULARITY_TOO_FINE`) or *rounds* intervals below the minimum
   granularity (e.g. 30 min for availability). Asking "5:15?" returns
   the same answer as the "5:00–5:30" block, identical to asking
   "5:00?": fine reconstruction becomes useless.
3. **Disclosure budgets:** *information-unit* budget per (peer, window).
   Each answer deducts per its approximate entropy (number of revealed
   intervals × granularity). Exhausted → policy deny until the next
   window.
4. **Aggregation / coarsening:** on probing patterns, the executor may
   degrade the answer: instead of exact intervals, *"free 2 of 4
   blocks"*; or merge adjacent gaps. Still useful for coordinating,
   useless for reconstructing.
5. **Cooldowns:** after N queries in a short window, mandatory pause with
   backoff. Cooldown is per peer, not global (not everyone is punished
   for one).
6. **Policy deny on detected pattern:** local "systematic probing"
   heuristic (sequential interval sweep). If detected →
   `POLICY_DENIED` + suggestion of a legitimate broad query. The
   heuristic is conservative: when in doubt, degrade (coarsening)
   before denying.

### 3.2 Honest evaluation of differential privacy

**When it does NOT make sense:** in 1-to-1 queries where the peer needs
an exact, useful answer (coordinating a meeting). Adding calibrated
noise to "are you free Tuesday at 6?" destroys utility and gives a false
sense of privacy: the attacker repeats the query and averages the noise.
DP doesn't replace rate limits + granularity + budgets.

**When it COULD make sense (future, not now):**

- Aggregate statistics over many NIDOs (e.g. "how many contacts
  are free Friday?" with a trusted aggregator or multiparty
  computation).
- Opt-in aggregate ecosystem telemetry (version adoption).
- Group responses (see `GROUP_TASKS.md`): noisy availability counts
  before revealing the winning interval.

**Decision:** don't implement DP automatically. Keep it as an explicit
per-future-capability option, only where there's real aggregation over
multiple subjects and a threat model that justifies it.

---

## 4. Multi-capability task graph

### 4.1 Example: "organize a dinner"

The model **proposes** a graph; the Policy Engine **authorizes each node**:

```
n1  availability.query/v1      (peer: esposa)            AUTO
 │   → free_intervals
n2  meeting.negotiate/v1       (peer: esposa)            AUTO
 │   → agreed_slot  (depende de n1)
n3  places.search/v1           (local, solo mi NIDO)     AUTO
 │   → candidates   (depende de n2)
n4  preferences.ask/v1         (peer: esposa)            ASK once
 │   → choice       (depende de n3)
n5  calendar.event.propose/v1  (peer: esposa)            AUTO
 │   → proposal_id  (depende de n2, n4)
n6  calendar.event.create/v1   (peer: esposa)            DENY ←
     (depende de n5; la regla del usuario exige ASK explícito por tarea)
```

### 4.2 Node schema

Each node declares:

- `capability` + `capability_version`
- `dependencies`: prior `node_id`s (acyclic graph; cycles → `MALFORMED`)
- `required_authority`: under which authority the node runs —
  `peer:<identity>` (the original requester's, never widened) or
  `user` (purely local steps of the user's own NIDO)
- `data_inputs`: references to prior nodes' outputs
  (`"n1.output.free_intervals"`)
- `expected_outputs`: fields the node will produce
- `side_effects`: `none` / `read` / `write` / `external` (inherited from
  the capability; the graph cannot declare it lower)

### 4.3 Hard rules

1. **The model proposes; the Policy Engine disposes, node by node.**
   Each node is evaluated as if it were an independent `TASK_REQUEST`
   from the original requester, with its capability, parameters, and
   policy.
2. **Permission is never granted to the whole graph** just because the
   model created it. A well-formed graph with one unauthorized node is
   a partially denied graph, not a global authorization.
3. **Data flow respects minimum disclosure:** a node only receives
   the fields the producing capability allows revealing; the graph
   cannot "widen" data between nodes.
4. **Graph disclosure accounting (round 3, C-3):** the graph as a whole
   is charged against the requester's privacy budget, not just node by
   node. A `data_inputs` may only feed the destination node's declared
   inputs; the graph's aggregate output is validated against minimum
   disclosure before being revealed to the peer. Full IFC
   (information-flow control) remains open research: the design doesn't
   promise what it can't verify.
5. **Authority doesn't grow with depth:** a node's `required_authority` ⊆
   the original requester's authority. A node can't run "as user" if a
   peer requested it (anti confused-deputy, RT-10).
6. **Per-node idempotency:** each node has its own derived `task_id`
   (`graph_id + node_id`); re-running the graph doesn't duplicate side
   effects (AGENT_PROTOCOL.md §9).

### 4.4 Partial failure semantics

Per-node states: `proposed → authorized → running → done | denied |
failed | skipped`.

- A `DENY` node blocks **only** the branches depending on it
  (transitively): its dependents go `skipped` with reason `NODE_DENIED`.
- Already-allowed independent work **is not destroyed**: `done` nodes
  on unaffected branches keep their results.
- The graph's result is **partial and honest**: `{status:
  partial, nodes: {n1: done, …, n6: denied, …}}`. Total success is never
  faked, nor the DENY hidden.
- Retry: only `failed`/`skipped` nodes whose cause is gone (e.g. the
  user later approves n6 with `ASK`); `done` nodes with side effects
  are not re-executed.

### 4.5 Mid-task revocation

- The Policy Engine revalidates the autonomy rule **at each node
  boundary**, not just at graph start.
- Revoked rule → pending nodes that needed it go `skipped` with error
  `AUTONOMY_REVOKED`; the requester is notified.
- An in-flight node finishes its current atomic call (a write is not
  interrupted mid-way), but its result **is not disclosed** to the peer
  if disclosure depended on the revoked rule.
- Already-completed irreversible side effects **remain** and are
  reported honestly in the explainability chain (§5). Revocation doesn't
  rewrite the past; it prevents the future.

---

## 5. Explainability: "why did you do that?"

NIDO answers with a **verifiable chain of decisions and events**,
generated from the audit log — never with the model's chain-of-thought.

### 5.1 Chain format

```json
{
  "task_id": "7a11…",
  "chain": [
    {"event": "task.received", "from_identity": "ab12…", "at": 1790000000000},
    {"event": "graph.proposed", "by": "model:local-qwen2.5-1.5b", "nodes": 6},
    {"event": "policy.decision", "node": "n1", "capability": "availability.query/v1",
     "decision": "AUTO", "rule_id": "rule-7"},
    {"event": "policy.decision", "node": "n6", "capability": "calendar.event.create/v1",
     "decision": "DENY", "rule_id": "rule-3", "reason": "requires explicit ASK"},
    {"event": "consent.requested", "node": "n4", "to": "user"},
    {"event": "consent.granted", "node": "n4", "by": "user", "scope": "task 7a11…, once"},
    {"event": "tool.executed", "node": "n1", "local": true},
    {"event": "result.disclosed", "node": "n1", "to_identity": "ab12…",
     "disclosure": "availability intervals (2 blocks)"}
  ]
}
```

In plain language for the user:

> *María's NIDO asked to coordinate a dinner. Her NIDO proposed 6 steps.
> Policy allowed 4 automatically (the "Family" rule), 1 asked for your
> confirmation (you approved it just for this task), and 1 was denied
> (creating the event requires your explicit approval). Revealed to María:
> availability intervals (2 blocks). Nothing else.*

### 5.2 Rules

- **Decisions and events** are recorded, not the model's private
  reasoning. Exposing chain-of-thought, internal prompts, or model
  deliberation is forbidden.
- The chain is verifiable: each event references `task_id`, `node_id`,
  `rule_id`, and `grant_scope` where applicable; envelope signatures
  let a third party (the user themselves, an auditor) verify origin.
- No sensitive content: disclosure categories, never full parameters
  (AGENT_PROTOCOL.md §11).

---

## 6. Machine-verifiable part (drafts)

### 6.1 JSON Schema — autonomy rule (`autonomy.rule/v1`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "autonomy.rule/v1",
  "type": "object",
  "properties": {
    "rule_id":      {"type": "string"},
    "v":             {"const": 1},
    "subject":       {"type": "object",
                      "properties": {
                        "type": {"enum": ["peer", "group", "any"]},
                        "identity": {"type": "string"},
                        "group": {"type": "string"}},
                      "required": ["type"], "additionalProperties": false},
    "capability":          {"type": "string"},
    "capability_version":  {"type": "string", "pattern": "^v[0-9]+$"},
    "mode":        {"enum": ["AUTO", "ASK", "DENY"]},
    "ask_mode":    {"enum": ["every_time", "once_per_task", "once"]},
    "constraints": {"type": "object", "additionalProperties": true},
    "limits":      {"type": "object",
                    "properties": {
                      "max_queries_per_hour": {"type": "integer", "minimum": 1},
                      "min_granularity_minutes": {"type": "integer", "minimum": 1},
                      "disclosure_units_per_day": {"type": "integer", "minimum": 1},
                      "cooldown_ms": {"type": "integer", "minimum": 0}},
                    "additionalProperties": false},
    "proximity":   {"enum": ["any", "nearby"]},
    "max_uses":    {"type": ["integer", "null"], "minimum": 1},
    "valid_from":  {"type": "integer"},
    "valid_until": {"type": ["integer", "null"]},
    "revocable":   {"const": true},
    "created_by":  {"const": "user"},
    "created_at":  {"type": "integer"}
  },
  "required": ["rule_id", "v", "subject", "capability", "capability_version",
               "mode", "revocable", "created_by", "created_at"],
  "additionalProperties": false
}
```

### 6.2 JSON Schema — task graph (`autonomy.taskgraph/v1`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "autonomy.taskgraph/v1",
  "type": "object",
  "properties": {
    "graph_id":    {"type": "string"},
    "task_id":     {"type": "string"},
    "proposed_by": {"type": "string"},
    "nodes": {"type": "array", "minItems": 1, "items": {
      "type": "object",
      "properties": {
        "node_id": {"type": "string"},
        "capability": {"type": "string"},
        "capability_version": {"type": "string", "pattern": "^v[0-9]+$"},
        "parameters": {"type": "object"},
        "dependencies": {"type": "array", "items": {"type": "string"}},
        "required_authority": {"type": "string"},
        "data_inputs": {"type": "array", "items": {"type": "string"}},
        "expected_outputs": {"type": "array", "items": {"type": "string"}},
        "side_effects": {"enum": ["none", "read", "write", "external"]}
      },
      "required": ["node_id", "capability", "capability_version",
                   "dependencies", "required_authority", "side_effects"],
      "additionalProperties": false
    }}
  },
  "required": ["graph_id", "task_id", "proposed_by", "nodes"],
  "additionalProperties": false
}
```

### 6.3 Error codes (draft, additive to AGENT_PROTOCOL.md §5.1)

| Code | When | `retryable` |
|---|---|---|
| `AUTONOMY_DENIED` | No autonomy rule allows it. | `false` |
| `AUTONOMY_REVOKED` | The rule was revoked mid-task (§4.5). | `false` |
| `BUDGET_EXHAUSTED` | Rate limit / disclosure budget exhausted (§3.1). | `true` (+`retry_after_ms`) |
| `GRANULARITY_TOO_FINE` | Query below minimum granularity. | `true` (retry coarser) |
| `NODE_DENIED` | A graph node was denied; dependent branches `skipped`. | `false` |
| `GRAPH_MALFORMED` | Cycles, growing authority, under-declared side effects. | `false` |

---

## 7. Open questions

1. Should autonomy rules be signed with the identity key (strong audit,
   multi-device), or is local encrypted storage enough?
2. How do rules sync between a user's devices without creating a channel
   a compromised secondary could abuse?
3. "Systematic probing" heuristic (§3.1.6): what false positives are
   acceptable before degrading to coarsening?
4. Does per-graph `ASK once` need a consent distinct from per-task
   `CONSENT_RESULT`, or is binding it to the graph's `task_id` enough?
5. Disclosure units (§3.1.3): approximate entropy, simple field count,
   or per-capability budget defined by the user?
6. On long graphs (days), does node-boundary revalidation also need
   temporal revalidation (the rule expired between nodes)?
7. Should the explainability chain be exportable/signed for
   inter-user disputes ("your NIDO did X")?
