> **Language:** English · [Español](../es/architecture/ECONOMY_ARCHITECTURE.md)

# NIDO Economy Architecture — App-Level Specification

**Status:** SPECIFICATION ONLY (2026-09-27). Zero implementation. No balances,
no ledger code, no monetization, no payment integration, no token, no blockchain.
**Subordinated to:** `docs/NIDO_PRINCIPLES.md` (in case of conflict, principles win)
and the research line in `docs/economic/` (`ECONOMIC_ARCHITECTURE.md`,
`ECONOMIC_POLICY_MODEL.md`, `SETTLEMENT_ABSTRACTION.md`, `ECONOMIC_PRIVACY.md`,
`ECONOMIC_REDTEAM.md`).

**Decision labels** (same as the research docs):
- **[FROZEN PRINCIPLES]** — not negotiable without explicit user review.
- **[PROVISIONAL]** — current design choice, revisable with evidence.
- **[EXPERIMENTAL]** — hypothesis to validate; nothing downstream may assume it.
- **[OPEN QUESTIONS]** — undecided; registered for future research.

**Scope of this document:** the *product* economy inside the NIDO app —
currencies, rewards, sinks/sources, inventory, progression, limits — as a
user-facing design. The *protocol* economy (agent-to-agent settlement) is
specified in `docs/economic/`; this document must stay consistent with it.

---

## 1. What the economy is for

**[FROZEN PRINCIPLES]** The economy is an **optional layer**. NIDO works
completely without it: no capability, protocol flow, or policy decision may
depend on the economy existing. A NIDO with the economy disabled is a complete
NIDO, not a degraded one. **CAPABILITY IS THE ECONOMIC PRIMITIVE** — what can
ever be exchanged is the execution of versioned capabilities, never the user's
authority, data, or identity.

**[FROZEN PRINCIPLES]** USER = AUTHORITY applies to value exactly as to data.
The model may **propose**; the **Policy Engine decides** whether permitted;
the **user remains the authority**. No economic flow moves value without a
traceable policy decision or explicit user confirmation.

Product purpose (why an economy at all): give long-term progression, personalization
unlocks, and (later, optionally) agent-to-agent exchange a coherent, legible
frame — without ever becoming pay-to-function.

---

## 2. Currencies (spec)

**[PROVISIONAL]** Two-tier currency design, both **purely local** in this spec
(no network, no chain, no fiat rails — rails are future work per
`docs/economic/SETTLEMENT_ABSTRACTION.md`):

| Currency | Unit (prov.) | Nature | Earnable by | Spendable on |
|---|---|---|---|---|
| **Spark** (engagement) | `spark` | Soft, infinite-supply, non-transferable, per-device | using NIDO: completed tasks, routines, milestones | cosmetic/personalization unlocks, avatar layers, themes |
| **Core** (capability) | `core` | Hard, scarce, non-transferable, per-device | meaningful achievements, streaks, community challenges (future) | capability-adjacent perks: priority compute scheduling, extra local model slots, advanced features |

**[FROZEN PRINCIPLES]**
- Neither currency is purchasable with real money in this spec. No IAP, no ads,
  no paywalls on core function. Monetization is **out of scope** for this design.
- Neither currency leaves the device. No transfers, no trading, no export —
  until and unless a settlement rail is specified (future; separate decision).
- Balances are **not** identity and **not** reputation: they never appear in
  P2P discovery, never influence policy decisions, never gate capabilities.

**[OPEN QUESTIONS]** Final names/symbols; whether two tiers are needed or one
suffices; exchange rate (if any) between tiers — currently: none.

---

## 3. Sources (how value enters)

**[PROVISIONAL]** All sources are local, verifiable on-device, and idempotent
(each grant carries a unique id; re-granting the same id is a no-op):

| Source | Currency | Trigger (spec) | Notes |
|---|---|---|---|
| Task completion | spark | agent task reaches terminal `completed` state | amount scales with task effort class, not wall-clock |
| Routine streaks | spark | routine completes N consecutive scheduled runs | capped (see §6) |
| Milestones | spark + core | first-time achievements (first P2P pairing, first offline week, etc.) | one-time each, enumerated in a milestone registry |
| Daily engagement | spark | first meaningful interaction of the day | small, anti-grind cap |
| Knowledge contribution | spark | user adds personal documents / corpus entries | rewards curation, not volume |
| Community (future) | core | opt-in challenges | NOT in v1 scope |

**[FROZEN PRINCIPLES]** No source may reward: sharing private data, weakening
security posture, granting permissions, or keeping the app online. The economy
must never incentivize against the user's privacy or security.

---

## 4. Sinks (how value leaves)

**[PROVISIONAL]** All sinks are cosmetic, expressive, or convenience — never
functional gates:

| Sink | Currency | What it buys (spec) |
|---|---|---|
| Avatar layers/presets | spark | mantle styles, sprout variants, accessories, core glow colors (from the approved asset manifest) |
| Themes | spark | UI themes, accent palettes |
| Profile expression | spark | name plates, status flourishes (never identity signals) |
| Convenience | core | extra local model slots, priority inference scheduling, larger personal corpus quota |
| Gifting (future) | — | explicitly NOT in scope until settlement rails exist |

