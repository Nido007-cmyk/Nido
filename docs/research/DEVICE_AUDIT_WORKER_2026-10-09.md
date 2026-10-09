# Device Compatibility Audit — NIDO Android (worker report)

- **Date:** 2026-10-09
- **Repo:** ~/workspace/nido-app, branch main, HEAD `f7688b3` (read-only audit, no source modified)
- **Scope:** does the app work on different phone models and the latest Android version?

Verdict scale: OK = no action needed. GAP (severity) = broken or at-risk on stated devices/versions.

---

## 1. Android SDK levels

| Setting | Value | Source |
|---|---|---|
| minSdkVersion | 24 (Android 7.0) | default in `node_modules/expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-plugin/src/main/kotlin/expo/modules/plugin/ExpoRootProjectPlugin.kt:53` |
| compileSdkVersion | 35 (Android 15) | same file, line 54 |
| targetSdkVersion | 35 (Android 15) | same file, line 55 |
| No override anywhere | confirmed: `android/build.gradle`, `android/app/build.gradle:88-94` only reference `rootProject.ext.*`; no `expo-build-properties` plugin in `app.json`/`package.json`; `plugins/` (with-bluetooth-never-for-location, with-data-extraction-rules, withBundledModels, withFlagSecure, withReleaseSigning) contains no SDK overrides |

Expo/RN versions: `expo 57.0.25`, `react-native 0.86.3`, `react 19.2.3` (`package.json`) — current SDK line.

**GAP (HIGH) — targetSdk 35, not 36 (Android 16).** Google Play requires new apps to target API 36 since 31 Aug 2026 (updates to existing apps follow ~Nov 2026). Expo SDK 57 defaults to 35/35; the repo does not pin 36 via `expo-build-properties`. Consequences: (a) Play submission of the APK will be rejected once the enforcement date hits; (b) Android 16 behavior changes (16KB page enforcement, large-screen resizability, predictive back default) do not fully apply — but see item 2 below, which makes the page-size issue real anyway. Fix path: add `expo-build-properties` pinning `compileSdkVersion 36`, `targetSdkVersion 36`, `buildToolsVersion 36.0.0`, then re-verify edge-to-edge + back navigation + large screens (Android 16 checklist).

**OK (with note) — minSdk 24** covers ~99% of active devices (Android 7.0+, 2016). No code path was found requiring a higher API without a version guard.

---

## 2. Runtime permissions by API level

### 2a. Bluetooth (API 31+ vs pre-31)
**OK.** `modules/nido-p2p/android/src/main/java/expo/modules/nidop2p/NidoP2PManager.kt:166-181` (`missingPermissions()`):
- API ≥ 31 (S): requests `BLUETOOTH_CONNECT` + `BLUETOOTH_SCAN`
- API < 31: requests `ACCESS_FINE_LOCATION` (required for discovery pre-31)
- API ≥ 33: additionally requests `POST_NOTIFICATIONS` (needed for the foreground-service notification)

Request flow: `NidoP2PModule.kt:103-141` (`requestPermissions`) uses expo-modules-core `askForPermissions` with the missing list, on the UI thread, with `E_NO_ACTIVITY`/`PERM_ERROR` failure paths. Manifest side is correct: `modules/nido-p2p/android/src/main/AndroidManifest.xml` declares the permissions; `BLUETOOTH_SCAN` carries `android:usesPermissionFlags="neverForLocation"` (app.json plugin `with-bluetooth-never-for-location`). All four ABIs' Bluetooth behavior is version-branched throughout (`NidoP2PManager.kt:134,238,281,318`).

### 2b. Notifications (POST_NOTIFICATIONS, API 33+)
**OK.** `src/notify/notifications.ts:66-76` — `initNotifications()` calls `Notifications.requestPermissionsAsync()` before creating channels and scheduling. Returns `false` when denied (callers degrade). The P2P path separately requests it at runtime (2a).

### 2c. Exact alarms (SCHEDULE_EXACT_ALARM, API 31+/34)
**OK.** Dedicated bridge `modules/exact-alarm/android/src/main/java/expo/modules/exactalarm/ExactAlarmModule.kt`:
- `canScheduleExactAlarms()` returns true below API 31, else queries `AlarmManager.canScheduleExactAlarms()`
- `openExactAlarmSettings()` fires `Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM` (the correct revocation-recovery path for Android 14+, where the permission defaults to denied and is a "special app access")

