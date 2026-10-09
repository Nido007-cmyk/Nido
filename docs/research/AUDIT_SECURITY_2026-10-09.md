# NIDO — Security audit 2026-10-09 (Worker 3)

> **Scope:** P2P handshake (`src/p2p/`), task delegation
> (`src/agent/delegation/`), SQLCipher key management
> (`src/privacy/keyManager.ts`, `src/security/secureDatabase.ts`,
> `src/security/backup.ts`), intent/deep-link handling, WebView usage,
> exported Android components.
> **Method:** read-only source review against the documented threat models
> (`docs/HANDSHAKE_THREAT_MODEL.md`, `docs/CRYPTO_ARCHITECTURE.md`,
> `docs/security/AUDITS_2026-10.md`). No code modified. No physical-device
> testing (Tab A9+ gate pending); findings are graded by code evidence.
> This report describes threats and mitigations at the design level only.

## 0. Executive summary

The audited security architecture is unusually disciplined for an app of
this stage: fail-closed defaults are pervasive, the handshake threat model
is honest about its limits, and the code reviewed matches the documented
design (R4 HELLO v3 + CONFIRM v1, HKDF-SHA512 KDF, QR-pinned Ed25519
signatures, persistent atomic nonce claims, Keystore-held DEK with
fail-closed loss handling). No critical issues found.

**Verified issues (code evidence): 4** — 2 medium (delegation caveat limits
unenforced; no inbound executed-task replay tracking), 2 low (TASK_CANCEL
can't abort a running executor; approval-gate liveness check silently
skipped when the state provider is unwired).
**Design/theoretical gaps: 2** — no DEK rotation; provisional ±600 s HELLO
timestamp window (already flagged as provisional in the docs).
**Verified clean:** MITM/downgrade/replay on the handshake, key generation
and storage, key material in logs/backups/errors, deep links, WebViews,
exported components, peer-memory injection (mitigated by allowlist).

## 1. Threat model used for grading

- **Network attacker (Dolev-Yao):** controls the Bluetooth RFCOMM channel
  (eavesdrop, intercept, modify, inject, replay). Has NOT compromised either
  phone. This is the documented P2P adversary.
- **Malicious paired peer:** a human whose NIDO was legitimately paired via
  QR but who (or whose device) now misbehaves. In scope for the
  negotiation/delegation layer; out of scope for the transport layer (a
  compromised endpoint reads what it legitimately receives — the docs state
  this honestly).
- **Local attacker:** has the unlocked device (or a backup + DEK). The docs
  correctly scope this as "rooted device with the app unlocked = game over";
  the audit checks that nothing makes this easier than it should be.
- **Malicious app on the same device:** covered by the exported-component
  and intent review.

Severity here means: what the attacker gains, assuming the stated
capabilities — not worst-case imagination.

---

## 2. Area (a) — P2P handshake

### Verified: code matches the threat model

I traced the full R4 path (`nativeTransport.ts` `handleHello` →
`handleConfirm` → `establishRoute`; `messenger.ts` `completeHandshake`;
`crypto.ts` `deriveSessionKeyV2`; `store.ts` `claimHelloNonce`):

| Threat-model claim | Code evidence | Verdict |
|---|---|---|
| MITM can't substitute the ephemeral | HELLO sig = Ed25519 over `nido-hello-v3\|pk\|eph\|nonce\|ts`, verified against the QR-pinned `spk` (`contact.sigPkHex`); `pk` must be a paired contact | **Holds** |
| Replay of HELLO rejected | Atomic single-`INSERT` into persistent `hello_nonce_cache`; UNIQUE conflict = replay, fail-closed, *before* CONFIRM is sent or state mutates | **Holds** |
| HELLO alone never moves the route | `handleHello` only sends CONFIRM; `pkToMac`/`macToPk` mutate only in `establishRoute`, called solely from `handleConfirm` after sig + nonce-binding checks | **Holds** |
| Reflection (own CONFIRM bounced back) | `confirm.pk !== pend.peerPk` rejects; `cn`/`pn` must cite both live nonces | **Holds** |
| Downgrade to v1/v2 | `parseHello` hard-cuts (`v !== 3` throws); `parseConfirm` hard-cuts (`v !== 1` throws). No cipher/KDF agility to downgrade | **Holds** |
| KDF = HKDF-SHA512 | `deriveSessionKeyV2`: Extract salt `nido-session-v2`, Expand info `nido-session-key-v1`, 32 B — matches `CRYPTO_ARCHITECTURE.md` exactly; HMAC-SHA512 verified against RFC 4231 vectors in `crypto.test.ts` | **Holds** |
| Forward secrecy / ephemeral hygiene | `deriveSessionKeyV2` zeroes the caller's ephemeral secret after DH; R7 zeroes `pend.myEphSecret` on *every* handshake exit (timeout, bad sig, mid-handshake disconnect). `deleteIdentity()` also clears the nonce cache on rotation | **Holds** |
| PRNG on device | `installSecurePrng()`: WebCrypto → `expo-crypto` native via direct `require` (Metro/Hermes-safe); no fallback to weak randomness — fail-closed | **Holds** |
| Insecure RFCOMM | `createInsecureRfcommSocketToServiceRecord` — deliberate, documented ("NIDO provides the security, not the OS"); consistent with the Dolev-Yao model | **By design** |
| Simultaneous dial | Canonical `tieBreakKey` (min‖max nonce), both sides converge deterministically | **Holds** |

