# Spec — Clear All Data exact semantics (TD-1)

**Status:** SPECIFICATION ONLY. Do not implement until the pre-alpha corrections
lane reaches this block. This document defines the EXACT destroy semantics that
`resetAllAppData()` (and its tests, and its confirmation UI) must satisfy.
Anything not listed here is out of scope; anything listed here must be
verified destroyed or the wipe is a failure.

**Why this exists:** PRE_ALPHA_PLAN.md requires the semantics to be defined
*before* implementation. Clear All Data is the user's last-resort privacy
guarantee ("nobody can recover my data from this device") and it also destroys
the NIDO identity — both halves must be exact.

Related: `docs/specs/NETWORK_AUDIT_SCREEN.md` (network audit log must be
included in this wipe), `docs/NIDO_PRINCIPLES.md` §8 (identity portability,
personal data vault), `docs/qa/RELEASE_VERIFICATION_PROTOCOL.md` (G3 covers
this on device).

---

## 1. What the current implementation destroys today (code review, 2026-09-27)

`src/services/appReset.ts` → `resetAllAppData()`. Verified by reading the code,
not by running it:

| # | Store | Path / key | What dies | Mechanism |
|---|---|---|---|---|
| 1 | Knowledge DB | `<docs>/SQLite/aoair_knowledge.db` + sidecars `-wal`, `-shm`, `-journal`, `.migtmp`, `.sqlcipher` marker | chat history, corpus chunks, collections, execution telemetry | `resetDatabase()` closes + deletes file, sidecars, marker |
| 2 | Memory DB | `<docs>/SQLite/nido_memory.db` + same sidecar set | agent memory (facts, preferences, people, daily log, notes, reminders) **and** the P2P tables (identity, paired contacts, inbox, outbox) | `clearMemoryDb()` closes + deletes file, sidecars, marker |
| 3 | SQLCipher DEK | Keystore alias `nido_db_key` (Android Keystore via SecureStore) | the single data-encryption key shared by both databases | `deleteDatabaseKey()`; in-memory key cache reset so the next open generates a fresh key |
| 4 | P2P identity key | Keystore alias `nido_p2p_sk` | X25519 private identity key | `deleteP2PPrivateKey()` |
| 5 | P2P signing key | Keystore alias `nido_p2p_sign_sk` | Ed25519 signing key | `deleteP2PSigningKey()` |
| 6 | Models | `<docs>/models/` | downloaded GGUF weights | recursive directory delete |
| 7 | Corpus packs | `<docs>/corpus/` | knowledge packs | recursive directory delete |
| 8 | Eval results | `<docs>/eval/` | device eval result files | recursive directory delete |
| 9 | Cache | `<cache>/` | transient exports | recursive directory delete |
| 10 | Settings | `<docs>/settings.json` | model selection, memory settings, language preference | `clearSettings()` (file delete) |
| 11 | Download state | in-memory only | in-progress download bookkeeping | `resetDownloadState()` |
| 12 | Native contexts | in-memory | mmap'd model handles | `llamaEngine.unload()`, `embeddingEngine.unload()`, `closeAllPacks()` — run FIRST so no live handle recreates files mid-wipe |

**Failure semantics today (good, keep):** post-wipe verification of every path
plus Keystore peeks; any survivor (or any unverifiable path) throws
`WipeVerificationError` listing survivors — never a silent partial wipe.

### Gaps in the current implementation (must be closed to meet this spec)

1. **Network audit log is not wiped.** `networkAudit` keeps entries in memory and
   `resetAllAppData()` never calls `networkAudit.clear()`. Today the log dies
   with the process, so the *effect* is a wipe — but NETWORK_AUDIT_SCREEN.md
   requires the log to be **persisted in the SQLCipher DB** (500-event ring
   buffer). The moment that persistence lands, this wipe MUST cover it:
   `networkAudit.clear()` + DB deletion must both happen. The spec below
   defines it as destroyed either way.
2. **Confirmation UI understates the consequences.** The current danger modal
   (`modelSetupScreen.dangerModal`) lists models, embeddings and chat history —
   it does **not** name the P2P identity destruction, the agent memory loss
   (facts, preferences, people), or that pairings on other devices break. §5
   requires the full itemized list.
3. **No inventory for future stores.** Voice models (`VOICE_ONDEVICE_SPIKE.md`),
   migration bundles (§8 portability) and any new persisted store must be added
   to the inventory table in §3 *before* they ship, or the wipe silently misses
   them. §3 ends with a registration rule.

---

## 2. Complete destruction inventory (REQUIRED semantics)

The wipe MUST destroy all of the following. The table is normative: a store
not in this table is not covered; a store in this table that survives is a
wipe failure.

