> **Language:** English · [Español](es/PRIVACY_MODEL.md)

# PRIVACY_MODEL.md — NIDO

**Date:** 2026-09-27. **Guiding principle:** the user's device is
the only place where their data exists. No account, no server, no cloud.

## 1. What data exists and where it lives

| Data | Where | Leaves the device |
|---|---|---|
| Messages (inbox/outbox) | Local SQLite | **No** — only over Bluetooth to the paired contact, encrypted |
| P2P contacts | Local SQLite | **No** |
| Agent memory (memories, notes, summaries) | Local SQLite | **No** |
| Identity/signing keys | SecureStore (Keystore) | **No** (never; only the public one travels in the physical QR) |
| AI models (LLM, STT, TTS) | Local storage (bundled) | **No** |
| Crash reports | Local, opt-in | **No** (manual user export) |
| Telemetry / analytics | — | **Doesn't exist** |

**There's no:** user registration, login, phone number, email, advertising, trackers,
analytics SDKs, or proprietary network endpoints. The app doesn't open Internet sockets for
any of its declared functions (see §4 on the OS network model).

## 2. Network model

- **Core functions (messaging, memory, voice, tools):** zero network by design.
  The only communication channel is Bluetooth RFCOMM with QR-paired devices.
- **What the OS may do on its own** (outside our control, documented
  honestly): Android connectivity checks, NTP, Play Services. NIDO doesn't
  trigger or need them; airplane mode + Bluetooth is an official test that the app
  works without them.
- **Rule:** no future feature may introduce a silent network call.
  If a feature ever needed network, it would be explicit opt-in, with plain-language
  explanation and without degrading offline mode.

## 3. Metadata: what's exposed and to whom

| Metadata | Who sees it | Mitigation |
|---|---|---|
| Bluetooth MAC (stable) | Any nearby radio during discovery/connection | M-5: rotating generic name, explicit brief discovery; the MAC is never identity |
| Device name | Same as above | M-5 |
| Connection timing/duration | Nearby radio observer | No total mitigation possible on classic radio; content is encrypted |
| Social graph (who talks to whom) | Nobody remote (no server aggregates it) | Local-first: the graph exists only on the phone |
| Usage patterns (when the app opens) | The device itself only | No telemetry exporting them |

**We don't promise anonymity** (see §7). NIDO's privacy is *local confidentiality +
absence of third parties*, not anonymity against a radio observer.

## 4. Consent and human confirmation

The app **never** acts outward without the user's explicit confirmation:

- Calls, SMS, messages to external contacts, calendar events.
- Sharing, exporting or deleting information.
- Changing identity or keys (rotation).
- Pairing a new contact (the QR is scanned and the fingerprint verified in person).
- Exporting crash reports or any data.

Each confirmation's text is in plain language (what will be done, with whom,
what risk it has), not technical jargon.

## 5. Involuntary leak surfaces (status and plan)

| Surface | Status today | Plan |
|---|---|---|
| Notifications | **Audit:** verify they don't show message text | M-1: generic "New NIDO message" text |
| Clipboard | **Audit:** don't auto-copy secrets | M-1: `EXTRA_IS_SENSITIVE` (API 33+), cleanup after timeout |
| Screenshots / switcher | Unprotected | M-1: `FLAG_SECURE` on sensitive screens (QR, inbox, messages) |
| Cloud backups | `allowBackup=false` | H-3: `dataExtractionRules` (also blocks device-transfer on 12+) |
| App logs | No PII by design in P2P code (errors don't include content) | M-3: sanitization before persisting crash reports |
| Thumbnails in "recents" | Unprotected | M-1 (FLAG_SECURE covers them) |
| Third-party keyboards | Outside the app's control | Document: recommend the system keyboard; sensitive fields use secure input |

## 6. Deletion and retention

- **Message deletion:** logical deletion + periodic `VACUUM`; physical deletion in
  flash with wear-leveling can't be guaranteed — it's documented, not promised.
- **Identity revocation:** `deleteIdentity()` removes the seeds from SecureStore.
- **No remote retention:** with no server, "delete" means delete on the
  device. Messages already delivered to the peer can't be deleted remotely
  (no remote-delete protocol; documented as a limit).
- **Default retention:** messages are kept until the user deletes them.
  No auto-delete policy yet (candidate for a future opt-in setting).

## 7. What we do NOT promise (honest limits)

- **No "anonymity":** classic Bluetooth exposes a stable MAC to nearby radio
  observers. NIDO doesn't anonymize the radio layer.
- **No "unhackable":** a rooted device or malware with privileges
  defeats app defenses (T-04). We document it instead of promising the impossible.
- **No "quantum-proof":** the harvest-now-decrypt-later risk exists in theory and is
  accepted until X-1 meets its criteria (see CRYPTO_ARCHITECTURE.md §9 and
  SECURITY_ROADMAP.md X-1).
- **No "biometric encryption"** (yet): the current biometric prompt is a UX gate; the
  cryptographic guarantee requires the future native module (H-6).
- **Tests aren't an audit.** 423 green tests ≠ external cryptographic review.

## 8. Local AI model privacy

- Models (LLM, whisper STT, Piper TTS) ship with the app or are downloaded
  once from an immutable URL with **SHA-256 pinned and verified before loading**.
- Inference happens on-device; no audio, text or embedding leaves.
- **No promises without evidence:** "100% offline STT" isn't claimed until tested
  in airplane mode with traffic capture (P7); `EXTRA_PREFER_OFFLINE` is a preference,
  not a guarantee.

## 9. Verifiable commitments

1. Zero app-initiated network calls (verifiable with traffic capture in
   airplane mode + Bluetooth, P7).
2. Zero telemetry, zero analytics, zero automatic crash reporting.
3. All sensitive data at rest, encrypted (C-1) with hardware keys (C-2).
4. No external action without human confirmation (§4).
5. Public security documents in the repo, updated with every change.

**Metric:** privacy is measured by *data it is technically impossible to get out*,
not by promises. Every commitment on this list must have a test or a physical
proof backing it.