### F-P2P-1 — Anti-spam cooldown burns a nonce-cache row per rejected HELLO · **Low** · verified

In `handleHello`, the `HANDSHAKE_COOLDOWN_MS` anti-spam rejection happens
*after* the atomic nonce claim. Each duplicate HELLO from a live peer burns
one persistent cache row (pruned after `NONCE_CACHE_WINDOW_S` = 3600 s).
**Threat:** availability nuisance only; no authentication impact.
**Exploitation difficulty:** requires a paired peer (or stolen signing key)
generating valid HELLOs at volume; effect is bounded DB growth.
**Mitigation:** move the cooldown check before the claim (it only needs
`pkToMac`/`lastHandshakeAt`, no DB), or keep as-is — the prune window caps
it. Not urgent.

### F-P2P-2 — ±600 s HELLO timestamp window is provisional · **Low** · theoretical

`HELLO_TS_SKEW_S = 600` is marked provisional in both code and docs,
pending real-device clock testing. A wrong-clocked peer can widen the
replay window, but the persistent nonce cache + CONFIRM liveness gate make
stale HELLOs non-exploitable regardless of `ts`.
**Threat:** none independently exploitable today.
**Mitigation:** keep the provisional flag; validate against wrong-clock
devices at the physical gate; consider shrinking to 300 s once device
evidence exists. No action before then.

### Notes (not findings)

- `SessionManager.createSession` builds session IDs with `Math.random()`.
  **Dead code:** zero production callers (verified by grep) — hygiene note
  only. If it is ever wired in, switch to `nacl.randomBytes`.
- `claimHelloNonce` detects the UNIQUE conflict via regex on the driver
  error message (`/unique|primary/i`). A driver that rewords the error
  fails *closed* (handshake rejected, safe direction) at the cost of
  availability. Acceptable; consider matching on SQLite error codes if the
  driver exposes them.
- The prebuilt `android/` directory is stale (it doesn't even contain
  `NidoP2PService`); the module manifests are the source of truth for the
  manifest review below.

---

## 3. Area (b) — Task delegation

Reviewed: `delegationToken.ts` (Biscuit-style Ed25519 chain),
`taskProtocol.ts` (validation + limits), `approvalGate.ts` (anti-loopjacking
human gate), `delegationService.ts` (wiring), `executor.ts` (sandboxed
execution). The flag `delegation.enabled` defaults OFF and is double-gated
(`messenger.ts` `handleFrame` + `handleTaskMessage`). The design is
careful; the issues below are gaps between documented intent and wiring.

### F-DELEG-1 — Token caveat limits (`maxToolCalls`, `resultSizeLimit`) are computed but never enforced · **Medium** · verified

