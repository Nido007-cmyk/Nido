# First Physical Device Phase — BASELINE TEST PLAN

> **Phase:** FIRST PHYSICAL DEVICE — FREEZE THE BASELINE
> **Date:** 2026-09-27
> **Code freeze:** effective now. No new app/code changes until the baseline pass is complete and the bug list is triaged.

## Baseline artifact (DO NOT rebuild, modify, or replace for this pass)

- File: `app-debug.apk`
- Source: CI run **36330270921** (workflow Android APK)
- Commit: **`e80de5c`** — `ci: deep-clean runner disk after tool setup + cancel-in-progress`
- Size: 167,297,727 bytes (~167 MB)
- SHA-256: `252ec5ba8b6a33f16a9176808e158f0f58ab1fe2e2a267c60889fde14819f8f5`
- ABI: arm64-v8a only
- Native: `librnllama.so` + `librnllama_jni.so` confirmed present
- Package: `team.nido.app`
- Preserved at: `docs/ci-evidence/artifacts/run-36330270921/app-debug.apk` (+ `METADATA.md`)
- **ANDROID COMPILED = VERIFIED.** INSTALLED / TESTED / VERIFIED remain independent states (see below).

## Provenance map — the critical distinction

| Code | In baseline APK (e80de5c)? | Where it lives |
|---|---|---|
| Lane A: English-first i18n (commit 1390157) | **NO** | Second-pass APK only |
| Lane B: verified Clear All Data (commit 1390157) | **NO** | Second-pass APK only |
| UsageStats wiring / SystemMonitor removal | **NO** | Uncommitted local changes; not in any APK |
| Everything else (wizard, chat, P2P screen, telemetry, drawer) | YES | Baseline |

**Rule:** never test a 1390157 feature against the e80de5c APK and report it as a failure.
A "missing" Lane A/B behavior in this pass is **expected provenance, not a bug**.
Record it as `NOT PRESENT IN BASELINE (e80de5c)` — do not file it.

## Second pass (separate)

CI run **36336288554** is building commit **1390157**. If it succeeds, preserve its APK
as the second-pass candidate: **that** is the build where English-first and the
verified Clear All Data implementation get tested. Keep the two passes and their
bug lists separate.

## Test procedure — 18 steps

Execute in order. For each step record PASS / FAIL / UNVERIFIED with device evidence.
On FAIL, capture (exact step, observed, expected, logcat/ADB evidence, reproducible?,
suspected component) and **continue capturing — do not fix during the baseline run.**

### 0. Preconditions
- Physical arm64 Android device, Android 8+ (API 26+), USB debugging on.
- `adb devices` shows exactly one device in `device` state.
- **Metro dev-server REQUIRED (static-analysis finding F1): this APK contains NO JS
  bundle (`bundleInDebug=false`).** On the host machine: `npx expo start --localhost`
  (forces Metro onto the USB `adb reverse` tunnel), then `adb reverse tcp:8081 tcp:8081`.
  Keep Metro running for the whole pass; without it the app lands on the dev launcher
  and no JS loads. Record the Metro bundler version/commit alongside the APK data.
- Wi-Fi available for the one-time model download (step 6), then OFF.

### 1. Verify APK SHA-256 before installation
```
sha256sum app-debug.apk
```
Must equal `252ec5ba8b6a33f16a9176808e158f0f58ab1fe2e2a267c60889fde14819f8f5`.
If it does not match: STOP. Do not install.

### 2. Fresh install
- If any NIDO/BOAR install exists: `adb uninstall team.nido.app` first, and note it.
- `adb install app-debug.apk` → expect `Success`; launcher icon appears as NIDO.
- Record installer output verbatim.

### 3. Record device facts
Device model, Android/API version, available storage before install.

### 4. Cold launch
Tap the launcher icon (cold start). **Expect the expo dev launcher first** (no bundled
JS — finding F1). In the dev launcher, connect to the Metro bundler from step 0
(`http://localhost:8081` via `adb reverse`). Only then does the JS load.
Record: time to first screen, any crash/ANR, and the exact Metro URL used.

### 5. Mandatory setup wizard
Walk the wizard (`SetupWizardScreen` / `ModelSetupScreen mode="required"`).
Expected: app does NOT reach chat before the wizard completes.

### 6. Model download completes
Default model Qwen2.5-1.5B + embedding model (~1 GB total) over Wi-Fi.
Expected: progress shown; download completes; chat screen appears usable.
Note: this is the app's only required network access.

### 7. First local inference
Send: "What is 12 * 12?" — expect a short correct answer.
Two-turn: "My dog's name is Bruno." → "What is my dog's name?"
While a long answer generates, tap Stop — generation must halt promptly.
Watch for native crashes (llama.rn context must stay alive).

