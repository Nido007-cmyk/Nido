# FINAL DEVICE COMPATIBILITY AUDIT — NIDO @ 5728bce

**Date:** 2026-10-09
**Auditor:** Device compatibility + Android version specialist
**Scope:** Different phone models, latest Android, all remaining gaps
**Method:** Manifest analysis, native module review, code tracing. No source modified.

---

## VERDICT: DO NOT SHIP — 4 carry-over criticals still open

Device compatibility foundations are solid (permissions, services, CPU, RAM-aware). But 4 critical gaps from previous audits remain unimplemented, plus 2 mediums.

---

## DEVICE COMPATIBILITY

### ✅ Bluetooth Permissions (version-aware)
**File:** `modules/nido-p2p/.../NidoP2PManager.kt:166-180`
- API 31+: requests `BLUETOOTH_CONNECT` + `BLUETOOTH_SCAN` at runtime
- API <31: falls back to `ACCESS_FINE_LOCATION` (correct for legacy discovery)
- API 33+: adds `POST_NOTIFICATIONS` for foreground service notification
- Manifest has `neverForLocation` flag on BLUETOOTH_SCAN (no location needed on 12+)
- **Verdict:** Correct across Android versions.

### ✅ Exact Alarm (Android 12+)
**File:** `modules/exact-alarm/.../ExactAlarmModule.kt`
- Checks `Build.VERSION.SDK_INT >= S` before calling `canScheduleExactAlarms()`
- Returns `true` on older versions (no permission model)
- `openExactAlarmSettings` directs to system settings
- JS layer (N1) shows one-time alert guiding user to enable
- **Verdict:** Correct. Android 14+ `SCHEDULE_EXACT_ALARM` handled.

### ✅ Foreground Service (Android 14+)
**File:** `modules/nido-p2p/android/src/main/AndroidManifest.xml`
- Service declared with `android:foregroundServiceType="connectedDevice"`
- Runtime code uses `ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE` on API 30+
- Wake lock acquired for Doze protection during handshake
- **Verdict:** Correct. Manifest merger includes it at build time.

### ✅ CPU Architecture
- `llama.rn` ships `arm64-v8a` + `x86_64`
- No `armeabi-v7a` (32-bit ARM) — acceptable: <1% of active devices, all pre-2016
- **Verdict:** Covers 99%+ of target devices.

### ✅ RAM-Aware Model Selection
**File:** `src/models/defaultModel.ts`, `src/inference/ramBudget.ts`
- Default model follows device RAM (not one-size-fits-all)
- Pre-flight RAM check before model load
- Token buffering (5.1) reduces UI re-renders
- **Verdict:** Handles low-RAM devices gracefully.

### ✅ Biometric Fallback
**File:** `src/security/biometricGate.ts:85-95`
- Checks `hasHardwareAsync()` + `isEnrolledAsync()`
- Falls back to device credential (PIN/pattern) or "none"
- No crash on devices without biometric hardware
- **Verdict:** Graceful degradation.

### ⚠️ Screen Sizes
- `orientation: portrait` locked in app.json
- No foldable-specific handling found
- ChatScreen is scroll-based (adapts to height)
- **Verdict:** Acceptable. Portrait-only is a product decision, not a bug.

---

## CRITICAL (still open from previous audits)

### CR-2 — F-KEY-1 has no UI entry point
**Status:** CONFIRMED OPEN
- `rotateDatabaseKey()` exported in `src/security/keyRotation.ts`, 4 tests pass
- Zero callers in `src/ui/`
- Dead code. Users cannot rotate their DEK.

### CR-3 — Rekey crash window can brick DB
**Status:** CONFIRMED OPEN
- Staging mechanism exists only in code comments (lines 16-23)
- No actual staging file written before `PRAGMA rekey`
- Crash between rekey and keystore write = DB encrypted with unknown key
- **Fix needed:** Write new DEK to temp file BEFORE rekey; on startup, check for stale staging and recover.

### CR-4 — Revocation in-memory only, no UI
**Status:** CONFIRMED OPEN
- `revokePeer()` / `unrevokePeer()` / `isRevoked()` exist in `nativeTransport.ts`
- `revokedPks` is a `Set` — lost on process restart
- Zero UI callers
- **Fix needed:** Persist to database + add UI in contact list.

