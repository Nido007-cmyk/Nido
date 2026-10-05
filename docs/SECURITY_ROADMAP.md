> **Language:** English · [Español](es/SECURITY_ROADMAP.md)

# SECURITY_ROADMAP.md — NIDO

**Date:** 2026-09-27. **Status:** living document; updated with every change.
**Principles:** privacy-first, zero-trust, local-first, offline-first, defense-in-depth.
**Measurement rule:** progress is measured by verifiable reduction of attack surface
and residual risk, not by number of features.

## Status vocabulary (not equivalent)

- `IMPLEMENTED` — the code exists.
- `AUTOMATED TESTED` — automated tests cover it (positive and negative).
- `ANDROID COMPILED` — compiled in a real Android build.
- `PHYSICALLY TESTED` — tested on real hardware (two phones where applicable).
- `EXTERNALLY AUDITED` — reviewed by an independent third party.

Today **no** NIDO security component is `EXTERNALLY AUDITED`.
Nothing described here should be read as "audited", "quantum-proof" or "impossible to break".

## Current baseline (2026-09-27)

| Component | Status |
|---|---|
| Authenticated handshake v2 (Ed25519 + ephemeral X25519 + nonces) | IMPLEMENTED + AUTOMATED TESTED (423 tests) |
| QR v2 as root of trust (spk bound to identity) | IMPLEMENTED + AUTOMATED TESTED |
| Identity keys in SecureStore (seeds, never plaintext on app disk) | IMPLEMENTED + AUTOMATED TESTED |
| Anti-replay (per-handshake nonces, unique message ids, liveness) | IMPLEMENTED + AUTOMATED TESTED |
| Bluetooth permissions per API (neverForLocation on 31+) | IMPLEMENTED (verified prebuild, commit `33bbc6b`) |
| allowBackup=false | IMPLEMENTED |
| SQLCipher | **NO** — plaintext SQLite |
| Biometrics as cryptographic gate | **NO** — pending only |
| FLAG_SECURE / clipboard policy / content-less notifications | **NO** |
| dataExtractionRules (device-transfer) | **NO** |
| Migration tweetnacl → @noble/\* | **NO** |
| HKDF (today: ad-hoc SHA-512 in KDF) | **NO** |
| XChaCha20-Poly1305 (today: XSalsa20-Poly1305) | **NO** |
| Noise_XX | **NO** — documented as future migration |
| PQ hybrid X25519+ML-KEM | **NO** — FUTURE, no audited implementation for RN |
| Android compilation of the nido-p2p module | **NO** — no JDK/SDK in this environment |
| Physical tests between two phones | **NO** |

---

## CRITICAL

### C-1. Real SQLCipher for all sensitive data at rest
- **Threat:** phone theft/loss, forensic extraction, malware with file access →
  reading messages, contacts, agent memory, sessions.
- **Action:** `expo-sqlite` with `useSQLCipher: true` (official option, no extra dependency);
  32 B master key in Keystore via SecureStore; plaintext→encrypted migration with
  `sqlcipher_export`; fail-closed opening (`PRAGMA key` + test `SELECT`; on failure,
  explicit error, never silent plaintext nor a fresh empty DB).
- **Status:** pending. Requires a native build to verify (`PRAGMA cipher_version`).
- **Done criteria:** IMPLEMENTED + AUTOMATED TESTED (JS logic) + ANDROID COMPILED +
  PHYSICALLY TESTED (opening, migration, rollback, wrong key).

### C-2. Identity and signing keys in Android Keystore with level detection
- **Threat:** SecureStore seed extraction on a compromised device.
- **Action:** generate Ed25519/X25519 in Keystore; try StrongBox, fall back to TEE,
  record the real `securityLevel` and show it on the security status screen.
  Never assume hardware without checking (the emulator lies).
- **Status:** partial (seeds in SecureStore). The move to native Keystore goes through
  the `nido-p2p` module.
- **Done criteria:** visible securityLevel + fallback tests + PHYSICALLY TESTED.

### C-3. Migrate JS cryptography from tweetnacl to @noble/\*
- **Threat:** tweetnacl hasn't had a release in ~6 years (2017 audit), no XChaCha20,
  `tweetnacl-util` incompatible with RN. It's abandoned critical code.
