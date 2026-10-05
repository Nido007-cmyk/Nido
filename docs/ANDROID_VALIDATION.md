> **Language:** English · [Español](es/ANDROID_VALIDATION.md)
# NIDO — Android Validation Checklist (two new phones, from zero)

For the first real hardware run. A checkbox alone is worthless: every PASS
requires the listed **evidence**. Capture evidence into `docs/evidence/<date>/`
(screenshots, logcat excerpts, command outputs). If evidence is missing, the
item is NOT passed.

Preconditions: release or debug APK built from a clean
`npx expo prebuild -p android --clean`; both phones factory-reset or fresh;
USB debugging enabled; one workstation with `adb`.

Package name: `team.nido.app`. DB names: `nido_memory.db` (memoryStore),
`aoair_knowledge.db` (rag). Marker file: `.sqlcipher`.

## 0. Build & install (both phones)

- [ ] `PASS` → APK installs: `adb install <apk>` exits 0 on both phones.
  Evidence: command output saved.
- [ ] `PASS` → App launches to the setup/lock screen with **no network**
  (airplane mode ON from first launch).
  Evidence: photo of airplane-mode icon + first screen; note the exact screen shown.
- [ ] `PASS` → Kotlin module packaged:
  `unzip -l app.apk | grep -i nidop2p` lists `NidoP2PModule`/`NidoP2PManager` classes.
  Evidence: command output saved. (If absent → prebuild ignored the module: BLOCKER.)
- [ ] `PASS` → Manifest attributes:
  `aapt dump xmltree app.apk AndroidManifest.xml | grep -iE "allowBackup|dataExtractionRules"`
  shows `allowBackup=false` and `dataExtractionRules="@xml/data_extraction_rules"`.
  Evidence: command output saved.
- [ ] `PASS` → Permissions declared:
  `aapt dump permissions app.apk` lists `BLUETOOTH`, `BLUETOOTH_CONNECT`,
  `BLUETOOTH_SCAN` (and `ACCESS_FINE_LOCATION`, `BLUETOOTH_ADMIN`).
  Evidence: command output saved.

## 1. SQLCipher loaded

- [ ] `PASS` → The app opens its databases and functions (chat works) without
  any "SQLite without SQLCipher" fail-closed error.
  Evidence: logcat excerpt showing normal startup, no fail-closed message
  from `applyDatabaseKey`.
- [ ] `PASS` → `PRAGMA cipher_version` non-empty. There is currently no
  on-device hook that prints it, so capture it ONE of these ways and record
  which:
  (a) temporary debug build logging the version string from `applyDatabaseKey`,
  (b) in-app diagnostics screen (if added later).
  Evidence: the exact version string, e.g. `4.12.0 community`.
  Until (a) or (b) exists, this item stays OPEN — the file-extraction tests
  below are the primary SQLCipher evidence.

## 2. Encrypted DB at rest (the core C-1 claim)

Run on a phone with data in the app (send a few messages first, with a known
canary string, e.g. `CANARY-7f3a-nido`):

- [ ] `PASS` → Extracted DB does NOT open with standard sqlite3:
  ```
  adb exec-out run-as team.nido.app cat files/nido_memory.db > /tmp/nido_memory.db
  sqlite3 /tmp/nido_memory.db "SELECT count(*) FROM sqlite_master;"
  ```
  Expected: `Error: file is not a database`. Evidence: full output saved.
  (Find the real path first: `adb shell run-as team.nido.app ls -R files databases` —
  expo-sqlite puts DBs under `files/SQLite/`; record the actual path used.)
- [ ] `PASS` → No plaintext fixture in DB bytes:
  ```
  strings /tmp/nido_memory.db | grep -i "CANARY-7f3a-nido"
  ```
  Expected: empty output. Evidence: command + empty result saved.
- [ ] `PASS` → Same two checks for `aoair_knowledge.db` (if present).
- [ ] `PASS` → `.sqlcipher` marker file exists next to the DB, and no
  `-wal`/`-shm`/`-journal` plaintext sidecars from a pre-migration DB remain.
  Evidence: `ls` output saved.

## 3. Keystore / SecureStore

- [ ] `PASS` → DEK round-trip: uninstall → reinstall → restore flow does NOT
  silently recover old data (expected: fresh DEK, old DB unreadable — or the
  documented recovery path; record which happened).
  Evidence: written observation of post-reinstall behavior.
