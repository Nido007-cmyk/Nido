> **Language:** English · [Español](es/ANDROID_BUILD.md)
# Real Android validation — status and blockers (2026-09-27)

## Verdict
NIDO **cannot be compiled or tested in this environment**. Everything verified
so far (357 tests, typecheck) is pure TypeScript logic: it does not prove
the APK compiles, installs, or works.

## Exactly what's missing
1. **Android SDK**: not installed (`ANDROID_HOME`/`ANDROID_SDK_ROOT` empty).
   Needed: Android SDK Platform 35 + Build-Tools 35 + Platform-Tools.
2. **JDK 17+**: `java` does not exist in the container. Required by Gradle.
3. **Physical device or emulator**: none connected (`adb` absent).
   Phase E Bluetooth RFCOMM **does not work on an emulator**: it requires 2
   real phones.
4. **EAS account** (alternative): not configured. With EAS one could build
   in the cloud without a local SDK, but hardware for Bluetooth would still
   be missing.

## Unblocking path (when a machine with SDK or EAS is available)
```bash
# 1. Instalar SDK + JDK 17, aceptar licencias
# 2. En ~/workspace/nido-app:
npx expo prebuild -p android --clean   # obligatorio tras tocar app.json
npx expo run:android                   # compila e instala (debug)
# o: eas build --platform android --profile preview --local
```
`app.json` already declares `team.nido.app`, `allowBackup: false` and the
`withReleaseSigning` plugin for the release APK.

## Declared permissions (app.json → AndroidManifest via prebuild)
- Existing (Phases B–D): calendar, contacts, notifications, microphone
  (voice-input), storage (document picker).
- Added for Phase E (this change): `BLUETOOTH`, `BLUETOOTH_ADMIN`
  (max API 30), `BLUETOOTH_CONNECT` and `BLUETOOTH_SCAN` (API 31+),
  `ACCESS_FINE_LOCATION` (BT discovery on API ≤ 30). Scanning also requests
  `neverForLocation` where applicable.
- Still to add when implementing the QR scanner: `CAMERA`.

## Known build risks (not verifiable without SDK)
- `llama.rn@0.13.0-rc.4` ships heavy native binaries; it is candidate #1
  to break the build (memory/NDK).
- Local modules (`voice-input`, future `nido-p2p`) must follow the pattern
  of the existing module or `prebuild` will ignore them.
- `expo-sqlite` **does not include SQLCipher**: the release build needs the
  cipher variant or boot will fail closed (by design).

## Physical validation checklist (for phone day)
- [ ] APK installs and starts with no network (airplane mode from first boot).
- [ ] Model download only on request, with verified SHA-256.
- [ ] Empty network audit after 10 min of use with no downloads.
- [ ] TTS/STT work in airplane mode.
- [ ] QR pairing + chat between 2 phones (Bluetooth only, no Wi-Fi).
- [ ] The `nido_memory.db` database is unreadable without the key (adb inspection).
