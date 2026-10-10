> **Language:** English · [Español](../../es/internal/economic/SETTLEMENT_ABSTRACTION.md)

# NIDO Economic Layer — Settlement Abstraction

**Status:** RESEARCH / DESIGN ONLY. No implementation. No adapter, no rail,
no token is implemented. Subordinate to
`../NIDO_PRINCIPLES.md` (§2: everything interchangeable is interchangeable)
and to `ECONOMIC_ARCHITECTURE.md`.

Decision labels: **[FROZEN PRINCIPLES]** · **[PROVISIONAL]** ·
**[EXPERIMENTAL]** · **[OPEN QUESTIONS]**.

---

## 1. Principle: the protocol doesn't know what money is

**[FROZEN PRINCIPLES]** The NIDO protocol (envelopes, tasks,
idempotency, expiry) **never** depends on a specific payment rail.
`TASK_REQUEST` contains no payment fields; the economic layer lives
**above** the protocol as quote/authorization messages and
**below** as adapters toward rails. Switching from fiat to stablecoin to
offline credits does not change `TASK` or `CAPABILITY`.

Consequence: everything a rail needs to know travels in versioned economic
data structures (see `ECONOMIC_ARCHITECTURE.md` §4), and everything a rail
returns is normalized to a common settlement result. The protocol never
parses "blockchain", "account", or "card".

---

## 2. PaymentAdapter / SettlementAdapter (abstract role)

The adapter is a **role** with defined responsibilities, not a class or a
code interface. Each future rail materializes it in its own way; the
economic layer only requires the behavioral contract:

**Adapter responsibilities:**

- **Declare its rail**: identifier (`rail_id`, e.g. `fiat/manual`,
  `offline-credits/v1`), supported units, expected finality
  (instant / deferred / by confirmations), and whether it requires
  connectivity.
- **Prepare** a settlement instruction from a Policy Engine authorization:
  `{payment_id, amount (exact decimal string), unit,
  rail_id, beneficiary (rail-opaque format), minimal concept}`.
  The adapter does **not** decide whether the payment proceeds: it receives
  an already-decided authorization and executes or rejects it for technical
  impossibility.
- **Execute** the transfer exactly once per `payment_id`
  (idempotency at adapter level too: if the rail is not idempotent
  by itself, the adapter keeps the journal by `payment_id`).
- **Query status**: `pending / settled / failed`, with a rail reference
  for the receipt.
- **Refund** by `refund_id`, with the same idempotency guarantees.
- **Fail closed**: if the rail does not confirm, the state is `unknown`
  and the design treats it as **not settled** until proven otherwise.
  **[FROZEN PRINCIPLES]** An ambiguous settlement state is never
  presented as success. The ambiguity is recorded, the
  `payment_id` frozen (no blind retries), and escalated to a human.

**[FROZEN PRINCIPLES]** The adapter operates exclusively with the
**settlement profile** credentials bounded to the budget vault
(`ECONOMIC_POLICY_MODEL.md` §3). An adapter with access to funds outside
the vault is an invalid configuration: the economic layer must refuse to
operate with it (fail-closed in configuration, not just in execution).

**[PROVISIONAL]** Normalized settlement result data format
(DATA, not code):

```json
{
  "payment_id": "9f2c…",
  "rail_id": "offline-credits/v1",
  "status": "settled | pending | failed | unknown",
  "amount": { "amount": "0.40", "unit": "USD" },
  "rail_reference": "opaco-para-el-rail",
  "settled_at": 1790000000123
}
```

---

## 3. Future rails: survey without selection

**[FROZEN PRINCIPLES]** This document **does not select** any rail,
blockchain, currency, or provider. The following list is a survey of
conceptual candidates to validate that the abstraction covers all of them.
**None is implemented.**

| Candidate rail | Trust model | Finality | Requires network |
|---|---|---|---|
| Manual fiat (the user pays out of band) | human | manual | no (local record) |
| Banking / payments provider | regulated institution | deferred | yes |
| Stablecoin / crypto (no chain specified) | network + own keys | by confirmations | yes |
| Future own token (see §5) | to define if it exists | to define | to define |
| Bilateral offline credits | known counterparty + bounded cap | local immediate, global deferred | no |
| Unknown future rails | unknown | unknown | — |

