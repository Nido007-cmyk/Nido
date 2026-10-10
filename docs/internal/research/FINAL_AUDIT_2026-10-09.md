# FINAL AUDIT — NIDO @ 15535a6

**Date:** 2026-10-09
**Auditor:** Deep professional audit (Meta senior engineer level)
**Scope:** All work from 2026-10-08 night through 2026-10-09 morning (8 commits)
**Method:** Code review, integration tracing, test gap analysis. No source modified.

---

## VERDICT: NOT READY for public APK

Two critical integration failures must be fixed first. Three high-severity issues should be fixed before release. See below.

---

## CRITICAL (must fix before public APK)

### C1 — "Save to Downloads" bypasses K1/K2/K3 protections

**Files:** `src/ui/BackupScreen.tsx:73-100` (`handleSaveToDownloads`)

The batch-3 "Save to Downloads" feature (SAF) copies ONLY the `.db` file:
```typescript
const destUri = await FS.StorageAccessFramework.createFileAsync(
  perms.directoryUri, fileName, "application/octet-stream"
);
// ... copies only lastBackup (the .db file)
```

It does NOT copy:
- `${backup}.manifest.json` → K1 (DEK fingerprint) and K2 (SHA-256) checks are skipped on restore (validateBackup falls back to "basic validation" when manifest is missing)
- `${backup}.knowledge.db` → K3 (knowledge DB restore) cannot work

**Impact:** A user who follows the recommended flow (Backup → Save to Downloads → restore from Downloads) gets ZERO protection against:
- Restoring a backup from a different installation (wrong DEK → bricked DB)
- Corrupted/truncated backup files
- Stale knowledge DB

The K1/K2/K3 fixes only protect the app-private-directory flow, not the user-facing Downloads flow.

**Fix:** Copy all three files via SAF (`.db`, `.db.manifest.json`, `.knowledge.db`), or bundle them into a single archive (ZIP) with manifest inside.

---

### C2 — 5.1 token buffer not flushed on adaptive routing path

**File:** `src/ui/ChatScreen.tsx`

The 5.1 optimization buffers tokens and flushes every ~100ms. The flush is called:
- ✅ In `onToken` (first token, and every 100ms)
- ✅ After `await llamaEngine.generate(genInput)` in `runFixedModelChat()` (line ~928)

But NOT after `runAdaptiveChat()` completes (lines 932-1010). The adaptive path streams via the same `onToken`, but when it finishes, any tokens buffered in the last <100ms window are never flushed to `setMessages`.

