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
- Removed: Hugging Face model browser (leaked interests over the network)
  and development screens. Telemetry is on-device only: timings and
  counts in the encrypted database, never sent anywhere
- Voice input uses Android's built-in SpeechRecognizer with the
  prefer-offline flag (not a bundled model: availability and offline
  behaviour depend on the device's recognition service)
- Spanish and Portuguese locales alongside English (`src/i18n/locales/`)

## Model and data licenses

The app does not ship any AI model inside the APK: models are downloaded
from their publishers when you choose them, and each keeps its own license.
Licenses below were verified at the source on 2026-10-14 (see
[`docs/release/MODEL_LICENSE_AUDIT.md`](docs/release/MODEL_LICENSE_AUDIT.md)).

| What | License | Notes |
|---|---|---|
| Qwen2.5 0.5B / 1.5B / 7B Instruct (Alibaba Qwen) | Apache-2.0 | GGUF by bartowski |
| Qwen3-0.6B (Alibaba Qwen) | Apache-2.0 | GGUF by unsloth |
| Gemma 4 E4B (Google) | Apache-2.0 | official QAT GGUF |
| Phi-3.5-mini-instruct (Microsoft) | MIT | GGUF by bartowski |
| bge-small-en-v1.5 (BAAI) | MIT | GGUF by CompendiumLabs |
| multilingual-e5-small (intfloat; Wang et al., arXiv:2402.05672) | MIT, Copyright (c) Microsoft Corporation | the GGUF in the `knowledge-packs-v2` release is NIDO's conversion; the MIT notice travels in `LICENSE-ATTRIBUTION.txt` next to it |
| LFM2.5-8B-A1B (Liquid AI) | LFM Open License v1.0 | not Apache/MIT: commercial use is licensed only to entities under USD 10M annual revenue (§5); redistributing it requires giving a copy of the license (§4). NIDO does not redistribute it: the app downloads it from Liquid AI's own repository |

**Wikipedia text (CC BY-SA 4.0).** The app *does* ship Wikipedia text: 300
article introductions bundled in the APK (`assets/corpus/corpus.json`), plus
the optional downloadable packs (`corpus-standard`, `corpus-full`,
`wiki-vital5`, `wiki-vital5-e5`). Text by Wikipedia contributors,
https://www.wikipedia.org, licensed under Creative Commons
Attribution-ShareAlike 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).
Each entry keeps its source article URL. The packs compiled by NIDO are
shared under the same CC BY-SA 4.0 terms (ShareAlike: they can't be MIT): if
you share or adapt them, credit **NIDO** (as compiler) and **Wikipedia**,
link the license, say what you changed and keep CC BY-SA 4.0. The notice is
also inside each pack (`meta` table), in `assets/packs/ATTRIBUTION.txt` and
in the `LICENSE-ATTRIBUTION.txt` / `ATTRIBUTION.txt` release assets. NIDO is
not affiliated with or endorsed by the Wikimedia Foundation.

**Third-party software.** The npm packages compiled into the app and their
license texts are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md),
and the same list is readable inside the app (About → Licenses).

## Adapted from the poidh #31 bounty entries (2026-10-31)

Ideas and algorithms adapted — reimplemented in NIDO's own TypeScript,
no code copied verbatim — from the winning and shortlisted entries of
the poidh bounty #31 ("Build the Best Offline AI Research App for
Android"), gathered with their licenses verified at the source:

| What | Source | License | Where it lives in NIDO |
|---|---|---|---|
| Citation post-check: an answer's figures must come from the evidence, allowing honest rounding and scale ("16.4 million" for 16,431,599) | Commonplace by 0xPD33 (`citations.rs`, `evidence.rs`) | Apache-2.0 | `src/rag/evidenceNumbers.ts`, used by `src/rag/grounding.ts` |
| Evidence first: the main source's card, with its best-answering sentence, above the answer; a colour per source shared by its citation markers | Commonplace by 0xPD33 (`AnswerViews.kt`, `evidence.rs`) | Apache-2.0 | `src/rag/evidenceCard.ts`, `src/ui/components/EvidenceFirstCard.tsx`, `src/ui/components/sourceColors.ts` |
| Emergency first + health lexical gate: an emergency typed mid-generation preempts it and is answered by the fixed routes at once; a health question with no health-pack passage falls to a fixed safe text, never to the model's memory | Field Atlas by 0x94t3z (`docs/emergency.md`) and the LabRat fork by r4topunk (pattern described in its README) | Apache-2.0 / MIT | `src/routing/emergencyGate.ts`, wired in `src/ui/ChatScreen.tsx` |
| Memory ladder + CrashGuard: the load plans the largest context that fits the device instead of refusing, and a load that never confirmed itself shrinks the next budget (safety factors 1 → 0.8 → 0.65 → 0.5) | Bivouac by Wolverr (`MemoryPlanner.kt` and its CrashGuard note) | MIT | `src/inference/memoryLadder.ts`, wired in `src/inference/LlamaEngine.ts` |
| Blind evaluation against the frontier as an installed practice: a sealed set, frontier reference answers with web search, a blind judge, ratios per question type with the limits declared | Commonplace by 0xPD33 (`EVAL.md`, `baseline.py`) and Field Atlas by 0x94t3z (`evaluation.md`); paired-comparison confidence practice from Bivouac by Wolverr (`EVAL.md`) | Apache-2.0 / MIT | `docs/BLIND_EVAL.md`, `src/eval/blindSet.ts`, `src/eval/blindReferences.ts`, `src/eval/blindRun.run.test.ts` |
| Pack edition card beside the signature: every build records the source edition and lock, rights, languages, counts, package and normalized record digests, known limitations and the versioned retrieval cases of the edition; incomplete cards are marked draft, never ready | Blobs by nonomnonom (the corpus catalog standard in `corpus/README.md`) | Apache-2.0 | `scripts/lib/pack-edition-lib.mjs`, wired in `scripts/build-knowledge-pack.mjs`; descriptors in `knowledge-packs/*/edition.json`; `docs/KNOWLEDGE_PACKS.md` |

## Using NIDO's code? Keep the notice

NIDO is MIT-licensed. You may use, copy, modify and distribute it. The one
condition of the MIT license is that the copyright notice and the
permission notice are included in all copies or substantial portions:

> Copyright (c) 2026 NIDO contributors

In practice: keep the `LICENSE` file (it also carries BOAR's notice,
"Copyright (c) 2026 aoair contributors") and the per-file headers.

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
"Built on [NIDO](https://github.com/Nido007-cmyk/Nido)" is not required by
the license, but it is appreciated by its builders.