**[PROVISIONAL]** Each rail declares its finality model and the economic
layer respects it: a rail with deferred finality cannot confirm a
`SETTLE` as definitive before its confirmation. The `unknown` state
exists precisely for rails that give no synchronous guarantees.

---

## 4. Verify-before-settle: surveyed modes, none universal

**[FROZEN PRINCIPLES]** `RESULT = WORK COMPLETED` is not assumed.
Settlement requires prior verification per the mode the **payer's policy**
accepts for that capability. Surveyed without adopting a universal
solution — each mode has a distinct, honest trust model:

1. **Deterministic verification.** The result is checkable by a pure
   function (expected-output hash, cryptographic proof, cheap re-execution).
   Strongest where it applies; rarely applies to creative or physical work.
2. **Buyer confirmation.** The payer (human or their NIDO with explicit
   policy) confirms satisfactory receipt. Simple and honest, but doesn't
   scale to autonomous micro-payments without fatigue.
3. **Mutual acknowledgement.** Both identities sign completion. Requires
   the executor to cooperate after being paid — operation order is
   critical: the completion signature must precede or accompany the
   `SETTLE`, never come after without a guarantee.
4. **Attestation.** The executor device attests it executed (e.g.
   signature over `{task_id, output_hash}`). **Weak by design**: attests
   execution, not correctness; a malicious executor attests falsehoods
   for free. Only useful combined with reputation or staking — both out
   of scope.
5. **Third-party verification.** An external verifier (another NIDO, a
   service) rules. Introduces a third party to trust and to pay: the
   verifier needs its own incentive model and its own verification.
   Potential infinite regress; use with explicit skepticism.
6. **Escrow / dispute.** Funds are held until verification or expiry with
   refund. **[OPEN QUESTIONS]** In a world without a central server, who
   is the escrow? The honest known forms are: (a) an explicit trusted third
   party (recentralizes), or (b) bilateral 2-of-2 lock with automatic
   refund timeout (doesn't resolve genuine disagreement, only
   abandonment). No escrow is designed without naming the custodian.

**[PROVISIONAL]** The offeror-declared `verification_method` is an
**offer**, not a requirement: the payer's policy chooses among the modes
it accepts, and if there is no intersection, there is no deal (`DECLINE`,
not silent degradation to a weaker mode).

---

## 5. Future optional token module: function evaluation, not tokenomics

**[FROZEN PRINCIPLES]** No tokenomics is designed in this research line.
Explicitly out of scope: supply, allocation, price, speculation,
fundraising, blockchain selection, smart contract design. If a token ever
exists, these decisions are taken then, with the user, from scratch.

The only thing evaluated here: **for which functions could an own token
have real utility?** Candidates (all **[EXPERIMENTAL]**, none adopted):

- **Micro-settlement**: agent-to-agent payments below the practical
  threshold of fiat rails (fees, latency). Real utility only if settlement
  cost is negligible against the amount.
- **Compute/resource exchange**: denominating and netting compute and
  storage exchange between NIDOs without touching fiat on every
  micro-transaction.
- **Relay/storage services**: paying third parties (relays, storage)
  for services to the agent network, if those services ever exist.
- **Machine-to-machine settlement**: frequent autonomous settlements
  where human friction (confirming each payment) is the bottleneck.
- **Ecosystem incentives**: rewarding verifiable contributions
  (test vectors, honest relays, datasets). Verifiability is the whole
  problem; without it, the incentive funds fraud.

**[FROZEN PRINCIPLES]** Token inequalities — valid whether or not a token
is adopted, today or in ten years:

- **TOKEN ≠ IDENTITY.** Holding tokens neither creates, proves, nor
  substitutes the NIDO identity.
- **TOKEN ≠ TRUST.** A high balance does not make a peer trustworthy.
- **TOKEN ≠ REPUTATION.** See the separate layer in `ECONOMIC_REDTEAM.md`
  §18.
- **TOKEN ≠ AUTHORITY.** Tokens grant no permissions, expand no
  capabilities, bypass no Policy Engine.
