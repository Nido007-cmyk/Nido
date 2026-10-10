> **Language:** English · [Español](../../es/internal/economic/ECONOMIC_PRIVACY.md)

# NIDO Economic Layer — Economic Privacy

**Status:** RESEARCH / DESIGN ONLY. No implementation. Subordinate to
`../NIDO_PRINCIPLES.md` (§8: privacy negotiation, minimum disclosure) and
to `ECONOMIC_ARCHITECTURE.md` §4 (the `privacy_requirements` fields).

Decision labels: **[FROZEN PRINCIPLES]** · **[PROVISIONAL]** ·
**[EXPERIMENTAL]** · **[OPEN QUESTIONS]**.

---

## 1. What an agent economy can leak

Every economic interaction is an observation for the adversary. Honest
inventory of surfaces:

| Surface | What it leaks |
|---|---|
| **Quotes** | Demand ("need urgent GPU render"), willingness to pay, urgency (short TTL), request frequency. |
| **Purchase history** | Behavioral patterns, dependencies (who I buy compute from daily), activity hours. |
| **Timing** | Temporal correlation between tasks (this purchase follows that sensitive task), timezone, routine. |
| **Offered capabilities** | Device resources (GPU, free storage), services the user sells, and therefore hints about their business/life. |
| **Balances / caps** | Approximate wealth, vault size, limits (a `DECLINE` by limit tells how much you *can't* pay). |
| **Counterparties** | Economic relationship graph: who you trade with is almost as revealing as what you trade. |
| **Disputes and refunds** | Friction, dissatisfaction, claim patterns. |
| **Exact amounts** | Amount fingerprinting (0.40 USD at 03:12 is almost an identifier). |
| **Pack purchases** | Interests and needs: which knowledge packs a NIDO buys reveals what its user studies, plans, or treats (see `ECONOMIC_ARCHITECTURE.md` §10.1). |

**[FROZEN PRINCIPLES]** Economic privacy is designed with the same rigor
as data privacy: minimum disclosure by default, and every economic field
leaving the device must be justified as **necessary** for the specific
transaction, not as convenient.

---

## 2. Minimum economic disclosure

Projection rules (parallel to capability `minimum_disclosure`):

1. **A quote reveals only what belongs to that request.** No "price
   catalogs" in public discovery. A capability's price is delivered
   upon authenticated request, within policy, and only for the
   requested capability (already established in `ECONOMIC_ARCHITECTURE.md`
   §4).
2. **The requester does not announce their budget.** `REQUEST_QUOTE` does not
   include "I can pay up to X": that gives away the negotiation and leaks
   the cap. The offeror quotes blind to the buyer's budget.
3. **DECLINE reasons are uniform.** A `DECLINE` toward the peer does not
   distinguish "insufficient funds", "daily limit reached", "unauthorized
   peer", or "price too high". **[FROZEN PRINCIPLES]** Differentiating the
   reason leaks exactly the information the limit was trying to
   protect (limit oracle: the attacker binarizes your budget
   through quotes).
4. **Rounded amounts where possible.** Micro-amounts with arbitrary decimals
   are fingerprints. **[PROVISIONAL]** Adapters may round to the rail's
   economically sensible minimum unit, and quotes use discrete price ticks,
   not continuous ones.
5. **Local receipts by default.** The full receipt lives on the
   payer's device (and a minimal view on the receiver's: which
   capability, which amount, which `payment_id`). No third party sees them.
6. **Aggregation with calendar noise.** The sliding limit windows
   (`ECONOMIC_POLICY_MODEL.md` §2) already avoid exploitable calendar edges;
   additionally, purchase retries after a `DECLINE` must be spaced with
   jitter to prevent fine probing of the exact moment budget frees up.

---

## 3. Proving ability to pay without showing the balance

**[FROZEN PRINCIPLES]** A peer does not need to know the full balance
to know that an authorized operation can settle.

Conceptual design (no advanced cryptography):

- The payer NIDO issues a device-key-signed **capacity attestation**:
  `{payment_id, amount, unit, budget_scope, expires_at, signature}`. It
  asserts: "my Policy Engine authorized this payment and my vault covers
  it".
- The peer verifies it for what it is: a **signed promise from the payer**,
  not a mathematical proof of funds. Its real value is that it is
  **locally binding**: the payer's journal already reserved that amount,
  and the attestation is signed evidence in a dispute.
- On rails with atomic settlement (the rail verifies funds at settlement),
  the attestation is just a prior courtesy: the rail tells the truth.
  In bilateral offline credits, the attestation **is** the mechanism, and
  its risk is bounded by the pre-authorized bilateral cap
  (`ECONOMIC_POLICY_MODEL.md` §6.1).

**[OPEN QUESTIONS]** Zero-knowledge solvency proofs
("I can pay X without revealing my balance")? Conceptually desirable,
practically premature: they require a public balance commitment (which
leaks by itself), per-rail circuits, and complexity we cannot audit
today. Recorded as future research, not as a plan.