JS fallback: `src/notify/notifications.ts:137-164` — when exact alarms are unavailable, shows a one-per-session Alert directing the user to Settings and still schedules the reminder (expo-notifications falls back to inexact; documented in the code comment). No silent failure.

### 2d. Foreground services (API 34 declaration + runtime)
**OK.** `modules/nido-p2p/android/src/main/AndroidManifest.xml` declares the service with `android:foregroundServiceType="connectedDevice"` (the Android 14+ requirement), plus `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_CONNECTED_DEVICE` permissions. Runtime call matches: `NidoP2PService.kt:121-136` passes `FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE` on API ≥ 30, legacy call below. `context.startForegroundService()` used on API ≥ 26 (`NidoP2PService.kt:55-62`).

**GAP (LOW) — background FGS start risk.** `NidoP2PService.start()` uses `startForegroundService()`; on Android 12+ this throws `ForegroundServiceStartNotAllowedException` if invoked while the app is in the background. Today it is only reached from the user-driven P2P screen (foreground), so this is latent, not active. If any future auto-reconnect path calls it from a background receiver, the app will crash on Android 12+.

---

## 3. Hardware variation

### 3a. RAM — model selection / budget / OOM
**OK.** Three layers exist:
1. Pre-flight: `src/inference/ramBudget.ts` — full working-set estimate (weights + exact KV-cache formula + compute buffers + logits term `n_batch × n_vocab × 4B`, added 2026-10-09), checked against live RSS from the native `ram-monitor` module before every load.
2. Native monitor: `modules/ram-monitor/android/src/main/java/expo/modules/rammonitor/RamMonitorModule.kt` — real RSS via `/proc/self/status` + total RAM via `ActivityManager.MemoryInfo`.
3. Failure path: `src/inference/LlamaEngine.ts:240-275` — budget failure throws a human-readable error naming model/RAM numbers; native init failure is caught and re-thrown with the RAM estimate as a hypothesis instead of a cryptic crash.

**Note (not a gap):** `LlamaEngine.ts:196` defaults `nThreads=4`. On-device research (`docs/research/LLAMACPP_SD695_TUNING`) recommends 2 threads for generation on the SD695's 2 big cores; 4 is safe but slower/hotter on low-end SoCs. Deliberate future-lane item, not a compatibility break.

### 3b. CPU ABI — what ships
**OK (by build design) — release APK is arm64-v8a only; 32-bit devices are excluded at install, not at runtime.** `llama.rn@0.13.0-rc.6` ships native libs for **arm64-v8a and x86_64 only** (`node_modules/llama.rn/android/src/main/jniLibs/` — no `armeabi-v7a`, no `x86`). The official release pipeline deliberately builds a single-ABI APK: `.github/workflows/android-apk.yml:183-188` (`assembleRelease -PreactNativeArchitectures=arm64-v8a`, with the comment that all 4 ABIs exhaust runner disk) and `AGENTS.md` documents the same command. On a 32-bit ARM phone the APK fails to install (`INSTALL_FAILED_NO_MATCHING_ABIS`) — a clean, honest failure, not a runtime crash. Note for the roadmap: 32-bit / Android Go devices (a real share of the low-end LATAM market) cannot use NIDO at all; this is a product-coverage decision, currently implicit in the build config rather than documented anywhere user-facing.

### 3c. 16KB page size (Android 15+/16) — native lib alignment
**GAP (HIGH) — bundled llama.rn .so files are 4KB-aligned.** Verified with `readelf -lW` on all 7 arm64-v8a libs in `node_modules/llama.rn/android/src/main/jniLibs/arm64-v8a/`: every LOAD segment has `Align 0x4000`, and there is no `.note.gnu.property` declaring 16KB support. Android 15 (which this app targets, API 35) requires 16KB-page-size support for native code on 16KB devices, and Android 16 makes 16KB the default page size on new devices (Pixel line already ships it). On such devices the dynamic linker refuses to load these ELFs → **the app will crash the moment inference initializes**, on brand-new flagship phones — exactly the "latest Android" the user asked about. The fix must come from llama.rn (build with `-Wl,-z,max-page-size=16384`); NIDO can only mitigate by upgrading/patching the package or shipping its own build of the native lib.