**Threat model:** a malicious or compromised paired peer (NIDO-A) issues a
delegation token; NIDO-B's owner narrows it via `attenuateToken`
(e.g. `maxToolCalls: 2`) before approving — or NIDO-A itself issues a
narrow token — expecting the executor to honor the tighter bound.
**What the code does:** `verifyDelegationToken` correctly folds caveats
into `effective: { maxToolCalls, resultSizeLimit, notBefore }` — but
`handleTaskRequest` drops `verified.effective` (only `scopes` and
`maxDurationMs` enter `inboundIndex`), and `approveTask` constructs
`DelegatedExecutor` without `maxToolCalls`/`resultSizeLimit`. The executor
then falls back to its defaults (10 calls, 8 KB result).
**Impact:** the attenuation mechanism is security theater until wired: an
issuer-narrowed limit is silently ignored, and the executor runs with
looser bounds than the token authorizes. (`notBefore` *is* enforced at
verify time; only the two quantitative caveats are dropped.)
**Exploitation difficulty:** trivial/automatic — any token carrying
narrowing caveats exercises the gap; no attacker skill needed.
**Mitigation:** persist `verified.effective` in `inboundIndex` at
`handleTaskRequest` time and pass `maxToolCalls`/`resultSizeLimit` into the
`DelegatedExecutor` constructor. Add a regression test: caveat
`maxToolCalls: 2` → executor stops at 2.

### F-DELEG-2 — No inbound executed-task replay tracking; `sessionTag` binding unwired · **Medium** · verified

**Threat model:** network attacker who captured a TASK_REQUEST (requires
breaking the session encryption — hard), or more realistically a malicious
paired peer replaying its own legitimately-issued request.
**What the code does:** a valid token (15-min lifetime) replayed as a
second TASK_REQUEST with the same `taskId` passes token verification
again. `ApprovalGate` dedupes only *pending* taskIds (`byTaskId` entry is
removed on approve/deny/timeout), so after the first task completes, the
replay produces a **second approval card** for the same task. Execution is
still human-gated (no silent double-run), but the owner can be confused
into approving twice, and a compromised peer gets replay-amplification for
free. Separately, the `sessionTag` anti-cross-session-replay binding is
dead in the real path: `handleTaskRequest` never passes
`expectedSessionTag`, so a session-bound token always fails verification
(fail-closed, but the protection is unusable).
**Exploitation difficulty:** moderate — needs a valid token within its
window (a peer can legitimately mint one) plus a second delivery.
**Mitigation:** keep an executed-`taskId` set with TTL =
`TASK_LIMITS.tokenLifetimeMs` and reject replays fail-closed; wire the
live transport `ackSessionTag` into `handleTaskRequest` so bound tokens
verify instead of failing.

### F-DELEG-3 — TASK_CANCEL can't abort a running executor · **Low** · verified

Once `gate.approve()` returns the frozen task bytes, `executor.execute()`
runs to completion (or the 120 s watchdog). A TASK_CANCEL arriving
mid-execution finds no `inboundIndex` entry (already deleted at approve)
and is ignored; TASK_RESULT is still sent. The R5 TOCTOU close covers the
card-dwell window but not execution.
**Threat:** a peer cancels but the task still runs — advisory cancellation
only. Impact is bounded by the watchdog and the human already approved.
**Exploitation difficulty:** low value to an attacker; mainly a correctness
gap.
**Mitigation:** cooperative cancellation token threaded through
`DelegatedExecutor` (check between model call and result send); on cancel,
send TASK_REJECT instead of TASK_RESULT.

### F-DELEG-4 — R5 liveness re-check skipped when the state provider is unwired · **Low** · verified

`ApprovalGate.approve()` re-checks negotiation state only `if
(this.stateProvider)`. A gate instantiated without `setNegotiationState-
Provider()` silently skips the TOCTOU close. Production wires it in
`NidoScreen.tsx`, but the gate's contract is fail-*open* by default.
**Threat:** a future caller using a bare `ApprovalGate` loses the
cancel-during-approval protection without any warning.
**Mitigation:** fail-closed default — deny when the provider is unset —
or wire the provider in `DelegationService`'s constructor instead of the UI
layer.

### Verified mitigations (no finding)

- **Peer memory injection:** `task:remember` writes peer text into the
  memory DB, but `getOwnerFacts()` uses an explicit allowlist
  (`source IN ('user','inferred')`) — peer facts never enter owner context.
  The code comment names the exact attack (persistent prompt injection).
  **Holds.**
- **Scope firewall:** executor only implements the 3 v1 scopes; unknown
  scopes rejected at construction; unknown P2P scopes → DENY in
  `evaluateProposalScopes`. **Holds.**
- **Anti-loopjacking:** deep snapshot + hash integrity check + single
  consume + timeout-deny in `ApprovalGate`. **Holds** as designed.
- **Prompt-injection framing:** honestly documented as cost-raising, not a
  boundary; structural controls carry the guarantee. **Correct posture.**
- **Outbound path:** `requestTask` requires an ACCEPTED negotiation,
  paired-contact signing key, and valid token issuance — all fail-closed.
  **Holds.**

