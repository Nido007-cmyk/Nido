# Static Analysis Report — baseline APK (run 36330270921)

> **Artifact:** `app-debug.apk`, commit `e80de5c`, SHA-256
> `252ec5ba8b6a33f16a9176808e158f0f58ab1fe2e2a267c60889fde14819f8f5`
> **Date:** 2026-09-27 · **Method:** read-only (unzip inventory, custom AXML parser,
> `strings` on 9 classes.dex + native libs, OpenSSL-style cert inspection via signing block).
> **Scope:** static only. Nothing here upgrades INSTALLED / TESTED / VERIFIED.

## F1 — CRITICAL: no JS bundle; Metro dev-server is required to run this APK

- No `index.android.bundle`, `.hbc`, or `.jsbundle` anywhere in the APK (full inventory grep).
- This is a debug dev-client build (`bundleInDebug=false` default): JavaScript loads from Metro.
- Dex strings reference `http://10.0.2.2:8081` and `http://localhost:8081` (Metro).
- `expo.modules.devlauncher` activities are exported (`DevLauncherActivity`,
  `AuthActivity`, scheme `exp+nido-app`).
- **Consequence for the device plan:** a fresh install on a phone with no dev machine
  attached will land on the **dev launcher**, NOT the setup wizard. The baseline
  procedure must start Metro on the host (`npx expo start --localhost`, USB
  `adb reverse`) and connect through the dev launcher before step 4 (cold launch).
  `FIRST_DEVICE_BASELINE_PLAN.md` has been amended accordingly.
- A future standalone baseline wants a release build (or `bundleInDebug=true`);
  recorded as a recommendation, not a change (code freeze in effect).

## F2 — Signing

- APK Signing Block **v2/v3 PRESENT** (magic `APK Sig Block 42` at offset 167161466).
- No v1 (JAR) signature entries in META-INF — v2-only signing, valid for minSdk 24+.
- Debug key (expected for `assembleDebug`). Release/alpha must use the release key
  (`withReleaseSigning.js`) and `debuggable=false`.

## F3 — Permissions (from binary AndroidManifest.xml)

`package=team.nido.app`, `versionCode=1`, `versionName=1.0.0`, `minSdk=24`, `targetSdk=36`.

Functional (justified by features): `INTERNET`, `ACCESS_NETWORK_STATE`, `BLUETOOTH`,
`BLUETOOTH_ADMIN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN` (P2P), `RECORD_AUDIO`
(voice-input module), `USE_BIOMETRIC`/`USE_FINGERPRINT` (lock), `VIBRATE`,
`WAKE_LOCK`, `RECEIVE_BOOT_COMPLETED`, `POST_NOTIFICATIONS`,
`CHANGE_WIFI_MULTICAST_STATE`, `READ/WRITE_CALENDAR`, `READ/WRITE_CONTACTS`
(agent tools), `READ/WRITE_EXTERNAL_STORAGE`.

Notable / needs justification:
- `ACCESS_FINE_LOCATION` — requested in `app.json` (`android.permissions`).
  Legitimate on Android <12 for Bluetooth discovery (P2P), but it is a
  location permission in a privacy-first app: **justify and document**, or scope
  it (`maxSdkVersion=30`) if P2P discovery targets 12+.
- `SYSTEM_ALERT_WINDOW` — from `expo-dev-client`; must not ship in release.
- `com.google.android.c2dm.permission.RECEIVE` + FCM components — from
  `expo-notifications`; inert without google-services config (see F5).
- Badge permissions (`shortcutbadger`, Samsung/HTC/Sony/Huawei/Oppo) — from
  `expo-notifications`; harmless but bloat.
- `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` —
  transitive (install referrer); unused surface.

## F4 — Application flags

- `debuggable=true` — expected for debug; **must be false** for any alpha/release.
- `allowBackup=false` — GOOD: blocks `adb backup` extraction of private data.
- `usesCleartextTraffic=true` — ⚠️ permits HTTP cleartext. Static URL scan shows
  the only `http://` endpoints are Metro dev URLs and XML-namespace constants,
  but the flag should be `false` (hardening item for triage).

