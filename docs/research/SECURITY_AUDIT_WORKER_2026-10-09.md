# NIDO — Security re-audit 2026-10-09 (worker)

**Scope:** crypto, P2P handshake, delegation, backup/restore, keystore/DEK.
**Method:** read-only source review at HEAD `f7688b3` (branch `main`), against
the documented threat models. No source modified. Every claim below carries a
`file:line` from the actual code read.
**License spot-check (standing rule 2026-10-09):** all files reviewed carry the
NIDO MIT header (incl. `src/security/keyRotation.ts`); crypto is TweetNaCl
(public domain), no new third-party deps introduced in the reviewed modules.

## Verdicts

| Area | Verdict | Worst gap |
|---|---|---|
| 1. P2P handshake (`src/p2p/`) | **SOLID** | G1/G2: ephemeral/session-key zeroing hygiene (LOW) |
| 2. Delegation (`src/agent/delegation/`) | **GAPS** | G4: TASK_CANCEL/RESULT lack requester binding (MEDIUM); G3: token sessionTag dormant (MEDIUM); G5: mid-execute cancel best-effort (MEDIUM-LOW) |
| 3. Backup/restore (`src/security/backup.ts`, `src/ui/backupShare.ts`) | **GAPS** | K2 fail-open inconsistency (MEDIUM-LOW); restore without biometric (MEDIUM-LOW) |
| 4. Keystore/DEK (`src/privacy/keyManager.ts`, `src/security/`) | **SOLID** | none |
| 5. `src/security/keyRotation.ts` | **GAPS (HIGH — latent, dead code)** | G9 plaintext staging; G10 blind recovery bricks DB; G11 recovery never wired at boot |

---

## 1. P2P handshake — SOLID

### What checks out

- **X25519 ephemeral generation — CSPRNG, yes.** `generateEphemeral()` → `nacl.box.keyPair()`
  → `nacl.randomBytes` (`src/p2p/crypto.ts:216-218`). The PRNG is installed by
  `installSecurePrng()` (`crypto.ts:59-107`): WebCrypto `getRandomValues` first,
  `expo-crypto` native on Hermes second, and **no fallback** — if neither exists,
  TweetNaCl throws its explicit "no PRNG" (fail-closed, never weak randomness).
- **Ed25519 signs exactly the right things.** HELLO v3 signs the domain-separated
  message `"nido-hello-v3" | pk | eph | nonce | ts` (`crypto.ts:229-243`) — the
  timestamp is *inside* the signature, so an attacker cannot "refresh" the `ts`
  of a captured HELLO. CONFIRM v1 signs `"nido-confirm-v1" | pk | cn | pn`
  (`crypto.ts:247-254`) — **both nonces** (own + the peer's seen *in this
  connection*), binding the confirmation to the live transcript. Domain tags make
  v2 signatures unverifiable as v3 and vice versa (cross-version confusion
  impossible by construction).
- **Nonces: 16-byte CSPRNG** (`HANDSHAKE_NONCE_BYTES = 16`, `crypto.ts:325`;
  `randomNonce` → `nacl.randomBytes`, `crypto.ts:187-189`).
- **Anti-replay: atomic + persistent + correctly ordered.** Cache table
  `hello_nonce_cache` with `PRIMARY KEY(pk_lower, nonce_hex)` (`src/p2p/store.ts:108-114`);
  `claimHelloNonce` is a single INSERT whose UNIQUE conflict = replay → reject,
  real DB errors throw (fail-closed) (`store.ts:1481-1522`). Crucially, the claim
  happens **after** signature verification against the QR-bound key
  (`nativeTransport.ts:1076` verify → `nativeTransport.ts:1086` claim), so
  unauthenticated peers cannot fill the cache. Window 3600 s (`store.ts:1467`)
  exceeds the ±600 s timestamp skew (`handshakeV3.ts:44`), so pruning can never
  re-admit a replayable HELLO — safe by construction. Pre-auth CPU/battery
  draining is rate-limited: 5 inbound handshakes per MAC per 60 s *before* any
  crypto (`nativeTransport.ts:158,887`).
