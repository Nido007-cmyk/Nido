# NIDO — Threat Model (one page)

> The full analysis lives in [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) (per-threat
> detail) and [`docs/HANDSHAKE_THREAT_MODEL.md`](HANDSHAKE_THREAT_MODEL.md)
> (handshake history). This page is the short public version: what the app
> protects, and — just as important — what it does not.

**Status:** alpha. The P2P protocol and delegation design went through an
internal security review plus two adversarial audit rounds
([`docs/security/AUDITS_2026-10.md`](security/AUDITS_2026-10.md)). **No
external cryptographic audit has been performed.** Until one exists, NIDO is
best described as **designed to fail closed**, not as "secure".

## What NIDO protects

- **P2P pairing and transport:** pairing happens in person via QR; the
  handshake (HELLO v3 + CONFIRM v1) authenticates the ephemeral exchange
  with the identity delivered in the QR. Primitives are standard and audited
  (X25519, Ed25519, XSalsa20-Poly1305, SHA-512 via TweetNaCl); the session
  key is derived with HKDF-SHA512. We invent no primitives.
- **Replay and hijack resistance:** a persistent per-peer nonce cache rejects
  replayed handshakes fail-closed; a replayed HELLO can never mutate the
  route table. Ephemeral secrets are zeroed on every handshake exit path.
- **Fail-closed by default:** malformed, unsigned, downgraded or replayed
  messages are rejected and the connection is closed — the app refuses
  rather than risking a bad session.
- **Data at rest:** the agent database is SQLCipher-encrypted with a key held
  in the Android Keystore (fail-closed: without the key the database is
  indistinguishable from random). Backups are encrypted; restore requires
  confirmation plus biometrics. Revocation removes the contact and blocks
  reconnection, with a visible recovery banner if the local store is corrupt.

## What NIDO does NOT protect against

- **A QR accepted blindly.** The QR is authentic only if you actually verified
  who you scanned it with, in person. A photographed or forwarded QR is a
  different person.
- **Malware on your phone.** The Android sandbox and encryption stop
  file-level readers; an app with accessibility access or root sees what you
  see. No app can defend against a compromised device.
- **A rooted device.** Key material in RAM can be dumped. We document this
  honestly instead of promising the impossible.
- **An APK from a dubious source.** Only builds signed with the NIDO release
  key are legitimate; verify the SHA-256 of anything you install. We keep the
  same signing key across builds so updates do not silently change identity.
- **A wrong clock.** Timestamps bound handshake freshness; a badly skewed
  clock weakens replay windows.
- **System Bluetooth itself.** During discovery the OS exposes a stable MAC
  and device name to nearby observers; NIDO deliberately skips OS-level
  pairing (PIN prompts confuse) and provides its own encryption instead.
- **Physical access to an unlocked phone.** No authentication currently gates
  opening the app; a stolen unlocked phone is fully exposed.
- **Social engineering and phishing.** Out of scope, as are vulnerabilities
  in third-party dependencies (report those upstream).
- **The AI models.** Weights are not audited; the model is a replaceable
  reasoning component, not part of the trust boundary.

If you find a vulnerability: **do not open a public issue** — use
[GitHub Private Vulnerability Reporting](https://github.com/Nido007-cmyk/Nido/security/advisories/new)
(see [`SECURITY.md`](../SECURITY.md)).