### 3d. Biometric fallback chain
**OK.** `src/security/biometricGate.ts`:
- `getGateStatus()` distinguishes `biometrics` / `device-credential` / `none`
- `requireUnlock()` allows the OS PIN/pattern fallback (`disableDeviceFallback: false`) and throws explicit `BiometricUnavailable` when nothing is enrolled — never a silent bypass
- `App.tsx:61-78`: `BiometricUnavailable` sets an explicit degraded state ("el usuario decide") instead of locking the user out or letting them in silently

Devices with no biometric hardware, no enrollment, or weak-only sensors are handled.

### 3e. Bluetooth adapter absence
**OK.** `NidoP2PManager.kt:75-79` — adapter is nullable (`as? BluetoothManager`, `manager?.adapter`); `startDiscovery()` and other entry points null-check and surface "Bluetooth no disponible en este dispositivo." rather than crashing. Devices without Bluetooth (rare tablets/TVs) degrade gracefully; P2P features simply report unavailable.

### 3f. Voice input (no Google services / no recognizer)
**OK-ish.** `VoiceInputModule.kt:54` exposes `SpeechRecognizer.isRecognitionAvailable()` and maps all error codes (network, no-match, busy, permissions). JS wrapper `src/voice/VoiceInput.ts:26` documents the availability check. On degoogled/Huawei devices the recognizer is absent → reported as unavailable, not a crash.

---

## 4. Hardcoded device assumptions

**OK.** Greps across `src/`, `modules/` (TS/TSX/Kotlin):
- No `Build.MANUFACTURER` / `Build.MODEL` / `Build.BRAND` / `Build.DEVICE` checks anywhere.
- No hardcoded filesystem paths (`/sdcard`, `/storage/emulated`, `/data/data`) — file access goes through expo-file-system/document-picker APIs.
- Numeric literals found are layout constants (e.g. `ChatScreen.tsx:1702` `width: 280`, `BackupScreen.tsx:184` `maxWidth: 400`) — responsive-safe (maxWidth/percentage), not device assumptions.
- `App.tsx`/`AndroidManifest.xml`: `screenOrientation="portrait"` is a deliberate product choice, not an assumption.

**Note (LOW):** portrait lock on Android 16 large screens — the OS no longer forces letterboxing for resizability; a locked-orientation app on tablets/foldables renders in a compat frame. Works, but looks dated on the user's own Tab A9+. `android:enableOnBackInvokedCallback="false"` + `predictiveBackGestureEnabled: false` (`app.json`) also opts out of the Android 14+ predictive-back UX — functional, just not current.

---

## 5. Expo / RN currency for latest Android

**OK on framework, GAP on target level (same as §1).** `expo 57.0.25` + `react-native 0.86.3` is the current SDK line and supports Android 16 builds (compileSdk 36 capable). The repo simply doesn't opt into `targetSdk 36` — a one-config fix via `expo-build-properties`. `edgeToEdgeEnabled=true` (`android/gradle.properties`) already satisfies the Android 15+ edge-to-edge enforcement.

---

## Summary of gaps

| # | Severity | Gap | Breaks on | Fix |
|---|---|---|---|---|
| 1 | HIGH | targetSdk 35, not 36 | Play submission after 31 Aug 2026 enforcement; incomplete Android 16 behavior | Pin 36 via `expo-build-properties`, re-run Android 16 checklist |
| 2 | HIGH | llama.rn .so 4KB-aligned (no 16KB page support) | Crash at inference init on 16KB-page devices (new Pixels, Android 16 defaults) | Rebuild/upgrade llama.rn with `-z max-page-size=16384` |
| 3 | — | 32-bit ARM unsupported by release build (arm64-v8a only per `.github/workflows/android-apk.yml:188`) | Android Go / 32-bit phones: APK won't install (clean failure); coverage gap for low-end LATAM, currently undocumented | Document as a product decision or revisit if 32-bit support is wanted |
| 4 | LOW | `startForegroundService()` from background would throw on API 31+ | Latent — only if future background auto-reconnect calls it | Guard/wrap when adding background triggers |
| 5 | LOW | Portrait lock + predictive back disabled | Cosmetic/UX on Android 16 tablets & foldables (incl. Tab A9+) | Revisit when targeting 36 |

Everything else audited — Bluetooth/POST_NOTIFICATIONS/exact-alarm permission flows across API 24→35, FGS type declaration, RAM pre-flight + OOM handling, biometric and Bluetooth-absent degradation, voice-input availability, hardcoded-assumption hygiene — is **OK** with version guards in the right places.
