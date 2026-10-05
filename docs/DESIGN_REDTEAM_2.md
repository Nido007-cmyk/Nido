> **Language:** English · [Español](es/DESIGN_REDTEAM_2.md)
# Design red-team — round 2: negotiation, autonomy, groups, metadata

**Method:** two separate attackers. Each finding:
`threat → exploit path → architectural mitigation → future conformance test`.

Covers the documents: `CAPABILITY_NEGOTIATION.md`, `AUTONOMY_MODEL.md`,
`GROUP_TASKS.md`, `METADATA_PRIVACY.md`, `AGENT_SCENARIOS.md`.

---

## Perspective 1 — PRIVACY ATTACKER

*Goal: obtain information the user never intended to reveal.*

### P-1. Reconstruction via fine-grained probing

**Threat →** 100 individually allowed queries reconstruct the calendar.
**Exploit path →** `availability.query` with 15-minute slots sweeping the
week (scenario S2).
**Mitigation →** layered privacy budget: rate limits, minimum granularity
(rounding that makes fine probing useless), disclosure budgets per (peer,
window), cooldowns, and denial on detected probing pattern.
**Conformance test →** a sequence of 50 probing queries must return
`BUDGET_EXHAUSTED` before query N, and the attacker reconstructs nothing
beyond the minimum granularity.

### P-2. Fingerprinting via discovery

**Threat →** "what capabilities do you support?" reveals apps, lifestyle,
socioeconomic level.
**Exploit path →** sweeping `CAPABILITY_QUERY` against many NIDOs to
profile them.
**Mitigation →** minimal uniform responses (`SUPPORTED/UNSUPPORTED/
SUPPORTED_WITH_CONSTRAINTS` without details), rate limit per identity,
`answer_minimal` policy by default toward strangers, ban on revealing
provider/app/model/files. Discovery ≠ authorization.
**Conformance test →** two NIDOs with different internal configurations
must produce discovery responses indistinguishable in form.

### P-3. Profiling by the relay

**Threat →** the relay correlates frequency, hours, and sizes.
**Exploit path →** stable destination hash + timestamps over a month
(S10).
**Mitigation →** rotating epoch rendezvous IDs (phase 1), ephemeral
session aliases; content stays ciphertext. Honest residual: coarse rhythms
are irreducible without heavy infrastructure.
**Conformance test →** analysis of a simulated relay log: no stable
identifier beyond one epoch; the contact graph isn't reconstructible
across epochs.

### P-4. Leak in group tasks

**Threat →** the coordinator or a participant learns more than the chosen
slot.
**Exploit path →** abused collect mode, or a coordinator forwarding
individual votes (S5/S6).
**Mitigation →** vote mode by default (only vote on proposed slots),
minimal aggregation, and what's revealed can't be un-revealed (documented
as a limit, not a bug).
**Conformance test →** the coordinator's log after a group task contains
only the chosen slot, never individual intervals.

### P-5. Leak via free-text fields

**Threat →** `note`/`detail`/`parameters_summary` leak sensitive data.
**Exploit path →** `TASK_PROGRESS.note: "waiting for your oncology appointment"`.
**Mitigation →** rule RT-2: no sensitive data in free text; enums
preferred; `disclosure_summary` with categories, not content.
**Conformance test →** fuzzing free fields with sensitive patterns: the
validator rejects them or the sender sanitizes before signing.

### P-6. Inference from consent summaries

**Threat →** `CONSENT_REQUEST.parameters_summary` reveals too much.
**Exploit path →** over-detailed summary ("appointment with Dr. X for Y").
**Mitigation →** summaries are coarse by spec (capability + categories,
not content); fine detail is only seen by the local user.
**Conformance test →** `CONSENT_REQUEST` vectors contain no PII in
`parameters_summary`.

### P-7. Timing side-channels (residual)

**Threat →** response time reveals whether there was a cache hit or real
computation (e.g. "fast response = already had that data").
**Exploit path →** measuring `TASK_RESULT` latencies.
**Mitigation →** partial: responses with jitter; no constant-time
promise. Documented as an open residual.
**Conformance test →** (future) statistical latency test; today: no
policy decision depends on hiding this channel.

---

## Perspective 2 — AUTHORITY ATTACKER