### H-2 — TASK_CANCEL doesn't stop in-flight modelInvoke
**Status:** CONFIRMED OPEN
- `delegationService.ts:293` calls `running.abort()` for executors
- But `modelInvoke` (the LLM call) has no abort signal wired
- Cancelled task still generates result and sends TASK_RESULT
- **Fix needed:** Pass AbortSignal through to model invocation.

---

## HIGH

### NEW3-M-2 — K1 skipped on fresh install (no DEK)
**File:** `src/security/backup.ts:271`
- If `getDatabaseKeyHex()` returns null (fresh install, no DEK yet), the DEK fingerprint check is skipped
- Restoring a foreign backup "succeeds" then bricks on first open
- **Fix:** If manifest has dekFingerprint but device has no DEK, warn user explicitly.

---

## MEDIUM

### NEW3-M-1 — restoreBackup extracts bundle before validating
**File:** `src/security/backup.ts:~300`
- `extractPortableBundle()` runs before `validateBackup()` on the extracted files
- UI calls validate first, but the exported function trusts its input
- Malicious bundle could write arbitrary files before validation
- **Fix:** Validate bundle shape BEFORE extraction (already have `validateBundle`).

### NEW3-M-3 — sha256File hashes string coercion, not raw bytes
- Self-consistent (same function for create and verify), so integrity works
- But `manifest.sha256` is not a true file hash — can't verify with external tools
- **Fix:** Use binary-safe hashing (low priority, internal consistency is what matters).

---

## LOW

- **L-1:** Bundle `.db` → `.nidobackup.json` string replace could theoretically overwrite source if filename is crafted (mitigated: bundle created by app, not user input)
- **L-2:** `*.pre-restore-*` safety copies never cleaned up (disk usage over time)
- **L-3:** Dead-code `BackupScreen` still in repo (confusing, not harmful)
- **L-4:** `extractPortableBundle` writes files before validation completes

---

## DEVICE MATRIX

| Capability | Tab A9+ (tested) | Other arm64 | Low-RAM (<4GB) | No biometric | Android 12 | Android 13 | Android 14+ |
|---|---|---|---|---|---|---|---|
| P2P connect | ✅ Physical | ✅ Code | ✅ Code | N/A | ✅ Perms | ✅ Perms | ✅ Svc type |
| Exact alarm | ✅ Physical | ✅ Code | ✅ Code | N/A | ✅ Bridge | ✅ Bridge | ✅ Bridge |
| Model load | ✅ Physical | ✅ arm64 | ✅ RAM-aware | N/A | ✅ | ✅ | ✅ |
| Backup/restore | ⏳ Pending | ✅ Code | ✅ Code | ✅ Fallback | ✅ SAF | ✅ SAF | ✅ SAF |
| Biometric gate | ✅ Physical | ✅ Code | ✅ Code | ✅ Fallback | ✅ | ✅ | ✅ |

**Legend:** ✅ = verified in code or physical | ⏳ = awaiting physical gate

---

## WHAT'S SOLID (verified this audit)

1. **Android permission model:** Version-aware BT permissions (31+/pre-31), notification permission (33+), exact alarm (12+)
2. **Foreground service:** Declared in module manifest with `connectedDevice` type, runtime API-level branching
3. **CPU:** arm64-v8a covers modern devices; x86_64 for emulator
4. **RAM:** RAM-aware model selection, pre-flight checks, token buffering
5. **Biometric:** Graceful fallback chain (hardware → enrolled → device credential → none)
6. **Crypto:** X25519 ephemeral + Ed25519 mutual auth + nonce anti-replay + HKDF-SHA512 (re-verified)
7. **Bundle fixes:** NEW-CR-1, NEW-CR-2, NEW-H-1 (100MB cap), NEW-H-2 all verified correct
8. **Tests:** 2145/2145 green, TSC clean

---

## PRIORITY ORDER

1. **CR-3** (crash-safe rekey staging) — data-loss risk
2. **H-2** (abort in-flight on TASK_CANCEL) — correctness
3. **CR-2** (F-KEY-1 UI) — feature completion
4. **CR-4** (revocation persistence + UI) — feature completion
5. **NEW3-M-2** (fresh-install K1 warning)
6. **NEW3-M-1** (validate before extract)

---

## PROCESS NOTE

Four audits, each finding flow-level incompleteness in the previous fix. The pattern: unit tests pass, integration fails. **Recommendation:** For every multi-step user flow fix, require a round-trip integration test (create → share → validate → restore → assert) before marking complete.
