# FINAL COMPREHENSIVE AUDIT — NIDO @ f7688b3

**Date:** 2026-10-09
**Auditor:** Final professional audit (5th pass), with delegated device-compatibility and security workers
**Scope:** Entire repo state at `f7688b3`, with emphasis on: CR-3/H-2 fix verification, new issues (5th pass),
device compatibility (different phone models + latest Android), full security re-check, license audit (new standing rule)
**Method:** Direct code reading (file:line), data-flow tracing, test-coverage mapping, `tsc`, targeted + full test runs.
Two read-only worker audits: device compatibility and security re-audit.
**License audit (NIDO LICENSE AUDIT RULE 2026-10-09):** all new source files since 2026-10-08 carry MIT headers;
no dependency changes in package.json/package-lock.json since 2026-10-08 (no new GPL/AGPL risk).

---

## VERDICT: DO NOT SHIP

Five audit passes, two delegated deep audits (device compatibility, security). The delegated security
worker independently confirmed the CR-3 recovery flaws and H-2 dead code, and added four new findings:
**G4** (no sender authorization on TASK_CANCEL/RESULT/REJECT — peer spoofing), **G3** (dormant sessionTag
binding), **K2-FAILOPEN** (integrity check skipped when manifest SHA is null/missing), and
**RESTORE-BIOMETRIC** (destructive restore with no authentication). P2P handshake, token chain, and
keystore/DEK handling verified SOLID. Device compatibility solid except targetSdk 36 and the llama.rn
16KB page-size crash-on-flagships.

