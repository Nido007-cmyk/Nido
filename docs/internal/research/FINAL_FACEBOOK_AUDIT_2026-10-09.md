# FINAL FACEBOOK-LEVEL AUDIT — NIDO @ 2b369ad

**Date:** 2026-10-09
**Auditor:** Independent professional audit (Facebook-scale bar: 3B users)
**Scope:** Full codebase security, correctness, reliability review before public APK
**Method:** Direct code reading, data-flow tracing, test verification. No code modified.
**Baseline:** 2145/2145 tests passing, `tsc --noEmit` clean (verified during audit).

---

## VERDICT: DO NOT SHIP

Three features reported as "implemented and tested" are **dead code** — unreachable from the app. Most critically, the C1 backup-integrity fix (copy manifest + knowledge DB) was applied to `BackupScreen`, which **is not imported anywhere in the app**. The live backup flow (`backupShare` via share sheet) still ships only the raw `.db`, so the K1/K2/K3 protections do not apply to any real user. A claimed ship-blocker fix does not protect the actual user path. This must be resolved before public release.

---

## CRITICAL (ship-blockers)

### CR-1 — C1 fix landed in dead code; live backup flow unprotected

**Files:** `src/ui/BackupScreen.tsx` (dead), `src/ui/backupShare.ts:57-63` (live)

`BackupScreen` is not imported by any file in `src/` (verified: zero importers). The C1 fix (copy `.db` + `.manifest.json` + `.knowledge.db`) exists only there.

The reachable flow is `ModelSetupScreen.tsx:419-431` → `backupShare.createBackupFile()` → `shareBackupFile(path)`, which shares **only the `.db`** via the OS share sheet. The manifest (K1 DEK fingerprint, K2 SHA-256) and knowledge DB (K3) are left behind in the app-private directory.

**Impact:** A user who follows the in-app flow (Crear backup → Compartir backup → restore via document picker) gets:
- No DEK-mismatch detection (K1): restoring a backup from a different installation silently replaces the live DB with one the current DEK cannot open → **app bricked, data inaccessible**.
- No corruption detection (K2): truncated/corrupt `.db` passes "basic validation" (SQLite header only).
- No knowledge DB restore (K3): knowledge base silently stale after restore.

**Fix (pick one):**
- (a) Change `shareBackupFile` to bundle all three files (e.g., ZIP the `.db` + `.manifest.json` + `.knowledge.db` and share the ZIP; update `validateBackup`/`restoreBackup` to unpack), or
- (b) wire `BackupScreen` into the app navigation (drawer/settings) so the fixed flow is reachable, and remove or redirect the `backupShare` path.

**Why this matters at Facebook scale:** This is the exact class of bug that causes 1-star reviews saying "the app deleted all my data." The fix was verified by tests against the wrong UI.

---

### CR-2 — F-KEY-1 (DEK rotation) has no UI entry point

**File:** `src/security/keyRotation.ts` (104 lines, 4 passing tests)

`rotateDatabaseKey()` is exported but **never called** from any UI or service. No settings screen, no button, no wiring. Users cannot rotate their DEK. The feature was reported as "implemented" — the module exists and is unit-tested, but it is not part of the product.

