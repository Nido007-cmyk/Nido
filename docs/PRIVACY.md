> **Language:** English · [Español](es/PRIVACY.md)

# PRIVACY.md — NIDO privacy hardening

This document records every privacy gap found during hardening and its
status. The user-facing policy is in [`PRIVACY.md`](../PRIVACY.md) at the repository root.

## Implemented

### 1. Network audit (`src/privacy/networkAudit.ts`)
Append-only singleton. `ModelManager.downloadCatalogModel` logs
`download_start` / `download_complete` / `download_failed` with the endpoint
trimmed to host+path (no query strings — tokens are never logged).
`isPristine()` lets the UI show "zero connections this session".

### 2. No Google backup (`app.json`)
`android.allowBackup: false` — automatic backup can no longer upload
`documentDirectory` (settings + databases).

### 3. Model browser removed
`src/services/modelBrowser.ts`, `src/models/discoveredModels.ts` and
`src/ui/ModelBrowser.tsx` removed, along with all their references
(`ChatScreen`, `ModelSetupScreen`, `evalHarness`, `appReset`,
`ExecutionTelemetryScreen`). Searching `huggingface.co/api` leaked
the user's interests over the network.

### 4. Pinned revisions (`src/models/manifest.ts`)
New `revision` field + `pinnedSourceUrl()`: when pinned, the download
uses `/resolve/<commit>/` instead of the moving `/resolve/main/` branch.
Real hashes are pinned during the release process
(`scripts/setup-models.sh` records them).

### 5. sha256 verification after download (`ModelManager`)
- Assets ≤ 256 MB (embeddings, corpus): sha256 verification **mandatory**
  after download; mismatch = file deleted + error.
- Multi-GB LLMs: verification inside the download flow
  (`ModelManager.verifyChecksum`); a manual verify button in Settings
  is still pending.

### 6. Network-less agent layer by construction
- `src/agent/tools/manifest.ts`: local tools only. Rule:
  if a future tool needed network, it goes in another manifest with
  per-use consent.
- `src/agent/tools/dispatcher.ts`: deterministic validation — the model
  cannot invoke nonexistent tools or invent parameters.

### 7. SQLCipher build, key in the Android Keystore (`src/security/databaseManager.ts`)
The database always opens with the SQLCipher variant of expo-sqlite and
fails closed when the key is unavailable (`databaseManager.ts:21`). The
key is a random 256-bit value generated on first launch and held by the
Android Keystore (`src/privacy/keyManager.ts:400`). In 0.1.69 the
database was proven against the real SQLCipher engine.

### 8. `rag/db.ts` migrated to the same encryption (`src/rag/db.ts`)
`src/rag/db.ts:335` opens encrypted, with a plaintext→SQLCipher
migration that fails closed. `settings.ts` has not migrated — it is
the remaining item in Pending below.

### 9. Biometric lock (`src/security/biometricGate.ts`)
Opening the app can be gated by fingerprint or face; the user-facing
description is in the root `PRIVACY.md`.

### 10. Audit screen (`src/ui/NetworkAuditCard.tsx`)
Settings › Security and privacy shows the network audit log
(`networkAudit.list()`); the log has persisted across restarts
since 0.1.62.

## Pending (later phases)

- [ ] **Migrate `settings.ts`** to the same encryption: `settings.json`
      still lives in plain text in the app's private storage
      (`src/models/settings.ts:80`).
- [ ] **On-device voice**: replace `modules/voice-input`
      (system SpeechRecognizer) with whisper.cpp.
- [ ] **"Verify integrity" button** in Settings → Models for large LLMs:
      `verifyChecksum()` runs inside the download flow, but no screen
      calls it as a manual check yet.

## P2P transport security notes

- NIDO's P2P crypto runs **above** the Bluetooth socket (X25519 ECDH +
  Ed25519 + XSalsa20-Poly1305 in `src/p2p/crypto.ts`), so link-layer
  Bluetooth attacks (KNOB, BIAS) cannot read NIDO traffic. The session
  key is derived with HKDF-SHA512 (RFC 5869) bound to both sides'
  fresh handshake nonces; ephemeral secrets are wiped from memory
  after the handshake.
- Residual risk below the app layer: pre-authentication RCE in the
  Android Bluetooth stack (e.g. CVE-2025-0075 / CVE-2025-22403,
  SDP use-after-free) can compromise the *device*, at which point no
  app-layer guarantee holds. There is no in-app fix for this class.
  **Operational minimum: keep both tablets on Android security patch
  level ≥ 2025-03-05.**
- Delegated-task tokens (feature-flagged OFF in v1) are bound to the
  transport session tag when issued; a token captured at rest cannot be
  replayed against a different session with the same peer.