- [ ] `PASS` → No DEK in app-private files:
  ```
  adb shell run-as team.nido.app grep -r -i "x'" files/ shared_prefs/ databases/ 2>/dev/null | head
  ```
  Expected: no 64-hex-char key material. Evidence: command + output saved.
  (SecureStore keeps the key in the Android Keystore; SharedPreferences must
  show at most ciphertext blobs.)
- [ ] `PASS` → Key non-exportable: documented as platform-default assumption
  (see `docs/ANDROID_READINESS.md` §3). On-device proof requires a debug hook
  attempting `KeyStore.getEntry` export — record as OPEN until then. Do NOT
  mark passed on assumption alone.

## 4. Biometric gate

- [ ] `PASS` → Lock screen appears on first launch before any data is shown.
  Evidence: screenshot.
- [ ] `PASS` → Successful auth (fingerprint/face) unlocks to chat.
  Evidence: screen recording or timestamped notes.
- [ ] `PASS` → Failed auth (wrong finger ×3, or cancel) does NOT unlock;
  error is shown, no retry loop, no bypass.
  Evidence: screen recording / notes.
- [ ] `PASS` → Device with no biometrics enrolled: gate shows the degraded
  warning (`BiometricUnavailable` path), never a silent bypass.
  Evidence: screenshot of the warning (test on at least one phone with
  biometrics removed, or a device without the sensor).
- [ ] `PASS` → Device-credential fallback (PIN/pattern) works where the OS
  offers it. Evidence: notes.

## 5. Backup rules

- [ ] `PASS` (static) → §0 manifest check already showed `allowBackup=false`
  + `dataExtractionRules`. Reference that evidence here.
- [ ] `PASS` (behavioral) → `adb backup -f /tmp/nido.ab team.nido.app`:
  on Android 12+ this is restricted and may refuse — record the exact result.
  If a backup file IS produced, inspect it:
  `dd if=/tmp/nido.ab bs=24 skip=1 | tar tvf - | grep -iE "\.db|shared_prefs"`
  Expected: no DB files, no SecureStore prefs. Evidence: full output saved.
  If `adb backup` refuses outright on the test devices, record the refusal
  message as evidence and keep the static manifest check as primary.

## 6. Bluetooth permissions & Kotlin nido-p2p

- [ ] `PASS` → Runtime grants (Android 12+):
  `adb shell dumpsys package team.nido.app | grep -B1 -A1 "BLUETOOTH_CONNECT\|BLUETOOTH_SCAN"`
  shows `granted=true` after the in-app pairing flow requests them.
  Evidence: dumpsys excerpt before AND after granting.
- [ ] `PASS` → `BLUETOOTH_SCAN` was granted WITHOUT location:
  confirm the manifest flag survived prebuild:
  `aapt dump xmltree app.apk AndroidManifest.xml | grep -A2 BLUETOOTH_SCAN`
  shows `usesPermissionFlags="neverForLocation"`. Evidence: output saved.
- [ ] `PASS` → Module loads at runtime: start the P2P/pairing screen; no
  "module not found" / redbox. Evidence: screenshot of the pairing screen
  on both phones.
- [ ] `PASS` → RFCOMM round-trip between the two phones (see
  `docs/DEMO_VERTICAL_PLAN.md` for the full script): frames flow both ways.
  Evidence: in-app confirmation on both phones + logcat excerpts showing
  `onConnected`/`onFrame` events.

## 7. Background/foreground lifecycle

- [ ] `PASS` → Background 5s → foreground: lock gate re-prompts before chat
  is visible. Evidence: screen recording.
- [ ] `PASS` → After backgrounding, no NEW plaintext files appear in app
  storage (`ls -R` before/after diff). Evidence: diff output saved.
- [ ] `PASS` → Force-stop → relaunch: biometric timestamp cache is gone
  (must re-authenticate; 5-minute grace does NOT survive process death).
  Evidence: notes.

## 8. Network audit (sanity, airplane mode)

- [ ] `PASS` → 10 minutes of normal use in airplane mode (after models are
  present): no crash, no "waiting for network" dead-end on core flows.
  Evidence: notes + logcat filtered for network errors (empty or explained).

## Sign-off

C-1 is verified on hardware only when §1–§7 are all PASS with evidence, OR
when each OPEN item has a named owner and a date. "It worked on my phone"
without evidence does not count.
