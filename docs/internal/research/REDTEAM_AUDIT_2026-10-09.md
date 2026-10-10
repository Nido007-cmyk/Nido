# RED-TEAM ADVERSARIAL AUDIT — NIDO @ 6daf61a5

**Date:** 2026-10-09
**Mode:** White-box adversarial. Three parallel attacker agents (P2P protocol / delegation+backup / keystore+DoS) + coordinator verification probes.
**Rules:** Read-only. Every finding traced to file:line at `6daf61a5`.
**Threat model:** (a) legitimately-paired-then-malicious P2P peer, (b) brief physical access to an unlocked phone, (c) crafted backup files + social engineering, (d) full codebase knowledge.

**Verdict: NOT GREEN — 13 EXPLOITABLE findings** (2 High, 5 Medium, 6 Low), 14 THEORETICAL, 20+ MITIGATED.
The two High findings both break **restore**: no restore path works in production (B1 + B13). The most dangerous integrity finding is B2 (crafted backup → total data destruction).

Prior 7 audits verified the crypto core (handshake, token chain, keystore) — this pass confirms those and attacks what they missed: the pairing ceremony, the pairing write path, revocation wiring, pre-auth resources, the approval UX loop, and the backup/restore data path.

---

## EXPLOITABLE FINDINGS

### B1 — `extractPortableBundle`: `writeAsStringAsync` arguments SWAPPED — portable restore always throws [HIGH]
**Code trace:** `src/security/backup.ts:447`:
```ts
await FileSystem.writeAsStringAsync(bundle.db, dbUri, { encoding: FileSystem.EncodingType.Base64 });
```
Signature (`node_modules/expo-file-system/build/legacy/FileSystem.d.ts:58`): `writeAsStringAsync(fileUri, contents, options?)`. The megabytes-long base64 blob is passed as the *file URI*, the destination path as *contents* — backwards. The other two writes in the same function (`:452`, `:459`) use the correct order. TypeScript cannot catch it (both `string`). Coordinator verified against the `.d.ts`.
**Effect:** every restore-from-`.nidobackup.json` throws; the CR-1 portable-restore flow shipped 2026-10-09 **never works**. Fail-closed (native layer rejects the absurd path), but users cannot restore shared backups and may resort to insecure workarounds. The green test suite never caught it (FileSystem is mocked; no arg-order assertion).
**Fix:** `writeAsStringAsync(dbUri, bundle.db, { encoding: Base64 })` + regression test asserting argument order.

### B13 — Header check rejects legitimate SQLCipher backups: restore-from-`.db` ALSO broken [HIGH] *(coordinator finding)*
**Code trace:** `src/security/backup.ts:226-236` requires the first 16 bytes to be `"SQLite format 3"`, with the comment "el header no está cifrado en SQLCipher". That comment is wrong: the vendored SQLCipher has `default_plaintext_header_size = 0` (`node_modules/expo-sqlite/vendor/sqlcipher/sqlite3.c:107772`) and the app never sets `cipher_plaintext_header_size` (repo-wide grep: zero hits). Default SQLCipher encrypts the entire file **including the header** — a real NIDO backup does not start with the magic string.
**Effect:** `validateBackup` returns `{valid:false}` for the app's own encrypted backups → `restoreBackup` throws "Backup inválido". Combined with B1, **no restore path works in production**. (The test suite mocks `readAsStringAsync` to return `"SQLite format 3\0..."` — `backup.test.ts:69` — so tests pass while production fails.)
**Branch:** if the production SQLite somehow lacks SQLCipher, headers are readable and restore works — but then "encrypted at rest" (GATE-1) is false. Either branch is broken; device verification of `PRAGMA cipher_version` on a real backup file settles it.
**Fix:** remove the magic-header gate for the encrypted path; replace with trial-open using the current DEK (which also fixes B2). Keep a header check only as a fast pre-filter that *warns*, never rejects, or check for *either* plaintext magic *or* successful trial-open.