*Goal: make NIDO do something the user never authorized.*

### A-1. Smuggling in the task graph

**Threat →** the model proposes a graph with a hidden privileged node.
**Exploit path →** "organize a dinner" with n4 = `location.request`
disguised in `data_inputs` (S7/S8).
**Mitigation →** node-by-node validation; no global permission to the
graph; `required_authority` never expandable beyond the requester.
**Conformance test →** graph with a capability undeclared in any node →
`GRAPH_MALFORMED`; node with a denied capability → `NODE_DENIED` without
affecting independent branches.

### A-2. Negotiation → authorization confusion

**Threat →** a `NEGOTIATION_ACCEPT` gets interpreted as permission to
execute.
**Exploit path →** A accepts terms and B executes `event.create` bypassing
policy, "because they already accepted".
**Mitigation →** ACCEPT = agreement on terms, **not** authorization. The
full pipeline runs after the ACCEPT, always.
**Conformance test →** after `NEGOTIATION_ACCEPT`, a `TASK_REQUEST` with a
denied capability must return `POLICY_DENIED` even though the negotiation
was accepted.

### A-3. Coordinator granting itself authority

**Threat →** the group coordinator forges a `GROUP_ACCEPT` to impose an
action.
**Exploit path →** malicious coordinator sends a fake acceptance (S5).
**Mitigation →** the coordinator isn't an authority; final acceptance is
local by the Policy Engine; signatures prevent forging votes.
**Conformance test →** `GROUP_ACCEPT` without valid signed votes →
`COORDINATOR_FAULT`; no side effect happens without a local `ALLOW`
decision.

### A-4. Economy hint as authority

**Threat →** self-reported `economy_hint{cost: 0, conditions: none}` to
influence policy.
**Exploit path →** a malicious service declares zero cost so the user
approves without thinking.
**Mitigation →** hints are descriptive and self-reported, **never**
authoritative; local policy decides whether to believe them.
**Conformance test →** a hint contradicting local limits is ignored; the
policy decision doesn't change for any `economy_hint` field.

### A-5. Race against revocation

**Threat →** revocation arrives when the step already started.
**Exploit path →** the user revokes during a long task (S12).
**Mitigation →** revalidation at each node boundary; atomic steps with
declared semantics; pending → `AUTONOMY_REVOKED`; completed irreversible
reported honestly.
**Conformance test →** revoking mid-graph: no pending node executes after;
the final report distinguishes `done` from `cancelled`.

### A-6. Extension claiming privileges

**Threat →** a new `message_type` tries to bypass the Policy Engine.
**Exploit path →** extension with a payload that "orders" a tool to run.
**Mitigation →** unknown type → `UNKNOWN_MESSAGE_TYPE` fail-closed;
extensions don't declare tool privileges or modify the pipeline.
**Conformance test →** envelope with an invented type and valid signature
must be rejected before any policy evaluation.

### A-7. Consent scope creep

**Threat →** reusing a consent for another action (RT-4 variant in
negotiation).
**Exploit path →** consent for "propose event" used for "create event".
**Mitigation →** `grant_scope{capability, parameters_hash, peer,
max_uses, expires_at}`; divergence → `POLICY_DENIED`.
**Conformance test →** `TASK_REQUEST` referencing a consent with a
different parameters hash → denied.

### A-8. Downgrade via old version

**Threat →** attacker pretends to be an old NIDO to get weaker disclosure
semantics.
**Exploit path →** requesting `v1` when `v3` exists with better minimum
disclosure (inverse S15).
**Mitigation →** the requester explicitly chooses the version; the
executor never degrades alone; each version declares its own disclosure.
**Conformance test →** requesting an unsupported version → explicit
`UNSUPPORTED_VERSION`; requesting a supported old version → that version
is served with its declared disclosure, no surprises.

---

## Round 2 verdict

15 findings (7 privacy + 8 authority). None break the principles; most
were already mitigated by the design and are tied here to future
conformance tests. Two honest residuals: **P-7** (timing side-channels)
and coarse relay profiling (**P-3** partial). No finding requires changing
FROZEN CORE; two clarify wording (P-5/P-6 already covered by RT-2; A-2
already covered by "ACCEPT ≠ authorization").