**Fix:** Add a "Rotar clave de cifrado" option in Settings/Backup, wired to `rotateDatabaseKey` with the real `openDb` (SQLCipher handle) and `storeDek` (keyManager write + cache invalidation — see CR-3). Must pass physical-device testing before exposure (rekey on a live DB with the app's singleton connection open needs verification).

---

### CR-3 — F-KEY-1 crash-consistency window can brick the DB

**File:** `src/security/keyRotation.ts:78-95`

Order of operations: (1) `PRAGMA rekey` with new DEK → (2) `storeDek(newDekHex)` → on throw, rekey back. The rollback handles a *thrown* keystore error, but **not a process crash** between (1) and (2). If the app is killed in that window, the DB file is encrypted with the new DEK while the keystore holds the old one → **unopenable DB, data loss** (recoverable only from backup).

**Fix:** Write-ahead the new DEK: (1) store new DEK under a staging alias, (2) `PRAGMA rekey`, (3) promote staging → primary alias, (4) delete staging. On startup, if a staging DEK exists, attempt open with it (crash recovery). Alternatively, do the rekey inside a single native transaction scope if the driver supports it. At minimum, document the window and require a fresh backup before rotation in the UI.

Additional notes on `keyRotation.ts`:
- `oldDekHex` comes from `getDatabaseKeyHex()`, which enforces `/^[0-9a-f]{64}$/i` — no PRAGMA injection via this path. `newDekHex` is internally generated. Injection-safe as written.
- No post-rekey verification (close + reopen with new DEK + test query). Add it: fail-closed if the new key doesn't actually open the DB.
- `getDatabaseKeyHex()` caches via `dekInFlight`; after rotation the cache must be invalidated or the app will keep using the old DEK object. The injected `storeDek` signature gives the caller no hook for this — the real wiring must handle it.

---

### CR-4 — P2P contact revocation has no UI entry point; in-memory only

**File:** `src/p2p/nativeTransport.ts` (`revokePeer`/`unrevokePeer`/`isRevoked`, ~lines 803-826)

Same dead-code pattern: `revokePeer()` is never called from UI. Additionally, `revokedPks` is **in-memory only** — it does not survive app restart. The `establishRoute` check (correctly placed, first check in the function) only helps within a single process lifetime.

**Mitigating factor:** `handleHello` (line ~1061) requires the peer to be a known contact (`findContactByPk` → throw if unknown). If the revocation UI *also* calls `deleteContact`, the store deletion persists across restarts and inbound handshakes fail closed. But `revokePeer()` itself does not delete the contact — the two operations are not linked anywhere.

**Fix:** Implement the revocation UI action as an atomic operation: `revokePeer(pk)` + `deleteContact(pk)` + cancel reconnect timers. Persist revocation (e.g., a `revoked` column or a separate store table) so it survives restart even if the contact row is later re-added.

---

## HIGH (fix before public)

### H-1 — Deep Research path missing token-buffer flush (C2 class, missed)

**File:** `src/ui/ChatScreen.tsx:853-869`

The C2 fix added `flushTokenBuffer()` after the adaptive/fixed paths (line 1030), and `runFixedModelChat` flushes internally (line 929). But the **Deep Research path** (`await runDeepResearch(..., onToken, ...)`) streams through the same buffered `onToken` and never flushes afterward. The last <100ms of tokens never reach `setMessages` — the user sees a truncated message. (`assistantText` accumulates separately, so persistence is correct; the bug is display-only and transient.)

**Fix:** Add `flushTokenBuffer()` after the `runDeepResearch` await, or better, wrap the whole generation section in `try/finally { flushTokenBuffer(); }`.

### H-2 — TASK_CANCEL does not stop in-flight model inference

**Files:** `src/agent/delegation/executor.ts:128-140`, `src/agent/delegation/delegationService.ts:448-480`

`abort()` sets a flag checked only in `checkBudget()`, which runs **before** `modelInvoke(prompt)` — never during or after. If TASK_CANCEL arrives mid-inference (LLM calls run 10-60s), the model call completes, `execute()` returns normally, and `delegationService` **sends TASK_RESULT to the peer anyway** (lines 474-480, unconditional send).

**Impact:** LOW for privacy (it's the peer's own data coming back), but "cancel" is a lie for the common case. A malicious peer could also use this to burn the victim's battery/CPU after "cancelling."

**Fix:** After `executor.execute()` returns, check a cancelled-set before sending TASK_RESULT. For true mid-inference abort, the modelInvoke would need AbortSignal support — at minimum, gate the send.

### H-3 — `handleShowKey` shows DEK with zero biometric (latent)

**File:** `src/ui/BackupScreen.tsx:125-140`

The "Ver mi clave de cifrado" button calls `exportDatabaseKey()` with no `requireUnlock`. The K5 biometric gate was added only to `handleCreateBackup`. **Currently unreachable** (BackupScreen is dead code), but if CR-1 is fixed by wiring up BackupScreen (option b), this becomes an exploitable DEK disclosure to anyone holding the unlocked phone.

**Fix:** Add the same `requireUnlock` flow to `handleShowKey` before wiring the screen up. Better: move the biometric check *inside* `exportDatabaseKey()` (fail-closed by default) so no caller can forget it.

### H-4 — `executed` anti-replay set is unbounded

**File:** `src/agent/delegation/approvalGate.ts:149`

`executed` (F-DELEG-2) only grows — no pruning, no expiry. Each entry is a small string; volume is low for a personal assistant, but it is a memory leak by construction. More importantly, there is **no legitimate re-execution path**: if a task legitimately needs re-running (peer retries after a failed result), the taskId is permanently burned and the user gets a confusing "replay rejected" error.

**Fix:** Store `{ taskId, executedAt }` and evict entries older than the token's max expiry window (e.g., 24h). Or scope the set per-negotiation and clear on negotiation close.

### H-5 — K1/K2 fail-open when SHA computation fails

**File:** `src/security/backup.ts:204-208`

```ts
if (manifest.sha256) {
  const actualSha = await sha256File(uri);
  if (actualSha && actualSha.toLowerCase() !== manifest.sha256.toLowerCase()) {
```

If `sha256File` throws/returns null (I/O error, huge file), the integrity check is **silently skipped** and restore proceeds. Fail-open on the security check.

**Fix:** If manifest claims a SHA-256 but we cannot compute one, reject the restore (fail-closed) or at minimum surface an explicit warning requiring user confirmation.

---

## MEDIUM (backlog, fix soon)

### M-1 — Approval rate-limit leaves denied card in limbo (UX)

**File:** `src/agent/delegation/approvalGate.ts:301-311`

When the 11th approval in an hour is rate-limited, `approve()` returns null *without* releasing the pending slot. `delegationService.approveTask` then sends TASK_REJECT to the peer and emits "denied." Functionally correct (fail-closed), but the human tapped "Approve" and the card just dies with no explanation. Add a distinct return code/reason so the UI can say "too many approvals — try again later."

### M-2 — B7: Bluetooth-off kills the retry chain permanently

**File:** `src/p2p/nativeTransport.ts` (scheduleReconnect timer)

When BT is off, the timer callback returns early **without scheduling a follow-up**. No BT-state listener re-arms it. If the user toggles BT off/on, the peer never reconnects until the next `onNativeDisconnected` (which won't come — nothing is connected). The pre-B7 behavior (burn attempts) was worse, but the correct fix is to listen for BT adapter state and re-run discovery on `STATE_ON`.

### M-3 — BackupScreen hardcoded Spanish strings (if wired up)

**File:** `src/ui/BackupScreen.tsx`

"Crear backup ahora", "Ver mi clave de cifrado", "Guardar en Descargas", "Cerrar", the description paragraph, the warning box, and several `Alert.alert` strings are hardcoded Spanish. The H2 fix covered only the DEK modal. If CR-1 option (b) is chosen, migrate the rest to i18n.

### M-4 — Clipboard DEK never cleared

**File:** `src/ui/BackupScreen.tsx` (copy handler)

After "Copiar clave," the DEK sits in the OS clipboard indefinitely — readable by any app with clipboard access. Clear after 60s or show a "copied — clear your clipboard" notice.

### M-5 — `revokedPks` vs `manualDisconnectPks` interaction

**File:** `src/p2p/nativeTransport.ts`

`revokePeer()` calls `disconnect()`, which (no-MAC case) sets `manualDisconnectPks` with a 30s timestamp. The revocation check runs first in `establishRoute`, so ordering is safe. But `unrevokePeer` does not clear a stale `manualDisconnectPks` entry — a re-pair within 30s of revocation could be killed by the stale manual-disconnect flag. Edge case; clear both in `unrevokePeer`.

---

## LOW (backlog)

- **L-1:** `approvalTimestamps` pruning is O(n) shift-loop per approve — n ≤ 10, negligible, but a ring buffer would be cleaner.
- **L-2:** `Math.random()` used for non-crypto IDs (entity/session/message IDs) — acceptable, but `sessionManager`/`packShareService` session IDs feed P2P flows; prefer the secure PRNG already available per the T-009 note in `messenger.ts:163`.
- **L-3:** N3 DAILY trigger content freezes at schedule time; the hybrid re-schedule on startup mitigates it. If the user never opens the app, the briefing body goes stale — acceptable, documented in the design.
- **L-4:** `validateBackup` catches JSON parse errors from a corrupt manifest and falls back to basic validation — correct degradation, but a corrupt manifest alongside a valid DB could mask tampering. Consider distinguishing "manifest absent" from "manifest corrupt."

---

## WHAT'S SOLID (confirmed good)

**P2P handshake crypto** (`src/p2p/crypto.ts`, `nativeTransport.ts`):
- Fresh X25519 ephemeral per handshake (`generateEphemeral`), zeroed on every exit path (success via `deriveSessionKeyV2`, timeout, disconnect, send-failure) — R7 verified.
- Ed25519 mutual authentication bound to ephemeral + nonce + timestamp; MITM cannot substitute keys without the peer's signing key.
- Inbound HELLO requires a known paired contact with a signing key (`handleHello` ~line 1061) — unknown devices fail closed before any crypto.
- Atomic nonce-claim anti-replay (UNIQUE insert), ±10min timestamp skew, per-MAC inbound rate limiting (R8), handshake cooldown.
- Session keys via HKDF-SHA512 with canonical nonce ordering — both sides derive identical keys regardless of initiator.
- Tie-break for simultaneous handshakes is deterministic and safe.

**Delegation security** (`src/p2p/delegationToken.ts`, `approvalGate.ts`, `executor.ts`):
- Token signature chain verified link-by-link against the issuer's Ed25519 key; issuer/audience binding; UUIDv4 task IDs; scope allowlist; expiry with skew tolerance; session-tag binding (strict).
- Limits (`maxToolCalls`, `resultSizeLimit`) derive from *signed* caveats with narrowing-only semantics and hard ceilings in the executor (≤50 calls, ≤TASK_LIMITS).
- ApprovalGate: SHA-512 (nacl) snapshot integrity, deep-copy at register, no update API, timeout=deny, single-consume, R5 liveness re-check, fail-closed without provider (F-DELEG-4), per-peer pending caps, anti-replay (F-DELEG-2), 10/hour rate limit.
- Executor: budget enforcement, scope allowlist (fail-closed on unknown), prompt-injection spotlighting, `abort()` flag + executor registry (F-DELEG-3).

**Key management** (`src/privacy/keyManager.ts`, `src/security/secureDatabase.ts`):
- DEK from `expo-crypto` CSPRNG with module-shape assertion; 64-hex format enforced on read; fail-closed on corrupt/missing key (KeyLossError, never silent first-run).
- PRAGMA interpolation inputs are hex-validated (DEK from keystore, internally generated) — no injection path.
- No hardcoded secrets, no `Math.random` in crypto paths, no DEK in logs (verified by grep).

**i18n:** All new user-facing keys (`backup.dek*`, `dekFraudWarning`) present in es/en/pt. Canned responses now cover PT with templates, regexes, and locale detection.

**Tests:** 2145/2145 passing across 168 files; `tsc --noEmit` clean. New tests for rate limiting, F-KEY-1 rollback, revocation-adjacent P2P paths, and regression tests for each fix are behavior-verifying (not tautological) — spot-checked `approvalGate.test.ts` (21 tests) and `keyRotation.test.ts` (4 tests).

---

## PROCESS FINDING (for the parent agent)

Three separate audits today reported fixes as complete that are **not reachable in the product**: C1 (BackupScreen), F-KEY-1 (no UI), P2P revocation (no UI). The audits verified code correctness but not *reachability*. Recommend adding a "wiring check" to the fix-verification discipline: for every user-facing fix, `grep` for an import/call chain from a reachable screen. A fix in dead code is not a fix.

---

## PRIORITY ORDER

1. **CR-1** — make the live backup flow carry the manifest (or wire up BackupScreen). Nothing else matters if restores aren't integrity-checked.
2. **CR-3** — crash-safe DEK rotation (staging alias + recovery) before exposing F-KEY-1 in UI (CR-2).
3. **CR-4 + H-3** — wire revocation UI as atomic revoke+delete+cancel; persist revocation.
4. **H-1, H-2** — deep-research flush; cancel-gates-send.
5. **H-4, H-5** — bounded replay set; fail-closed SHA.
6. Backlog: M-1…M-5, L-1…L-4.
7. Physical device gate (out of scope for static audit).
