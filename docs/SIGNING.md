<!--
MIT License
Copyright (c) 2026 NIDO contributors
See LICENSE file for details.
-->

# NIDO release signing

> **Language:** English.

This document describes NIDO's Android release-signing identity: what it is,
where it lives, how CI uses it, and how to recover or rotate it. It contains
**no secrets**. The keystore and its passwords live outside this repo.

## The identity

- **Keystore:** `nido-release.p12` (PKCS12), stored at
  `~/workspace/user/keystores/nido-release.p12` on the maintainer's machine.
  **It never enters the repo, never appears in logs, and is never bundled
  into the APK.**
- **Algorithm:** RSA-4096, self-signed certificate (SHA384withRSA).
- **Alias:** `nido-release`
- **Validity:** 2026-10-05 → 2056-09-27 (30 years).
- **Certificate SHA-256 fingerprint:**
  `4B:D7:3B:2F:31:CE:7E:66:FF:3E:2C:03:CD:2F:F4:4E:AB:B3:8D:C9:E6:EE:F1:78:D8:AD:77:95:B5:01:60:CF`
- **DN:** `CN=NIDO Contributors, OU=NIDO, O=NIDO Contributors`
- **Note:** PKCS12 does not support a key password different from the store
  password; both are the same value.

Verify the fingerprint at any time (needs the keystore + store password):

```bash
keytool -list -v -keystore nido-release.p12 -storetype PKCS12 \
  | grep -A1 "Certificate fingerprints"
```

An APK signed with this identity can be verified on-device / from the artifact:

```bash
apksigner verify --print-certs app-release.apk   # SDK build-tools
# or: keytool -printcert -jarfile app-release.apk
```

The SHA-256 of the signer certificate must match the fingerprint above.

## How CI uses it

GitHub Actions (`.github/workflows/android-apk.yml`, step
"Set up release signing keystore"):

1. Reads the `NIDO_UPLOAD_*` repository Secrets:
   - `NIDO_UPLOAD_STORE_FILE` — base64 of the `.p12`
   - `NIDO_UPLOAD_KEY_ALIAS`
   - `NIDO_UPLOAD_STORE_PASSWORD`
   - `NIDO_UPLOAD_KEY_PASSWORD`
2. Decodes the keystore to `$RUNNER_TEMP/nido-release.p12` (ephemeral runner disk).
3. Writes `~/.gradle/gradle.properties` with the four `NIDO_UPLOAD_*` Gradle
   properties pointing at it.
4. `plugins/withReleaseSigning.js` (Expo config plugin) injects a `release`
   signingConfig into `android/app/build.gradle` during `expo prebuild`,
   used only when the `NIDO_UPLOAD_STORE_FILE` Gradle property exists.

If the secrets are absent, the build falls back to Expo's default **debug**
signing — the same behavior as before this identity existed. Nothing is
silently assumed: a debug-signed APK is still a debug-signed APK.

Local builds: put the four `NIDO_UPLOAD_*` properties in your own
`~/.gradle/gradle.properties` (never in the repo) to sign locally with the
same identity.

## Migration note (2026-10-05)

The signing properties were renamed from `UPSTREAM_UPLOAD_*` to `NIDO_UPLOAD_*`
in `plugins/withReleaseSigning.js`, `.github/workflows/android-apk.yml`,
`AGENTS.md`, and `docs/ANDROID_READINESS.md` (EN/ES). No functional change
besides the names; the old names no longer have any effect. Historical audit
documents under `docs/qa/` intentionally keep the old names as a record.

## Clean-install consequence

APKs currently in the wild (including the private-alpha builds on test
devices) are **debug-signed**. Android treats a different signing identity
as a different app owner: **the first APK signed with the NIDO release
identity cannot be installed as an update over a debug-signed APK**.
The upgrade path is:

1. Back up anything that matters (NIDO keeps everything on-device; "Clear
   All Data" semantics apply on uninstall).
2. Uninstall the debug-signed NIDO.
3. Install the release-signed APK clean.

This is a one-time migration. All future release-signed APKs install as
normal updates of each other (same identity = same owner, per Android).

Do not delete anyone's existing APK or data without warning during the
physical device gate.

## Recovery

**If the keystore file is lost and no backup exists, there is no recovery.**
A new keystore = a new identity = every user must uninstall and reinstall;
there is no way to make Android accept the new signature as an update.

- The maintainer keeps `nido-release.p12` plus its credentials backed up
  **outside this machine** (external drive / secure offline storage).
  Losing the backup ends the update lineage — treat it like a production
  database backup.
- The GitHub Secrets hold a copy of the same material (base64 `.p12` +
  passwords). They are a second copy, not the backup of record: if the repo
  or its secrets were ever wiped, the offline backup is what matters.

## Rotation

Rotation = generating a brand-new keystore and accepting that it is a new
Android identity (clean install for all users, same as the debug→release
migration above). Procedure:

1. Generate the new keystore (same recipe: RSA-4096, 30 years, PKCS12).
2. Record its fingerprint here (append, don't overwrite history — see below).
3. Update the four `NIDO_UPLOAD_*` GitHub Secrets with the new material.
4. Back up the new keystore + credentials offline before the first signed build.
5. Build, verify the APK's signer fingerprint matches the new one, and
   announce the clean-install requirement with the release.

Fingerprint history:

| Since      | SHA-256 fingerprint (truncated) | Status  |
|------------|----------------------------------|---------|
| 2026-10-05 | `4B:D7:3B:2F:…:B5:01:60:CF`      | Active  |
