> **Language:** English · [Español](../es/release/UPDATE_AND_ROLLBACK.md)

# NIDO Update & Rollback — design

**Status:** design, NOT to be implemented yet.
**Principle:** an update is a code change on the user's device. It can
never be a silent change of **authority**.

---

## 1. Update surfaces

Each one versions and migrates separately; a change in one doesn't drag the
others along except by explicit declaration:

| Surface | What changes | Characteristic risk |
|---|---|---|
| App | binary, UI, logic | new permissions, new network |
| Protocol | `nido/x.y`, envelopes, state machines | incompatibility with old peers |
| Database | SQLCipher schema, migrations | data loss/corruption |
| Models | local weights (GGUF) | reasoning behavior, size, battery |
| Capabilities | catalog, schemas, `human_approval` | silent expansion of what's executable |
| Policy schema | policy rule format | old rules misinterpreted |
| Avatar format | personal avatar format | visual corruption (low risk, but versioned the same) |

### 1.1 Update security rule

> **FROZEN PRINCIPLE.** An update **never** silently expands: OS permissions
> · agent autonomy · data disclosure · spending authority · network access.
>
> Concretely: after updating, the effective allowed set of
> `(capability, peer, decision)` must be a **subset** of the previous one,
> absent new explicit user decisions. Any expansion requires explicit
> consent, presented as such ("this update wants new X"), never buried in
> "improvements".

This is INV-2 (AUTONOMY_NON_EXPANSION) applied to the product lifecycle: a
new capability defaults to DENY; a new capability version (`v2`) doesn't
inherit `v1`'s approval; a new schema field is not interpreted as a
permission.

### 1.2 Pre-update checklist (design)

Before applying an update, the updater verifies locally:

1. Valid package signature (when signing infrastructure exists).
2. Higher `versionCode` (no accidental downgrade).
3. Declared-permission diff (AndroidManifest) — if there are new
   permissions, they are presented to the user **before** installing, not
   after.
4. Capability diff: list of new capabilities or ones with relaxed
   `human_approval` → presented as "new pending decisions", in DENY until
   the user decides.
5. Encrypted backup of DB + identity **before** migrating (see §3).

---

## 2. Feature flags

### 2.1 Purpose and shape

**Local, versioned** flags to disable quickly without a new release:

- experimental capabilities
- specific transports (e.g. disabling relay if abused)
- problematic model integrations
- new agent behaviors

Shape (illustrative, not implementation):

```json
{
  "flags": {
    "transport.relay": { "state": "off", "since": "1.2.0", "reason": "abuse observed" },
    "capability.experimental.x": { "state": "deny", "since": "1.3.0" }
  },
  "version": 7
}
```

### 2.2 Hard rule

> **FROZEN PRINCIPLE.** A feature flag can **never** remotely grant more
> authority to the user. No update and no flag turn `DENY → ASK` or
> `ASK → AUTO` without the user's explicit consent. **AUTONOMY MUST NEVER
> GROW SILENTLY.**
>
> Flags may only **reduce** authority/capability (turn off, degrade to
> DENY, require ASK). The opposite direction requires a user policy
> decision on the device.

Corollaries:

- Flags are evaluated **after** the Policy Engine, never before: a flag
  cannot "pre-authorize" what policy would deny.
- A flag received over the network (if remote flags ever exist) is
  **UNTRUSTED DATA**: it can only turn off, never on. A remote flag
  attempting to turn on is ignored and logged as a security event.
- Flag state is visible to the user (what is off and why).

### 2.3 Classification

- **FROZEN:** flags' single direction (only reduce); evaluation after
  policy; remote flags = untrusted, turn-off-only.
- **PROVISIONAL:** the flag manifest format.
- **OPEN QUESTIONS:** (1) Should remote flags ever exist, or only local
  ones packaged with the release? (2) Who signs the flag manifest and how
  is it distributed without a central server?

---

## 3. Safe rollback

### 3.1 What must survive a rollback

Returning to the previous version **without**: breaking the DB · losing
the identity · corrupting memory · breaking pairings · causing crypto
downgrade.

### 3.2 Design

- **Migrations declared reversible or not.** Each DB migration carries a
  `reversible: true/false` field. If `false`, the release **explicitly
  declares** it in its notes ("from 1.4.0 there is no safe rollback to
  1.3.x") — silent one-way doors are prohibited.
- **Pre-migration backup:** before migrating, an encrypted snapshot of DB +
  identity + pairings. Rollback restores the snapshot; it doesn't attempt
  to "migrate backwards" business logic.
- **Identity separate from the app:** identity keys live in a
  Keystore/independently versioned store separate from the app schema; an
  app rollback never touches the identity store except for a declared
  migration of that store.
- **Pairings:** pairing secrets are kept outside the app DB or in a
  non-destructively-migrated table; rollback doesn't invalidate
  relationships unless the migration declares it.
- **Crypto downgrade:** rollback never restores cryptographic suites
  retired as insecure. If the previous version used a now-prohibited
  suite, rollback to that version is **blocked** with an explanation, not
  silently allowed. Going back in features ≠ going back in security.

### 3.3 Declared impossible downgrade

If after a certain migration a safe rollback isn't possible, it must be
explicitly declared **before** the user updates:

```
"This update migrates the identity format to v2.
 It will not be possible to return to 1.x without re-doing pairing.
 Continue? [See what changes] [Cancel]"
```

> **FROZEN PRINCIPLE.** No silent one-way migrations. The user decides with
> full information, or there is no migration.

---

## 4. Safe update per surface

- **Protocol:** version negotiation (AGENT_PROTOCOL.md §6); an old peer
  keeps speaking `nido/1.0` while local policy allows; deprecation with an
  announced sunset date, without auto-degrading security.
- **Database:** transactional migrations (all or nothing); post-migration
  integrity verification (`cipher_integrity_check`); on failure,
  restore the snapshot and report — never boot with a half-migrated DB.
- **Models:** weights are versioned by hash; a new model doesn't change
  policy, capabilities, or flags; the Model Router may A/B-test but
  **authority** doesn't change with the model (THE MODEL IS NOT NIDO).
- **Capabilities:** versioned catalog; new capability = DENY by default;
  a `human_approval: always → conditional` change is treated as an
  authority expansion → requires explicit consent.
- **Policy schema:** versioned; old-schema rules are interpreted with the
  old parser or migrated with user confirmation; never silently
  reinterpreted with new semantics.
- **Avatar format:** versioned; an unknown format doesn't break the app
  (silhouette fallback), never blocks functionality.

---

## 5. Decision classification

- **FROZEN PRINCIPLES:** (a) no update silently expands
  permissions/autonomy/disclosure/spend/network; (b) flags only reduce
  authority, never grant it, and are evaluated after policy; (c) no silent
  one-way migrations — declared beforehand; (d) rollback never restores
  crypto retired as insecure.
- **PROVISIONAL:** flag manifest format, migration fields (`reversible`),
  pre-update checklist contents.
- **EXPERIMENTAL:** automatic pre-migration backup with encrypted snapshot —
  the concrete mechanism (what gets snapshotted, where it lives, how long
  it's kept) is yet to be designed.
- **OPEN QUESTIONS:** (1) Package-signing infrastructure without a central
  server — project keys distributed with the initial app + declared
  rotation? (2) How is an update's "authority diff" presented without
  dialog fatigue — grouped by impact, expansions only? (3) Should the
  pre-migration snapshot be encrypted with a different key than the
  operational one?
