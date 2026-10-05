# NIDO Security Review — P2P + Key Management + Encrypted Storage

**Date:** 2026-09-27
**Scope:** `src/p2p/` (crypto, pairing, protocol, messenger, store, transport, nativeTransport),
`src/privacy/keyManager.ts`, `src/security/secureDatabase.ts`, `src/security/biometricGate.ts`
(surface), `src/agent/tools/` (manifest, handlers, confirm), `src/services/appReset.ts`,
`src/rag/packs.ts` (DB-open exception), `src/agent/memory/memoryStore.ts`, `src/rag/db.ts`.
Compared against `docs/SECURITY_ROADMAP.md`, `docs/HANDSHAKE_THREAT_MODEL.md`,
`docs/CRYPTO_ARCHITECTURE.md`.

**Status:** REVIEW ONLY. No source modified, no commits, no pushes.
All findings are **QUEUED, not applied**.

**Verdict:** 0 CRITICAL · 0 HIGH · 7 MEDIUM · 5 LOW · 1 INFO.
The cryptography is sound for its threat model (signed handshake, ephemeral ECDH,
authenticated messages, fail-closed storage). The findings are robustness/UX gaps,
not broken primitives.

---

## 1. PROVEN (with file:line evidence)

### P2P crypto
1. **Messages are authenticated encryption.** `sealMessage`/`openMessage` use
   `nacl.secretbox` (XSalsa20-Poly1305); decryption failure returns `null`, never
   throws into the session (`src/p2p/crypto.ts:217-237`).
2. **Fresh random 24-byte nonce per message.** `sealMessage` calls
   `nacl.randomBytes(nacl.secretbox.nonceLength)` per message — no nonce reuse
   (`src/p2p/crypto.ts:221-225`).
3. **Handshake v2 is MITM-resistant by design.** Each HELLO carries an Ed25519
   signature over `("nido-hello-v2"|pk|eph|nonce)`; the verifying key (`spk`) was
   exchanged out-of-band via in-person QR. The signature is verified against the
   **paired contact's stored `spk`** before any session is derived; an attacker
   cannot substitute the ephemeral without the peer's signing key
   (`src/p2p/nativeTransport.ts:407-424`, `src/p2p/crypto.ts:143-148`).
4. **Session key binds both nonces.** `deriveSessionKeyV2` computes
   `SHA-512("nido-session-v2" || DH || nonce_min || nonce_max)[0:32]` with canonical
   nonce ordering; a replayed HELLO cannot resurrect a past session or let the
   attacker predict the new key (`src/p2p/crypto.ts:170-208`). (Ad-hoc but correct
   construction; roadmap H-1 plans HKDF migration.)
5. **Anti-downgrade enforced.** `parseHello` rejects `v: 1` ("actualiza su app")
   and any unknown version (`src/p2p/nativeTransport.ts:143-149`). Matches
   roadmap C-4 (IMPLEMENTED).
6. **Pairing requires a QR-paired contact.** `handleHello` looks up
   `findContactByPk(hello.pk)` and rejects unknown devices and contacts without
   `sigPkHex` (legacy v1 QR) with explicit re-scan guidance
   (`src/p2p/nativeTransport.ts:395-405`).
7. **Anti-replay, two layers.** In-memory per-session `seenIds` (10k, FIFO
   eviction) drops duplicate frames (`src/p2p/protocol.ts:130-136`); persistent
   `INSERT OR IGNORE` in `saveMessage` prevents reprocessing after restart
   (`src/p2p/store.ts:236-254`).