---

## 4. Area (c) — SQLCipher key management

### Verified: generation, storage, and loss handling are sound

- **Generation:** 32-byte CSPRNG via `expo-crypto` (`randomHex32Async`);
  never derived from PIN/UUID/identity. **Holds.**
- **Storage:** DEK + both P2P private keys (box + Ed25519 signing) in
  `expo-secure-store` (Android Keystore-backed) under distinct aliases
  (`nido_db_key`, `nido_p2p_sk`, `nido_p2p_sign_sk`). Private keys never
  touch the database (`p2p_identity.sk_hex` is written empty by design).
  **Holds.**
- **Fail-closed reads (M-1/M-2):** a read *failure* throws
  `SecureStoreReadError` — it is never misread as "absent", so a transient
  glitch can never trigger silent key regeneration/overwrite. Corrupt
  values also throw. **Holds.**
- **Key-loss (N4):** if managed DBs exist but the DEK is gone, `KeyLossError`
  (explicit recovery state) is thrown instead of silently minting a new DEK
  that would strand the data. Recovery (`recoverFromKeyLoss`) requires
  explicit user confirmation and archives rather than deletes. **Holds.**
- **Migration:** plaintext→SQLCipher via `sqlcipher_export` into a temp
  file, verified (open with key + `integrity_check` + schema/count
  fingerprint) *before* the atomic rename; interrupted migrations recover
  idempotently and never promote an unverified temp. **Holds.**
- **Key material in logs/backups/errors:** no DEK/private-key logging
  found (error paths carry only alias + diagnostic branch tags, by explicit
  design). Backup copies the *encrypted* DB file + manifest; the DEK is
  exported only via `exportDatabaseKey()` for the user to store separately.
  `allowBackup=false` + data-extraction rules exclude all domains from
  cloud backup and device transfer. **Holds.**

### F-KEY-1 — No DEK rotation · **Medium** · design gap (theoretical)

