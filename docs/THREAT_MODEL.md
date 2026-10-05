> **Language:** English · [Español](es/THREAT_MODEL.md)

# THREAT_MODEL.md — NIDO

**Date:** 2026-09-27. **Scope:** Android app (Expo SDK 57), 100% offline,
P2P messaging over Bluetooth RFCOMM, agent memory in local SQLite.
**Out of scope:** security of the Android OS itself, of the hardware, and of the AI models
(weights audit: see PRIVACY_MODEL.md).

Per-threat format: **asset → attacker capability → attack → mitigation → residual risk.**
Identifiers (T-01…) link to SECURITY_ROADMAP.md.

## Model assumptions

1. The attacker does **not** have the victim's identity private key unless stated.
2. The QR is exchanged **in person**; its physical integrity is the root of trust.
3. Classic Bluetooth exposes a stable MAC and name during discovery to passive observers.
4. Without SQLCipher (current state), everything in SQLite is **plaintext** to
   file access.

---

## T-01. Lost phone (locked)

- **Asset:** messages, contacts, agent memory, identity keys.
- **Capability:** physical access, no credentials; basic logical/forensic extraction.
- **Attack:** connect via USB / forensic reader and copy the SQLite DB and files.
- **Current mitigation:** `allowBackup=false`; keys in SecureStore (encrypted by Keystore).
- **Gap:** without SQLCipher, the DB is plaintext → **the content is readable**.
- **Planned mitigation:** C-1 (SQLCipher) + C-2 (hardware Keystore) + H-6 (biometrics).
- **Residual risk (today):** **HIGH** — a lost phone exposes the content. After C-1/C-2/H-6: LOW
  (the attacker needs to break the device lock or the hardware).

## T-02. Stolen unlocked phone