### B2 — Malicious backup accepted: no trial-open with DEK; `dekFingerprint` optional [MEDIUM-HIGH]
**Code trace:** `validateBackup()` (`src/security/backup.ts:212-301`) checks size ≥ 1024, magic header, manifest SHA-256 (self-consistent), and *optional* `dekFingerprint` (`if (manifest.dekFingerprint)` — absent → skipped). The header comment claims BK-3 does "header SQLCipher + **apertura con DEK**" — **no trial-open exists anywhere**. Legacy no-manifest path: header only. `databaseManager.ts:237`: no plaintext fallback.
**Attack:** attacker crafts a *plaintext* SQLite DB (magic header identical), self-consistent manifest (`sha256` matches; `dekFingerprint` **omitted** → K1 skipped), social-engineers the user into restoring it. Validation passes → live encrypted DB replaced → app can't open it → **total data destruction / app DoS**. SHA-256 here proves only transit integrity — it's attacker-attested.
**Fix:** (1) make `dekFingerprint` mandatory; (2) trial-open the candidate with the current DEK (`PRAGMA key` + `SELECT count(*) FROM sqlite_master`) *before* replacing the live DB — i.e. implement the BK-3 claim.

### R1 — Pairing fingerprint (SAS) covers only the X25519 identity key, NOT the Ed25519 handshake-signing key [MEDIUM-HIGH]
**Code trace:** `src/p2p/pairingCeremony.ts` `previewPairingCeremony`: `fingerprint(fromHex(payload.pk))` — `spk` never displayed/fingerprinted/bound. `src/p2p/nativeTransport.ts` `handleHello`: handshake authenticated **solely** by `contact.sigPkHex` (the spk); `pk` is only a routing label.
**Attack:** QR shared remotely (screenshot) → attacker modifies only the `spk` field, keeps `pk`/`name`. Victim's ceremony shows the genuine fingerprint (covers `pk` only); all 8 groups match; victim confirms. Contact row now pins the **attacker's** Ed25519 key → full impersonation later over Bluetooth (read/inject chat and agent tasks) under the real contact's name.
**Fix:** fingerprint over `sha512(pk || spk)` (or two labeled fingerprints); treat spk change/removal on re-scan as an explicitly-warned destructive event.

