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
- Multi-GB LLMs: on-demand verification from Settings
  (`verifyChecksum()` already existed; verifying GBs in JS would OOM).

### 6. Network-less agent layer by construction
- `src/agent/tools/manifest.ts`: local tools only. Rule:
  if a future tool needed network, it goes in another manifest with
  per-use consent.
- `src/agent/tools/dispatcher.ts`: deterministic validation — the model
  cannot invoke nonexistent tools or invent parameters.

## Pending (later phases)

- [ ] **SQLCipher**: `src/agent/memory/memoryStore.ts` already emits
      `PRAGMA key` and fails closed if SQLite doesn't ship cipher.
      Missing: build with the SQLCipher variant of expo-sqlite + key
      generated in Android Keystore on first launch.
- [ ] **Migrate `rag/db.ts` and `settings.ts`** to the same encryption.
- [ ] **On-device voice**: replace `modules/voice-input`
      (system SpeechRecognizer) with whisper.cpp.
- [ ] **Biometric lock** when opening the app.
- [ ] **Audit screen** in Settings (list `networkAudit.list()`).
- [ ] **"Verify integrity" button** in Settings → Models for large LLMs.

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