8. **H-8 implemented and tested.** New handshakes become *candidate* sessions
   (`pendingSessions`); the live session is replaced only after a valid frame
   under the candidate key proves liveness (`src/p2p/messenger.ts:52-58, 232-247`).
   Covered by `src/p2p/messenger.test.ts:218` ("H-8: un handshake nuevo no
   sustituye la sesión viva hasta liveness"). **Note:** `docs/SECURITY_ROADMAP.md`
   still says H-8 "mitigation pending" — the roadmap text is stale relative to
   the code (see INFO-1).
9. **Recipient/sender binding.** `P2PSession.expectRecipient` rejects envelopes
   whose `to` is not me; `unpack` rejects `from` ≠ session peer (anti-spoofing)
   (`src/p2p/protocol.ts:120-122`).
10. **Key separation.** X25519 identity keypair (encryption) and Ed25519 signing
    keypair are independent; "cada una para su propósito", no cross-curve
    derivation (`src/p2p/crypto.ts:96-114`, `src/p2p/store.ts:61-75`).
11. **`agent_task` never auto-executes.** Inbound `agent_task` is stored with
    status `queued` for explicit user approval (`src/p2p/messenger.ts:9-12, 256-268`).
12. **Queue only flushes to live sessions.** `flushOutbox` requires
    `session.isPeerLive` (peer proved knowledge of the session key), so a ghost
    session can never swallow queued messages (`src/p2p/messenger.ts:296-318`).
13. **Strict QR parsing.** `decodePairingPayload` validates prefix, JSON shape,
    version, app tag, name, and 32-byte keys; v2 without `spk` is rejected
    (`src/p2p/pairing.ts:45-90`).

### Key management
14. **Private keys live in SecureStore (Android Keystore), never in the DB.**
    `saveIdentity` stores `sk_hex = ""` in SQLite; the X25519 secret and Ed25519
    seed go to `nido_p2p_sk` / `nido_p2p_sign_sk` (`src/p2p/store.ts:113-124`,
    `src/privacy/keyManager.ts:121-163`).
15. **Legacy migration is hygienic.** If an old row still carries `sk_hex`, it is
    moved to the Keystore and the column is cleared on read
    (`src/p2p/store.ts:93-101`).
16. **Fail-closed without SecureStore in production.** `getDatabaseKeyHex()`
    throws when no backend exists and `__DEV__` is false; the dev-plaintext path
    (`return null`) is reachable only with `__DEV__ === true`
    (`src/privacy/keyManager.ts:104-119`). In the release build `__DEV__` is
    false at runtime, so the fail-closed branch is the live one.
17. **SQLCipher presence is verified, not assumed.** `applyDatabaseKey` checks
    `PRAGMA cipher_version` non-empty and forces a page read (`sqlite_master`)
    to prove the key is correct — wrong key / corrupt / plaintext DB all throw
    fail-closed (`src/privacy/keyManager.ts:192-231`).
18. **No SQL injection via key.** `PRAGMA key = "x'${hex}'"` interpolates only
    after strict `/^[0-9a-f]{64}$/i` validation (`src/privacy/keyManager.ts:204`,
    `src/security/secureDatabase.ts:262`).

### Encrypted storage
19. **All sensitive DBs go through the encrypted path.** `memoryStore`
    (`nido_memory.db`: agent memory + P2P identity/contacts/messages) and
    `rag/db` (knowledge base) resolve the DEK via `getDatabaseKeyHex()`
    (fail-closed in prod) and open via `ensureEncryptedDatabase`
    (`src/agent/memory/memoryStore.ts:108-119`, `src/rag/db.ts:64-71`).
20. **Plaintext→encrypted migration is careful.** Export to `.migtmp` via
    `sqlcipher_export`, verify `integrity_check` + schema/count fingerprint,
    *then* atomic rename; the original is untouched on any failure
    (`src/security/secureDatabase.ts:256-310`). Interrupted migrations recover
    idempotently (`recoverInterruptedMigration`).
21. **Migration state machine never opens plaintext silently.**
    `RECOVERY_REQUIRED` throws instead of opening (`src/security/secureDatabase.ts:414-428`).
22. **Clear All Data is verified, not assumed.** `resetAllAppData` deletes DBs +
    sidecars + markers, all three Keystore aliases, models/corpus/eval/cache,
    then *checks* non-survival (files + `peekDatabaseKey`/`loadP2P*`) and throws
    `WipeVerificationError` listing survivors (`src/services/appReset.ts:91-174`).

### Hygiene
23. **No hard-coded keys/IVs.** Grep over `src/` for key/secret assignments
    found only aliases and SecureStore calls — no embedded key material.
24. **No key material in logs.** No `console.*` prints secrets/DEKs/aliases'
    values.
25. **No AsyncStorage/MMKV for secrets.** The only AsyncStorage mention is a
    comment stating it is *not* used (`src/services/appReset.ts:60`).
26. **Skills are built-in only.** `loadSkill` reads from `BUILT_IN_SKILLS`, not
    from user-writable files — no skill-file prompt-injection surface
    (`src/agent/skills/registry.ts:17-26`).
27. **H-3 implemented.** `with-data-extraction-rules` config plugin is registered
    in `app.json` (excludes all nine domains from cloud-backup and
    device-transfer); `allowBackup=false` also set.
28. **Biometric gate is honest about its limits.** Wired as an app lock in
    `App.tsx:43`; the module docstring states the real KEK with
    `setUserAuthenticationRequired` needs a future native module (matches
    roadmap H-6: "UX only, don't sell it as biometric encryption").

---

## 2. FINDINGS (QUEUED, not applied)

### MEDIUM

**M-1. Transient SecureStore read failure → fresh DEK overwrites the real one (permanent data loss).**
- Evidence: `src/privacy/keyManager.ts:112-119` —
  `getDatabaseKeyHex()` does `getItemAsync(DB_KEY_ALIAS).catch(() => null)`;
  on a *transient* read error it falls through, mints a fresh 32-byte key, and
  `setItemAsync` overwrites the genuine DEK. The existing SQLCipher DB then
  fails `applyDatabaseKey` forever ("file is not a database"): the data is
  cryptographically unrecoverable.
- Repro: inject a backend whose `getItemAsync` throws once (transient) then
  recovers; call `getDatabaseKeyHex()`; observe a new key stored and the old
  DB unreadable.
- Proposed fix: distinguish "absent" from "read error" — on read error, throw
  fail-closed instead of minting; only generate when the read *succeeds* and
  returns null.

**M-2. Same failure class destroys the P2P identity and signing key.**
- Evidence: `loadP2PPrivateKey` / `loadP2PSigningKey` `.catch(() => null)`
  (`src/privacy/keyManager.ts:130-147, 156-163`). A transient failure makes
  `getIdentity()` return null (`src/p2p/store.ts:102`) → `ensureIdentity()`
  generates a **new** identity and `saveIdentity` overwrites the old one;
  `getSigningKeypair()` (`src/p2p/store.ts:66-75`) generates a new Ed25519 key
  and overwrites `nido_p2p_sign_sk`. Peers holding the old `spk` then reject all
  handshakes ("posible ataque de intermediario") until manual re-pairing.
- Repro: as M-1, via `getIdentity()` / `getSigningKeypair()` after one
  transient `getItemAsync` failure.
- Proposed fix: propagate read errors (throw) from the `load*` functions;
  treat only a successful null read as "absent".

**M-3. `withConfirmation` fails open when the confirm channel is missing.**
- Evidence: `src/agent/tools/confirm.ts:44-61` — if `requestConfirm` is
  undefined, the wrapped handler executes *immediately*; in release
  (`__DEV__=false`) not even a warning is logged. The safety argument is "en
  producción ChatScreen siempre inyecta el diálogo" — an assumption, not an
  enforcement.
- Current state: the only production call site,
  `src/ui/ChatScreen.tsx:548` (`buildToolHandlers({ requestConfirm })`), does
  inject the channel, so this is **latent, not reachable today**.
- Repro: call `buildToolHandlers()` without opts in any future/host context and
  invoke `nido_send_message` or `create_calendar_event` — no user confirmation.
- Proposed fix: fail closed — if the tool is in `SENSITIVE_TOOLS` and no
  channel exists, refuse with an explicit error instead of executing.

**M-4. `nido_send_message` resolves contacts by partial, case-insensitive `LIKE` — wrong-recipient risk.**
- Evidence: `sendChat` → `findContactByName` (`src/p2p/messenger.ts:196`,
  `src/p2p/store.ts:196-206`): `WHERE lower(name) LIKE '%<input>%' LIMIT 1`
  with no `ORDER BY`. With contacts "Aldo" and "Aldo P.", sending to "Aldo"
  may deliver to either. `%`/`_` in the input also act as wildcards.
- Impact: message is still E2E-encrypted, but to the **wrong paired contact**
  (privacy breach, not a crypto break).
- Repro: pair two contacts with overlapping names; `nido_send_message(to="<shorter>")`;
  observe indeterminate recipient.
- Proposed fix: exact (case-insensitive) match first; on 0 or 2+ matches,
  return a disambiguation error listing candidates instead of picking one.

**M-5. `nido_pair` accepts a code from *any* provenance, weakening the in-person QR assumption.**
- Evidence: `nidoPairHandler` (`src/agent/tools/handlers.ts:506-518`) takes a
  `code` string argument — the model can pair using a code pasted from any
  channel (chat, email), not just a camera-scanned QR. The threat model
  (`pairing.ts` header, "modelo Briar") assumes an out-of-band, in-person
  exchange; a code delivered over an insecure channel lets a MITM substitute
  their own QR. `nido_pair` is also **not** in `SENSITIVE_TOOLS` (no
  confirmation dialog).
- Repro: feed the agent a `NIDO1:` payload received over an untrusted channel;
  it pairs without any provenance warning.
- Proposed fix: add `nido_pair` to `SENSITIVE_TOOLS` with a confirmation dialog
  that shows the contact name + fingerprint and instructs in-person
  verification; document that only camera-scanned QRs carry the full trust
  assumption.

**M-6. No approval UI exists for queued `agent_task`s.**
- Evidence: `handleFrame` correctly stores inbound `agent_task` as `queued`
  (never auto-executes — PROVEN #11), but `src/ui/NidoScreen.tsx` (670 lines)
  contains **zero** references to `agent_task`: there is no screen to review,
  approve, or reject them. Tasks accumulate invisibly in the DB.
- Impact: the "explicit user approval" the design relies on has no surface;
  users cannot distinguish legitimate tasks from social-engineering payloads
  sent by a paired contact.
- Proposed fix: inbox surface listing queued agent tasks with sender identity
  + fingerprint, Approve/Reject, and never rendering task text as trusted
  instructions.

**M-7. No key rotation / revocation story (roadmap H-7, still pending).**
- Evidence: the DB DEK is generated once and kept for the app's lifetime;
  P2P identity and signing keys have no rotation API — only destructive
  `deleteIdentity()` (which orphans all pairings). A compromised identity key
  lets the attacker impersonate the device in future handshakes indefinitely
  (past content keeps per-connection forward secrecy via ephemerals).
- Proposed fix: implement H-7 as roadmapped — one-gesture identity rotation
  (new Ed25519 + new QR), local revocation marking for contacts, and a
  re-pairing guide; surface the H-4 "identity changed" warning when a known
  `pk` presents a new `spk`.

### LOW

**L-1. `newId()` uses `Math.random()` for message IDs.**
- Evidence: `src/p2p/messenger.ts:40-45` (and `src/agent/memory/memoryStore.ts:103`
  for note IDs). IDs are the anti-replay/dedup keys; `Math.random()` is not a
  CSPRNG. No direct exploit today (frames are authenticated; an attacker cannot
  mint valid frames with predicted IDs), but IDs should be unpredictable on
  principle.
- Proposed fix: `nacl.randomBytes` / `expo-crypto.getRandomBytes` for ID generation.

**L-2. Ephemeral and session secrets are not zeroed after use.**
- Evidence: `deriveSessionKeyV2` zeroes the DH `shared` secret
  (`src/p2p/crypto.ts:205-206`) but **not** `myEphemeralSecret`, and the derived
  session key / `myEphSecret` in `PendingHello` are never wiped. JS GC makes
  this best-effort, but the existing `fill(0)` shows the intent.
- Proposed fix: zero `myEphemeralSecret` after `fromHandshakeV2`, and session
  keys on session teardown.

**L-3. Knowledge-pack DBs open in plaintext with no integrity re-check.**
- Evidence: `src/rag/packs.ts:76` — `SQLite.openDatabaseAsync(...)` directly,
  bypassing `ensureEncryptedDatabase` (no `PRAGMA key`). Pack content is public
  corpus data (acceptable), but: (a) the file is **not re-verified** at open —
  only size + `meta` row are checked, not the download-time SHA-256 — so a
  post-download modification feeds poisoned chunks into RAG context
  (prompt-injection into the model); (b) it is the one exception to the
  "everything encrypted" story.
- Proposed fix: re-verify SHA-256 (or a stored HMAC) before opening a pack;
  document the plaintext exception explicitly in the privacy copy.

**L-4. Frame length header is unauthenticated.**
- Evidence: `[u32 BE length][nonce][secretbox]` (`src/p2p/protocol.ts:100-113`).
  Tampering with the length only causes frame rejection (DoS on that frame),
  not decryption — but headers should be AAD per roadmap H-2 (XChaCha20).
- Proposed fix: covered by H-2; authenticate the header as AAD on migration.

**L-5. `.sqlcipher` migration marker is plaintext metadata.**
- Evidence: `src/security/secureDatabase.ts:302-305` writes JSON
  `{v, cipher, migratedAt, db}` next to the DB. No key material, but it reveals
  DB names and migration timestamps to forensic/file access.
- Proposed fix: acceptable as-is; optionally fold the marker into the encrypted
  DB (`meta` table) and delete the sidecar file.

### INFO

**I-1. Roadmap H-8 status text is stale.** `docs/SECURITY_ROADMAP.md` says H-8
"mitigation pending", but `src/p2p/messenger.ts` implements candidate-session
promotion and `src/p2p/messenger.test.ts:218` covers it. Update the roadmap
status to IMPLEMENTED + AUTOMATED TESTED (physical two-phone test still pending).

---

## 3. UNVERIFIED (needs device / hardware / native build)

U-1. **"Your data remains encrypted at rest."** The code paths are correct
    (fail-closed DEK resolution, `cipher_version` check, test-read, careful
    migration), and `sqlcipherReal.test.ts` proves the SQL statements against
    real SQLCipher 4.x on CI — but there is **no physical evidence** that the
    release APK's `expo-sqlite` links SQLCipher and that `nido_memory.db` /
    knowledge DB bytes on the Tab A9+ are actually encrypted. Per GATE-1 this
    claim stays **UNVERIFIED / NOT CLEARED FOR PUBLIC RELEASE** until a device
    test dumps raw DB bytes and confirms no plaintext.
U-2. **Keystore backing level.** No `securityLevel`/StrongBox detection is
    surfaced (roadmap C-2 partial: keys are generated in software via tweetnacl
    and *stored* in SecureStore, not generated inside the Keystore). Whether the
    Tab A9+ keeps them in TEE/StrongBox is unconfirmed on device.
U-3. **Bluetooth P2P transport.** The `nido-p2p` native module is not compiled;
    the entire signed-handshake-over-RFCOMM path (`NidoBluetoothTransport`) has
    never run on hardware. All P2P session tests use `LoopbackTransport`.
U-4. **Two-phone E2E.** No real NIDO↔NIDO exchange (pairing → handshake →
    message → replay attempt) has ever executed on two physical devices.
U-5. **Reinstall semantics.** Assumed: uninstall wipes SecureStore → fresh
    identity + DEK on reinstall (backups blocked by H-3). Not observed on device.
U-6. **WAL sidecars on device.** SQLCipher encrypts WAL/SHM too, but encrypted
    bytes of `-wal`/`-shm` on a real device were never inspected.
U-7. **Biometric gate on device.** Fallback to device credential, lock timing,
    and behavior when biometrics are unenrolled are untested on hardware.
U-8. **Data extraction rules in the built manifest.** The config plugin is
    registered, but `android:da
...[truncated 1058 chars]