## F5 — Network surface (dex strings, 550,916 strings scanned)

Present (dev-client / tooling):
- `http://10.0.2.2:8081`, `http://localhost:8081`, `http://localhost:19006` — Metro/dev.
- `https://exp.host/--/api/v2`, `/development-sessions`, `https://exp.host/--/graphql`,
  `https://expo.dev` — expo-dev-client endpoints.
- `https://u.expo.dev/01980973-2cf9-71fb-a891-a53444132a6e` — EAS Update URL string
  constant in dev-client code. **Nuance:** zero `expo/updates/` class references —
  the expo-updates module is NOT linked, so no automatic OTA update check runs.
  Runtime network behavior remains UNVERIFIED (device-only).

Absent (good):
- **No** Crashlytics, Sentry, Mixpanel, AppsFlyer, Google Analytics, Segment-analytics,
  `facebook.GraphRequest`. (`amplitude` hits = Material progress-indicator wave
  amplitude; `Segment` hits = Compose PathSegment; `firebase.analytics` hits = R-class
  resource IDs of the firebase-measurement-connector stub — all false positives,
  verified by context.)
- No `ws://`/`wss://` endpoints.
- ML Kit barcode scanning is bundled (`.tflite` models in `assets/mlkit_barcode_models/`,
  `libbarhopper_v3.so`) — on-device inference, transitive via camera libs; unused
  feature = bloat/attack surface note.
- PDFBox (`tom_roush`) resources present (document handling) — on-device, no network.

Exported components: only `MainActivity` (MAIN/LAUNCHER + `exp+nido-app` deep link),
dev-launcher activities, and `ProfileInstallReceiver` are exported. All
FileProviders `exported=false`. No unexpected exported surface.

## F6 — Encrypted storage (code-level evidence; on-device proof still UNVERIFIED)

- `libexpo-sqlite.so`: `SQLCIPHER` ×24, `sqlcipher` ×165 in strings;
  `sqlite3_key` ×7 in strings, ×5 dynamic symbols → **SQLCipher keying API linked**.
  SQLite 3.49.1. `libcrypto.so` (OpenSSL) present.
- Dex references `android/security/keystore/KeyGenParameterSpec` (expo-secure-store path).
- `expo-sqlite` plugin configured with `useSQLCipher: true` (from `assets/app.config`).
- This is the strongest static evidence available. Per checklist semantics, actual
  at-rest encryption stays **UNVERIFIED** until the device hexdump check.

## F7 — Native inventory (arm64-v8a)

- `librnllama.so` + `librnllama_jni.so` + 10 `librnllama_*` CPU-variant libs
  (llama.cpp multi-variant packaging, selected at runtime).
- `assets/ggml-hexagon/libggml-htp-v*.so` ×4 (Hexagon DSP delegates).
- Hermes (`libhermesvm.so`), React Native (`libreactnative.so` 23 MB),
  `libexpo-sqlite.so`, `libfbjni.so`, Fresco/image libs.
- 9 `classes.dex` (16.0 + 4.3 + 0.6 + 0.0 + 0.0 + 12.1 + 10.9 + 13.1 + 4.3 MB).

## Recommendations (triage after baseline pass; freeze respected — no changes made)

1. Amend device procedure with the Metro prerequisite (DONE in `FIRST_DEVICE_BASELINE_PLAN.md`).
2. Decide the standalone-baseline build flavor (release or `bundleInDebug=true`) for the
   second-pass or later device runs.
3. Harden: `usesCleartextTraffic=false`, `debuggable=false` for alpha,
   justify/scope `ACCESS_FINE_LOCATION`, drop dev-launcher + unused ML Kit/FCM surface
   from release builds.
4. Keep `allowBackup=false`.

## Explicitly still UNVERIFIED (device-only)

INSTALLED, TESTED, VERIFIED · actual at-rest SQLCipher encryption · Keystore
hardware-backed status · runtime network silence (post-setup) · biometric gate ·
any UI behavior.

*Evidence files: `INVENTORY.txt`, `MANIFEST.txt`, `URLS.txt` next to this report.
Parser: `work/axml.py`. Dex strings: `work/dex/ALL.strings`.*