- **TOKEN ≠ PERMISSION.** Holding more tokens **never** grants additional
  access to private data or unauthorized capabilities.

Any future design violating one of these inequalities is not "the NIDO
economy": it is another system under another name.

**[PROVISIONAL]** Honest adoption criterion: an own token is only justified
if it solves a problem that existing rails + offline credits don't solve,
without introducing a de facto central authority (issuer, foundation
multisig, oracle). If the token needs a central operator to work, it adds
nothing over fiat and adds risk.

---

## 6. Deferred netting (experimental settlement pattern)

**[EXPERIMENTAL]** When two NIDOs trade repeatedly (compute back and
forth, pack-for-render exchanges), settling every micro-payment on an
external rail is friction without benefit. Netting: the bilateral credit
ledger (`ECONOMIC_POLICY_MODEL.md` §6.1) accumulates signed balance
movements; on a schedule, a threshold, or when connectivity returns, only
the **net** amount settles on the rail.

Rules:

- Every underlying movement is individually signed by both parties with
  its own `payment_id` (idempotency preserved end to end).
- The netting statement is a new signed document both parties
  countersign: `{netting_id, movement_ids[], net_amount, unit, rail_id}`.
- Settlement of the net is one `SETTLE` with one fresh `payment_id`
  referencing the `netting_id`.

**[FROZEN PRINCIPLES]** Netting never merges authorizations: each
underlying movement was individually authorized under policy. Netting is a
settlement optimization, not an authorization shortcut. Either party may
refuse to net and demand per-movement settlement instead — refusal is
always safe, only slower.

Disputes: disagreement on the net falls back to per-movement settlement;
the signed movements are the evidence. A party that stalls netting while
holding a favorable balance is recorded in the journal and feeds
contextual reputation (`ECONOMIC_REDTEAM.md` §18); stalling cannot steal,
only delay.

**[OPEN QUESTIONS]** Fair netting cadence and thresholds? Should the
netting statement itself be settleable on rails that support batch
transfers natively?

---

## Decision log

| # | Decision | Classification |
|---|---|---|
| 1.1 | The protocol never depends on a specific rail | FROZEN PRINCIPLES |
| 2.1 | Adapter as a role with responsibilities, not as code | PROVISIONAL |
| 2.2 | Ambiguous settlement state = not settled; frozen and escalated to human | FROZEN PRINCIPLES |
| 2.3 | Adapter only with vault-bounded credentials; otherwise fail-closed | FROZEN PRINCIPLES |
| 3.1 | No rail selected; survey only to validate the abstraction | FROZEN PRINCIPLES |
| 3.2 | Each rail declares its finality; the layer respects it | PROVISIONAL |
| 4.1 | `RESULT ≠ WORK COMPLETED`; prior verification required | FROZEN PRINCIPLES |
| 4.2 | No universal verification mode; the payer's policy chooses | FROZEN PRINCIPLES |
| 4.3 | Escrow without a named custodian is not designed | OPEN QUESTIONS |
| 5.1 | No tokenomics: no supply, allocation, price, speculation, fundraising | FROZEN PRINCIPLES |
| 5.2 | Candidate token functions evaluated as hypotheses | EXPERIMENTAL |
| 5.3 | TOKEN ≠ IDENTITY / TRUST / REPUTATION / AUTHORITY / PERMISSION | FROZEN PRINCIPLES |
| 5.4 | Adoption criterion: solve what fiat+credits don't, without centralizing | PROVISIONAL |
| 6.1 | Deferred netting: only the net settles; refusal always safe (per-movement fallback) | EXPERIMENTAL |
| 6.2 | Netting never merges authorizations; each movement individually authorized | FROZEN PRINCIPLES |

## Open questions (this document)

1. Who can be an escrow custodian in a network without a central server
   without recentralizing trust?
2. How is an unknown future rail's finality expressed in the adapter
   contract without breaking the abstraction?
3. For machine-to-machine micro-settlement, what friction threshold makes
   an own token beat periodically netted offline credits?
4. Should the `rail_reference` be verifiable by third parties (user audit
   on another device) without exposing rail data?
5. What netting cadence and thresholds are fair when one party benefits
   from delay?