**Impact:** UI displays incomplete response text (missing tail). The persisted `assistantText` is correct (it's accumulated separately), so data isn't lost — but the user sees a truncated message.

**Fix:** Add `flushTokenBuffer()` after the adaptive block completes (before line 1028's setMessages for citations).

---

## HIGH (should fix before public APK)

### H1 — Stale `manualDisconnectPks` flag blocks reconnect after handshake timeout

**File:** `src/p2p/nativeTransport.ts`

The R1 fix narrowed `manualDisconnectPks` to only set when there's no MAC (handshake in progress). But:

1. User taps Connect → handshake starts
2. User taps Disconnect → `disconnect(pkHex)` → no MAC → flag set ✅
3. Handshake times out → `failHello(mac, err)` → rejects pending, **does NOT clear the flag** ❌
4. User taps Connect → new handshake → `establishRoute` → sees STALE flag → rejects with "Desconectado por el usuario" ❌

`failHello` (line 934) clears the timer, deletes from `pending`, zeroes the secret, rejects waiters — but never touches `manualDisconnectPks`.

**Fix:** In `failHello`, if `pend.peerPk` is known, delete it from `manualDisconnectPks`. Or: clear the flag in `connect()` via MAC→pkHex lookup when available.

**Test gap:** The R1 regression tests cover disconnect-with-MAC and disconnect-without-MAC, but not the "disconnect → timeout → reconnect" sequence.

---

### H2 — K4 modal has hardcoded Spanish strings (new i18n gap)

**File:** `src/ui/BackupScreen.tsx:214,230,233`

The new copyable DEK modal (K4 fix) contains:
- "Backup creado" (line 214)
- "Copiar clave" (line 230)
- "Entendido" (line 233)
- "TU CLAVE (cópiala...)" etc.

None are in `src/i18n/locales/*.json`. This is a new I2-type violation introduced by the K4 fix.

**Fix:** Add keys to en/es/pt locale files and use `t()`.

---

### H3 — `reconnectManager` singleton is half-dead (confusing, not broken)

**File:** `src/ui/NidoScreen.tsx`, `src/p2p/reconnectManager.ts`

After B1, the singleton's `schedule()` is never called (commented out), but:
- `notifyPeerLost`/`notifyPeerFound` still track `lostPeers`
- `setConnector` still set (line 801)
- `cancel()` still called on manual connect (line 770)

The transport now owns reconnection. The singleton is a vestigial state tracker. It works (I1 fix ensures `lostPeers` is cleaned), but having two "reconnect" systems where one is neutered is a maintenance hazard.

**Recommendation:** Either fully remove the singleton or document clearly that it's now only a presence tracker, not a reconnect scheduler. Not blocking for APK, but tech debt.

---

## WARNINGS (fix soon, not blocking)

### W1 — B7, I3, F-DELEG-4 still open (from original audit)
Low-severity items never addressed. B7 (reconnect into dead radio), I3 (cannedResponses PT fallback), F-DELEG-4 (R5 liveness re-check skipped when provider unwired).

### W2 — 5.1: `flushTokenBuffer` defined after `onToken` uses it
Works at runtime (TDZ is satisfied by call time), but fragile. If someone refactors to call `onToken` synchronously during setup, it throws. Move definitions above `onToken`.

### W3 — K1/K2: manifest validation silently skipped for old backups
By design ("backups viejos"), but the user gets no warning that their backup has no integrity protection. Consider a one-time notice.

### W4 — Architecture: 17 of 18 items unaddressed
Only 5.1 was implemented. The God components, dead code, and medium refactors remain. Not blocking, but the tech debt is growing.

---

## CONFIRMATIONS (verified solid)

### P2P integration
- **B2** (multicast): Correct. `waiters` Set, `resolvePending`/`rejectPending` clear timers and settle all. Two new tests pass.
- **B4** (secret zeroing): Correct. `stopDiscovery` loop now calls `fill(0)`.
- **B5** (counter reset): Correct. `establishRoute` deletes from `reconnectAttempts` and cancels reconnect timer.
- **B6** (no raw MAC in onPeerLost): Correct. Else-branch now empty with explanatory comment.
- **B1** (single reconnect loop): Correct, with H1 caveat above.
- **B3+R1** (manual disconnect): Correct for the main flows, with H1 edge case above.

### Backup/restore
- **K1** (DEK fingerprint): Correct implementation. Manifest includes `dekFingerprint`, validateBackup compares. Bypassed only in Downloads flow (C1).
- **K2** (SHA verification): Correct. Compares manifest SHA with computed SHA.
- **K4** (copyable DEK): Correct functionality, H2 i18n gap noted.
- **K5+R2** (biometric gate): Correct. Falls back to warning when biometric unavailable.

### Delegation
- **F-DELEG-1** (token limits): Correct. `inboundIndex` carries `maxToolCalls`/`resultSizeLimit`, passed to `DelegatedExecutor`.
- **F-DELEG-2** (replay protection): Correct. `executed` Set in `ApprovalGate`, checked in `register()`, test updated.
- **F-DELEG-3+I2** (abort): Correct. `runningExecutors` map, `abort()` flag checked in `checkBudget()`, TASK_CANCEL handled before outbound check. New I2 test passes.

### Dates/notifications/i18n
- **A1** (local date): Correct. Uses `getFullYear`/`getMonth`/`getDate`, locale-aware `todayLong`.
- **A2** (past date rejection): Correct. Both tool path (`handlers.ts`) and notification path (`notifications.ts` N4) reject past dates.
- **N1** (session flag): Correct. `exactAlarmAlertShownThisSession` module flag.
- **N2** (init guard): Correct. `notificationsInitialized` with test reset export.
- **I1** (PT complete): Correct. 0 missing keys (verified).
- **I4** (en.deny): Correct. Added to en.json.

### Code quality
- No new TODOs introduced (one pre-existing in backup.ts manifest).
- No dead code from fixes (reconnectManager is reduced, not dead).
- No commented-out blocks.
- Error messages are in Spanish (appropriate for current UI default).

### Breaking changes
- None. Only one new export (`__resetNotificationsForTests`, test-only).
- All behavior changes are bug fixes, not API changes.

### Test coverage
- 2139 tests pass (167 files).
- New regression tests: B2 x2, F-DELEG-2 x1, R1 x2, I2 x1.
- **Gaps identified:** H1 (no test for disconnect→timeout→reconnect), C2 (no test for adaptive path flush), C1 (no integration test for Downloads flow).

---

## PRIORITY ORDER FOR FIXES

1. **C1** (Downloads manifest/knowledge) — 2 hours
2. **C2** (adaptive flush) — 15 minutes
3. **H1** (stale flag in failHello) + test — 1 hour
4. **H2** (K4 i18n) — 30 minutes
5. Full suite + tsc → push
6. Re-verify C1 with physical test (backup → Downloads → restore)

---

## APPENDIX: Files changed (3bcb31f..15535a6)

26 files, +2484/-61. Key source files:
- `src/p2p/nativeTransport.ts` (+101/-): B1-B6, R1, I1
- `src/security/backup.ts` (+72/-): K1-K3, R3
- `src/ui/BackupScreen.tsx` (+70/-): K4, K5, R2
- `src/ui/ChatScreen.tsx` (+26/-): 5.1
- `src/agent/delegation/delegationService.ts` (+54/-): F-DELEG-1/3, I2
- `src/agent/delegation/approvalGate.ts` (+13/-): F-DELEG-2
- `src/agent/delegation/executor.ts` (+10/-): F-DELEG-3
- `src/notify/notifications.ts` (+19/-): N1, N2, N4
- `src/agent/loop/agentLoop.ts` (+12/-): A1, I2
- `src/agent/tools/handlers.ts` (+9/-): A2
- `src/i18n/locales/pt.json` (+53/-): I1
- `src/i18n/locales/en.json` (+5/-): I4
- `src/ui/NidoScreen.tsx` (+10/-): B1, I1