**[FROZEN PRINCIPLES]** No sink may purchase: capabilities, permissions,
policy exceptions, security downgrades, or visibility into another NIDO.
Spending is always user-initiated and explicit; the agent may suggest, never
spend autonomously (spending = side effect → needs policy decision or user
confirmation per `ECONOMIC_POLICY_MODEL.md`).

---

## 5. Inventory

**[PROVISIONAL]** Inventory = the set of owned, non-consumable entitlements:

```ts
// Spec sketch — not code.
interface InventoryItem {
  id: string;                 // e.g. "mantle.olive", "theme.midnight"
  kind: "avatar-layer" | "avatar-preset" | "theme" | "convenience" | "title";
  acquiredAt: string;         // ISO timestamp
  source: "purchase" | "milestone" | "reward" | "default";
  cost?: { currency: "spark" | "core"; amount: number };
  // Cosmetic items are pure data referencing the 3D asset manifest ids
  // (see docs/architecture/3D_INTEGRATION_CONTRACT.md §2.3).
  assetRef?: string;
}
interface Inventory { items: InventoryItem[]; schema: "nido.inventory/v1"; }
```

Rules:
- Inventory lives in the encrypted local store (same protection class as
  settings/memory — see `docs/architecture/DATA_MODEL.md`).
- Ownership is per-device, per-user; export/import only via the user's
  explicit backup flow (future), never automatic.
- Titles/achievements are display-only; they carry no privilege.

---

## 6. Progression

**[PROVISIONAL]** Progression is about the *relationship* with NIDO, not power:

- **Levels (spec):** a single, soft progression track (e.g. "Spark level")
  computed from lifetime spark earned. Purely expressive — unlocks cosmetics
  earlier, never capabilities.
- **Milestones:** enumerated registry (id, condition, one-time reward).
  Conditions reference local events only (tasks completed, streaks, features
  tried). The registry is data, editable without code changes.
- **No leaderboards, no social comparison, no competitive pressure** in v1
  scope. (Anything social is future work with its own privacy review.)

---

## 7. Limits and anti-abuse

**[PROVISIONAL]**

| Limit | Spec |
|---|---|
| Earning caps | per-source daily/weekly caps; global daily cap on spark |
| Idempotency | every grant has a unique id; double-grant impossible by construction |
| No farming | sources require genuine task completion (terminal states only); time-based sources have cooldowns |
| Balance bounds | balances are integers, ≥ 0, with a max cap (overflow → capped, logged) |
| Audit | every grant/spend is an append-only local ledger entry: `{ id, ts, kind, amount, reason, policyRef? }`. The ledger is inspectable by the user (Settings → Economy → History) and contains no chain-of-thought or private content |
| Tamper-evidence | ledger entries are hash-chained locally (spec; algorithm TBD, crypto-agile per principles) — casual DB editing is detectable, not silently accepted |

**[FROZEN PRINCIPLES]** The ledger is local-first and private. It is never
transmitted except at the user's explicit direction, and never to settle
anything until a rail exists and the user authorizes that rail.

---

## 8. UI surfaces (spec)

- **Settings → Economy** (future screen): balances, inventory, ledger history,
  earning rules explanation, and the master **economy on/off toggle**.
  Disabled = the entire layer is inert (no grants, no sinks, UI hidden).
- **Reward moments:** small, non-intrusive confirmations (a toast, never a
  modal) on milestone completion. Respects notification settings.
- **Shop/gallery (future):** cosmetic unlocks enumerated from data
  (asset manifest + theme registry), prices in spark/core, purchase =
  explicit user action → policy check → ledger entry → inventory update.
- All economy UI strings are i18n keys from day one
  (see `docs/architecture/I18N_ARCHITECTURE.md`).

---

## 9. Relationship to the research docs

| This spec | `docs/economic/*` |
|---|---|
| spark/core, inventory, progression, limits | the *product* surface |
| "no rails yet" | `SETTLEMENT_ABSTRACTION.md` defines how rails plug in later |
| user confirms / policy decides | `ECONOMIC_POLICY_MODEL.md` |
| ledger is local & private | `ECONOMIC_PRIVACY.md` |
| caps, idempotency, anti-farming | `ECONOMIC_REDTEAM.md` threat models |

If the protocol-level economy ever activates (agent-to-agent), it reuses the
same primitives (capability descriptors, payment ids, at-most-once settlement)
— the app-layer currencies above remain local-only unless a future, explicit
user decision bridges them.

## 10. Open questions (must be resolved before any implementation)

1. One currency or two? (Spark-only v1 is the simpler hypothesis.)
2. Exact earning amounts and caps — needs product judgment, not just spec.
3. Does `core` create unhealthy scarcity psychology? Consider removing.
4. Milestone registry contents (the actual achievement list).
5. Ledger hash-chain algorithm (crypto-agility: versioned from the start).
6. Whether the economy ships enabled-by-default or opt-in at first run.
7. Interaction with multi-device (balances are per-device in this spec —
   is that acceptable long-term?).
