> **Language:** English · [Español](es/ANDROID_READINESS.md)
# NIDO — Android Readiness (C-1) · 2026-09-27

Verdict per item, with file/line evidence. Nothing here was compiled or run
on a device — this environment has no JDK, no Android SDK, no adb, no
emulator, no physical device (verified: `which java javac adb` → empty).
"READY" below means *code/config ready*, never *verified on device*.

## 1. SQLCipher native wiring — CONFIG READY / BUILD UNVERIFIED

- `app.json` → `plugins`: `["expo-sqlite", { "useSQLCipher": true }]` (app.json:44-49).
- `package.json`: `"expo-sqlite": "~57.0.3"` (package.json:30).
- Runtime enforcement: `applyDatabaseKey` in `src/privacy/keyManager.ts:174-201`
  runs `PRAGMA key`, then `PRAGMA cipher_version`; empty version → DB closed +
  throw ("fail-closed: la base no se abre en claro").
- `src/security/secureDatabase.ts:249` calls it on every open/migration verify.
- Unit-tested with mocked drivers (`sqlcipherReal.test.ts`, 21 tests in
  `secureDatabase.test.ts`); the container verified SQLCipher 4.12.0
  community against a real encrypted DB (see `docs/C1_SQLCIPHER.md`).
- NOT verified: that the Gradle build actually bundles the SQLCipher `.so`
  for the target ABIs. If the native lib is missing, the app fails closed
  by design (good) but is unusable (expected — first build will confirm).

## 2. PRAGMA cipher_version code path — CODE READY / DEVICE UNVERIFIED

- Path exists and is on the critical path of every DB open
  (`keyManager.ts:190-199`). No code path opens an encrypted DB without it.
- Gap: the version string is checked but never logged or surfaced anywhere.
  For hardware validation there is currently **no observability hook** to
  capture `cipher_version` output on-device (see `docs/ANDROID_VALIDATION.md`
  for the workaround: file-extraction evidence + optional debug log line).
  This is a validation-prep gap, not a security gap.

## 3. Keystore / SecureStore — IMPLEMENTED WITH DOCUMENTED LIMITATION

- `package.json`: `"expo-secure-store": "^57.0.4"`, `"expo-crypto": "~57.0.3"`.
- `getDatabaseKeyHex` (`src/privacy/keyManager.ts:100-114`): 32-byte CSPRNG
  DEK (`x'hex'` 64 chars), stored under `DB_KEY_ALIAS`; production throws if
  SecureStore is unavailable (fail-closed, line 107). P2P identity key under
  `P2P_SIGN_SK_ALIAS` (lines 117-125).