**[PROVISIONAL]** Settlement identity separation: the NIDO may use
rotating settlement identifiers per peer (within the same settlement
profile) so two counterparties cannot correlate its activity through a
stable identifier. This **is not** anonymity against the rail (the rail
sees what it sees) and **must not** be used to evade reputation
(see `ECONOMIC_REDTEAM.md` §18: rotating to evade negative history
is a Sybil-like attack and is treated as such).

---

## 4. Privacy requirements as capability fields

The economic descriptor's `privacy_requirements`
(`ECONOMIC_ARCHITECTURE.md` §4) are structured as (DATA):

| Field | Meaning |
|---|---|
| `input_data_needed` | Closed list of data categories execution requires. |
| `input_retention` | `until_result_delivered` / `hours:N` / `none_stored`. |
| `logging` | `no_input_content` / `hashes_only` / `full_debug` (the latter requires explicit ASK_USER). |
| `quote_visibility` | `private` (only upon request) / `contacts` / `public`. Default: `private`. |
| `result_linkability` | Whether the result can be correlated with the requester by a third party observing the rail. |

**[FROZEN PRINCIPLES]** `quote_visibility: public` is never the default and
requires an explicit, informed decision by the offering user: a public price
is a permanent, observable economic announcement.

**[PROVISIONAL]** An offeror may declare `input_retention: none_stored`
as a commitment; compliance is not remotely verifiable
by the buyer (it is a promise, not a proof). The design treats it as a
signal for the buyer's policy (e.g. "only buy from offerors with
`none_stored` for sensitive data"), not as a guarantee.

---

## 5. Aggregation and metadata leaks

- **Quote frequency as demand signal.** An offeror receiving 50
  `REQUEST_QUOTE`s per day from a NIDO learns its consumption pattern even
  if no purchase ever closes. **[PROVISIONAL]** Mitigation: local caching
  of recent quotes (don't re-ask what was already quoted within the TTL)
  and request batching when the plan allows it (group tasks ask
  in one go).
- **Task→payment correlation.** If every economic `TASK_REQUEST` is
  followed by an observable `SETTLE` on the same channel with similar
  timing, a transport observer correlates tasks with payments even if
  content is encrypted. **[PROVISIONAL]** Mitigation: decouple timing
  (jitter on `SETTLE`), and remember the transport only sees ciphertext
  (`TRANSPORT_ARCHITECTURE.md`): correlation is by metadata
  (size/timing), not content.
- **Counterparty graph.** **[FROZEN PRINCIPLES]** NIDO never publishes
  its counterparty history. Not in discovery, not in reputation (see
  redteam §18: reputation is contextual and requires no global
  public history).
- **Pack catalog exposure.** **[PROVISIONAL]** A pack's table of contents
  is itself sensitive (it advertises what the buyer wants). Pre-purchase
  sampling (`ECONOMIC_ARCHITECTURE.md` §10.1, open question 5) must be
  minimum-disclosure by construction: a verifiable random chunk preview
  reveals bounded content, never the full manifest to an unauthenticated
  observer.

---

## Decision log

| # | Decision | Classification |
|---|---|---|
| 1.1 | Economic privacy with the same rigor as data privacy | FROZEN PRINCIPLES |
| 2.1 | Quote only upon authenticated request; no public catalogs | FROZEN PRINCIPLES |
| 2.2 | `REQUEST_QUOTE` never announces budget | FROZEN PRINCIPLES |
| 2.3 | Uniform `DECLINE` reasons toward the peer (anti-limit-oracle) | FROZEN PRINCIPLES |
| 2.4 | Discrete price ticks; rounding where the rail allows | PROVISIONAL |
| 2.5 | Local receipts by default; minimal view for the counterparty | PROVISIONAL |
| 3.1 | Signed capacity attestation instead of visible balance | FROZEN PRINCIPLES |
| 3.2 | The attestation is a binding promise, not mathematical proof | PROVISIONAL |
| 3.3 | Solvency ZK: future research, not a plan | OPEN QUESTIONS |
| 3.4 | Rotating settlement identifiers per peer; not for evading reputation | PROVISIONAL |
| 4.1 | `quote_visibility: private` by default; `public` requires informed decision | FROZEN PRINCIPLES |
| 4.2 | `input_retention: none_stored` is a promise, not a verifiable guarantee | PROVISIONAL |
| 5.1 | Quote caching and batching against demand signaling | PROVISIONAL |
| 5.2 | Counterparty history never public | FROZEN PRINCIPLES |
| 5.3 | Pack purchases leak interests; pre-purchase sampling must be minimum-disclosure | PROVISIONAL |

## Open questions (this document)

1. What price-tick granularity balances privacy (anti-fingerprint)
   with economic utility (real competition among offerors)?
2. Can a capacity-attestation design evolve toward minimal-disclosure
   solvency proofs without a trusted setup?
3. How is an offeror's `input_retention: none_stored` compliance audited
   without inspecting their device (impossible by design)?
4. Is `SETTLE` jitter sufficient against task→payment correlation by
   a transport observer with full timing visibility?
5. What sampling mechanism proves a pack's usefulness without leaking
   its full contents or the buyer's interests?
