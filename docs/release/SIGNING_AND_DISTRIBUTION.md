# Signing & Distribution Runbook

**Status:** active process doc.
**Applies from:** first ALPHA release. INTERNAL builds may stay debug-signed.

Current state (2026-09-27): APKs are signed with the **Android debug certificate**.
That is acceptable for sideloading to one lab device. It is **not** acceptable for
any wider distribution: anyone can reproduce the debug key, so signature checks
prove nothing and updates cannot be trusted.

---

## 1. Release key (ONE-TIME, owner action)

The owner generates the key **once**, on a trusted machine, and never commits it
anywhere.

```bash
keytool -genkeypair -v \
  -keystore nido-release.keystore \
  -alias nido-release \
  -keyalg RSA -keysize 4096 \
  -validity 10950 \
  -storetype PKCS12
```

Rules:
- The keystore file, its passwords, and the alias password live in **exactly two**
  places: the owner's offline backup and the CI secret store. Never in the repo,
  never in chat, never in a screenshot.
- Losing the keystore = a new app identity = all users must uninstall/reinstall.
  Back it up like it matters, because it does.
- Validity 10950 days (30 years): aligns with the project's longevity stance.

## 2. CI wiring (performed once the key exists)

1. Add GitHub secrets: `NIDO_KEYSTORE_BASE64` (base64 of the keystore),
   `NIDO_KEYSTORE_PASSWORD`, `NIDO_KEY_ALIAS`, `NIDO_KEY_PASSWORD`.
2. The Android APK workflow decodes the keystore at build time and signs the
   `assembleRelease` output with `apksigner`.
3. The workflow publishes, per build: APK SHA-256, signature certificate SHA-256
   fingerprint, `versionCode`/`versionName`. These go into the release's
   `docs/ci-evidence/releases/<version>/RELEASE.md`.

## 3. Versioning

- `versionName`: semver (`1.0.0-alpha.1`, …).
- `versionCode`: monotonically increasing integer, never reused, never decreased.
- A versionCode may exist on two channels with different guarantees (see
  `RELEASE_MODEL.md`); what changes is what was verified, recorded in DECISION.md.

## 4. Distribution & on-device update verification

- ALPHA distribution: private, expiring download link (same mechanism as the
  current QR flow).
- Before installing any update, the device (or the tester) verifies:
  1. APK SHA-256 matches the published value for that version, **and**
  2. the signature certificate fingerprint matches the published release fingerprint.
- An update whose signature does not match the installed app is **rejected by
  Android** — that is the mechanism that makes signature continuity a security property.

## 5. Rollback

See `UPDATE_AND_ROLLBACK.md`. A rollback is a **declared downgrade**: it follows
the same verification protocol (this doc + `../qa/RELEASE_VERIFICATION_PROTOCOL.md`),
not a silent sideload of an old APK.

## 6. What is explicitly NOT done

- No Play Store signing key escrow until a deliberate decision says otherwise.
- No auto-update mechanism that bypasses user consent.
- No "update available" prompt that cannot show the SHA-256 and the changelog first.