- **Action:** `@noble/curves` (Ed25519/X25519), `@noble/ciphers` (XChaCha20-Poly1305),
  `@noble/hashes` (SHA-256/HKDF). Audits: Trail of Bits Aug-2026, Cure53 Sep-2024.
  Byte-compatible wire formats (same wire, different library).
- **Status:** pending. **Doesn't break** the 423 tests: the primitives migrate, not the protocol.
- **Done criteria:** IMPLEMENTED + AUTOMATED TESTED (incl. official vectors) + 423 tests green.

### C-4. Explicit anti-downgrade and version policy
- **Threat:** v2→v1 downgrade, unknown version accepted for compatibility.
- **Action:** already IMPLEMENTED (v1 rejected with update message, unknown version
  rejected). Keep the rule: **no old insecure version is ever accepted silently**;
  every new version requires an explicit bump + negative tests.
- **Status:** IMPLEMENTED + AUTOMATED TESTED.

## HIGH

### H-1. HKDF (RFC 5869) as the session KDF
- **Today:** `SHA-512("nido-session-v2" || DH || nonce_min || nonce_max)[0:32]` — a
  correct ad-hoc construction but non-standard; no per-purpose key separation.
- **Action:** `HKDF-SHA-256(salt=hash_transcript, ikm=DH‖nonces, info="nido-sess-v1")` and
  per-purpose separated keys (different `info` for send/receive/confirm).
- **Done criteria:** IMPLEMENTED + AUTOMATED TESTED (RFC 5869 vectors).

### H-2. XChaCha20-Poly1305 instead of XSalsa20-Poly1305
- **Reason:** XSalsa20 has no AAD and no IETF standard; XChaCha20 (random 24 B
  nonces, with AAD to authenticate headers) is the 2026 recommendation for new code.
- **Action:** via `@noble/ciphers` (C-3); authenticate the frame header as AAD.
- **Done criteria:** IMPLEMENTED + AUTOMATED TESTED (IRTF draft vectors).

### H-3. dataExtractionRules: also block device-transfer
- **Threat:** `allowBackup=false` doesn't block device-to-device transfer on Android 12+.
- **Action:** config plugin with `res/xml/data_extraction_rules.xml` (empty
  `<cloud-backup/>` and `<device-transfer/>`) + manifest test on prebuild.
- **Done criteria:** IMPLEMENTED + verified prebuild (no more without SDK).

### H-4. Visible warning on contact identity key change
- **Threat:** the peer rotates/reinstalls their identity; today the signature fails with a
  generic "possible MITM" message, without distinguishing attack from legitimate rotation.
- **Action:** detect "invalid signature but known pk with different spk" → plain-language
  screen: "The identity of <name> changed. Verify their new QR in person before continuing."
  Re-verification flow via QR. Rollback protection: never accept an old spk
  after having seen a new one.
- **Status:** pending (fail-closed rejection already exists; the UX is missing).
- **Done criteria:** IMPLEMENTED + AUTOMATED TESTED + human-reviewed text.

### H-5. gitleaks + basic supply chain hardening
- **Action:** gitleaks v8 in pre-commit; `.npmrc` with `min-release-age=3`; `npm audit signatures`;
  CycloneDX SBOM per release (`npm sbom`); offline osv-scanner in CI/manual.
- **Done criteria:** IMPLEMENTED (zero runtime risk).

### H-6. Biometrics as UX gate (layer 1)
- **Action:** `expo-local-authentication` to open the app and for sensitive actions.
- **Honest limit:** it's UX only; the real cryptographic guarantee (KEK with
  `setUserAuthenticationRequired`) is a FUTURE native module. Document it as such in the UI,
  don't sell it as "biometric encryption".
- **Done criteria:** IMPLEMENTED + ANDROID COMPILED + PHYSICALLY TESTED.

### H-7. Key compromise: recovery and revocation
- **Threat:** compromised identity key → the attacker can impersonate in future handshakes.
- **Action:** one-gesture identity rotation (new Ed25519 + new QR), local revocation
  (mark contact as "revoked identity", block session), and re-pairing guide.
  Forward secrecy of past content: the ephemerals already provide it (see CRYPTO_ARCHITECTURE.md).
