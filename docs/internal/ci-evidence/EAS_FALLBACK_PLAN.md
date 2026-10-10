# EAS Build Fallback Plan — NIDO first APK

> **Status: DRAFT — prepared 2026-09-27, NOT active.**
> This plan activates ONLY if its trigger fires. The current GitHub Actions
> native-build route remains the primary path.

## 1. Trigger (all three must hold)

1. Run `36330270921` (commit `e80de5c`, deep-clean disk fix) finishes with **failure**.
2. The confirmed first causal error is **exclusively** disk space / GitHub
   runner infrastructure (`No space left on device`), with **zero** Kotlin,
   C++, Gradle, linking, or NIDO-code errors in the log.
3. If ANY real code error appears instead → capture it, fix it first.
   **EAS must never be used to hide a genuine compile error.**

## 2. Target architecture (the upstream project's proven split)

| Stage | Platform | Responsibility |
|---|---|---|
| Checks | GitHub Actions | `typecheck`, full test suite, security/quality checks (mirrors the upstream project `ci.yml`) |
| Native build | EAS Build (Expo cloud) | `llama.cpp` / `llama.rn` native compile, APK generation |
| Distribution | GitHub Release | Approved APK + published SHA-256 checksum |

## 3. Exact changes required (NONE applied yet)

1. **`app.json`** — add `extra.eas.projectId`. No projectId exists today; it
   requires `eas init` (one-time, needs an Expo account — maintainer action).
2. **`eas.json`** — already present and byte-identical to the upstream project's; the `preview`
   profile already yields an APK. For the first physical APK keep **arm64-v8a**:
   verify at migration time whether EAS needs a `gradleCommand` override or env
   var for `-PreactNativeArchitectures=arm64-v8a` (default EAS APK is universal,
   larger). TO VERIFY, not assumed.
3. **`.github/workflows/android-apk.yml`** — replace the native-build job with
   typecheck/test/security jobs; delete the disk-cleanup hacks; keep
   `concurrency: cancel-in-progress`. Two EAS trigger options:
   - **(a) Manual (recommended for first APK):** maintainer runs
     `npx eas-cli build --platform android --profile preview` (or
     `make build-eas`), downloads the APK, verifies it, attaches it to a
     GitHub Release with `sha256sum`. No tokens in CI, simplest, fully auditable.
   - **(b) CI-driven (later):** `eas build --non-interactive` with an
     `EXPO_TOKEN` secret, then download the artifact and attach to the Release.
4. **Signing** — the first physical APK may be debug-signed (user's own phone).
   Release signing later via the existing `plugins/withReleaseSigning.js` +
   `~/.gradle/gradle.properties` (credentials never in the repo).
5. **`Makefile`** — `make build-eas` already exists; no change needed.

## 4. Pre-migration confirmations (required before any switch)

- **No security weakening:** EAS compiles the unmodified NIDO source. Zero
  changes to SQLCipher, Keystore, biometric lock, encryption, or key isolation.
- **No functionality removed.**
- **No NIDO code changes needed to make it compile:** the native modules
  (`bundled-assets`, `download-wake-lock`, `nido-p2p`, `ram-monitor`,
  `voice-input`, `llama.rn`) are Expo config-plugin compatible — the same set
  the upstream project already ships through EAS.
- **Honest supply-chain note:** EAS uploads the source to Expo's build servers.
  That is a trust consideration for an offline-first project, not a code
  change; builds remain reproducible from the tagged source. Recorded here so
  the tradeoff is explicit, not discovered later.

## 5. Invariants (hold regardless of route)

- Success criterion is unchanged: a **real APK as a downloadable artifact**,
  then INSTALLED → TESTED → VERIFIED. COMPILED is not claimed from CI logs.
- Do NOT cancel run `36330270921`; do NOT push to master while it runs
  (`concurrency: cancel-in-progress` would kill it).
- The local checkpoint commit `1390157` (Lane A + Lane B) pushes only after the
  run finishes.

## 6. If the run succeeds

Discard this plan (keep the file as a record). The GitHub Actions route stays;
nothing migrates.