### D1 — Approval-fatigue spam: no rate limit on request *registration* [MEDIUM]
**Code trace:** `src/agent/delegation/approvalGate.ts:307-313` — the 10/hr limit counts only successful `approve()`s. `denyTask()` frees the slot and doesn't touch the `executed` set. Coordinator verified.
**Attack:** malicious peer sends TASK_REQUEST (fresh taskId+token) → human denies → peer immediately re-sends → unbounded approval cards over time (3-concurrent cap bypassed via deny-frees-slot). Textbook approval-fatigue / UI-DoS loop; eventually the human approves carelessly.
**Fix:** per-peer registration rate limit (e.g. 10 cards/peer/hour sliding window) + deny-cooldown (same peer+description-hash can't re-register for N minutes).

### D-2 — Paired-peer chat bomb → unbounded `p2p_messages` growth [MEDIUM]
**Code trace:** outbound chat capped at 4000 chars (`src/p2p/messenger.ts:822`); **inbound** persisted as `String(payload.text ?? "")` with no cap beyond the 256 KB frame (`:1282-1296`), no inbound chat rate limit (only handshake frames are limited), `saveMessage` (`src/p2p/store.ts:1025`) has no per-peer cap/pruning.
**Attack:** paired malicious peer sends repeated ~256 KB chat frames → multi-GB SQLite growth → storage exhaustion, UI degradation.
**Fix:** mirror the 4000-char cap inbound + per-peer inbound rate limit + prune policy (keep last N per peer).

### R2 — Re-scan of spk-less (v1) QR silently NULLs the contact's signing key → durable connectivity DoS + rename [MEDIUM]
**Code trace:** `src/p2p/messenger.ts` `pairWith` knownLive path → `commitRepair({…, sigPkHex: payload.spk ?? null})`; `src/p2p/store.ts` `commitRepair` upsert overwrites `sig_pk` with NULL. `pk` is public (cleartext in every HELLO); v1 QRs carry no `spk` and are accepted.
**Attack:** attacker crafts `NIDO1:{v:1,…,pk:"<real pk>",name:"<chosen>"}`; one social-engineered re-scan → `sig_pk`=NULL → **all future handshakes with that contact fail** until a v2 re-scan; contact silently renamed; nonce-cache rows for that peer wiped.
**Fix:** preserve existing `sig_pk` when the new payload lacks one; or reject spk-less re-scans of keyed contacts without explicit user acknowledgment.

### R3 — Revocation is dead code end-to-end [MEDIUM]
**Code trace:** `loadRevokedPks()` (`src/p2p/nativeTransport.ts:326`) and `revokePeer()`/ `unrevokePeer()` (`:851/:862`) have **zero callers** repo-wide; the `establishRoute` check (`:1241`) is vacuous. Side: the revocation file is plaintext unauthenticated JSON; its loader's comments bless fail-open.
**Effect:** a compromised contact device cannot be cut off except via unpair (which also deletes history — different semantics). Any plan relying on "revoke the peer" does not function.
**Fix:** wire `loadRevokedPks()` into transport init + real UI entry point + move the file into the encrypted store — or delete the mechanism and document unpair as the revocation path.

### R4 — R8 rate-limit rejects without closing the socket → pre-auth connection-slot exhaustion DoS [MEDIUM]
**Code trace:** `src/p2p/nativeTransport.ts` `beginHello`: on R8 reject, bare `return` — no disconnect, no timer; the RFCOMM socket stays open indefinitely. Once a `pending` entry exists, every further frame re-runs full `handleHello` (verify+claim+sign) with no per-socket throttle.
**Attack:** nearby attacker opens N sockets (platform cap ~7), reconnects each ~14 s → holds all server slots busy forever, starving legitimate peers; or trickles valid HELLOs for 1:1 CPU/battery burn. Availability-only, no data impact.
**Fix:** `disconnect(mac)` on R8 reject; idle-socket watchdog; per-pending HELLO re-execution throttle.

### B3 — `restoreBackup` extracts the bundle BEFORE any bundle validation [MEDIUM]
**Code trace:** `src/security/backup.ts:319` runs `extractPortableBundle` first; `validateBackup(actualUri)` after; `validateBundle()` (100 MB cap, shape checks) **never runs** in this path. `extractPortableBundle` has no size cap — full `JSON.parse` + base64 decode of an unbounded bundle → OOM/disk-fill. (The single UI caller pre-validates; the API doesn't — defense in depth fails.)
**Fix:** call `validateBundle(bundleUri)` at the top of `restoreBackup` before extraction; add size/type guards inside `extractPortableBundle`.

### D2 — Peer-asserted display name on the approval card [MEDIUM-LOW]
**Code trace:** `pairingCeremony.ts:177` takes `payload.name` from the peer (self-asserted, only collision-checked); card renders `From {{name}} ({{pkShort}})` (`TaskApprovalCard.tsx:63-68`) — the 16-char pk is not human-verifiable, and the "untrusted" labeling covers the description, not the sender name.
**Attack:** pair once as "Mom" / "NIDO Support" → every approval card inherits false authority.
**Fix:** label the name as self-asserted on the card; show pairing-verification state; full pk on tap.

### B5 — `.pre-restore-*` safety copies never deleted [LOW-MEDIUM]
**Code trace:** `src/security/backup.ts:332` creates the copy; the step-6 comment promises cleanup — **no delete call exists**. Every restore permanently leaves a full-size DB copy in the SQLite dir → disk exhaustion over repeated restores.
**Fix:** delete on successful restore (keep on failure, with cap/age pruning).

### D3 — No TASK_REJECT on approval timeout; outbound entries never expire; no requester cancel [LOW]
**Code trace:** `sweepExpired()` silently drops; `outbound` map (`delegationService.ts:246`) deleted only on RESULT/REJECT — no TTL; no outbound `cancelTask()` API.
**Effect:** requester hangs forever ("Wait for the result"), map leaks; a malicious B can grow A's map unboundedly; A can't revoke a mistakenly-sent task.
**Fix:** timer → `sendReject(…,"expired")` on deadline; outbound TTL sweep; requester-side `cancelTask()`.

### B4 — No upper size bound on raw-`.db` restore [LOW]
**Code trace:** `validateBackup()` raw path checks only `size < 1024`. A multi-GB valid-magic file passes and is `copyAsync`'d over the live DB.
**Fix:** cap (e.g. 100 MB policy) with documented max.

### D-3 — `delivery_ack_log` grows forever [LOW]
**Code trace:** `pruneDeliveryAckLog` (`src/p2p/store.ts:1213`) exists but has **zero production callers**. One row per seen `message_id`, forever.
**Fix:** call it periodically (e.g. on `flushOutbox` or startup, 7-day TTL).

---

## THEORETICAL / HARDENING

- **R5** — `extractMac` takes first MAC-like substring from attacker-controlled BT device name (misdirection only; Ed25519 auth still holds). Fix: anchor parse to parenthesized suffix.
- **R6** — negotiation anti-replay in-memory only; signed messages lack timestamp freshness (contained by terminal states + expiry + human approval). Fix: persist nonces; enforce window in `verifyNegotiationMessage`.
- **R7** — QR display-name newline/control-char injection into pairing dialog (social-engineering aid). Fix: sanitize to single line before interpolation.
- **R8** — all-zero ephemeral accepted in HELLO (no KDF-input validation; no third-party advantage today). Fix: reject in `parseHello`.
- **D4** — `sessionTag` binding implemented but never activated (comments overclaim). Fix: pass live tag at issuance or downgrade comments.
- **D5** — `resultSchema` never validated (comment claims it is; harmless in v1, display-only). Fix: validate or correct comment.
- **D6/D7** — card omits taskId/expiry; stale `inboundIndex`/`taskNegotiation` on timeout (memory leak). Fix: render; hook sweep to purge.
- **D13/D14** — multi-scope token runs only `scopes[0]`; `documentBase64` accepted for non-summarize scopes. Fix: reject at `handleTaskRequest`.
- **B6** — non-atomic replace (`copyAsync` over live file); safety copy may be WAL-inconsistent (no checkpoint first). Crash-window only. Fix: checkpoint → tmp + integrity check + atomic rename; boot recovery.
- **B9/B10/B11** — old backups never pruned; whole-file in-memory base64; manifest `version` unchecked on restore.
- **K-2** — clipboard DEK never auto-cleared (`BackupScreen.tsx:258`) — **downgraded**: screen is unreachable dead code (never imported). Latent only; fix if the screen is ever wired.
- **K-3** — DEK hex in immutable JS strings (no zeroing possible) — accepted residual; Keystore-at-rest unaffected.
- **K-4** — create-backup biometric bypass ("warn and continue" never warns; string-matched `instanceof`) — **downgraded**: in unreachable `BackupScreen`. The *live* path (`backupShare.createBackupFile` ← `ModelSetupScreen`) is fail-closed. Latent only.
- **K-5** — rekey crash bricks DB; recovery never runs — **downgraded/corrected**: coordinator verified `checkStaleRekeyStaging` **IS** called at startup (`App.tsx:183`, 3-arg probe-based signature) and `rotateDatabaseKey`'s only caller is the unreachable `BackupScreen`. The brick scenario cannot occur in production. Plaintext staging remains a theoretical concern if the screen is ever wired.
- **K-6** — PRAGMA key builders lack self-validation (all current callers validate; one-line regex guard kills the class).
- **M-3** — bundle OOM via extract-before-validate — unreachable today (single caller pre-validates); harden per B3.

## MITIGATED (verified closed this pass)

P2P: handshake crypto core (Ed25519 domain separation, ts-in-signature, atomic persistent anti-replay surviving both clock-jump directions, HELLO-alone-never-routes, deterministic simultaneous-dial tie-break, HKDF-SHA512, no UKS, no reflection), framing caps (256 KB both directions; `FrameReassembler` OOM latent — `handleBytes` has no production callers), per-MAC R8 pre-auth gate, reconnect backoff + flap guard, `hello_nonce_cache` pruning. Delegation: scope firewall (structural — executor has no tool mechanism; spotlighting honestly framed as cost-raising only), token audience binding (cross-device replay dead), same-taskId replay (`executed` set), global approval rate limit (fail-closed), result display-only consumption, `runningExecutors`/`runningPeers` cleanup in `finally`, approvalGate bounds. Keystore: zero key material in logs/errors (branch/alias only), no crash-reporting SDK, biometric core gate fail-closed, no deep-link scheme / intentFilters, no WebView. Backup: bundle carries fingerprint only (no DEK), app-private backup dir, UI restore flow well-gated (picker→private cache, confirm, biometric).

---

## COORDINATOR CORRECTIONS TO WORKER CLAIMS

1. **K-5 premise false.** Worker: "recovery never called at startup." Coordinator: `App.tsx:178-213` calls `checkStaleRekeyStaging(stagingPath, storeDek, openDb)` during startup before first DB open, with the current 3-arg probe-based signature. And `rotateDatabaseKey` is reachable only from `BackupScreen.tsx:90`, which is never imported anywhere (only a comment reference in `App.tsx:212`). Downgraded to THEORETICAL.
2. **K-4/K-2 blast radius.** Both live in unreachable `BackupScreen`. The live DEK-export path (`ModelSetupScreen.tsx:419` → `backupShare.createBackupFile`) is biometric fail-closed. Downgraded to THEORETICAL (fix if the screen is ever wired — and it shouldn't be wired without fixing these first).
3. **B1/B2/B13/D1 independently confirmed** by the coordinator against `.d.ts`, full `validateBackup` source, and `approvalGate.ts`.

## FIX PRIORITY (adversary's ranking)

1. **B13 + B1** — restore is broken on both paths; fix the header gate (trial-open replaces it) and the arg swap. Without these, backup is write-only.
2. **B2** — mandatory `dekFingerprint` + trial-open before replacing the live DB (only true integrity hole).
3. **R1** — bind `spk` into the pairing fingerprint (impersonation is the worst confidentiality outcome here).
4. **D1** — per-peer registration limit + deny cooldown (cheapest remote attack).
5. **B3/B4/B5, D-2, R2, R4, R3** — resource exhaustion and revocation wiring.
6. **D3, D-3, D2** — hangs, leaks, card truthfulness.
7. **Backlog** — R5–R8, D4–D7, D13–D14, B6, B9–B11, K-6, M-3 + the two targeted tests from re-audit #7 §4.

## Appendix: audit trail (2026-10-09)

Initial 5-doc audit → `REAUDIT_2026-10-09.md` → `FINAL_AUDIT_2026-10-09.md` → `FINAL_FACEBOOK_AUDIT_2026-10-09.md` → `REAL_ATTACKS_REVIEW_2026-10-09.md` → `FINAL_FACEBOOK_AUDIT_2_2026-10-09.md` → `FINAL_FACEBOOK_AUDIT_3_2026-10-09.md` → `FINAL_DEVICE_AUDIT_2026-10-09.md` / `DEVICE_AUDIT_WORKER_2026-10-09.md` → `FINAL_COMPREHENSIVE_AUDIT_2026-10-09.md` → `REAUDIT_6_2026-10-09.md` → `REAUDIT_7_2026-10-09.md` (GREEN) → **`REDTEAM_AUDIT_2026-10-09.md`** (this report)
