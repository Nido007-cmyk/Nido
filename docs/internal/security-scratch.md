> **Language:** English · [Español](../es/internal/security-scratch.md)
# Audit notes (scratch — do not commit as-is)

## 2026-09-27: initial secret scan
- `grep` for api_key/secret/password/token/private_key in src/, scripts/, plugins/, app.json: **0 findings** (excluding tests/mocks).
- `npm audit` blocked by internal registry policy (403 policy_denied) → use osv-scanner or manual review for CVEs.

## 2026-09-27: current Android config
- `app.json`: `allowBackup: false` already present.
- Plugins: with-bluetooth-never-for-location.js, withBundledModels.js, withReleaseSigning.js.
- Still to review: android:exported in generated activities/receivers, backup rules XML, FLAG_SECURE, networkSecurityConfig.

## 2026-09-27: dependency inventory
- 38 direct, 699 total (package-lock.json). See SECURITY_ROADMAP for SBOM.
- tweetnacl@1.0.3 is the current crypto lib → evaluate migration to @noble/* in the research.

## 2026-09-27: Android/SQLCipher research (subagent) — SUMMARY
- SQLCipher: ADOPT expo-sqlite `useSQLCipher:true` (SDK 52+; build-wide; requires native rebuild; migration via sqlcipher_export; fail-closed with test SELECT; PRAGMA cipher_version in checklist).
- Keystore: ADOPT StrongBox→TEE→software with real detection (FEATURE_STRONGBOX_KEYSTORE; expose securityLevel in UI; emulator gives hardware false positive).
- Biometrics: expo-local-authentication UX-only (hookable boolean); KEK with setUserAuthenticationRequired = FUTURE native.
- MASVS/MASTG v2.0 (Jul 2026): use as checklist; NETWORK N/A (no IP network) with justification.
- Backups: allowBackup=false (already) + dataExtractionRules (cloud + device-transfer) — ADOPT, low complexity.
- Selective FLAG_SECURE, clipboard EXTRA_IS_SENSITIVE + clearing, content-less notifications — ADOPT.
- BT permission matrix confirmed; with-bluetooth-never-for-location already OK (commit 33bbc6b); HW test still missing.
- Play Integrity: REJECT (requires network). Root detection advisory (warn, don't block). Offline key attestation = FUTURE.
- BT metadata: classic stable MAC never randomized; generic rotating name + explicit discovery with timeout + MAC≠identity — ADOPT.

## 2026-09-27: supply chain + voice/AI research (subagent) — SUMMARY
- SBOM: npm sbom (cyclonedx) + osv-scanner offline + npm audit signatures + min-release-age=3 in .npmrc — ADOPT.
- JS crypto: MIGRATE tweetnacl → @noble/curves + @noble/ciphers + @noble/hashes (Trail of Bits audits Aug-2026, Cure53 Sep-2024; tweetnacl dead ~6 years without XChaCha). libsodium-wrappers REJECT in RN (Hermes has no WASM). @noble/post-quantum FUTURE (unaudited).
- STT: whisper.rn 0.7.4 + pinned hash-on-load Spanish ggml-base — ADOPT. TTS: sherpa-onnx + Piper es_ES int8 — ADOPT; Google TTS REJECT as primary path (no zero-network guarantee).
- Secret scanning: gitleaks v8 pre-commit + custom rules (Solana base58, *.jks, storePassword) — ADOPT.
- Reproducible builds: full pinning + byte-identical double local build — ADOPT; EAS doesn't guarantee bit-for-bit.
- Crash reporting: local-only + in-app viewer + opt-in export, sanitized before persisting — ADOPT; cloud Sentry REJECT.
- Dependency minimization: checklist with thresholds (2+ red flags → alternative/inline).