Four carry-over criticals remain open (CR-2, CR-3-wiring+recovery-flaw, CR-4, H-2-broken), plus the
new mediums above. The physical device gate (user's Tab A9+) remains the binding constraint for any
public-APK claim, and per repo AGENTS.md, `tsc`/`vitest` prove only JS/TS consistency — never native
build correctness.

---

## 1. Fix verification (what f7688b3 claimed to fix)

### CR-3 (rekey crash-safe staging) — PARTIALLY FIXED, with NEW flaws
Staging write before rekey exists (`src/security/keyRotation.ts:76-84`), keystore write, staging delete on success.
But:
- **CR3-NEW (HIGH): recovery can brick the DB.** `checkStaleRekeyStaging` blindly writes the staged
  `newDekHex` to the keystore without verifying whether `PRAGMA rekey` actually executed before the crash.
  Crash window (a) — after staging write, before rekey: DB still has old DEK; recovery overwrites keystore
  with the new DEK → DB unopenable → brick. The recovery must probe-open the DB with the staged DEK first:
  if it opens, rekey happened → write to keystore; else delete staging and do nothing.
  `checkStaleRekeyStaging`'s signature `(stagingPath, storeDek)` lacks the `openDb` needed for the probe.
- **CR3-NEW2 (HIGH): staging not deleted on the revert path.** If `storeDek` throws and the revert
  `PRAGMA rekey` back to the old DEK succeeds (`keyRotation.ts:92-99`), the function returns
  `{ok:false}` WITHOUT deleting the staging file. A later `checkStaleRekeyStaging` run would then
  write the staged (new) DEK to the keystore while the DB holds the old DEK → brick.
- **Wiring:** `checkStaleRekeyStaging` and `rotateDatabaseKey` have zero callers outside tests
  (CR-2 still open) — the crash window is not closed in the product at all; staging files would
  accumulate and recovery would never run.
- **Test gap:** `keyRotation.test.ts` (4 tests) has zero coverage of staging write/delete/revert/recovery.
- **Plaintext DEK on disk (MEDIUM):** the staging file stores `newDekHex` as plaintext JSON in the
  app-private directory. Android sandboxing limits exposure, but a rooted device or full backup
  extraction exposes the DEK. Document as a known tradeoff or encrypt staging with the old DEK.

### H-2 (no TASK_RESULT after TASK_CANCEL) — NOT FIXED (dead code)
`delegationService.ts:452-466`: the try/catch around `executor.execute()` checks
`e.message.includes("abort")`. But `executor.execute()` catches ALL throws internally
(`executor.ts:198-206`) and returns `{ok:false, error:{code:"executor_error",...}}` — it never throws
the abort error. `wasAborted` is therefore never set, and the code proceeds to send TASK_RESULT
(with an error payload) to the peer after cancel. The existing test
(`delegationService.test.ts:238-254`) only asserts `abort()` was called, not result suppression.
Correct fix: after `execute()` returns, check `result.error?.code === "aborted"` — which requires
`execute()`'s catch to preserve a dedicated `"aborted"` code instead of folding it into
`"executor_error"` — or expose `executor.isAborted()`.
Deeper limitation (by design): `abort()` only sets a flag checked at `checkBudget()` boundaries;
a long in-flight `modelInvoke` cannot be truly interrupted — the LLM runs to completion and the
result is discarded (wasted compute/battery, bounded by maxDurationMs watchdog).

---

## 2. Still open from previous audits (re-confirmed at f7688b3)

- **CR-2 (CRITICAL):** `rotateDatabaseKey()` / `checkStaleRekeyStaging` have no UI entry point and no
  startup wiring. Dead code in production.
- **CR-4 (CRITICAL):** `revokePeer()`/`unrevokePeer()`/`isRevoked()` on nativeTransport have no UI callers;
  `revokedPks` is an in-memory `Set` — revocation does not survive restart. (Note: `replayProtection.ts`
  has a separate `revokePeer` for handshake grants — different concept, not affected.)
- **NEW3-M-2 (LOW, downgraded per worker):** K1 DEK-fingerprint check is skipped when the device has no DEK yet.
  Worker notes fresh installs generate a DEK at first launch, so the branch is rarely reachable — but the
  silent skip remains if any restore-before-first-open path exists. No DEK-import flow exists anywhere,
  so cross-device restore is currently impossible (K1 correctly blocks it) — product gap, not vuln.
- **NEW3-M-1 (MEDIUM):** `restoreBackup` extracts the bundle before validating its shape; the exported
  function trusts its input (the UI validates first, but defense-in-depth is missing).
- **NEW3-M-3 (MEDIUM):** `sha256File` hashes a JS-string coercion, not raw file bytes — self-consistent,
  so integrity checks work, but `manifest.sha256` is not a true file hash.

## 3. New issues found on this pass

### From direct verification
- **H2-NEW (HIGH):** H-2 fix is dead code (see §1). TASK_RESULT (error payload) is still sent after TASK_CANCEL.
- **CR3-NEW (HIGH):** rekey recovery can brick the DB — crash-before-rekey + blind keystore overwrite (§1).
- **CR3-NEW2 (HIGH):** staging file not deleted on the revert path → later recovery bricks DB (§1).
- **BUNDLE-STRICT (LOW):** `validateBundle` requires `dekFingerprint`/`sha256` to be strings, but
  `createBackup` can write them as `null` (keystore/digest failure) — the app can create a bundle it
  then refuses to restore. Fail-closed direction (safe), latent.
- **TEST-GAPS (MEDIUM, process):** zero round-trip test for bundle create→validate→extract→restore;
  zero tests for `validateBundle`; zero tests for rekey staging/recovery; zero tests asserting
  TASK_RESULT suppression after abort.

### From the delegated security worker (full report: `docs/research/SECURITY_AUDIT_WORKER_2026-10-09.md`)
- **G4 (MEDIUM):** TASK_CANCEL/TASK_RESULT/TASK_REJECT never verify `fromPkHex` == the task's original
  requester (`delegationService.ts:308-345`). Any paired peer that learns a taskId can kill another
  peer's approval card, abort its in-flight task, or forge results. Missing authorization check.
- **G3 (MEDIUM):** token `sessionTag` binding is documented but dormant — never issued (`:270`) nor
  verified (`:346`). A documented security property that doesn't exist in code.
- **K2-FAILOPEN (MEDIUM):** K2 is fail-open when `manifest.sha256` is null or the manifest is missing
  (`backup.ts:280,306`) — inconsistent with `validateBundle`. A tampered legacy backup is copied over
  the live DB with no integrity check.
- **RESTORE-BIOMETRIC (MEDIUM):** restore has no biometric gate (`ModelSetupScreen.tsx:470-510`).
  Destructive operation (replaces all data) with no authentication — anyone holding the unlocked
  phone can wipe it via a foreign backup.
- **G1 (LOW):** `establishRoute` abort paths never `fill(0)` the ephemeral secret.
- **G2 (LOW):** `P2PSession.sessionKey` never zeroed on `destroy()` (`messenger.ts:306`).

---

## 4. Device compatibility (worker audit — full report: docs/research/DEVICE_AUDIT_WORKER_2026-10-09.md)

**Overall: SOLID.** Permission and version-branching code is correct with API-level guards in the right places.

| Area | Verdict |
|---|---|
| Bluetooth permissions (API 31+ `BLUETOOTH_SCAN/CONNECT`, pre-31 `ACCESS_FINE_LOCATION`, API 33+ `POST_NOTIFICATIONS`) | OK — `NidoP2PManager.kt:166-181`, manifest `neverForLocation` flag |
| Exact alarms (API 31+/34 `SCHEDULE_EXACT_ALARM`) | OK — dedicated Kotlin bridge with `canScheduleExactAlarms()` + settings-recovery path; JS one-per-session fallback |
| Foreground service (API 34 `connectedDevice` type) | OK — declared in module manifest, runtime branches API 30+ |
| CPU ABI | OK by build design — release APK is arm64-v8a only (`android-apk.yml:183-188`); 32-bit devices fail install cleanly (`INSTALL_FAILED_NO_MATCHING_ABIS`), no runtime crash. Coverage note: 32-bit/Android-Go (low-end LATAM) cannot use NIDO — implicit product decision, undocumented |
| RAM | OK — 3-layer: pre-flight working-set estimate (`ramBudget.ts`, incl. logits term), native RSS monitor (`/proc/self/status`), human-readable OOM failure path |
| Biometric | OK — fallback chain hardware → enrolled → device PIN → none; `BiometricUnavailable` is explicit, never silent |
| Bluetooth absent | OK — nullable adapter, graceful "not available" |
| Hardcoded device assumptions | OK — no `Build.MANUFACTURER/MODEL` checks, no hardcoded paths; layout constants are responsive-safe |
| Expo/RN currency | OK — expo 57.0.25 / RN 0.86.3 (current line) |

**Gaps:**
- **HIGH:** targetSdk 35, not 36 (Android 16). Play requires API 36 for new apps since 31 Aug 2026. Fix: pin via `expo-build-properties`, re-run Android 16 checklist.
- **HIGH:** llama.rn `.so` files are 4KB-aligned, no 16KB page-size support (`readelf` verified, no `.note.gnu.property`). Android 15+ enforces 16KB pages on capable devices; Android 16 makes it default (Pixel line). **The app will crash at inference init on new flagship phones** — exactly the "latest Android" the user asked about. Fix must come from llama.rn (rebuild with `-Wl,-z,max-page-size=16384`) or upgrading the package.
- **LOW:** `startForegroundService()` from background would throw on API 31+ — latent (only user-driven paths call it today).
- **LOW:** portrait lock + predictive-back disabled — cosmetic on Android 16 tablets/foldables (incl. the Tab A9+).

---

## 5. Security re-audit (delegated deep pass + direct verification)

Full worker report: `docs/research/SECURITY_AUDIT_WORKER_2026-10-09.md`. Read-only; no source modified.

| Area | Verdict |
|---|---|
| P2P handshake (`src/p2p/`) | **SOLID** |
| Delegation (`src/agent/delegation/`) | **GAPS** |
| Backup/restore (`src/security/backup.ts`, `src/ui/backupShare.ts`) | **GAPS** |
| Keystore/DEK (`src/privacy/keyManager.ts`, `src/security/`) | **SOLID** |
| `src/security/keyRotation.ts` | **GAPS (HIGH — latent, zero production callers)** |

**P2P — SOLID.** CSPRNG X25519 ephemerals (`crypto.ts:216`, PRNG fail-closed `crypto.ts:59-107`);
Ed25519 signs HELLO v3 (`pk|eph|nonce|ts`, ts inside signature) and CONFIRM v1 (both nonces);
atomic persistent anti-replay (`store.ts:1481`), claimed only after signature verification
(`nativeTransport.ts:1076→1086`); 3600s window > 600s skew; R8 pre-auth rate limit; HKDF-SHA512;
32-byte peer key validation; HELLO-alone-never-routes invariant holds. Hygiene-only:
**G1 (LOW)** — `establishRoute` abort paths (revoked `:1195`, manual-disconnect `:1203`, tie-break loss
`:1220`) never `fill(0)` the ephemeral secret; **G2 (LOW)** — `P2PSession.sessionKey` never zeroed
on `destroy()` (`messenger.ts:306`).

**Delegation — GAPS.**
- **G4 (MEDIUM, NEW):** `delegationService.ts:308-345` — TASK_CANCEL / TASK_RESULT / TASK_REJECT never
  check that `fromPkHex` equals the task's original requester. Any paired peer that learns a taskId
  (UUID, but transmitted over the P2P channel) can kill another peer's approval card, abort its
  in-flight task, or forge results. Missing authorization check on inbound protocol messages.
- **G3 (MEDIUM, NEW):** the token's documented `sessionTag` binding is dormant — never issued (`:270`)
  nor verified (`:346`). Documented security property that doesn't exist in code.
- **G5 (MEDIUM-LOW):** confirms H2-NEW from §1 — `abort()` sets a flag checked only in `checkBudget()`
  (`executor.ts:115`), which runs once per execution; a cancel during `modelInvoke` (up to 120s) is
  silently ignored and TASK_RESULT is still sent (`delegationService.ts:460-478`).
- Token chain itself strong (canonical chained Ed25519, issuer/audience/expiry/scope binding,
  verify-before-attenuate). ApprovalGate excellent (SHA-512 snapshot, TOCTOU fail-closed, 10/hr
  window, 1000-entry bound).

**Backup/restore — GAPS (medium-low).**
- **K2-FAILOPEN (MEDIUM, NEW):** K2 is fail-open when `manifest.sha256` is null or the manifest is
  missing (`backup.ts:280,306`) — inconsistent with `validateBundle`, which requires both fields.
  A tampered legacy backup (no manifest) is copied over the live DB with no integrity check.
- **RESTORE-BIOMETRIC (MEDIUM, NEW):** restore has no biometric gate (`ModelSetupScreen.tsx:470-510`).
  Restore is destructive (replaces all data) yet requires no authentication — anyone holding the
  unlocked phone can wipe it via a malicious/foreign backup.
- K1: worker notes fresh installs generate a DEK at first launch, so the K1 skip branch
  (`backup.ts:271-273`) is rarely reachable — downgrading NEW3-M-2 to LOW, with the caveat that the
  silent-skip remains if any restore-before-first-open path exists.
- **No DEK import flow exists anywhere** — cross-device restore is currently impossible (K1 correctly
  blocks it); this is a product gap, not a vulnerability.
- Extract-before-validate ordering, accumulating `*.pre-restore-*` copies, 500MB-comment/100MB-code
  mismatch: LOW.

**Keystore/DEK — SOLID.** 32-byte CSPRNG DEK (`keyManager.ts:217`), SecureStore/Keystore storage, zero
key material in logs/errors, PRAGMA hex-validated before interpolation (`:518-521`), fail-closed
semantics throughout. No DEK exposure without biometric (except the documented no-biometric-device
tradeoff in dead-code `BackupScreen`).

**keyRotation.ts — HIGH (latent).** Worker independently confirmed CR3-NEW/CR3-NEW2 and found the
plaintext staging (`G9`, `keyRotation.ts:78-88`) plus the blind keystore overwrite (`G10`, `:116-146`)
plus never-called-at-boot (`G11`). **Do not wire this module up before G9/G10 are fixed.**

**License spot-check (standing rule):** all reviewed files carry the NIDO MIT header; TweetNaCl is
public domain; no new dependencies in reviewed modules.

---

## 6. What's solid (confirmed this pass)

- TSC clean (`npx tsc --noEmit`, exit 0) at f7688b3.
- Full suite: **2145/2145 green** (168 files) at f7688b3.
- Targeted: keyRotation (4), delegationService, approvalGate, backup, backupShare — 39/39 green.
- **P2P handshake (worker-verified):** CSPRNG X25519 ephemerals with fail-closed PRNG, Ed25519-signed
  HELLO v3/CONFIRM v1 (timestamps and both nonces inside signatures), atomic persistent anti-replay
  claimed only after signature verification, HKDF-SHA512, 32-byte key validation, HELLO-alone-never-routes.
- **Delegation token chain (worker-verified):** canonical chained Ed25519, issuer/audience/expiry/scope
  binding, verify-before-attenuate.
- **Keystore/DEK (worker-verified):** 32-byte CSPRNG DEK, SecureStore/Keystore storage, zero key material
  in logs/errors, hex-validated PRAGMA, fail-closed semantics.
- NEW-CR-1 bundle restore path: `validateBackup` detects `.nidobackup.json` → `validateBundle` (100MB cap, manifest shape check) → `restoreBackup` extracts then re-validates; K1/K2 enforced on extracted files.
- NEW-CR-2: `createBackupFile` requires biometric before DEK exposure; bundle carries fingerprint only, never the raw DEK.
- NEW3-H-1: restore uses `actualUri` for the knowledge DB (no longer silently dropped for bundles).
- NEW-H-2: manifest shape validated on both bundle and raw-.db paths; H-5 fail-closed on SHA-compute failure intact.
- H-1: token-buffer flush on all chat paths (fixed, adaptive, deep-research).
- ApprovalGate: rate-limit ordering correct (slot retained on limit), executed-set bounded at 1000 (FIFO), F-DELEG-4 fail-closed.
- P2P revocation check present in `establishRoute` (unreachable without UI, but the gate is correct).
- License: MIT headers on all new files; zero dependency changes (no GPL/AGPL risk); TweetNaCl public domain.
- i18n: `dekFraudWarning` present in es/en/pt.

## 7. Priority order

1. **CR3-NEW + CR3-NEW2** — make rekey recovery probe-based (open DB with staged DEK before touching keystore) and delete staging on the revert path; add staging/recovery tests. (Data-loss risk.)
2. **H2-NEW / G5** — preserve a dedicated `"aborted"` error code through `execute()`; suppress TASK_RESULT on abort; add a test asserting no TASK_RESULT is sent.
3. **G4** — verify `fromPkHex` == task requester on TASK_CANCEL/TASK_RESULT/TASK_REJECT. (Peer-spoofing.)
4. **K2-FAILOPEN** — make raw-.db validation fail-closed when manifest exists but `sha256` is null/missing (match `validateBundle` strictness).
5. **RESTORE-BIOMETRIC** — require biometric before destructive restore.
6. **CR-2** — wire F-KEY-1 UI + call `checkStaleRekeyStaging` at startup (only after 1 is fixed).
7. **CR-4** — revocation persistence (store) + UI.
8. **G3** — either implement `sessionTag` binding or remove it from the documented token contract.
9. **Device HIGHs** — targetSdk 36 pin; llama.rn 16KB page-size rebuild/upgrade (blocks "latest Android" flagships).
10. **Backlog** — NEW3-M-1, NEW3-M-3, BUNDLE-STRICT, G1, G2, portrait/predictive-back, FGS background guard, 32-bit coverage decision doc.

## 8. Final recommendation

**DO NOT SHIP the public APK yet.** The two highest-priority items are both data-loss-class
(CR3-NEW/CR3-NEW2: rekey recovery can brick the DB) and protocol-correctness (H2-NEW: cancel does not
actually suppress the result). Both are small, well-understood fixes with clear tests — estimated
half a day including the test suite. After those land, plus the startup wiring for recovery (CR-2),
the code is in shippable shape **pending the physical device gate**: per repo AGENTS.md, static
checks prove JS/TS consistency only — the Tab A9+ gate (P2P, reminders/Doze, backup round-trip,
model inference incl. the 16KB-page question on current hardware) remains the binding constraint,
and the GitHub Actions APK is the only official build artifact.

---

## Appendix: audit trail (2026-10-09)

- `AUDIT_INDEX_2026-10-09.md` + `AUDIT_BUGS_2026-10-09.md` + `AUDIT_SECURITY_2026-10-09.md` + `AUDIT_TECH_SCOUT_2026-10-09.md` + `AUDIT_ARCHITECTURE_2026-10-09.md` — initial audit (21 bugs, 4 verified security issues)
- `REAUDIT_2026-10-09.md` — re-audit found R1/R2/R3/I1/I2 regressions
- `FINAL_AUDIT_2026-10-09.md` — verdict NOT READY (C1, C2 + 3 HIGH)
- `FINAL_FACEBOOK_AUDIT_2026-10-09.md` — verdict DO NOT SHIP (CR-1..CR-4, H-1..H-5)
- `REAL_ATTACKS_REVIEW_2026-10-09.md` — documented real-world attacks mapped to NIDO mitigations
- `FINAL_FACEBOOK_AUDIT_2_2026-10-09.md` — verdict DO NOT SHIP (NEW-CR-1, NEW-CR-2, NEW-H-1, NEW-H-2)
- `FINAL_FACEBOOK_AUDIT_3_2026-10-09.md` — verdict DO NOT SHIP (fixes verified + NEW3-H-1/M-1/M-2/M-3)
- `FINAL_DEVICE_AUDIT_2026-10-09.md` + `DEVICE_AUDIT_WORKER_2026-10-09.md` — device compatibility (this report's §4)
- `DESIGN_N3_BRIEFING_2026-10-09.md`, `DESIGN_FKEY1_ROTATION_2026-10-09.md` — designs for N3, F-KEY-1