- **Status:** pending.

### H-8. Don't replace the live session until the new one proves liveness
- **Threat:** HELLO captured and reinjected >10 s after the last handshake (outside the
  cooldown) replaces the live session with a ghost one → availability DoS
  (red-team 2026-09-27, CRYPTO_ARCHITECTURE.md §11 attack #5). No impact on
  confidentiality: the key is different and without liveness the queue doesn't divert.
- **Action:** keep serving the current session until the new one completes
  `session_confirm`; only then replace. Keep the 10 s cooldown.
- **Status:** documented finding + cooldown test; mitigation pending.
- **Done criteria:** IMPLEMENTED + AUTOMATED TESTED (replay >10 s doesn't interrupt
  the live session; the new one replaces it only after liveness).

## MEDIUM

### M-1. Selective FLAG_SECURE + clipboard policy + content-less notifications
- Sensitive screens (pairing QR, inbox, messages): no screenshots or switcher thumbnails.
  Clipboard: don't auto-copy secrets; `EXTRA_IS_SENSITIVE` (API 33+) and cleanup
  after timeout. Notifications: "New NIDO message", never the text.
- Requires a small native module or config plugin; verify on prebuild.

### M-2. Advisory root detection (not blocking)
- Warn of elevated risk and harden in-memory key handling; **don't block** the
  rooted device (don't turn security into DRM). Play Integrity is REJECTED
  (requires network; incompatible with offline-first).

### M-3. 100% local opt-in crash reporting
- Only sanitized stack traces on the device, viewer in the app, manual export by the
  user. Zero network telemetry. Sanitize before persisting (no messages, keys,
  contacts, SQL).

### M-4. Symmetric per-message ratchet (fine forward secrecy)
- Today: per-session forward secrecy (ephemerals). Improvement: derive a per-message key
  with HKDF and erase the previous one (~20 lines, without the Double Ratchet's complexity).
- **Don't** implement a partial Double/Triple Ratchet (research verdict).

### M-5. Rotating generic Bluetooth name + explicit discovery
- The classic MAC is stable and never randomized: don't use it as identity (already a rule),
  use a "NIDO"+random-suffix name per discovery session, discovery only on explicit action
  with a short timeout, and document it in the UX.

### M-6. Reproducible builds (base)
- Full pinning (Expo, lockfile, Gradle wrapper+sha256, JDK 17, NDK), `SOURCE_DATE_EPOCH`,
  local byte-identical double build in CI. EAS Build doesn't guarantee bit-for-bit: don't promise it.

## EXPERIMENTAL / FUTURE

### X-1. Post-quantum hybrid X25519 + ML-KEM-768
- **Standard status:** solid (RFC 10024, X-Wing, PQXDH deployed by Signal).
- **RN library status:** `@noble/post-quantum` **not independently audited**,
  no constant time in JS. **Not fit for production.**
- **Decision:** ADOPT LATER. Design: the audited classic component stays as the base;
  the ML-KEM branch adds harvest-now-decrypt-later protection when an audited
  implementation exists (or a native BoringSSL/AWS-LC binding). The wire must already
  be crypto-agile (version byte + suite) to plug it in without breaking compatibility.
- **Explicit activation criteria:** independent audit of the ML-KEM library in
  JS/Hermes, or a native module with BoringSSL. Until then: EXPERIMENTAL opt-in at most.

### X-2. Migrating the handshake to Noise_XX
- The current v2 handshake (signed, simple, with standard primitives) is the "simplest
  secure protocol" the research recommends keeping. Noise_XX is the right framework
  long-term (rev. 34 stable, official vectors), but there's no standalone audited Noise
  library for RN; adapting it is precision work.
- **Decision:** ADOPT LATER with official vectors as tests. Don't hand-copy PQXDH or the
  Triple Ratchet.

### X-3. Offline key attestation
- Prove cryptographically (attestation chain against embedded Google roots) that a
  key was born in StrongBox/TEE, without network. High complexity; FUTURE.

### X-4. BLE with random addresses as an alternative transport
- Would reduce tracking via the classic Bluetooth stable MAC. Switching transport is
  expensive; RFCOMM is what's implemented today. FUTURE.

### X-5. Post-quantum signatures (ML-DSA) for identity
- Can wait: a classic signature isn't vulnerable to harvest-now-decrypt-later (forging
  it requires the quantum computer at the moment of attack). FUTURE.

---

## POST-QUANTUM SECURITY / CRYPTO-AGILITY — ROADMAP ONLY

> **Status: NOT IMPLEMENTED. Future roadmap line, not active work.**
> Everything described in this section is future architecture. NIDO's real security today
> is exclusively the one in this document's "Current baseline" section.
> No current cryptography is implemented, changed or replaced because of this section.
> It doesn't touch the Android build or open an active research line.

**Goal:** prepare NIDO for a future transition to post-quantum cryptography,
especially for: NIDO identity, P2P communications, key exchange, signatures,
identity rotation and protection against *harvest now, decrypt later* scenarios.

**Future scope (design, not implementation):**
- Established post-quantum standards (e.g. ML-KEM / FIPS 203 for KEM,
  ML-DSA / FIPS 204 for signatures) — only finalized standards, never candidates
  under evaluation.
- Hybrid classical + post-quantum transition (the audited classic stays as base;
  the PQ branch adds protection when an audited implementation exists).
- Secure algorithm/version negotiation between peers, with anti-downgrade
  protection (extends the C-4 rule: no old insecure suite is accepted silently).
- Key/identity rotation and revocation compatible with algorithm change
  (extends H-7: the NIDO identity must survive cryptographic migrations without
  being permanently tied to a single algorithm).
- Cross-version compatibility during the transition (the wire must already be
  crypto-agile: version byte + suite identifier).
- Offline / local-first operation: the transition can't depend on a
  central server, external PKI or network.

**Identity longevity:** the data model already contemplates `crypto_version`,
key rotation and crypto-agility as future design (see `DATA_MODEL.md`). The
NIDO identity must be able to migrate algorithms without losing continuity or forcing
re-pairing all contacts from scratch, unless the threat requires it.

**Activation criteria (all must be met before implementing):**
1. Solid validated Android base (build + physical tests passed).
2. PQ implementation with independent audit (or audited native binding,
   e.g. BoringSSL/AWS-LC) — see X-1's criterion.
3. Finalized stable standards; explicit re-evaluation of the
   library state for React Native/Hermes at that time.

**Explicitly out of scope today:** implementing ML-KEM/ML-DSA, changing
current primitives, touching the native module or the Android build, or opening
an active research line. See also X-1 (X25519+ML-KEM hybrid) and X-5
(ML-DSA signatures) for the detailed technical status.

**Direction note (2026-09-27, Vitalik Buterin / Lean Ethereum):** Ethereum's
public goal is "centuries-long cryptographic security via hash-based
schemes", replacing the elliptic-curve cryptography that a large
quantum computer would break; NIST standards are already
finalized (ML-KEM/FIPS 203, ML-DSA/FIPS 204, Falcon) and Ethereum's
protocol cluster targets December 2029 for PQ-readiness. For NIDO,
this sets a future design preference: when crypto-agility is
activated, **hash-based signatures (SPHINCS+-type) are priority candidates
for the long-lived identity** — their security rests on hashes, not on
lattice problems, making them the most conservative bet for an
identity that must last decades. This is direction, not implementation; the
activation criteria above still rule.

---

## Technology decision table

| Technology | Decision | Concrete benefit | Threat it solves | Standard maturity | Library maturity (RN) | Complexity | Android impact | Size/perf | Impl. risk | Migration plan |
|---|---|---|---|---|---|---|---|---|---|---|
| @noble/\* (curves/ciphers/hashes) | **ADOPT NOW** | Audited maintained primitives | Abandoned crypto lib (tweetnacl) | High (RFC 8032, CFRG) | High (ToB 2026, Cure53 2024) | Low | None (pure JS, Hermes OK) | ~3 KB tree-shakeable | Low | Direct swap, same wire; official vectors as tests |
| HKDF RFC 5869 | **ADOPT NOW** | Standard KDF + per-purpose separation | Key reuse across contexts | High (RFC 5869) | High (@noble/hashes) | Low | None | Negligible | Low | Change session KDF; handshake version bump |
| XChaCha20-Poly1305 | **ADOPT NOW** | AAD + safe random nonces | Nonce reuse; unauthenticated headers | High (IRTF draft + deployment) | High (@noble/ciphers) | Low-Medium | None | Negligible | Low | Via C-3; header as AAD |
| SQLCipher (expo-sqlite) | **ADOPT NOW** | Real encryption at rest | Forensics, theft, malware with file access | High (SQLCipher 4) | High (official Expo) | Medium | Requires native rebuild | +~MBs in APK | Medium | sqlcipher_export; fail-closed; key in Keystore |
| Keystore StrongBox→TEE | **ADOPT NOW** | Non-exportable hardware keys | Key extraction | High (API 28+) | Native (own module) | Medium-High | Requires real HW to test matrix | None | Medium | Try StrongBox, fallback TEE, expose level |
| dataExtractionRules | **ADOPT NOW** | Blocks device-transfer | Leakage via device migration | High (API 31+) | Config plugin | Low | Manifest only | None | Low | Plugin + prebuild test |
| gitleaks + .npmrc + SBOM | **ADOPT NOW** | No secrets in repo; SBOM per release | Credential leakage; opaque supply chain | High | Mature tooling | Low | None | None | None | Pre-commit + CI/manual |
| Biometrics UX (expo-local-auth) | **ADOPT NOW** (UX layer) | Friction against shoulder surfers | Casual shoulder surfing | High | Official Expo | Low | Requires build | Small | Low | Prompt on open; document limit |
| Cryptographic biometrics (KEK) | **ADOPT LATER** | Biometrics truly authorize the key | Bypass of the prompt by hooking | High (Keystore) | Requires own native module | High | Native + UX fallback | None | Medium | nido-p2p module; invalidate on re-enroll |
| Noise_XX | **ADOPT LATER** | Standard analyzed handshake | Ad-hoc handshake (though simple and sound) | High (rev. 34) | Medium (only via libp2p) | High | None (JS) | Small | High | Implement against official vectors; external audit before prod |
| Symmetric msg ratchet | **ADOPT LATER** | Per-message forward secrecy | Session key compromise mid-chat | High (standard construction) | Own (~20 lines) | Low | None | None | Low | HKDF per message + erasure |
| ML-KEM-768 hybrid | **EXPERIMENTAL** | Best-effort HNDL protection | Future quantum adversary that harvested today | High (FIPS 203, RFC 10024) | **Low** (no indep. audit in JS) | Medium | Native or pure JS | +~1-2 KB per handshake | **High** | Crypto-agile wire already; activate only when criterion met |
| PQXDH | **REJECT** (today) | — | — | High | None for RN (libsignal: "external use not supported", AGPL, doesn't run on Hermes) | — | Unviable | — | — | Re-evaluate if an audited binding appears |
| Double/Triple Ratchet | **REJECT** | — | Per-message FS achieved with symmetric ratchet | High | — | High | — | — | High | Don't implement partial |
| XSalsa20 new code | **REJECT** | — | — | Medium (no IETF) | — | — | — | — | — | Keep only for compatibility |
| libsodium-wrappers (RN) | **REJECT** | — | — | High (in C) | Low in RN (Hermes without WASM → slow asm.js) | — | — | Large | — | noble in JS; native only if performance demands it (react-native-quick-crypto) |
| Play Integrity | **REJECT** | — | — | High | Requires network + Play Services | — | Incompatible with offline-first | — | — | Advisory root detection + offline attestation (future) |
| Google TTS as main route | **REJECT** | — | — | — | No documented zero-network guarantee | — | — | — | — | sherpa-onnx + Piper es_ES offline |
| Sentry/cloud crash reporting | **REJECT** | — | — | — | — | — | — | — | — | Local opt-in crash reporting |

## Progress metric (per milestone)

Each milestone must be able to answer: which attack is now more expensive or impossible, against
which attacker, and what residual risk remains? If it can't answer that, it's not a security milestone.