### 8. Biometric / background lock
From chat: press Home (or lock phone), reopen from recents.
Expected: lock screen appears BEFORE any chat content/data is visible.
Cancel the biometric prompt once → error state, data stays hidden.
Authenticate → return to chat with state intact.

### 9. Process restart and persistence
Send one message, wait for reply. `adb shell am force-stop team.nido.app`. Relaunch.
Expected: biometric gate again; chat history present (SQLite); no crash, no
"database locked" / migration error.

### 10. Airplane mode — fully local inference
Enable airplane mode (no Wi-Fi, no mobile data). Send 3 messages: greeting,
factual question, follow-up referencing the earlier answer.
Expected: all answered locally, no network errors, no dead-end spinners.
Open drawer → My Documents, Telemetry, About: must render from local data only.

### 11. Conversation memory and persistence
Tell the assistant a durable fact ("Remember: my favorite color is green.").
Force-stop, relaunch, ask: "What is my favorite color?"
Record whether the fact survives (memory write/read path under test).

### 12. Language switching (BASELINE-ADJUSTED)
Cycle EN / ES / PT in Settings if a selector exists; force-stop; check persistence.
**Baseline rule:** Lane A (English-first) is NOT in this APK. Record the ACTUAL
default language on fresh install and actual behavior. Do NOT fail the APK for
not starting in English or for hardcoded Spanish strings — that expectation
belongs to the second pass (1390157). Scan for blank labels regardless.

### 13. Every reachable drawer screen
Open each drawer item; confirm it renders with a working back/close:
Prompts, My Documents, Settings (incl. System Recovery & Danger Zone card),
Telemetry, NIDO (P2P), About.

### 14. Usage Stats (BASELINE-ADJUSTED)
**NOT PRESENT in this APK** (wiring is uncommitted local work).
Do not test, do not file a bug. Record: `NOT PRESENT IN BASELINE (e80de5c)`.
(Second pass will test it only if the wiring has landed in code by then.)

### 15. Clear All Data (BASELINE-ADJUSTED)
Lane B is NOT in this APK. Run the wipe test **appropriate to e80de5c's state**:
create identifiable state (messages, a document if the flow allows, settings
changes, a durable memory fact), run Settings → System Recovery & Danger Zone →
Clear All Data, observe where the app lands, re-walk the wizard, check what
survives.
**Record old-wipe behavior factually.** Do NOT evaluate against the Lane B
contract and do NOT mark PRIVATE ALPHA NO-GO from this pass — the blocker
semantics apply to the second pass (1390157), where the verified wipe lives.

### 16. Encrypted-storage spot checks
```
adb exec-out run-as team.nido.app ls -l files/
```
Note DB filenames. `settings.json` is known-plaintext — confirm no secrets/keys in it.
UNVERIFIED in this pass (code-level only): SQLCipher actually encrypting DB files
(hexdump vs `SQLite format 3` header); Keystore/hardware-backed status (no UI exposes it).

### 17. NIDO P2P screen presence only
Drawer → NIDO (`NidoScreen`). Confirm it opens and explains Bluetooth phone-to-phone.
Presence only. Pairing/discovery/send-receive need a second physical phone —
do NOT claim two-device verification.

### 18. Record the verdict per step
Every step: PASS / FAIL / UNVERIFIED + device evidence.
FAIL capture: exact step · observed behavior · expected behavior · logcat/ADB
evidence (`adb logcat` around the failure) · reproducible? · suspected component.

## States — keep independent

- **COMPILED** — real `app-debug.apk` exists, SHA-256 recorded. (VERIFIED for this baseline.)
- **INSTALLED** — APK installed on the physical device and launched.
- **TESTED** — steps above executed on device, results recorded.
- **VERIFIED** — a claim backed by direct device evidence. UNVERIFIED stays UNVERIFIED.

Do NOT mark the project VERIFIED because installation succeeds.

## After the pass

1. Produce the prioritized bug list from step 18 captures.
2. Triage together: decide what changes to make (freeze lifts only by explicit decision).
3. Then — and only then — plan fixes.

## Sign-off

```
Steps PASS: ____ / 18     FAIL: ____     UNVERIFIED: ____     NOT PRESENT IN BASELINE: ____
Baseline APK SHA-256 verified pre-install: [ ] yes (hash: _________________)
Device: ___________________  Android/API: ___________  Date: ___________
Notes: _________________________________________________________________
```

*Baseline plan version: 2026-09-27. Baseline commit: e80de5c (run 36330270921).
Derived from FIRST_DEVICE_CHECKLIST rev2 with provenance adjustments.
Second pass: run 36336288554 / commit 1390157 (pending CI success).*