| Store | Location | Contents destroyed | Destroy mechanism |
|---|---|---|---|
| Knowledge DB | `<docs>/SQLite/aoair_knowledge.db` + `-wal`, `-shm`, `-journal`, `.migtmp`, `.sqlcipher` | all chat sessions, messages, summaries, corpus chunks, collections, execution telemetry | close connection, delete file + sidecars + marker |
| Memory DB | `<docs>/SQLite/nido_memory.db` + same sidecar set | agent memory (facts, preferences, people, daily log, notes, reminders), P2P identity table, paired contacts, inbox, outbox | close connection, delete file + sidecars + marker |
| SQLCipher DEK | Keystore `nido_db_key` | data-encryption key for both DBs | Keystore delete + in-memory key cache reset |
| P2P identity key | Keystore `nido_p2p_sk` | X25519 private key | Keystore delete |
| P2P signing key | Keystore `nido_p2p_sign_sk` | Ed25519 private key | Keystore delete |
| Network audit log | persisted ring buffer (in DB per spec) + `networkAudit` in-memory entries | all network events (download history) | `networkAudit.clear()` + DB deletion above |
| Downloaded models | `<docs>/models/` | all GGUF weights, partial `.part` downloads | recursive directory delete |
| Corpus packs | `<docs>/corpus/` | knowledge packs | recursive directory delete |
| Eval results | `<docs>/eval/` | device eval files | recursive directory delete |
| Cache | `<cache>/` | transient exports | recursive directory delete |
| Settings | `<docs>/settings.json` | model selection, memory settings, language preference | file delete |
| In-memory state | process memory | download bookkeeping, native model contexts, DB key cache | unload contexts, reset caches, close packs |

**Registration rule:** any new persisted store (new directory, new DB, new
Keystore alias, new SecureStore entry) MUST be added to this table in the same
change that introduces it. A store added without a table entry is a spec
violation, caught in code review.

### Explicitly NOT destroyed (and why)

| Item | Why not |
|---|---|
| The app binary / APK itself | Clear All Data is a *data* wipe, not an uninstall. The user keeps the app and re-runs setup. |
| The app's private directory skeleton | Android owns the sandbox; we empty it, we don't remove the sandbox. |
| OS-level backups | There are none to destroy: the build sets `allowBackup=false` (verified in static analysis), so app data never enters Google/cloud backup. If this flag ever changes, this row must be revisited. |
| Data on paired devices | We cannot reach another person's device. Their copy of *your public key* and *messages you sent them* survives — see §4. |
| The network audit *spec* | The definition of the log survives; only its recorded events are destroyed. |

---

## 3. Identity consequences (what "destroying the NIDO identity" means)

Per `NIDO_PRINCIPLES.md` §8, the identity is IDENTITY · MEMORY · POLICY —
portable across devices, with no central backdoor. Clear All Data is the
deliberate, local, irreversible end of *this device's* identity. The user must
understand all of the following before confirming:

1. **The identity is gone, not suspended.** `nido_p2p_sk` / `nido_p2p_sign_sk`
   and the `p2p_identity` table are destroyed. There is no recovery: NIDO has
   no account, no server, no backup of the private keys (by design).
2. **Pairings break silently on the other side.** Paired contacts keep *your old
   public key* and the messages you exchanged. After re-setup you are a **new
   stranger** to them: same human, new cryptographic identity. There is no
   revocation message — NIDO is offline-first and must not phone home to
   announce the wipe.
3. **Memory is gone, not archived.** Facts, preferences, people, daily log,
   notes, reminders — the personal data vault (§8) is emptied. The model never
   owned it and neither does anyone else; there is no copy anywhere.
4. **Re-setup starts from zero.** Downloaded models (~1 GB+) must be
   re-downloaded; the setup wizard runs again; language preference is forgotten.
5. **What survives on purpose:** nothing on this device. On other devices:
   your old public key and messages you sent (their data, their device).

The confirmation UI (§5) must state points 1–4 in plain language. "Delete my
data" must never be presented as "log out" or "switch account" — there is no
account to log out of.

---

## 4. Ordering constraints (normative)

1. Native inference contexts unload FIRST (a live mmap'd handle must never see
   its file deleted underneath it).
2. Downloads stop and download state resets before the `models/` delete.
3. Databases close and are deleted BEFORE their Keystore keys (no open handle
   may recreate or re-read a DB mid-wipe).
4. Keystore deletes happen before the final verification pass.
5. Verification runs LAST and covers every table entry in §2.

---

## 5. Confirmation UX requirements

