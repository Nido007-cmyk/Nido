> **Language:** English · [Español](README.es.md)

# NIDO: your agent, your world

A personal AI assistant that lives **on your Android phone**. Privacy by design:
encrypted on-device memory, no accounts, no cloud, no analytics.

Forked from [BOAR](https://github.com/rferrari/boar-app) (MIT), see
[ATTRIBUTION.md](ATTRIBUTION.md). NIDO builds on BOAR's offline foundation
with an original agent architecture, encrypted persistent memory, and
privacy by design.

## Documentation languages

English is the canonical documentation language in this repository. Spanish
translations live in a mirror tree with identical relative paths:
`docs/X.md` → `docs/es/X.md`, `conformance/X` → `conformance/es/X`, and root
files use the `.es.md` suffix (this file's Spanish counterpart is
[README.es.md](README.es.md)).

Every document carries a language-nav line at the top linking to its counterpart.

The app itself follows the device language, with English as fallback.
Spanish, English, and Portuguese are fully supported in the UI.

## What it does

- **Local chat** with an on-device LLM (llama.cpp via llama.rn).
- **Persistent memory**: facts, preferences, people and journal, encrypted
  with SQLCipher, key in the Android Keystore.
- **Local tools**: notes, reminders, device time, opening apps. None touch the
  network (manifest in `src/agent/tools/manifest.ts`).
- **Agent loop** think → act → observe (`src/agent/loop/`), with deterministic
  validation of each tool call.
- **Local RAG**: your documents indexed on the phone (inherited from BOAR).
- **Network audit**: every connection the app makes is logged and visible in
  Settings (`src/privacy/networkAudit.ts`).

## Core principles

- **Privacy**: Your data stays on your device, encrypted.
- **User authority**: You decide what NIDO can do. Sensitive actions require
  your explicit approval.
- **Local-first**: Core functionality works without network.
- **Fail-closed security**: When in doubt, NIDO refuses rather than risking
  your data.
- **Auditable behavior**: What NIDO does is visible and verifiable.

## Privacy & Security

Your data is encrypted with SQLCipher. The encryption key lives in the
Android Keystore and never leaves your device. If the key cannot be read,
NIDO refuses to operate rather than risking data exposure (fail-closed).

Android backup is disabled (`allowBackup=false`), so your data is never
backed up to Google servers.

Every network connection the app makes is logged in Settings. You can see
exactly what leaves your device, if anything.

Sensitive actions (sending messages, making calls, etc.) require your explicit
approval. NIDO uses a canonical AUTO/ASK/DENY system: safe actions proceed
automatically, sensitive actions ask you, dangerous actions are denied.

See [docs/PRIVACY.md](docs/PRIVACY.md) for details.

## How Nido differs from BOAR

NIDO is a fork of BOAR. This table compares verified differences based on
the current codebase.

| Area | BOAR / Upstream | NIDO |
|------|-----------------|------|
| Local database | Plaintext SQLite (verify upstream) | SQLCipher + Android Keystore (`src/agent/memory/`) |
| Android backup | Enabled (verify upstream) | `allowBackup=false` (`android/app/src/main/AndroidManifest.xml`) |
| Model discovery | Hugging Face browser (network) | Removed — curated catalog only |
| Model sources | Unpinned `resolve/main` URLs | Pinned revisions (`src/models/manifest.ts`) |
| Download integrity | SHA-256 not verified | Automatic SHA-256 verification (`src/models/ModelManager.ts`) |
| Network visibility | No audit | Audit log in Settings (`src/privacy/networkAudit.ts`) |
| Persistent telemetry | Present (verify upstream) | Removed |
| Sensitive actions | No authorization system | Canonical AUTO/ASK/DENY (`src/agent/policy/authorization.ts`) |
| Human approval | Not present | Explicit approval for sensitive actions |
| Policy enforcement | Not present | Policy Engine + validateTask (`src/agent/policy/`) |
| Untrusted content | Direct use | `wrapUntrusted` labeling (`src/agent/policy/policyEngine.ts`) |
| P2P integrity | Verify upstream | SHA-256 chunk verification (`src/p2p/packSharing.ts`) |

**Note:** BOAR upstream claims marked "verify upstream" could not be
independently verified from the fork point. They represent the understood
differences at fork time.

## Current status

### Runtime-integrated

These features are live and used by the product:

- Local LLM chat (llama.rn)
- Encrypted persistent memory (SQLCipher + Keystore)
- Agent loop (think → act → observe)
- Local tools (notes, reminders, time, app launching)
- Policy Engine with AUTO/ASK/DENY
- Network audit log
- P2P messaging (basic)
- Model catalog with pinned revisions and SHA-256 verification

### Implemented but not runtime-integrated

Code exists but is not yet part of the operational product flow:

- **Scheduled Tasks** (`src/agent/scheduled/`) — task scheduling infrastructure
- **Knowledge Graph** (`src/agent/memory/knowledgeGraph.ts`) — graph-based memory
- **Dual Model Router** (`src/agent/models/dualModel*.ts`) — multi-model routing
- **Calm UI components** (`src/ui/components/calm/`) — AgentMessage, MemoryChip,
  AgencyReceipt, ApprovalCard, EmptyState (some newly created, not yet wired)

### Dead-code candidates

- **UsageStatsScreen** — 0 callers, not used by the product

## Experimental R&D — not implemented

The following are research concepts only. They do **not** exist as production
functionality:

- Nido Memory Fabric
- Verified Forget
- Cryptographic Agency Receipts
- Capability Passports
- Capability Leasing
- Isolation Cells
- Adaptive Brain
- Living UI
- Personal LoRA / Personal Adaptation Layer
- Native Device Capability Layer

Do not expect these in the current build.

## Building / Testing

Doesn't work in Expo Go (native modules: llama.rn, SQLCipher, etc.).
You need Android SDK + NDK + JDK, or EAS.

```bash
npm install
npx expo prebuild -p android --clean
npx expo run:android --device
```

Release APK:

```bash
npx expo prebuild -p android --clean
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Verification without a device (doesn't prove a real install):

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest, the pure logic (agent, privacy, routing, rag)
```

Full build guide in [AGENTS.md](AGENTS.md).

## Layout

```
src/
  agent/        NIDO agent layer: memory, tools, loop, policy, scheduled
  privacy/      Network audit, key management
  inference/    LlamaEngine (inherited from BOAR)
  rag/          Local hybrid RAG (inherited from BOAR)
  models/       Catalog + downloads (pinned revisions, SHA-256)
  p2p/          Peer-to-peer messaging
  services/     Downloads, documents, summaries…
  ui/           Chat, settings, screens, calm components
  i18n/         locales/en.json, es.json, pt.json
```

## Upstream / Attribution

NIDO is a fork of [BOAR](https://github.com/rferrari/boar-app) by aoair
contributors (MIT License).

The original BOAR copyright notice and MIT license text are preserved in
[LICENSE](LICENSE). See [ATTRIBUTION.md](ATTRIBUTION.md) for details on
what was reused and what was changed.

## License

MIT, see [LICENSE](LICENSE) and [ATTRIBUTION.md](ATTRIBUTION.md).

Copyright (c) 2026 aoair contributors (BOAR upstream)
Copyright (c) 2026 NIDO contributors