- **Ephemeral secret zeroing on the failure paths that matter.** `failHello`
  (`nativeTransport.ts:966-984`), `onNativeDisconnected` (`:1288-1296`), and the
  `handleConfirm` catch (`:1170-1180`) all `fill(0)` the ephemeral secret; the
  success path zeroes it inside `deriveSessionKeyV2` (`crypto.ts:316-317`) right
  after the DH.
- **Session key derivation is standard.** HKDF-SHA512 (RFC 5869) implemented over
  `nacl.hash`, cross-verified against Node's `crypto.hkdfSync` in tests
  (`crypto.ts:250-300`); `PRK = HMAC(salt="nido-session-v2", DH || nonce_min ||
  nonce_max)`, canonical nonce ordering so both sides agree (`crypto.ts:306-341`).
- **No missing 32-byte validation on peer ephemerals.** `parseHello` enforces
  64-hex `eph` (`nativeTransport.ts:290`); `deriveSessionKeyV2` throws unless
  both keys are exactly 32 bytes (`crypto.ts:310-312`); envelope `from`/`to`
  validated as 32-byte hex (`protocol.ts:426-429`).
- **MITM resistance holds end-to-end.** HELLO signature is verified against the
  Ed25519 key exchanged **out-of-band via QR** (`pairing.ts:29-43`,
  `nativeTransport.ts:1067-1081`); a HELLO alone *never* mutates `pkToMac`/`macToPk`
  (R4 invariant, `handleHello` comment at `nativeTransport.ts:1040-1047`) — the
  route is established only after a valid CONFIRM naming both nonces of *this*
  connection (`handleConfirm`, `nativeTransport.ts:1154-1180`), which kills
  reflection (confirm.pk must equal the HELLO's pk, `:1159`) and replay.
  Simultaneous-dial resolves deterministically via the tie-break key
  (`handshakeV3.ts:126-139`). H-8 candidate-session promotion (a new handshake
  never evicts a live session until a valid frame arrives under the new key,
  `messenger.ts:1093-1118`) closes the HELLO-replay session-kill.

### Gaps

- **G1 (LOW) — ephemeral secret not zeroed on three `establishRoute` abort
  paths.** In `establishRoute` (`nativeTransport.ts:1185-1230`): revoked peer
  (`:1195-1199`), fresh manual-disconnect flag (`:1203-1210`), and tie-break
  loss (`:1220-1228`) all call `rejectPending` (which does *not* `fill(0)`,
  `:1277-1285`). `handleConfirm` already removed the pend from the map
  (`:1157`), so `failHello`'s zeroing never runs for these. Practical impact is
  memory-hygiene only — the secret was never combined with anything (its public
  half went over the wire), so it decrypts nothing — but the file's own R7
  contract says "all exits". **Fix:** `pend.myEphSecret.fill(0)` before each
  `rejectPending` in `establishRoute`, or centralize the wipe inside
  `rejectPending` itself.
- **G2 (LOW) — session keys never zeroed on teardown.** `NidoMessenger.destroy()`
  (`messenger.ts:306-340`) clears the `sessions`/`pendingSessions` maps, but
  `P2PSession.sessionKey` (`protocol.ts:203`) has no wipe — keys linger until
  GC (also in `teardownSupersededPeer`, `messenger.ts:893-915`, and the F-2
  key-loss recovery). **Fix:** add `P2PSession.destroy()` that `fill(0)`s the
  key and call it wherever maps are cleared.
- *Note (informational):* TweetNaCl's `box.before` performs no contributory /
  small-subgroup check on the peer ephemeral. Acceptable here: the peer is
  QR-authenticated and `session_confirm` under the derived key provides key
  confirmation, so a malicious low-order point buys an attacker nothing.

---

## 2. Delegation — GAPS

### What checks out

- **Token chain is genuinely solid** (`src/p2p/delegationToken.ts`). Biscuit-style
  Ed25519 chain over canonical (key-sorted) JSON; each link signs
  `(prevSig || payload)` so links cannot be reordered or removed (`:118-126`).
  Verification checks issuer == the peer's known signing key, audience == me,
  UUID-v4 taskId, valid scopes, expiry ≤ 15 min + 5 min clock skew
  (`:259-330`; limits at `src/p2p/taskProtocol.ts:39-47`), and **verifies the
  chain before extending it** in `attenuateToken` (`:183-196`). Caveats only
  narrow (maxToolCalls, resultSizeLimit, notBefore; widening ignored,
  `:332-349`). `issueDelegationToken` rejects `issuer == audience` (`:146`).
- **Inbound verification is strict** (`delegationService.ts:329-360`): unknown
  peer → drop; token must verify against the *paired contact's* stored signing
  key; `verified.root.taskId` and `negotiationId` must match the body; the
  negotiation must be ACCEPTED *right now*.
- **ApprovalGate is the strongest piece.**
  - Anti-loopjacking: deep snapshot at register, hash recomputed at approve
    (SHA-512, `approvalGate.ts:170-172`); no update API; second request for a
    pending taskId rejected; executed taskIds recorded (`:366-370`).
  - TOCTOU re-check: `approve()` re-reads the live negotiation state and
    **fails closed when no provider is wired** (`:330-341`).
  - Rate limit: 10 approvals/hour, correct sliding window (`:311-321`).
  - Fail-closed everywhere: timeout = deny, unknown id = deny, tamper = deny,
    never throws for these cases (`:300-352`).
  - Executed-set bounded at 1000 with FIFO eviction (`:366-370`); per-peer
    pending cap 3 + lazy sweep of expired entries (`:240-260`).
- **Executor scope firewall is structural** (`executor.ts:86-99`): only the
  three v1 scopes have handlers; unknown scopes rejected at construction
  (`:143-147`); token limits are actually enforced now (F-DELEG-1 fix,
  `delegationService.ts:394-404` → `executor.ts:126-142`); peer-namespaced
  memory writes (`:193-206`); watchdog via Promise.race (`:163-169`); strict
  base64 validation aligned with the gate (`taskProtocol.ts:143-147`).
- **TASK_CANCEL reaches in-flight executors** (`delegationService.ts:305-322`):
  denies pending cards *and* calls `runningExecutors.get(taskId).abort()`.
  The gate.approve → runningExecutors.set path is synchronous (no await gap)
  when modelInvoke exists, so there is no cancel-loss race in that window.
- **Message validators are fail-closed** (`taskProtocol.ts:111-241`): UUID-v4
  taskIds, bounded descriptions/documents, expiry + skew, size-capped results.

### Gaps

- **G4 (MEDIUM) — TASK_CANCEL / TASK_RESULT / TASK_REJECT lack requester
  binding.** In `handleTaskMessage` (`delegationService.ts:300-345`):
  - The TASK_CANCEL branch (`:308-321`) iterates `inboundIndex` and aborts
    *any* matching `taskId` — it never checks that `fromPkHex` equals the
    task's original requester (`ctx.peerPkHex`).
  - The TASK_RESULT/TASK_REJECT branch (`:323-345`) only does
    `this.outbound.get(taskId)` — it never verifies `fromPkHex` equals
    `tracked.peerPkHex`.
  Exploitability: requires a *paired* peer (envelope is authenticated per
  session), and the attacker must learn the target `taskId` (not broadcast,
  but visible on a compromised endpoint or via social engineering). Impact is
  **DoS / integrity**: peer B can silently kill peer A's pending approval card
  (the card vanishes and a spurious REJECT is sent to A) or abort A's in-flight
  delegated task; B can also forge a TASK_RESULT for A's outbound task, feeding
  A's UI a result A never requested. **Fix:** compare `fromPkHex.toLowerCase()`
  against the stored peer in both branches and drop on mismatch.
- **G3 (MEDIUM) — the token's `sessionTag` binding is dormant.** The token
  format supports binding to the transport session (`delegationToken.ts:55-66`)
  and verification enforces it strictly (`:315-323`) — but `requestTask` issues
  *without* `sessionTag` (`delegationService.ts:270-278`) and
  `handleTaskRequest` verifies *without* `expectedSessionTag`
  (`delegationService.ts:346-350`). The documented cross-session replay
  protection never engages. Exploitability is low today (tokens travel only
  inside the secretbox-encrypted session, so capture needs endpoint compromise),
  but a claimed defense that doesn't run is a latent hole. **Fix:** pass the
  live `session.sessionTag` at issuance (the ack session tag derivation at
  `protocol.ts:196-243` already exists) and demand it at verification.
- **G5 (MEDIUM-LOW) — TASK_CANCEL mid-execute is best-effort, not real.**
  `abort()` (`executor.ts:125-129`) only sets a flag, and the flag is checked
  solely in `checkBudget()` (`executor.ts:115-123`), which runs **once per
  execution** (v1 has a single tool call). A cancel arriving during
  `modelInvoke` (up to `maxDurationMs` = 120 s) does not interrupt the
  in-flight inference; the executor returns normally, and `approveTask`
  (`delegationService.ts:460-478`) sends TASK_RESULT anyway because
  `wasAborted` is only set when the executor *throws* containing "abort".
  Net effect: a mid-execute cancel is silently ignored and the result is
  delivered as if nothing happened. **Fix:** check `this.aborted` after
  `modelInvoke` resolves (and before `capResult`/return), or race the model
  promise against an abort signal.
- *Observation (not a gap):* the 1000-entry `executed` eviction could
  theoretically re-admit a replayed taskId, but the 15-minute token expiry
  bounds the window — an attacker would need 1000 executions inside 15
  minutes of issuance. Infeasible; no action needed.
- *Observation:* the watchdog abandons (does not cancel) the model promise on
  timeout (`executor.ts:163-169`) — the inference keeps burning CPU/RAM in the
  background. Minor resource note.

---

## 3. Backup/restore — GAPS

### What checks out

- **K1 (DEK fingerprint check) is fail-closed when the manifest is present.**
  `validateBackup` (`src/security/backup.ts:293-305`) compares the manifest's
  `dekFingerprint` against the current DEK's SHA-256 and rejects mismatches
  *before* overwriting the live DB. On a fresh install (no DEK),
  `getDatabaseKeyHex()` generates a fresh one, so K1 rejects foreign backups —
  fail-closed. ✓
- **K2 (SHA-256 check) is fail-closed when `sha256` is present**
  (`backup.ts:279-290`), including the H-5 fix: rejects when the SHA cannot be
  computed.
- **Bundle manifest shape is validated** (`validateBundle`, `backup.ts:158-186`):
  format tag, manifest object, db base64 string, `sha256` + `dekFingerprint`
  strings required.
- **Size cap enforced at 100 MB** (`backup.ts:168-170`) — note the comment says
  500 MB (NEW-H-1); the code is stricter. Comment/code mismatch (doc bug).
- **No path traversal in `extractPortableBundle`** (`backup.ts:423-449`):
  output names are hardcoded (`restored.db` + fixed suffixes); `destDir` comes
  only from `FileSystem.documentDirectory` at the sole production call site
  (`backup.ts:318`).
- **DEK export is biometrically gated** in the share flow
  (`src/ui/backupShare.ts:35-39`, `createBackupFile`).

### Gaps

- **(MEDIUM-LOW) — K2 fail-open inconsistency.** In the raw-`.db` restore path,
  the SHA check is skipped silently when `manifest.sha256` is null
  (`backup.ts:280`, `sha256File` returns null if expo-crypto is unavailable) and
  **both K1 and K2 are skipped when the manifest file is missing entirely**
  (`backup.ts:306-308`, "backups viejos" compat). `validateBundle`, by contrast,
  *requires* both fields. So a legacy/corrupt manifest yields "basic validation
  only" and a wrong-key or tampered backup gets copied over the live DB — the
  app then fails to decrypt at next open (data effectively bricked until
  manual recovery). **Fix:** make the `.db` path match `validateBundle`:
  reject (fail-closed) when the manifest is missing or `sha256` is null, or at
  minimum surface an explicit "integrity unverifiable" warning requiring
  confirmation.
- **(MEDIUM-LOW) — restore has no biometric gate.** `ModelSetupScreen.tsx:470-510`
  calls `restoreBackup(uri)` after only a confirmation dialog. Anyone holding
  the unlocked phone can restore the device's *own* old backup over current
  data (K1 blocks foreign backups, so this is destruction, not exfiltration —
  still, a destructive crypto-data operation without the biometric gate the
  rest of the flow uses). **Fix:** `requireUnlock("Restaurar backup")` before
  `restoreBackup`, consistent with `createBackupFile`.
- **(LOW) — DEK shown without biometric on devices lacking biometrics.**
  `BackupScreen.tsx:54-63`: if `requireUnlock` fails with "no tiene biometría",
  the code warns and *continues to display the DEK*. Documented as an R2
  trade-off, but it is a real DEK-without-biometric path (shoulder-surfing /
  screenshot risk). **Fix:** keep the exception documented, or mask the key
  (show once, require device PIN via the existing device-credential fallback).
- **(LOW) — extract-before-validate ordering.** `restoreBackup` (`backup.ts:315-326`)
  writes three files to the app-private dir *before* `validateBackup` runs.
  Bounded by the 100 MB cap and fixed filenames, so the blast radius is a
  failed restore + disk churn, but validation-first would be cleaner.
- **(LOW) — pre-restore safety copies accumulate.** `backup.ts:328-338` keeps
  `nido_memory.db.pre-restore-<ts>` forever ("se conserva si hubo algún
  problema" — but nothing deletes it on success either).
- **(FUNCTIONAL, fail-closed) — no DEK import flow exists.** Searched the whole
  `src/` tree: there is no UI to import a saved DEK. Consequence: on a fresh
  install, restore *always* fails K1 (fresh DEK is generated), so cross-device
  restore is currently impossible. Not a vulnerability — but the backup story
  is incomplete until key import lands.

---

## 4. Keystore/DEK — SOLID

- **DEK generation is CSPRNG:** 32 bytes from `expo-crypto.getRandomBytesAsync`,
  length-checked, in `randomHex32Async` (`src/privacy/keyManager.ts:217-240`).
- **Storage:** `expo-secure-store` (Android Keystore-backed when hardware
  exists), alias `nido_db_key` (`keyManager.ts:66`); P2P identity keys under
  `nido_p2p_sk` / `nido_p2p_sign_sk` (`:67-74`). Private keys never touch the DB
  (`p2p_identity.sk_hex` stays empty; legacy rows migrated on read,
  `src/p2p/store.ts:341-362`).
- **No DEK logging:** `failClosed` logs only `branch` + `alias`
  (`keyManager.ts:251-254`); `applyDatabaseKey` never includes key material in
  errors (`keyManager.ts:499-543`); grep confirms no `console.*` near key
  material.
- **PRAGMA construction is injection-safe:** `applyDatabaseKey` validates
  `^[0-9a-f]{64}$` before interpolating into `PRAGMA key = "x'...'"` (`:518-521`);
  `buildKeyPragmaSql`/`buildAttachEncryptedSql` (`secureDatabase.ts:517-524`)
  have **zero callers outside `secureDatabase.ts`** (verified by grep) — the
  only live path goes through the validating `applyDatabaseKey`.
- **Fail-closed semantics throughout (M-1/M-2/N4):** a SecureStore *read failure*
  throws `SecureStoreReadError`, never returns null-as-absent (`:268-318`); a
  genuine absence with existing encrypted DBs throws `KeyLossError` (recovery
  screen) instead of silently generating (`:319-348`); concurrent callers share
  one in-flight resolution so two DEKs are never minted (`:258-266`).
- **P2P identity fork protection (F-2):** row-exists-but-secret-missing throws
  `P2PIdentityKeyLossError` instead of silently regenerating
  (`store.ts:356-360`, `store.ts:299-301`).

---

## 5. `src/security/keyRotation.ts` — GAPS (HIGH, currently latent)

**Status: dead code.** `rotateDatabaseKey` and `checkStaleRekeyStaging` have
**zero production callers** (only `keyRotation.test.ts` imports the module;
  `PRAGMA rekey` appears nowhere else in `src/`). Nothing below is exploitable
  in the shipped app today — but the module is one UI wiring away from
  production, and its crash-safety design (the reason the staging file exists)
  is broken in exactly the way that destroys data.

- **G9 (HIGH, latent) — new DEK staged in plaintext JSON on disk.**
  `rotateDatabaseKey` writes `{ newDekHex, dbPath, at }` to
  `${documentDirectory}rekey-staging.json` (`keyRotation.ts:78-88`).
  `documentDirectory` is app-private but **not encrypted at the filesystem
  level**; on a rooted, lost, or `adb backup`-extracted device the DEK is
  trivially readable — and because rotation re-keys the DB to this key,
  whoever reads the file reads the database. **Fix:** never persist the raw
  DEK; either write it to the Keystore under a staging alias (then delete on
  success), or wrap it with a Keystore-held key before writing the file.
- **G10 (HIGH, latent) — `checkStaleRekeyStaging` blindly adopts the staged
  DEK and can brick the DB.** It reads the file and calls `storeDek(newDekHex)`
  with **no verification of which key the DB currently uses**
  (`keyRotation.ts:116-146`). Crash-window analysis:
  | Window | DB key | Keystore key | Recovery writes | Outcome |
  |---|---|---|---|---|
  | Crash between staging write and `PRAGMA rekey` (`:88` → `:92`) | OLD | OLD | staged NEW | **BRICK** — DB unreadable, old key lost |
  | `openDb`/`rekey` throws *after* staging (`:91-95` catch) — staging **not deleted** | OLD | OLD | staged NEW at next boot | **BRICK** |
  | Crash between rekey and Keystore write (`:92` → `:99`) | NEW | OLD | staged NEW | OK (the one window it handles) |
  | Crash after Keystore write, before staging delete | NEW | NEW | staged NEW | OK (idempotent) |
  | Keystore-write failure → revert-rekey itself throws (inner `catch {}`,
    `:101-103`) | NEW | OLD | staged NEW at next boot | accidentally OK, but only via the staging file |
  The two BRICK windows are the *common* ones (staging exists precisely when
  the rekey did **not** run). **Fix:** on recovery, probe — try opening the DB
  with the staged key (`SELECT 1 FROM sqlite_master`); adopt the staged key
  only if it opens, else keep the Keystore key; delete the staging file on
  **all** exits of `rotateDatabaseKey` (success, failure, revert); validate
  `newDekHex` is 64-hex before storing.
- **G11 (MEDIUM, latent) — the recovery it was built for never runs.**
  `checkStaleRekeyStaging` is never called at boot (its own docstring says
  "Debe llamarse al arranque de la app"). So the designed-for window (crash
  between rekey and Keystore write) currently strands the DB: Keystore holds
  the old key, the DB is on the new key, and the plaintext staging file sits
  on disk indefinitely. **Fix:** wire it into boot **only after** G10 is fixed
  (wiring it as-is introduces the G10 brick); until then the staging file is
  pure liability.
- Minor: staging JSON is parsed with no schema validation beyond
  `typeof newDekHex === "string"` (`:125-130`) — a malformed-but-string value
  would be written straight to the Keystore; `dbPath` in the JSON is never
  cross-checked against the actual DB.

---

## Prioritized fix list

1. **G10/G9** — rework `keyRotation.ts` recovery (probe-then-adopt, delete
   staging on all exits, never stage raw DEK) *before* any UI wires it up.
   Highest data-loss risk in the tree, even if latent.
2. **G11** — wire `checkStaleRekeyStaging` at boot only after (1).
3. **G4** — bind `fromPkHex` to the stored peer in the TASK_CANCEL and
   TASK_RESULT/TASK_REJECT branches (`delegationService.ts:308-345`).
4. **G3** — thread the live `session.sessionTag` through token issuance and
   verification so the documented session binding actually runs.
5. **G5** — check `this.aborted` after `modelInvoke` resolves in the executor
   (or race against an abort signal) so mid-execute cancels are honored.
6. **K2 inconsistency** — fail closed (like `validateBundle`) when the
   manifest is missing or `sha256` is null in the raw-`.db` restore path.
7. **G6** — `requireUnlock` before `restoreBackup` in `ModelSetupScreen`.
8. **G1/G2** — zero ephemeral secrets on the three `establishRoute` aborts;
   add `P2PSession.destroy()` and use it on every session-map clear.
9. **G7** — decide: keep the no-biometric DEK display as a documented
   exception or mask it; fix the 100 MB-vs-500 MB comment mismatch in
   `validateBundle`; prune pre-restore safety copies on success.
10. **Functional** — a DEK import flow is required before cross-device restore
    can work at all (K1 correctly blocks it today).

## Evidence level

Static source review (this worker has no device access): all findings are
code-level (file:line cited), several corroborated by the repo's own
adversarial tests. Physical-device confirmation of the *behavioral* claims
(handshake MITM rejection, cancel timing) remains with the Tab A9+ gate.