- **Asset:** all of the above + active sessions in memory.
- **Capability:** full interactive use of the app.
- **Attack:** read messages, export data, impersonate the user to their contacts.
- **Current mitigation:** none specific (the app opens without authentication).
- **Planned mitigation:** H-6 (biometrics on open + re-auth after inactivity); M-1 (FLAG_SECURE
  doesn't help here, but the H-4/M-3 confirmations do for destructive actions).
- **Residual risk (today):** **HIGH**. After H-6: MEDIUM (window between unlock and re-auth;
  an attacker with the user's finger or coercion still gets in — out of the model).

## T-03. Local malware / malicious app on the same device

- **Asset:** app files, process memory, clipboard, notifications.
- **Capability:** execution as another app (Android sandbox), or as root (see T-04).
- **Attack:** read the DB, sniff notifications, read the clipboard, overlay the app.
- **Current mitigation:** Android sandbox; `allowBackup=false`; notifications — *content pending audit*.
- **Planned mitigation:** C-1 (the encrypted DB resists readers with file permission),
  M-1 (content-less notifications, secret-free clipboard), H-5 (fewer deps = less
  supply-chain risk inside the APK itself).
- **Residual risk:** MEDIUM. Malware with accessibility or root defeats any app-level
  defense; the goal is that **reading files alone isn't enough**.

## T-04. Rooted device / hooking (Frida)

- **Asset:** process memory, keys in use.
- **Capability:** full device read/write, bypass of client-side checks.
- **Attack:** dump the SQLCipher master key from RAM, hook the biometric prompt.
- **Mitigation:** **advisory** detection (M-2): warn and harden (don't cache the master key,
  frequent re-auth). **Don't block** (it's not DRM). Biometrics as a boolean is hookable:
  the real guarantee requires a KEK with `setUserAuthenticationRequired` (FUTURE).
- **Residual risk:** **HIGH by design** — against local root no app defense holds;
  it's documented honestly instead of promising the impossible.

## T-05. Passive Bluetooth attacker (nearby observer)

- **Asset:** metadata (who talks to whom, when, how much).
- **Capability:** passive radio during discovery/connection, without interacting.
- **Attack:** correlate stable MACs with people/places; infer the social graph from
  connection patterns; read device names ("María's Galaxy").
- **Current mitigation:** none (default device name).
- **Planned mitigation:** M-5 (rotating generic name per discovery session,
  explicit discovery with timeout, documented in UX). Content is encrypted (not readable).
  The MAC is never identity (architecture rule).
- **Residual risk:** MEDIUM. The classic MAC **cannot be hidden** (stable by protocol
  design); mitigation reduces *human readability*, not *radio observability*.

## T-06. Active MITM on Bluetooth

- **Asset:** conversation confidentiality and integrity.
- **Capability:** active radio: intercept, modify, reinject frames; pose as the peer.
- **Attack:** substitute the HELLO ephemeral to force a known session key;
  alter frames.
- **Current mitigation:** signed v2 HELLO with Ed25519 bound to the QR (IMPLEMENTED + AUTOMATED TESTED);
  the signature covers `(pk|eph|nonce)` — substituting the ephemeral invalidates the signature; frames under
  XSalsa20-Poly1305 (AEAD) — tampering is silently discarded.
- **Tests:** `nativeTransport.test.ts` (MITM: ephemeral substitution; forged signature),
  `adversarial.test.ts` (corrupt, truncated, garbage ciphertext).
- **Residual risk:** LOW against network MITM. **Doesn't cover** a compromised endpoint or a
  physically substituted QR without fingerprint verification (see T-08).

## T-07. Replay

- **Asset:** session freshness; message queue.
- **Capability:** capture and reinject valid HELLOs and frames.
- **Attack:** reinject a HELLO to resurrect a session and divert the queue; reinject
  a chat frame to duplicate a message.
- **Current mitigation:** fresh 16 B nonces per handshake bound to the KDF (a repeated
  HELLO derives a **different** key); liveness: the queue only drains toward sessions
  that produced a valid frame (the attacker doesn't know the ephemeral key and cannot
  produce `session_confirm`); unique message ids with `seenIds` + persistent
  deduplication in DB (survives restarts).
- **Tests:** replay with live route, cooldown against duplicated HELLO on a new connection,
  different nonces → different keys, persistent duplicate.
- **Note (red-team 2026-09-27):** a HELLO reinjected >10 s after the cooldown replaces
  the live session with a ghost one without liveness → availability DoS (real frames
  fail the AEAD). No confidentiality impact. Mitigation: H-8.
- **Residual risk:** LOW.

## T-08. Malicious QR / physical QR substitution

- **Asset:** root of trust (the contact's spk).
- **Capability:** stick their own QR over the legitimate QR; generate a QR with valid format
  but the attacker's keys.
- **Attack:** the victim pairs the attacker's key believing it's their contact.
- **Current mitigation:** the QR is verified in person; the fingerprint is shown for
  verbal verification; `pairWith` rejects its own code and malformed/oversized payloads.
- **Gap:** if the user doesn't verify the fingerprint, the physical substitution isn't detected.
- **Planned mitigation:** H-4 (explicit verification flow: show the fingerprint in human
  language and require confirmation before saving the contact).
- **Residual risk:** MEDIUM (depends on user behavior; inherent to any physical
  trust-on-first-sight).

## T-09. Compromised peer

- **Asset:** future conversation confidentiality.
- **Capability:** full control of the contact's device.
- **Attack:** read future messages; impersonate the contact to the victim.
- **Current mitigation:** forward secrecy of past content (per-session ephemerals: compromising
  the identity **afterwards** doesn't decrypt past sessions — see CRYPTO_ARCHITECTURE.md).
- **Gap:** no post-compromise security: with the peer's signing key, the attacker can
  keep impersonating them in future handshakes until the victim rotates/re-pairs.
- **Planned mitigation:** H-7 (one-gesture rotation and revocation, re-pairing via QR).
- **Residual risk:** MEDIUM-HIGH (inherent to serverless messaging: no central CRL;
  recovery is social, via QR).

## T-10. Contact identity key change (legitimate or attack)

- **Asset:** trust continuity.
- **Capability:** the peer reinstalls the app (new key) or an attacker attempts rollback.
- **Attack:** pass a new key off as legitimate, or reinject an old key
  after a rotation (identity rollback).
- **Current mitigation:** fail-closed (signature doesn't verify → connection rejected).
- **Gap:** the error message doesn't distinguish "possible attack" from "your contact reinstalled the app";
  no explicit protection against rollback to an already-seen old spk.
- **Planned mitigation:** H-4 (visible warning in human language + re-verification via
  QR; pin the most recent spk and reject previous spks).
- **Residual risk (today):** MEDIUM (the rejection is safe, but the UX pushes the user to
  re-scan without verifying, which nullifies the protection).

## T-11. Malicious file (import, voice/AI model, backup)

- **Asset:** process integrity, data.
- **Capability:** deliver a file the app processes (model, document, backup).
- **Attack:** model with a different SHA (substitution), tampered backup, document exploiting
  a parser.
- **Current mitigation:** partial (size limits in QR/framing; defensive parsers in P2P).
- **Planned mitigation:** pinned hash and verification before loading each model
  (whisper/STT, TTS, LLM); strict validation of all input (QR, HELLO, frames, files);
  no complex-format parser without limits.
- **Residual risk:** MEDIUM until model verification is closed.

## T-12. Compromised dependency (supply chain)

- **Asset:** build and runtime integrity.
- **Capability:** publish a malicious package version; typosquatting; maintainer takeover.
- **Attack:** exfiltrate keys or messages from inside the app.
- **Current mitigation:** committed lockfile; 38 direct dependencies.
- **Planned mitigation:** H-5 (gitleaks, `min-release-age=3`, `npm audit signatures`,
  CycloneDX SBOM per release, offline osv-scanner); C-3 (remove abandoned tweetnacl);
  vetting checklist for new deps (2+ red flags → alternative/inline).
- **Residual risk:** MEDIUM (npm audit doesn't see malware; Socket.dev only on-demand since it's SaaS).

## T-13. Compromised build machine

- **Asset:** integrity of the APK the user installs.
- **Capability:** modify the code during the build or sign with a different key.
- **Attack:** trojanized APK with the legitimate signature.
- **Current mitigation:** `withReleaseSigning.js` (the signing key lives in `~/.gradle`, never in the repo).
- **Planned mitigation:** M-6 (reproducible builds: pinning + `SOURCE_DATE_EPOCH` + byte-identical
  double build); publish the APK's SHA-256 (FUTURE, F-Droid model).
- **Residual risk:** MEDIUM-HIGH (without reproducible builds there's no independent way to
  verify the APK matches the source).

## T-14. Future quantum adversary (harvest-now-decrypt-later)

- **Asset:** long-term confidentiality of conversations captured today.
- **Capability:** capture Bluetooth traffic today; cryptographically relevant quantum computer
  in the future.
- **Attack:** retroactively decrypt X25519 sessions.
- **Current mitigation:** none specific (X25519 is vulnerable to HNDL in theory).
- **Honest context:** the HNDL model is weaker over Bluetooth than over the Internet (it requires
  physical proximity during the session to harvest). It's not the priority threat vs
  T-01/T-02/T-03.
- **Planned mitigation:** X-1 (X25519+ML-KEM-768 hybrid, activation conditioned on an
  audited implementation); crypto-agility from now (version + suite in the wire).
- **Residual risk:** MEDIUM (accepted and documented; "quantum-proof" is not promised).

## T-15. Forensic extraction (lab)

- **Asset:** everything persistent.
- **Capability:** desolder memory, lock-screen bypass, commercial forensic exploits.
- **Attack:** direct flash read.
- **Mitigation:** C-1 + C-2 (with StrongBox/TEE, the key doesn't leave the hardware; the DB is
  indistinguishable from random without it). Secure deletion: `deleteIdentity` removes seeds;
  physical deletion in flash with wear-leveling can't be guaranteed — documented.
- **Residual risk:** MEDIUM with C-1/C-2 (a lab with a TEE exploit remains a risk;
  out of the model for a normal user).

## T-16. Shoulder surfing / prying eyes

- **Asset:** on-screen content, pairing QR.
- **Capability:** casual visual observation.
- **Attack:** read messages over the shoulder; photograph the pairing QR.
- **Mitigation:** H-6 (biometrics on open), M-1 (FLAG_SECURE on sensitive screens),
  content-less notifications.
- **Residual risk:** LOW-MEDIUM (a QR photographed at a distance is a real vector:
  pairing must happen in a controlled environment).

## T-17. Leak via notifications / clipboard / screenshots

- **Asset:** message text, codes, fingerprints.
- **Capability:** another app (Notification Listener), clipboard read, screenshot malware.
- **Attack:** message text shows up in the notification visible on the locked screen;
  a copied secret stays in the global clipboard.
- **Planned mitigation:** M-1 (generic notifications, `EXTRA_IS_SENSITIVE` + clipboard
  cleanup, selective FLAG_SECURE).
- **Residual risk (today):** MEDIUM (pending audit of what each notification shows today).

## T-18. Radio / battery DoS

- **Asset:** availability.
- **Capability:** radio proximity.
- **Attack:** flood HELLOs/garbage frames to drain the battery or block the handshake.
- **Current mitigation:** handshake cooldown (10 s per peer), 15 s timeout, malformed
  frames discarded without response, 256 KiB limit per frame.
- **Residual risk:** LOW-MEDIUM (Bluetooth is inherently jammable by radio;
  no battery is spent on expensive crypto before cheap validation: version/size first,
  the Ed25519 signature only after contact lookup).

## Current residual risk matrix (without C-1/C-2/H-6)

| Threat | Risk today | After CRITICAL/HIGH roadmap |
|---|---|---|
| T-01 lost phone | HIGH | LOW |
| T-02 stolen unlocked | HIGH | MEDIUM |
| T-03 local malware | MEDIUM-HIGH | MEDIUM |
| T-04 root/hooking | HIGH | HIGH (accepted, documented) |
| T-05 passive BT observer | MEDIUM | MEDIUM (stable MAC: irreducible) |
| T-06 MITM | LOW | LOW |
| T-07 replay | LOW | LOW |
| T-08 malicious QR | MEDIUM | MEDIUM (human factor) |
| T-09 compromised peer | MEDIUM-HIGH | MEDIUM |
| T-10 identity key change | MEDIUM | LOW (with H-4) |
| T-11 malicious file | MEDIUM | LOW (with pinned hash) |
| T-12 supply chain | MEDIUM | MEDIUM-LOW |
| T-13 build machine | MEDIUM-HIGH | MEDIUM (with M-6) |
| T-14 future quantum | MEDIUM | MEDIUM-LOW (with X-1) |
| T-15 forensic | HIGH (without C-1) | MEDIUM |
| T-16 shoulder surfing | MEDIUM | LOW-MEDIUM |
| T-17 notif/clipboard | MEDIUM | LOW |
| T-18 radio DoS | LOW-MEDIUM | LOW-MEDIUM |

**Executive read:** today's HIGH risks are all on the "physical device access" axis
and are fixed by the same package: **C-1 + C-2 + H-6** (encryption at rest,
hardware keys, biometrics). That's the next milestone that removes the most risk per
effort invested.
