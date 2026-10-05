> **Language:** English · [Español](../es/economic/ECONOMIC_POLICY_MODEL.md)

# NIDO Economic Layer — Policy Model

**Status:** RESEARCH / DESIGN ONLY. No implementation. Subordinate to
`../NIDO_PRINCIPLES.md` and to `ECONOMIC_ARCHITECTURE.md` (the state
machine and the CAPABILITY primitive are defined there).

Decision labels: **[FROZEN PRINCIPLES]** · **[PROVISIONAL]** ·
**[EXPERIMENTAL]** · **[OPEN QUESTIONS]**.

---

## 1. Human economic policies as structured rules

The user expresses their economic will as a **set of structured rules**,
evaluated by deterministic code in the Policy Engine.
The model may help draft or explain them; it **never creates,
modifies, or interprets them in a binding way**.

Canonical examples (default values, see §3):

| Rule (human language) | Structured form |
|---|---|
| AUTO under $1/task | `{effect: ALLOW, scope: {per_task_max: {amount: "1.00", unit: "USD"}}}` |
| AUTO up to $5/day | `{effect: ALLOW, scope: {per_day_max: {amount: "5.00", unit: "USD"}}}` |
| ASK above $5 | `{effect: ASK_USER, scope: {per_task_min: {amount: "5.00", unit: "USD"}}}` |
| DENY subscriptions | `{effect: DENY, scope: {recurring: true, explicit_grant: false}}` |
| DENY unknown peers | `{effect: DENY, scope: {peer_class: "unknown"}}` |
| ALLOW family | `{effect: ALLOW, scope: {peer_group: "family"}, limits: {...}}` |
| ALLOW this business until date | `{effect: ALLOW, scope: {peer: "<id>", until: "<ts>"}, limits: {...}}` |
| ASK every recurring payment | `{effect: ASK_USER, scope: {recurring: true}}` |

**[PROVISIONAL]** The default thresholds (`$1`, `$5`) are reasonable
initial values, not truths. The user adjusts them; the design only
requires that thresholds **exist** and that the default when in doubt is to
ask (ASK_USER) or deny, never to allow silently.

**[FROZEN PRINCIPLES]** No recurring or hidden payment may be created
without the user's explicit authorization for **that** recurrence (or for a
named, bounded subscription the user approved as such). A
capability attempting to turn a one-time payment into a recurring one is an
attack (see `ECONOMIC_REDTEAM.md`: hidden recurring payment), not a feature.

### 1.1 What an economic ASK_USER must show

**[PROVISIONAL]** Every user confirmation request includes, at minimum:
exact amount + unit, peer (identity, not a pretty alias),
capability and version, accepted verification method, `refundability`,
which policy limit escalated it to ASK, and what would happen on `FAIL`
(refund or not). Without these fields, consent is not informed and the
Policy Engine must not present it.

---

## 2. Limit combination

Limits combine across **all** of these dimensions at once:

- `per_task` — cap per payment intent (`payment_id`).
- `per_peer` — cap per counterparty identity, per time window.
- `per_capability` — cap per `capability/version`.
- `per_day` / `per_month` — sliding windows in device-local time.
- `per_asset` — cap per unit/rail (e.g. "max 20 USD/month on
  rail X").

**[FROZEN PRINCIPLES]** All applicable limits must be satisfied
**conjunctively**: the allowed spend is the common minimum, i.e. the
most restrictive one wins. A spend exceeding **any** of them is denied
or escalated to ASK_USER per the rule. There is no "the daily limit doesn't
apply because the per-task limit allows it": dimensions do not
offset each other.

**[FROZEN PRINCIPLES]** Limits are accounted by **peer identity**, not by
device, transport, or session (direct parallel to INV-3
TRANSPORT_INDEPENDENCE and INV-5 DISCLOSURE_ACCOUNTING of the protocol).
Switching from Bluetooth to LAN does not reset the daily budget with a peer.

**[PROVISIONAL]** Sliding windows (`per_day` = last 24h, not calendar
day) to prevent the "spend the cap at 23:59 and again
at 00:01" trick.

### 2.1 Never self-expand

**[FROZEN PRINCIPLES]** A model, software, capability, or protocol update
**never** automatically expands economic limits (economic extension of
INV-2 AUTONOMY_NON_EXPANSION):

- A new capability (or a new version `v2` of an existing one) has
  **zero** budget until the user explicitly authorizes it.
- A default change in an update applies only to rules
  created afterwards, or is presented to the user as a new decision. Existing
  rules are never silently rewritten.
- The model cannot propose "adjusting your limits for convenience" and have
  that take effect: any limit change is a policy action
  requiring the user's explicit confirmation (presented per §1.1).

---

## 3. Budget vault: separate operating budget

**[FROZEN PRINCIPLES]** An agent never needs — and must never have —
unlimited authority over the user's funds. The design separates:

- **Principal funds (principal):** the user's assets. The NIDO
  has **no** spend authority over them through any automatic
  path. Every movement from the principal requires the
  user's explicit confirmation, case by case.
- **Budget vault (operational):** a bounded allocation the user
  funds deliberately (amount, unit, time window). Only the
  vault is subject to AUTO/ASK rules. The vault is the only thing the Policy
  Engine may commit without asking each time.

Vault dimensions (all configurable, all with a conservative
default):

| Budget | Scope | Suggested default |
|---|---|---|
| `spending` | global vault cap per window | defined by the user when funding |
| `session` | cap per task session (a root `task_id` and its sub-nodes) | `per_task` × factor, or 0 (disabled) |
| `capability` | cap per `capability/version` | 0 until explicit authorization |
| `peer` | cap per counterparty identity | class `unknown`: 0 |
| `time` | day/month windows (sliding) | see §2 |

**[PROVISIONAL]** The vault is implemented as a **local accounting ledger**
signed by the device, not as separate custody on the rail: what
makes it real is that the Policy Engine **denies** spending that exceeds it,
before the SettlementAdapter acts. If the rail allows spending outside
the vault (e.g. the real wallet holds more funds), the design requires
the adapter to operate **only** with the settlement profile credentials
bounded to the vault (see `ECONOMIC_ARCHITECTURE.md` §8). An adapter with
access to unlimited funds invalidates this entire model: it is a
configuration failure, not a supported case.

### 3.1 Emergency revoke

**[FROZEN PRINCIPLES]** There is a single, local, immediate
**emergency revocation** action: it freezes all future spending (empties
pending authorizations, blocks new `AUTHORIZE`s, revokes the
settlement profile credentials on the device). It is local-first:
works without a network. It does not undo settlements already recorded on
the rail (nobody can promise that), but it prevents **all** new
authorizations from that instant. It must be reachable in ≤2 taps from the
home screen.

### 3.2 Offline limits

**[PROVISIONAL]** The user may pre-authorize an **offline spend cap**
(a sub-limit of the vault, e.g. $2) usable without connectivity. Once
reached, further spending goes on `hold` until connectivity returns.
The offline journal is single-writer per device (§6); spending
offline on two devices at once against the same vault is a known risk
bounded by the cap (see §6 and redteam: multi-device double
spend).

---

## 4. Receipts

**[FROZEN PRINCIPLES]** Every economic event with a side effect produces a
receipt: a **verifiable** record of **events and decisions**, never of
the model's chain-of-thought. The receipt must be able to answer,
unambiguously:

1. what was **requested** (capability, version, summarized parameters, peer),
2. what was **quoted** (accepted quote: amount, unit, `refundability`,
   verification method, TTL),
3. what the **policy authorized** (rule applied, limits evaluated,
   decision: AUTO/ASK_USER + reference to the consent),
4. what the **user confirmed** (if there was an ASK: timestamp, exact
   confirmed scope),
5. what was **executed** (`task_id`, summarized result per minimum
   disclosure; for goods such as knowledge packs: `pack_id`, content
   hash, and `license_id` — see `ECONOMIC_ARCHITECTURE.md` §10.1),
6. what was **verified** (verification mode, minimum evidence),
7. what was **paid** (`payment_id`, final amount, rail, rail
   reference),
8. what was **refunded** (if applicable: `refund_id`, amount, reason).

Receipt properties:

- Signed by the **device key** that authorized/executed (local
  non-repudiation; verifiable by the user on another of their devices).
- Chained by `payment_id`: request → authorization → settlement →
  refund form an auditable chain, not loose entries.
- Stored encrypted at rest, viewable/exportable/deletable by the user
  (same discipline as the protocol audit, `AGENT_PROTOCOL.md`
  §11).
- **[FROZEN PRINCIPLES]** The receipt never contains: prompts, model
  reasoning, user sensitive data beyond the minimum summary
  necessary, nor keys or signing material.

**[PROVISIONAL]** The receipt is a **local attestation**, not a global
truth: it proves what *this* NIDO decided and recorded. Against a peer,
its own receipt + the rail reference are the evidence; no
"global receipt" is designed without a trusted third party (that would be
recentralizing).

---

## 5. Recurrence and subscriptions

**[FROZEN PRINCIPLES]** (restated for being a classic attack surface):

- Each recurring charge requires explicit authorization: either the user
  approved **that** named subscription (capability, amount or bounded amount
  formula, frequency, end date or end condition), or
  each charge goes through ASK_USER.
- An approved subscription **cannot** unilaterally expand its
  amount, frequency, or scope: any change is a new
  authorization.
- Cancelling a subscription is an immediate local action
  (like the emergency revoke, but with limited scope): it prevents future
  authorizations even if the peer keeps trying to charge.
- `DENY` by default any pattern smelling of undeclared
  recurrence (same peer + same capability + regular cadence without a
  subscription grant).

---

## 6. Offline economy: honest classification

Two NIDOs in airplane mode with Bluetooth may need to exchange value
(e.g. pay for the other's compute). This design **does not promise
impossible double-spend prevention**. Classification:

| Operation | Offline | Notes |
|---|---|---|
| **Execute** work | ✅ yes | Local by definition. |
| **Authorize** spend (policy decision) | ✅ yes | Policy is local; recorded in the journal with timestamp and `payment_id`. |
| **Record** intent/receipt | ✅ yes | Encrypted local journal; chained by `payment_id`. |
| **Settle** on external rail | ❌ no | Requires connectivity with the rail. No exception. |
| **Settle** in offline credits | ⚠️ provisional | Only if the rail is a pre-funded local credit system between those two NIDOs (see §6.1). |
| **Deferred settlement** (settlement promise) | ✅ yes, as a promise | `SETTLE_DEFERRED` is recorded: signed commitment to settle when connectivity returns. **Not final**: it is recorded debt, not payment. |
| Dispute with remote human | ❌ no | Requires a channel to the human. Offline, `DISPUTE` freezes locally. |
| Deterministic verification | ✅ yes | If the mode allows it (hash, proof). |
| Buyer confirmation | ✅ yes | If the buyer is present (the typical Bluetooth case). |

### 6.1 Offline credits (provisional, bounded)

**[EXPERIMENTAL]** Two NIDOs may keep a **bilateral credit ledger**: each
pre-authorizes a cap (e.g. $5) and offline exchanges
move balances within that cap, with a journal signed by both.
Honest limits of this design:

- Only works between peers with an established relationship (not with
  strangers: the default risk is borne by whoever accepts the credit).
- The pre-authorized cap **is** the accepted maximum loss. There is no
  cryptographic double-spend prevention without a third party or
  connectivity: there is **damage bounding**.
- On regaining connectivity, journals reconcile against the vault;
  discrepancies → `DISPUTE` with humans.
- Multi-device: each device keeps its own sub-journal with a
  sub-cap; the vault is not exceeded because the sum of sub-caps ≤ offline
  cap (§3.2). **[OPEN QUESTIONS]** Safe automatic reconciliation
  between same-user devices without double counting? Unresolved,
  the default is conservative: a single device spends offline at a time
  (others see the cap as exhausted until sync).

**[FROZEN PRINCIPLES]** A `SETTLE_DEFERRED` or an offline credit movement is
never presented to the user as "final payment". The UI
distinguishes: `paid` (settled on rail) vs. `pending settlement`
(recorded commitment) vs. `bilateral credit` (balance between peers). Ambiguity
here is fraud by UX design.

---

## Decision log

| # | Decision | Classification |
|---|---|---|
| 1.1 | Structured economic rules; the model neither creates nor modifies them | FROZEN PRINCIPLES |
| 1.2 | $1/$5 thresholds as initial defaults | PROVISIONAL |
| 1.3 | Hidden recurrence prohibited; subscription requires explicit grant | FROZEN PRINCIPLES |
| 1.4 | Minimum content of the economic ASK_USER | PROVISIONAL |
| 2.1 | Conjunctive limits across all dimensions (most restrictive wins) | FROZEN PRINCIPLES |
| 2.2 | Accounting by peer identity, not by transport/device | FROZEN PRINCIPLES |
| 2.3 | Sliding windows (not calendar) | PROVISIONAL |
| 2.4 | No update expands limits automatically | FROZEN PRINCIPLES |
| 3.1 | Principal vs. budget vault separation; the agent never touches the principal alone | FROZEN PRINCIPLES |
| 3.2 | Vault as local accounting ledger + adapter bounded to the vault | PROVISIONAL |
| 3.3 | Emergency revoke: single, local, immediate action | FROZEN PRINCIPLES |
| 3.4 | Pre-authorized offline spend cap; excess on hold | PROVISIONAL |
| 4.1 | Receipt of events+decisions, never chain-of-thought | FROZEN PRINCIPLES |
| 4.2 | Receipt signed by device, chained by `payment_id` | PROVISIONAL |
| 4.3 | Receipt as local attestation, not global truth | PROVISIONAL |
| 5.1 | Recurrence: explicit authorization, no unilateral expansion, local cancellation | FROZEN PRINCIPLES |
| 6.1 | Settlement on external rail requires connectivity, no exception | FROZEN PRINCIPLES |
| 6.2 | `SETTLE_DEFERRED` is a recorded promise, not final payment | FROZEN PRINCIPLES |
| 6.3 | Bilateral offline credits with cap = accepted maximum loss | EXPERIMENTAL |
| 6.4 | UI distinguishes paid / pending / bilateral credit | FROZEN PRINCIPLES |

## Open questions (this document)

1. How is the vault funded in practice without turning funding into
   friction the user avoids (and therefore leaves everything in
   ASK_USER fatigue)?
2. Multi-device reconciliation of the offline journal without double
   counting or a server: what minimal protocol would make it safe?
3. Should receipts have an interoperable canonical signed format
   between NIDO implementations (JCS as in the protocol), or is the
   local format enough?
4. What minimum verification evidence is sufficient for an
   automatic `SETTLE` (without ASK) to be defensible against a later
   user claim?