- Honest limitation (per `docs/C1_SQLCIPHER.md`): there is NO explicit
  non-exportable KEK with `setUserAuthenticationRequired`, and NO
  StrongBox-vs-TEE detection. The DEK lives directly in the OS SecureStore
  (Android Keystore under the hood — non-exportable by platform default, but
  the key's protection class is never asserted in code). A native Keystore
  module remains future work. This does not block encryption at rest, but
  "non-exportable" is currently a platform-default assumption, not a
  verified property.

## 4. Biometric gate — CODE READY / DEVICE UNVERIFIED

- `src/security/biometricGate.ts`: UX gate only (documented as NOT
  cryptographic key authorization). 5-minute in-memory timestamp cache,
  `lockNow()` on background, `ensureUnlocked()` on foreground,
  `BiometricUnavailable` when nothing is enrolled (never silent bypass),
  device-credential fallback allowed.
- Wired in `App.tsx:117-125` (AppState listener) and `App.tsx:43`.
- 11 unit tests green. Real biometric behavior (success / fail / fallback /
  no-enrollment) never exercised on hardware.

## 5. Backup rules — CONFIG READY / NEEDS RE-VERIFY AT PREBUILD

- `app.json`: `"allowBackup": false` (app.json:15).
- `plugins/with-data-extraction-rules.js`: generates
  `res/xml/data_extraction_rules.xml` with explicit `<exclude>` for all nine
  domains under both `<cloud-backup>` and `<device-transfer>`, and sets
  `android:dataExtractionRules` on `<application>`.
- Previously verified via `expo prebuild --clean` (see `docs/C1_SQLCIPHER.md`);
  `android/` was deleted afterwards (gitignored), so the generated XML must
  be re-inspected at the next prebuild. No config change needed.

## 6. Kotlin nido-p2p module — NEEDS WORK (never compiled)

- Present: `modules/nido-p2p/android/src/main/java/expo/modules/nidop2p/`
  (`NidoP2PModule.kt`, `NidoP2PManager.kt`), `AndroidManifest.xml`,
  `android/build.gradle`, `expo-module.config.json`.
- The module's own header comment states it has **never been compiled**
  (`NidoP2PModule.kt:15-19`). `requestPermissions` was corrected against
  expo-modules-core SDK 57 sources by reading, not by building.
- First-build risk areas (from the code comments): thread handling in
  `connect`, event registration. Crypto stays in TS by design — the module
  only moves framed bytes.
- Follows the same local-module pattern as `voice-input` (which is the
  established pattern in this repo), so `prebuild` should pick it up — but
  "should" is not verification.

## 7. Bluetooth permissions — CONFIG READY / RUNTIME GRANT UNVERIFIED

- Declared in `app.json:16-22`: `BLUETOOTH`, `BLUETOOTH_ADMIN`,
  `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`, `ACCESS_FINE_LOCATION`.
- `plugins/with-bluetooth-never-for-location.js`: sets
  `android:usesPermissionFlags="neverForLocation"` on `BLUETOOTH_SCAN`
  (privacy: discovery finds nearby NIDOs, never derives location).
- Runtime request path lives in `NidoP2PManager.requestPermissions`
  (corrected by reading SDK 57 sources; never executed).
- Missing (flagged in `docs/ANDROID_BUILD.md`): `CAMERA` for the QR pairing
  scanner — not yet implemented, needed before the two-phone demo.

## 8. Background/foreground lifecycle — IMPLEMENTED / MEMORY-WIPE NOT IMPLEMENTED

- `App.tsx:117-125`: background/inactive → `lockNow()`; foreground while in
  chat → back to the lock gate. The 5-minute biometric timestamp lives only
  in memory (lost on process death — correct).
- Known limitation (explicit, not hidden): backgrounding locks the UI gate
  but does **not** wipe in-memory JS state (chat messages, agent context).
  The DB remains encrypted at rest; in-memory plaintext after background is
  standard locked-app behavior, but it is not zeroized. Not a C-1 blocker;
  recorded for a future hardening pass.

## Blockers — what prevents compiling today

1. **No JDK** — `java`/`javac` absent. Gradle cannot run.
2. **No Android SDK** — `ANDROID_HOME`/`ANDROID_SDK_ROOT` empty; no
   platform-tools → **no `adb`**.
3. **No device, no emulator** — nothing to install to or test on.
4. **No Expo account / EAS configured** — the cloud-build alternative path is
   not set up either (`eas.json` exists with dev/preview/production profiles,
   but no login).
5. **Release signing material absent** — `plugins/withReleaseSigning.js` reads
   `NIDO_UPLOAD_STORE_FILE` / `NIDO_UPLOAD_KEY_ALIAS` /
   `NIDO_UPLOAD_STORE_PASSWORD` / `NIDO_UPLOAD_KEY_PASSWORD` from
   `~/.gradle/gradle.properties` (or the NIDO_UPLOAD_* GitHub Secrets in CI;
   see docs/SIGNING.md); none exist. Debug builds don't need this;
   release APKs do.
6. **Native build risk (not a blocker, a warning)**: `llama.rn` ships heavy
   native binaries — historically the most likely build breaker
   (memory/NDK). Unverifiable until the first real build.
7. **First-launch model download (~1 GB)** — the app gates on
   `ModelManager.requiredModelsPresent()` (`App.tsx:108-113`). Any
   airplane-mode test requires pre-seeded models or a prior download; plan
   for it (see `docs/DEMO_VERTICAL_PLAN.md`).

## What I could NOT verify (explicit)

- That `expo prebuild` generates a working `android/` project (no SDK).
- That Gradle compiles the app or any native module (no JDK/SDK).
- That SQLCipher `.so` ships in the APK for arm64-v8a (no APK).
- Any runtime behavior: cipher_version on device, Keystore key properties,
  biometric prompts, permission grants, lifecycle, Bluetooth RFCOMM.
- The two-phone airplane-mode test (no phones).

Next artifact: `docs/ANDROID_VALIDATION.md` (evidence-based checklist for two
new phones from zero).

## Toolchain setup — 2026-09-26 (container)

Progress since the blockers above were written:

- **JDK 17**: installed persistently at `~/workspace/jdk-17`
  (Eclipse Temurin 17.0.20.1). NOTE: `/usr/lib/jvm` is ephemeral in this
  container — an earlier `apt-get install openjdk-17-jdk-headless` vanished
  after a system-layer reset. Toolchain MUST live under `~/workspace`.
- **Android SDK**: `~/workspace/android-sdk` with cmdline-tools,
  platform-tools (`adb` 1.0.41), `platforms/android-35`,
  `build-tools/35.0.0`. Installed by direct download+unzip because
  `sdkmanager` cannot run here (its JVM HTTPS fails through the egress
  proxy with `NoSuchElementException` in `doTunneling0`).
- **Gradle 9.3.1**: distribution at `~/workspace/gradle-9.3.1`
  (downloaded manually; the wrapper cannot fetch it — same proxy issue).
  `GRADLE_USER_HOME=/home/hatch/.gradle` (the JVM resolves `user.home` to
  `/root`, also ephemeral — must override).
- **`expo prebuild -p android --clean`**: SUCCEEDS. `android/` generated,
  `nido-p2p` present as autolinked local module.
- **Safe observability**: `src/diagnostics/security.ts` added
  (SQLCipher `cipher_version`, Keystore canary round-trip, biometric
  capability; hardware-backed/StrongBox honestly `not-verifiable` from JS;
  never logs secrets). 11 tests green, committed.

### HARD BLOCKER: Gradle cannot build in this container

`./gradlew assembleDebug` (or manual `gradle`) always fails with
`Could not dispatch a message to the daemon` / `Broken pipe` writing to
the daemon's loopback socket.

Root cause (verified with socket-level experiments, 2026-09-26):
the sandbox transparently intercepts **TCP connections initiated by JVM
processes to 127.0.0.1** and answers with its own payload
(`"muse: Other TCP connections is ..."`). Evidence:

- Python → 127.0.0.1 (any port): reaches the real server every time.
- Java (blocking or NIO) → 127.0.0.1: connection hijacked, every time,
  even with all `*_proxy` env vars stripped and with the `java` binary
  copied under a different name/path.
- The Gradle daemon itself starts and listens fine; it never sees the
  client's connection. The client's first write gets RST/broken pipe.

The Gradle daemon protocol is TCP-loopback-only (no Unix-socket mode;
`--no-daemon` still forks a single-use daemon in Gradle 9). There is no
workaround inside this container.

**What this means**: `ANDROID COMPILED` is NOT achievable in this
environment. The remaining paths are:

1. **User's machine / CI runner** without the JVM loopback interception:
   `export JAVA_HOME=~/workspace/jdk-17 ANDROID_HOME=~/workspace/android-sdk
   GRADLE_USER_HOME=~/.gradle` then `npx expo run:android`
   (or `./gradlew assembleDebug` in `android/`).
2. **EAS cloud build**: needs `npx eas-cli login` (user action).
3. A container/VM without the network guard.

C-1 stays OPEN. `CONFIGURED != VERIFIED ON DEVICE` — and here, not even
`COMPILED` yet.
