> **Language:** English · [Español](README.es.md)

# NIDO: your agent, your world

A personal AI assistant that lives **100% on your Android phone**. Total privacy
by design: zero network after installation, encrypted on-device memory, no
accounts, no cloud, no analytics.

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
- **Spanish** as the primary language.

## Privacy: how NIDO differs from BOAR

| Area | NIDO |
|---|---|
| Settings and SQLite in plaintext | Encrypted (SQLCipher + Keystore) |
| Google backup enabled | `allowBackup=false` |
| System voice (may use network) | On-device STT (whisper.cpp) |
| Model browser (leaks interests over network) | Removed |
| Unpinned `resolve/main` URLs | Pinned revisions (`pinnedSourceUrl`) |
| sha256 never verified after download | Automatic verification (≤256 MB) + on demand |
| No network visibility | Audit log in Settings |
| Persistent telemetry | Removed |

Details in [docs/PRIVACY.md](docs/PRIVACY.md).

## Build and install

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
  agent/        NIDO agent layer: memory, tools, loop
  privacy/      Network audit
  inference/    LlamaEngine (inherited from BOAR, unchanged)
  rag/          Local hybrid RAG (inherited; db.ts → encryption pending)
  models/       Catalog + downloads (hardened: audit, sha256, pins)
  services/     Downloads, documents, summaries…
  ui/           Chat, settings, screens
  i18n/         locales/es.json ← primary language
```

## License

MIT, see [LICENSE](LICENSE) and [ATTRIBUTION.md](ATTRIBUTION.md).