- **No accidental trigger.** The control lives in a clearly-marked danger area
  (today: Settings → Model setup → Danger Zone). It must never be adjacent to
  benign actions, never trigger on a single casual tap.
- **Two explicit steps minimum:** (1) open the confirmation explaining
  consequences; (2) a deliberate confirm action (button press) that is disabled
  while a wipe is in progress. Typed confirmation ("type DELETE") is
  RECOMMENDED for the final implementation given identity destruction is
  irreversible.
- **Itemized consequences, in plain English (i18n from day one):** the dialog
  MUST name, at minimum: downloaded AI models (will need re-download),
  knowledge & embeddings, chat history, agent memory (facts, preferences,
  people, notes), **P2P identity and all pairings** (contacts will see you as
  a new stranger), network activity log, settings. The current modal's three
  bullets are insufficient.
- **During the wipe:** progress indication, cancel/close disabled, no
  backgrounding the operation.
- **After the wipe:** an explicit result screen. Success → "All data deleted"
  + the app returns to the setup wizard. Failure → the survivor list, in plain
  language, with a retry action. **The app must never show success when
  verification failed, and must never proceed to the setup wizard as if clean
  when survivors remain.**

---

## 6. Partial failure (fail-closed)

- Any exception during the destroy phase OR any survivor in the verification
  phase = wipe FAILED. Throw / surface `WipeVerificationError` (or its
  successor) with the survivor list.
- **Never claim a wipe that didn't complete.** No success toast, no wizard
  redirect, no "your data is deleted" copy while survivors exist.
- The UI reports *what survived* (paths/keys in user-comprehensible terms)
  and offers retry. Retry re-runs the full wipe, not just the survivors.
- Logging of the failure must not itself leak user data: log store names and
  counts, never content.

---

## 7. Verification criteria (how a test proves nothing survived)

A wipe is VERIFIED only when all of the following hold, checked after
`resetAllAppData()` resolves:

1. **File absence (byte-level):** for every path in §2, `getInfoAsync(path)`
   reports `exists == false` — including every sidecar suffix
   (`""`, `-wal`, `-shm`, `-journal`, `.migtmp`, `.sqlcipher`) for both DBs.
2. **Key inaccessibility:** Keystore reads for `nido_db_key`, `nido_p2p_sk`,
   `nido_p2p_sign_sk` return null/absent.
3. **DB unopenable:** attempting to open either database with any key fails
   (file gone; and even a planted copy would fail without the DEK).
4. **Audit log empty:** `networkAudit.list()` is empty AND the persisted ring
   buffer (when implemented) contains zero events.
5. **Re-setup gate:** the app's required-models check fails and the setup
   wizard is the only reachable surface.

**Test levels:**
- *Unit:* mocked filesystem + mocked SecureStore; assert every §2 inventory
  entry is touched by the wipe and absent afterwards; inject one survivor and
  assert `WipeVerificationError` names it. (Extends `src/services/appReset.test.ts`.)
- *Device (G3):* run the wipe on the physical tablet, then verify 1–5 via
  `run-as` file listing and Keystore inspection; preserve evidence per
  `docs/qa/RELEASE_VERIFICATION_PROTOCOL.md`.

---

## 8. Open questions

1. **Secure deletion depth:** file delete on flash storage does not overwrite
   bytes; wear-leveling may retain recoverable copies. Is `unlink` sufficient
   for the threat model, or do we need SQLCipher-level mitigations (e.g.
   `PRAGMA secure_delete`, key destruction as the primary guarantee)? Note the
   DEK is destroyed, so DB *content* is cryptographically unrecoverable even if
   blocks persist — document whether this argument covers every store.
2. **WAL checkpoint before delete:** should the wipe force a WAL checkpoint
   before deleting DB files, to avoid leaving recoverable frames in `-wal`?
   (Current code deletes the `-wal` file itself; confirm this is sufficient.)
3. **Identity export before wipe:** §8 wants identity portability (device
   migration). Should the confirmation flow *offer* an encrypted identity
   export before destroying — or is that a separate feature that must not
   complicate the wipe? Undecided; do not block the wipe on it.
4. **Multi-device coordination:** when the wiped device is one of several, is
   there any local-only signal (e.g. via P2P at next contact) worth sending,
   or is silent break the correct offline-first behavior? Currently: silent.
5. **Voice models:** when `VOICE_ONDEVICE_SPIKE.md` ships, its model directory
   must be registered in §2 in the same change.
6. **Biometric/lock state:** if a lock flag or biometric enrollment binding is
   ever persisted, register it in §2 (Keystore aliases and/or settings keys).
7. **Language of the survivor report:** survivor paths are technical; define
   the user-facing wording per store (i18n keys) when implementing §5.
