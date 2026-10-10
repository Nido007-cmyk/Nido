> **Language:** English · [Español](../es/internal/DESIGN_REDTEAM_3.md)
# Design red-team — round 3: chained attacks

**Method:** chaining surfaces that individually look permitted —
capability discovery, negotiation, privacy budget, delegation, multi-device,
group tasks, task graphs, model router, transports, consent, revocation,
extensions — looking for escalations that only appear in composition.

Format: `threat → exploit path → architectural mitigation → future
conformance test`. Which findings **changed the spec** is marked.

---

## C-1. Fragmentation of the privacy budget across capabilities

**Threat →** the disclosure budget is evaded by spreading the probing
across several capabilities.
**Exploit path →** the attacker interleaves `availability.query` (10
queries/h), `NEGOTIATION_COUNTER` rounds (each leaks constraints), and
`calendar.event.propose` with test windows. Each counter runs separately;
together they reconstruct the calendar (S2 × S5).
**Mitigation →** **disclosure budgets aggregate by (identity, window)
across capabilities**, not per capability. Negotiation rounds consume
budget (fix applied in `CAPABILITY_NEGOTIATION.md`). **[SPEC CHANGED]**
**Conformance test →** mixed query/negotiate/propose sequence must
exhaust the aggregated budget and return `BUDGET_EXHAUSTED` even if no
individual counter was exceeded.

## C-2. COUNTER as a constraints oracle

**Threat →** counterproposals progressively leak the peer's feasible set.
**Exploit path →** A proposes 20 different windows in separate
negotiations; each `COUNTER` from B ("can't before 18:30") narrows the
picture of their calendar. No single round violates their policy.
**Mitigation →** coarse counters by policy + rounds against budget (C-1) +
low default `max_rounds` + the recipient may answer `DECLINE` without
counterproposing (not obligated to inform). **[SPEC CHANGED]**
(`CAPABILITY_NEGOTIATION.md`).
**Conformance test →** 20 simulated negotiations: accumulated information
about the real calendar doesn't exceed the declared granularity.

## C-3. Exfiltration by composition in the task graph

**Threat →** each node passes policy; the composition exfiltrates.
**Exploit path →** compromised remote model proposes: n1
`availability.query` (allowed) → n2 `message.send` to the attacker's
identity with the intervals as "scheduling info" (allowed: the peer has
`message.send`). No node is malicious in isolation; the data flow is the
attack (S8 × S7).
**Mitigation →** graph disclosure accounting **in aggregate** against the
requester's budget + `data_inputs` only to declared inputs + aggregate
output validation before revealing. Full IFC declared open research, not
a promise. **[SPEC CHANGED]** (`AUTONOMY_MODEL.md` §4.3).
**Conformance test →** "benign by nodes, exfiltrating in aggregate" graph
must be denied or trimmed at the node crossing the aggregated budget.

## C-4. Consent laundering via delegation and group

**Threat →** a narrow authorization is widened across contexts.
**Exploit path →** A gets from B consent for `availability.query` → B
delegates to C (`max_depth: 1`) → C carries the delegation into a group
task where D (unrelated to A) benefits from the revealed data.
**Mitigation →** delegation `scope` includes peer allowlist and **doesn't
cross group boundaries** without explicit scope; each group participant
evaluates the original issuer (RT-10); delegation never overrides a local
DENY. **[SPEC CLARIFIED]** (already in the design; test added).
**Conformance test →** delegation presented in a group outside its scope →
`DELEGATION_INVALID`; D receives no data.

## C-5. Silent autonomy expansion by update

**Threat →** a legitimate update widens authority without the user
noticing.
**Exploit path →** the user allowed `availability.query/v1` (coarse
intervals). `v2` arrives with finer disclosure + a new model that
"understands" the rules better. Old rules apply by name to v2 → the peer
gets more data with the same permission (variant: a model with expanded
tool-use interprets old rules more permissively).
**Mitigation →** **new law: `AUTONOMY MUST NEVER GROW SILENTLY`.** Rules
pin exact `capability + version`; new version or more capabilities →
scope-expansion detection → new explicit decision. What's granted stays
valid for what's granted, not one bit more. **[SPEC CHANGED]**
(`AUTONOMY_MODEL.md`, `AGENT_PROTOCOL.md` §1.1).
**Conformance test →** installing capability v2 with rules only for v1 →
every v2 request returns `POLICY_DENIED` (not inherited) until
re-consent.

