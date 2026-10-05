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