**Threat model:** local attacker (or anyone who obtains a backup *and* its
separately-stored DEK, e.g. both in Downloads) — or a Keystore compromise.
**What exists:** `deleteDatabaseKey()` is only called on Clear All Data.
There is no rotation: the same DEK encrypts the live DB and every backup
ever made under it, indefinitely.
**Impact:** a DEK compromise is retroactive and permanent — all past
backups become readable, and there is no way to re-secure the data without
wiping. No forward secrecy for data at rest.
**Exploitation difficulty:** requires obtaining the DEK (Keystore
extraction on a rooted device, or the user's exported key) — high bar, but
the *consequence* is total and irreversible.
**Mitigation:** implement rotation: generate new DEK → `PRAGMA rekey` on
live DBs → update Keystore → mark old backups as compromised (they can't
be re-encrypted). Document that old backups remain readable by the old key
— rotation bounds *future* exposure only.

### F-KEY-2 — DEK shown as raw hex in a UI alert · **Low** · verified, by design

`BackupScreen`/`backupShare` display `exportDatabaseKey()` output in an
alert for manual copy. Shoulder-surfing and clipboard sniffing are the
residual risks; the design consciously puts key custody on the user ("sin
la clave, el backup es inútil").
**Mitigation (guidance, not a bug):** if batch #3 writes the key to a file
in Downloads, keep it a *separate* file from the backup DB, name it
unambiguously, and warn in-UI never to store/transmit both together. Never
log or include it in diagnostics.

### Notes (not findings)

- The DEK is **not biometric-bound** (SecureStore default options, no
  `requireAuthentication`): it is available whenever the device is
  unlocked. This matches the documented threat model (unlocked + rooted =
  game over) and avoids biometric-bricking UX failure modes. Conscious
  trade-off; revisit only if the threat model changes.
- `peekDatabaseKey()` (non-generating read for post-wipe verification)
  correctly throws on read failure instead of returning a false null.
  Good.

---

## 5. Area (d) — Intent / deep-link handling

**No inbound deep-link surface exists.** Findings, all verified:

- `app.json` declares **no `scheme`** and no `intentFilters`; the generated
  manifest has **no `<data>` intent filters** — nothing outside the app can
  route a URL into it.
- No `Linking.addEventListener` / `getInitialURL` inbound handling in
  `src/`.
- **Outbound** URL opening (`Linking.openURL`) goes through
  `src/agent/tools/externalLink.ts`: strict allowlist
  (`https|http|tel|sms|mailto`), control-char/whitespace rejection,
  scheme-confusion hardening, wrapped in a human-confirmation gate
  (`withConfirmation`). **Sound.**
- QR pairing input (`decodePairingPayload`) is strict: prefix, JSON shape,
  version, 32-byte key lengths, v2-requires-`spk`. Malformed QRs throw
  before any state changes. **Sound.**

---

## 6. Area (e) — WebView usage

**None found.** Grep over `src/`, `plugins/`, `modules/` (ts/tsx/js/java/kt)
for WebView returns zero hits. No WebView attack surface to configure.

---

## 7. Area (f) — Exported Android components

From the module manifests (source of truth; the prebuilt `android/` dir is
stale) and the generated manifest:

| Component | Exported | Notes |
|---|---|---|
| `.MainActivity` | **true** (required) | Only `<intent-filter>` is LAUNCHER — no VIEW/BROWSABLE/data filters. Clean. |
| `expo.modules.nidop2p.NidoP2PService` | **false** | Foreground service, `connectedDevice` type. Not reachable by other apps. |
| Receivers / providers | none declared | — |

- **Permissions** are proportionate: BT set with `neverForLocation` on
  SCAN, `ACCESS_FINE_LOCATION` (required by Android for BT discovery),
  `FOREGROUND_SERVICE` + `CONNECTED_DEVICE`, `POST_NOTIFICATIONS`,
  `WAKE_LOCK`, `SCHEDULE_EXACT_ALARM` (exact-alarm module), `INTERNET`
  (model download at setup — the app's one sanctioned network use),
  calendar/contacts (used by agent tools via expo-calendar/expo-contacts).
  `SYSTEM_ALERT_WINDOW` traces to react-native's **debug** manifest only —
  release builds are unaffected (verified in node_modules).
- `allowBackup="false"` + `data_extraction_rules` (all nine domains
  excluded for cloud-backup *and* device-transfer) — defense in depth,
  correctly implemented (empty sections would *not* exclude).
- No custom permissions, no `sharedUserId`, no debuggable flags in the
  release path.

---

## 8. Finding index

| ID | Area | Finding | Severity | Status |
|---|---|---|---|---|
| F-DELEG-1 | delegation | Token caveat `maxToolCalls`/`resultSizeLimit` computed but never passed to executor | Medium | **Verified** |
| F-DELEG-2 | delegation | No inbound executed-taskId replay tracking; `sessionTag` binding unwired | Medium | **Verified** |
| F-DELEG-3 | delegation | TASK_CANCEL can't abort a running executor | Low | **Verified** |
| F-DELEG-4 | delegation | R5 liveness re-check skipped when state provider unwired (fail-open default) | Low | **Verified** |
| F-KEY-1 | SQLCipher | No DEK rotation; compromise is retroactive/permanent | Medium | Design gap |
| F-KEY-2 | SQLCipher | DEK displayed as raw hex in UI alert (user-managed custody) | Low | By design |
| F-P2P-1 | handshake | Anti-spam cooldown burns a nonce-cache row per rejected HELLO | Low | **Verified** |
| F-P2P-2 | handshake | ±600 s `ts` window provisional | Low | Theoretical (docs already flag it) |

### Residual honest limits (from the docs, confirmed — not re-litigated)

QR-substitution at pairing, compromised-peer endpoint, radio jamming,
non-repudiation by design, traffic analysis, no delivery guarantee from
CONFIRM, live-relay vs. physical-presence indistinguishability. The docs
state all of these; the code is consistent with them.

## 9. Recommended next actions (priority order)

1. **Wire `verified.effective` into the executor** (F-DELEG-1) — small,
   testable, closes the only medium where a documented security control is
   silently unenforced.
2. **Add executed-taskId replay tracking + wire `sessionTag`**
   (F-DELEG-2) — same area, same lane.
3. **Decide the DEK rotation story** (F-KEY-1) — at minimum document the
   "compromised DEK = wipe" runbook; ideally implement `PRAGMA rekey`
   rotation before the key is ever exported to Downloads at scale.
4. **Fail-closed default for the approval gate's state provider**
   (F-DELEG-4) + **cooperative cancel** (F-DELEG-3) — cheap hardening in
   the same lane as 1–2.
5. Re-check F-P2P-2's timestamp window against wrong-clock devices at the
   physical gate; everything else in (a) needs no code action.