## C-6. Expiration stretching via rapid re-delegation

**Threat →** re-delegation chains extend a short authorization
indefinitely.
**Exploit path →** root delegation expires in 1 h; the intermediary
re-delegates every 50 min with a "new" 1 h expiration, chaining
effectively infinite authorization within `max_depth` if the issuer
doesn't limit it.
**Mitigation →** **monotonically decreasing expiration**: no link may
expire after its parent; `max_uses` decrements along the chain. **[SPEC
CHANGED]** (`AGENT_PROTOCOL.md` §7).
**Conformance test →** chain where a child declares `expires_at` after
the parent → `DELEGATION_INVALID` at verification.

## C-7. Transport hopping to evade rate limits

**Threat →** per-transport limits reset when switching medium.
**Exploit path →** the attacker alternates Bluetooth → LAN → relay; each
transport carries its own counter and none fires (RT-12 ×
`TRANSPORT_ARCHITECTURE.md`).
**Mitigation →** rate limits and budgets **per identity, aggregated at
the protocol layer** across all transports. **[SPEC CHANGED]**
(`AGENT_PROTOCOL.md` §8).
**Conformance test →** burst spread across 3 transports against the same
identity → the aggregated limit fires just the same.

## C-8. Revocation window on a rare transport

**Threat →** a revoked device keeps acting where the revocation hasn't
arrived yet.
**Exploit path →** the revoked tablet (S13) stops using Bluetooth (where
gossip already killed it) and attacks via relay, where peers haven't
received the list yet.
**Mitigation →** short certificate expiration (bounds the window by
design) + **enforceable revocation freshness**: `high` capabilities may
require revocation info fresher than a threshold. **[SPEC CHANGED]**
(`AGENT_PROTOCOL.md` §2).
**Conformance test →** `location.request` with peer revocation older
than the threshold → revalidation required before executing.

## C-9. Group rejoin for double voting and reset

**Threat →** withdraw + rejoin = voting twice or a fresh budget.
**Exploit path →** C votes, leaves (S6), rejoins with another `device_id`
and votes the same slot again; or their disclosure budget "resets".
**Mitigation →** votes and budgets **per identity, not per device**;
rejoining resets nothing; `DUPLICATE_VOTE` covers re-voting. **[SPEC
CHANGED]** (`GROUP_TASKS.md`).
**Conformance test →** withdraw → rejoin → vote sequence →
`DUPLICATE_VOTE`; budget consumed before the withdraw stays consumed.

## C-10. Extension shadowing a core capability

**Threat →** an extension registers `availability.query/v1` with weaker
disclosure and impersonates the core's.
**Exploit path →** the peer announces "I support `availability.query/v1`"
but their implementation is an opportunistic extension that returns event
titles. The executor's policy allowed by name.
**Mitigation →** **anti-shadowing**: identity = exact name + version of
the core; collision → rejection at validation. **[SPEC CHANGED]**
(`CAPABILITY_NEGOTIATION.md` §3.2).
**Conformance test →** registering an extension with the core's name →
rejection; requesting `v1` always invokes the core's definition.

## C-11. Policy divergence between devices

**Threat →** the attacker targets the device with the weakest policy.
**Exploit path →** the user has a phone (strict policy, always ASK) and a
desktop (forgotten old `ALLOW_FOR_CONTACT` rule). The attacker discovers
the desktop via LAN and uses it as the soft door (S4 × multi-device).
**Mitigation →** policy is **per identity** and must converge across
devices; until policy sync exists, `sensitivity: high` capabilities are
only served on the primary device. Detected divergence → user warning.
**[SPEC ADDED as temporary restriction]**.
**Conformance test →** (future) two devices with divergent policies →
the secondary rejects `high` with `POLICY_DIVERGED`.

---

## Round 3 verdict

11 chains analyzed. **9 changed or clarified the spec** (C-1, C-2, C-3,
C-5, C-6, C-7, C-8, C-9, C-10, C-11 — C-4 was already covered and tied to
a test). Dominant pattern: **attacks live in composition** — no isolated
check sees them; mitigations aggregate accounting by identity (not by
device/transport/capability) and pin versions. Two areas remain without
verifiable closure: full IFC between nodes (C-3 partial) and
multi-device policy sync (C-11 temporary).
