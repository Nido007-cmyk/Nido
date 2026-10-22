# NIDO — scope for an external security audit

This page is for a professional security firm asked to audit NIDO. It lists
what to review, where the code is, what has already been checked and how,
and what we already know is weak. Everything here can be checked against the
code in this repository.

NIDO has **not** had a professional audit yet.

## 1. What NIDO is

An Android app (Expo SDK 57, React Native 0.86, TypeScript, plus Kotlin and C
native modules). It is an on-device AI assistant with encrypted local
storage, and it does phone-to-phone messaging over Bluetooth RFCOMM or local
Wi-Fi, without servers or internet.

## 2. Priority scope

| # | Area | Code | Why it matters |
|---|------|------|----------------|
| 1 | P2P handshake (HELLO v3, CONFIRM v1/v2, sealed hello v4) | `src/p2p/nativeTransport.ts`, `src/p2p/handshakeV3.ts`, `src/p2p/crypto.ts`, `src/p2p/sealedHandshake.ts`, `src/p2p/nonceCache.ts` | Authentication of contacts, identity hiding, replay protection |
| 2 | Session layer and P2P v5 (Double Ratchet + ML-KEM-768, encrypted headers) | `src/p2p/protocol.ts`, `src/p2p/ratchet.ts`, `src/p2p/pq.ts` | Confidentiality, forward secrecy, post-compromise security, downgrade resistance |
| 3 | Native ML-KEM-768 | `modules/nido-p2p/android/src/main/cpp/` (mlkem-native v2.0.0, unmodified, plus NIDO's config and JNI) | Memory safety of the JNI bridge, correct configuration |
| 4 | Messenger state machine (delivery, ACKs, re-pairing, revocation, disappearing messages) | `src/p2p/messenger.ts`, `src/p2p/store.ts` | Logic bugs that leak or lose messages |
| 5 | Pairing by QR code | `src/p2p/pairing.ts`, `src/p2p/pairingCeremony.ts` | Trust on first use, key changes |
| 6 | Storage encryption and hardware vault | `src/security/secureDatabase.ts`, `src/privacy/keyManager.ts`, `src/security/keyVault.ts`, `modules/nido-keyvault/` | Data at rest, key handling, biometric binding |
| 7 | Backups, full erase, panic button | `src/security/backup.ts`, `src/services/appReset.ts` | Data remanence |
| 8 | Native transport (sockets, framing, limits) | `modules/nido-p2p/android/src/main/java/expo/modules/nidop2p/` | Parsing untrusted input from nearby devices |
| 9 | Android manifest, permissions, exported components | `app.json`, `plugins/`, CI "Manifest summary" | Attack surface |

Lower priority: the on-device AI, which is local only, and its tool
permissions (`src/agent/`). Out of scope: the downloadable models
themselves.

## 3. Design documents

- Protocol and threat model: [`docs/HANDSHAKE_THREAT_MODEL.md`](../HANDSHAKE_THREAT_MODEL.md) (Spanish: `docs/es/HANDSHAKE_THREAT_MODEL.md`)
- Cryptography overview: [`docs/CRYPTO_ARCHITECTURE.md`](../CRYPTO_ARCHITECTURE.md)
- Metadata: [`docs/METADATA_PRIVACY.md`](../METADATA_PRIVACY.md)
- MASVS self-assessment: [`MASVS_CHECKLIST.md`](MASVS_CHECKLIST.md)
- Privacy policy: [`PRIVACY.md`](../../PRIVACY.md)

## 4. What has already been checked, and how

- **Formal verification (ProVerif, symbolic Dolev-Yao).** Models are in
  `formal/` and the results in `formal/README.md`; CI runs them on every
  protocol change.
  - Proven: message secrecy, forward secrecy against later leakage of
    signing keys, injective message authentication, identity agreement with
    CONFIRM v2, and v5 "harvest now, decrypt later" resistance.
  - Found and fixed: an unknown key share with CONFIRM v1 (fixed in 0.1.48).
  - Limits: the cryptography is idealised, the models are written by hand
    from the code, and only the first ratchet step is modelled.
- **Tests:** about 4,200 unit and integration tests (vitest + jest),
  including adversarial suites (`src/p2p/*adversarial*`, `r4-*`, `n6*`,
  `f1`, `f2`).
- **Fuzzing:** structured fuzzing of every parser of untrusted input
  (`src/p2p/fuzz/`), weekly in CI. It is not coverage-guided yet.
- **Native ML-KEM:** CI compiles the exact C and configuration shipped in the
  APK on x86_64 and arm64 and compares it byte for byte with
  `@noble/post-quantum` (`.github/workflows/pqc.yml`). The app runs the same
  comparison once on the device before using it.
- **Reproducible build:** two independent CI builds match in all files except
  the signature (`.github/workflows/reproducible.yml`).
- **Supply chain:** exact-pinned dependencies, actions pinned by commit, SBOM
  with every release, gitleaks, weekly `npm audit`.
- **Reviews:** independent reviews by other AI agents, which are not a
  substitute for a professional audit.

## 5. Known weaknesses (please confirm, quantify or refute)

1. With a contact on a NIDO older than 0.1.45/0.1.48/0.1.50, the protections
   fall back to what that phone supports:
   - the caller's static key is sent in clear;
   - CONFIRM is v1 only;
   - v5 headers travel in clear.
2. The Bluetooth service UUID and the mDNS service type reveal that NIDO is
   present nearby (not who).
3. The X25519, Ed25519 and secretbox primitives come from `tweetnacl` (pure
   JavaScript), which was audited by Cure53 in 2017. Hermes gives no
   constant-time guarantees.
4. Authentication is Ed25519 (not post-quantum). As in Signal's PQXDH, v5
   protects against "harvest now, decrypt later", not against an active
   quantum attacker.
5. Padding hides lengths only up to a power of two.
6. The hardware vault is optional: it requires a screen lock, and removing
   the screen lock makes the data unrecoverable without a backup.
7. Ed25519 signatures are non-repudiable. NIDO does not aim for
   deniability.
8. v5, encrypted headers and CONFIRM v2 have not been tested on two physical
   phones at the time of writing.

## 5b. Findings from other messengers' public audits

[`LESSONS_FROM_PUBLIC_AUDITS.md`](LESSONS_FROM_PUBLIC_AUDITS.md) maps the
published findings against Threema, Signal (PQXDH), Briar and Matrix to
NIDO's code.

## 6. How to build and test

- Build: [`docs/ANDROID_BUILD.md`](../ANDROID_BUILD.md). CI builds the APK
  in `.github/workflows/android-apk.yml`.
- Tests: `npm ci && npm test` (vitest) and `npm run test:components` (jest).
- Formal models: `python3 formal/check.py` with ProVerif 2.05.
- Native ML-KEM cross-check: see `.github/workflows/pqc.yml`.

## 7. Contact

Report findings as described in [`SECURITY.md`](../../SECURITY.md).
