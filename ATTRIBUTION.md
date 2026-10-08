> **Language:** English · [Español](ATTRIBUTION.es.md)

# ATTRIBUTION.md — NIDO

NIDO is a fork of **BOAR** (https://github.com/rferrari/boar-app),
MIT license, Copyright (c) 2026 aoair contributors.
The copyright notice and the MIT license text are preserved in `LICENSE`.

## What is reused from BOAR
- Local inference engine (`src/inference/LlamaEngine.ts`, `src/rag/embed.ts`)
- Local hybrid RAG (`src/rag/retrieve.ts`, `pure.ts`, `db.ts` — migrated to encryption)
- Model management and resumable downloads (`src/models/ModelManager.ts`)
- Local document importer (`src/services/documentImporter.ts`)
- Base UI: chat, drawer, themes, components (`src/ui/`)
- Native modules: `ram-monitor`, `download-wake-lock`

## What changed in NIDO (full privacy + agent)
- New agent layer: `src/agent/` (encrypted persistent memory,
  local tools, think→act→observe loop)
- `src/privacy/networkAudit.ts`: network audit (immutable log)
- Encrypted database and settings (SQLCipher + Android Keystore)
- `allowBackup=false`: out of Google backup
- Removed: Hugging Face model browser (leaked interests over the network),
  persistent telemetry, development screens
- System voice replaced with on-device inference (whisper.cpp)
- Spanish (`src/i18n/locales/es.json`) as the primary language

## Model and data licenses (if BOAR assets are distributed)
- Qwen2.5 / Gemma: Apache-2.0
- Phi-3.5-mini / bge-small-en-v1.5: MIT
- LFM2.5-8B: LFM Open License v1.0 (review terms before distributing)
- Wikipedia corpus: CC BY-SA 4.0 (attribution + share-alike)

## Using NIDO's code? Attribution is required

NIDO is MIT-licensed. You may use, modify, and distribute it — but the MIT
license **requires** preserving the copyright notice:

> Copyright (c) 2026 NIDO contributors

This means: keep the `LICENSE` file, keep the per-file headers
("Copyright (c) 2026 NIDO contributors"), and credit NIDO wherever you
credit your other dependencies (README, about screen, documentation).

What is NIDO-original work (not inherited from BOAR):
- P2P layer: `src/p2p/` — Bluetooth pairing, encrypted handshake,
  negotiation protocol, native transport (`modules/nido-p2p`)
- Agent layer: `src/agent/` — persistent memory, local tools, agent loop
- Privacy hardening: SQLCipher encryption, `allowBackup=false`,
  network audit (`src/privacy/networkAudit.ts`)
- Self-knowledge grounding: `src/rag/selfKnowledge.ts`
- Backup/restore: `src/security/backup.ts`
- Spanish-first i18n and the NIDO brand/UI identity

If you fork NIDO or reuse substantial portions, a visible credit such as
"Built on [NIDO](https://github.com/Nido007-cmyk/Nido)" is required by the
license and appreciated by its builders.
