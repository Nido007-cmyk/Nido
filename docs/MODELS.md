> **Language:** English · [Español](es/MODELS.md)

# Models, indexes, and datasets

This file documents every offline asset the app ships with or depends on, per the
bounty's "clearly document the models, datasets, indexes, and other resources used"
requirement.

## Phi-3.5-mini — optional (the default until 2026-09-24)

**[Phi-3.5-mini-instruct](https://huggingface.co/microsoft/Phi-3.5-mini-instruct)**
(Microsoft, **MIT license**), quantized GGUF from
**[bartowski/Phi-3.5-mini-instruct-GGUF](https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF)**,
file `Phi-3.5-mini-instruct-Q4_K_M.gguf` (~2.23GB, sha256 below).

- 3.8B params, dense, Q4_K_M quantization
- Chosen over Qwen2.5-3B-Instruct because Qwen's 3B GGUF ships under the restrictive
  `qwen-research` license (non-commercial/research-only), which is a poor fit for a
  public open-source bounty submission; Phi-3.5-mini's MIT license has no such
  restriction.
- Strong reasoning-per-parameter for its size (outperforms most 1–3B dense models on
  MMLU/GSM8K-style benchmarks per its model card), directly targeting the bounty's
  ">1B dense model" reasoning bar.
- Runs via `llama.cpp`/`llama.rn` on Android CPU, mmap-streamable so weights aren't
  fully pinned in RAM.
- **Upgrade path (not yet implemented)**: a proper MoE model (e.g. an Apache/MIT
  licensed variant in the Qwen1.5-MoE / OLMoE family, ~2–3B active params) for more
  world knowledge at similar active-param RAM/speed cost, once benchmarked on-device
  against this baseline.

## Embedding model — chosen

**[bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5)** (BAAI, **MIT
license**), quantized GGUF from
**[CompendiumLabs/bge-small-en-v1.5-gguf](https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf)**,
file `bge-small-en-v1.5-q8_0.gguf` (~35MB, sha256 below).

- 33M params, well under the 300MB sub-budget, fast enough to stay resident alongside
  the primary LLM without meaningfully affecting the 12GB RAM budget.

## Local knowledge base / retrieval index

- **Lexical**: SQLite FTS5 virtual table (`chunks_fts`), built from the same source
  corpus as the vector index. See `src/rag/db.ts`.
- **Semantic**: brute-force cosine search over stored float32 embeddings
  (`chunk_embeddings` table). Fine at the corpus scale a phone can hold within the
  storage budget; revisit with a proper ANN index (e.g. quantized HNSW) only if
  corpus size makes brute-force too slow on-device.
- **Corpus source**: `assets/corpus/corpus.json` — 300 docs: ~58 curated article
  summaries covering AI/systems topics relevant to the bounty's own eval questions
  (MoE, quantization, RAG, BM25, mmap, transformers) plus general research topics
  across science, history, geography, biology, and economics, topped up with
  random **Wikipedia** (CC BY-SA 4.0) articles to reach 300. Built by
  `scripts/build-corpus.mjs` + `scripts/build-corpus-tier.mjs` (dev-machine-only,
  online, run once to curate/update the corpus — not run by the shipped app).
  ~188KB of text; embeddings are computed on-device at first launch via
  `src/rag/seedCorpus.ts`, not precomputed, so they always match whatever
  embedding model ships.
- **Attribution**: per Wikipedia's CC BY-SA 4.0 license, each stored chunk keeps a
  `source` field linking back to its origin article
  (`https://en.wikipedia.org/wiki/<Title>`), surfaced to the user as a citation.
- **Known limitation**: still just Wikipedia lead-paragraph summaries, not full
  article text or non-Wikipedia sources — sufficient to demonstrate the RAG
  pipeline and answer the eval questions in `docs/EVAL_QUERIES.md`, but growing
  it further (fuller article text, other sources) would meaningfully improve
  real-world usefulness.

## Language scope: English-only for this version

bge-small-en-v1.5 is an English-only embedding model, and the bootstrap corpus is
English-only. This was a deliberate choice, not an oversight: swapping in a
per-locale embedding model would also require a per-locale knowledge base and
separate retrieval-quality testing per language, and the primary LLM
(Phi-3.5-mini-instruct) is itself primarily English-tuned — a multilingual
embedding model wouldn't meaningfully help without a multilingual LLM and corpus
to match. Worth revisiting (e.g. a multilingual embedding model matched to the
device's locale, paired with a multilingual LLM candidate and corpus) as future
work, not in this version.

## Default generation model: Qwen2.5-1.5B, or Qwen2.5-0.5B on low-RAM devices

The default model is chosen by detected device RAM at first-run setup
(`src/models/defaultModel.ts`, owner decision 2026-10-05):

- **Qwen2.5-1.5B-Instruct**
  ([Qwen/Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct))
  (Alibaba, **Apache-2.0 license**), quantized GGUF from
  **[bartowski/Qwen2.5-1.5B-Instruct-GGUF](https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF)**,
  file `Qwen2.5-1.5B-Instruct-Q4_K_M.gguf` (~0.92GB, sha256 in `src/models/manifest.ts`).
  The default on devices where the RAM pre-flight says it fits (roughly
  6 GB+ phones).
- **Qwen2.5-0.5B-Instruct**
  ([Qwen/Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct))
  (Alibaba, **Apache-2.0 license**), quantized GGUF from
  **[bartowski/Qwen2.5-0.5B-Instruct-GGUF](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF)**,
  file `Qwen2.5-0.5B-Instruct-Q4_K_M.gguf` (~0.38GB, sha256 in
  `src/models/manifest.ts`). The default on low-RAM devices (e.g. 4 GB
  phones/tablets): ~0.52 GiB working set at its default n_ctx 2048, same
  Qwen2.5 ChatML template and stop sequences as the 1.5B, fastest
  tokens/sec of the catalog — but noticeably weaker at complex reasoning
  and instruction following (see the RAM/model audit of 2026-10-05).

The threshold is not a magic number: it falls out of the pre-flight formula
(`src/inference/ramBudget.ts`) — the 1.5B needs ~1.28 GiB working set, plus
a 0.5 GiB app-baseline estimate and the 2 GiB system-headroom policy, so
devices reporting >= ~3.8 GiB total RAM get the 1.5B and anything below gets
the 0.5B. The user can always switch in Settings > Tone & Model.

Downloaded alongside the embedding model during mandatory first-run setup —
the 1.5B keeps `required: true`; the 0.5B is `required: false` because it is
an *alternative* default, not an additional download (the setup installs
exactly one default LLM: `ModelManager.requiredModelsPresent()` and the
setup wizard both resolve it via `defaultLlmForDevice()`).

## Optional LLM catalog (choose your model)

Beyond the required default, Settings offers these models, each tested on a real
phone (Xiaomi 2311DRK48G, Dimensity 8300, 11.6 GB RAM; see
[DEVICE_EVALUATION.md](DEVICE_EVALUATION.md)):

| Candidate | Params | Quant | Size | License | Measured on the phone |
|---|---|---|---|---|---|
| Qwen2.5-0.5B-Instruct | 0.5B dense | Q4_K_M | 0.38GB | Apache-2.0 | not benchmarked yet; the low-RAM default (n_ctx 2048) |
| Phi-3.5-mini-instruct | 3.8B dense | Q4_K_M | 2.39GB | MIT | ~4 tok/s; most complete comparisons and syntheses |
| Qwen2.5-7B-Instruct | 7B dense | Q4_K_M | 4.68GB | Apache-2.0 | ~2.7 tok/s; accurate, often too slow for the 120s step limit |
| LFM2.5-8B-A1B | 8B MoE, ~1.5B active | Q4_K_M | 5.16GB | LFM Open License v1.0 | ~15 tok/s; best reasoning, but it thinks first and needs a larger answer budget |
| Gemma 4 E4B | ~4B effective | QAT Q4_0 | 5.15GB | Apache-2.0 | loads and answers; not benchmarked yet |

Sizes and SHA-256 checksums are in `src/models/manifest.ts`. Switching models re-loads the
inference engine (`LlamaEngine`/`EmbeddingEngine` now release their previous
context before loading a new one, avoiding a native memory leak on switch).

## Setup tiers and corpus packs

First run offers three tiers (`src/models/manifest.ts` `TIERS`, picked in
`ModelSetupScreen`'s wizard) — all download the same required models, only
the knowledge base differs, and higher tiers are strict supersets:

| Tier | Knowledge base | Extra download |
|---|---|---|
| Minimum | 300 bundled topics (in the JS bundle, no download) | none |
| Standard | + 1,000 more Wikipedia-derived topics | ~600KB |
| Full | + 4,000 more on top of Standard (5,300 total) | ~3MB total |

Corpus packs (`corpus-standard`, `corpus-full`) are built by
`scripts/build-corpus-tier.mjs`, which uses MediaWiki's batched
`generator=random` API (20 articles/request) rather than one-by-one summary
calls — far fewer HTTP round-trips for a given count. They're committed to
this repo and downloaded via a `raw.githubusercontent.com` URL (no separate
hosting needed) through the same `ModelManager.downloadCatalogModel` path as
everything else, verified by sha256.

**Honest scope note**: "Full" is not literally the entire English Wikipedia —
that's a different scale of engineering (dump processing, compression, a real
ANN index) not attempted here. The architecture is designed so more packs can
be added later within the 50GB storage budget without changing how any of
this works — `MODEL_CATALOG`/`TIERS` are meant to grow.

## "Deep Research Mode" — honest scope note

Settings has a "🔬 Deep Research Mode" toggle (`src/services/orchestrator.ts`)
that decomposes a question into 2-3 sub-questions, retrieves + answers each
separately, then synthesizes one final answer. This is **not** multiple AI
models/agents running concurrently — running 3 models at once, or a
dedicated planner/critic model, genuinely doesn't fit in the 12GB RAM budget
alongside everything else. It's several sequential `llamaEngine.generate()`
calls on the *same* single loaded model, playing different roles in turn.
Noticeably slower than a normal reply (multiple LLM passes instead of one) —
the UI badge says "Deep Research", not "multi-agent", and the in-app
description spells this out, to avoid overclaiming what's actually
happening.

`modules/ram-monitor` also exposes `getDeviceTotalRamBytes()` (device
physical RAM, not just this app's usage) so the model catalog can show a
rough 🟢/🟡/🔴 compatibility hint before downloading a large model —
estimated as weights + computed KV cache + compute buffers
(src/inference/ramBudget.ts, the same formula the load-time pre-flight
uses), which is an approximation, not a guarantee. A live Hugging Face model browser (search,
arbitrary GGUF repos) was considered and deliberately not built — real
scope beyond the curated, sha256-verified static catalog already in place,
for uncertain payoff.

## Multi-session chat history & conversation memory

Chat sessions/messages persist locally in the same SQLite database as the
knowledge base (`src/rag/db.ts`'s `chat_sessions`/`chat_messages` tables) —
`src/services/chatHistory.ts` is the CRUD layer, surfaced as a "Recent
Chats" list in the drawer with auto-generated titles and per-session
delete.

For long conversations, `src/services/summarize.ts` condenses older turns
into a running summary (prepended to the prompt alongside the last 3
exchanges kept verbatim — see `assemblePrompt`'s `history` param in
`src/rag/pure.ts`), instead of sending the whole transcript every time.

**Concurrency constraint worth being explicit about**: title generation and
summarization are themselves LLM calls through the *same* `llamaEngine`
context as the main chat — `llama.cpp` contexts only run one completion at
a time. These run as fire-and-forget background tasks after a response
finishes (not literally blocking the UI thread), but if the user sends a
new message while one is still in flight, `ChatScreen` calls
`llamaEngine.stop()` and awaits it before starting the next generation
(`cancelBackgroundTask`) — otherwise the new message would silently queue
behind the background task on the same context.

## UI dependency choices

The chat UI's animations (mic pulse/aura rings, processing indicator, drawer
slide) all use React Native's built-in `Animated` API rather than
`react-native-reanimated`, and the side drawer is hand-rolled rather than
`@react-navigation/drawer`. Both would work, but both are heavier native
dependency chains (worklets + Babel plugin; gesture-handler + screens + a
full navigator) for effects `Animated` and a simple slide-panel component
already deliver here — given this app is a single-screen state machine, not
a multi-route navigator, pulling in a routing library felt like solving a
problem this app doesn't have. `expo-linear-gradient` is the one new native
dependency added for the gradient background/glassmorphism look.

## Voice input (offline speech-to-text)

`modules/voice-input` wraps Android's built-in `SpeechRecognizer` with
`EXTRA_PREFER_OFFLINE`, exposed via `src/voice/VoiceInput.ts` and the mic
button in `ChatScreen`. No cloud STT API is called.

**Honest scope note**: this depends on a system-provided recognition service
(Google's, or an OEM's) being installed on the device. Most stock
Android/OEM builds ship one; **GrapheneOS and other de-Googled builds
typically do not**, so voice input won't work there out of the box —
`isAvailable()` detects this and the UI shows a clear "unavailable" message
rather than pretending to listen. A true cross-device guarantee would mean
bundling a `whisper.cpp` model with a custom binding, which is a project on
the scale of the `llama.rn` integration itself — documented as future work,
not attempted in this version. Typing always works everywhere regardless.

## Delivery: one-time first-run download

The two required assets (Qwen2.5-1.5B and the embedding model) are declared with
`required: true` in `src/models/manifest.ts` (about 1 GB total). Phi-3.5-mini,
Qwen2.5-7B, LFM2.5-8B-A1B and Gemma 4 E4B are optional suggestions in the same
catalog. The
app itself ships small (no multi-GB assets baked in, for fast builds/installs);
on first launch it shows a mandatory setup screen that downloads them — see
`ARCHITECTURE.md` "First-run model setup". Once done, the app works completely
offline from then on, matching "work completely offline once installed."

Each download has a 60-second *inactivity* timeout (`ModelManager.
downloadCatalogModel`, not a flat deadline — a slow-but-progressing download
isn't penalized, only zero progress for 60s is treated as stalled) and, in the
setup wizard, a visible error + Retry button per failed asset. Before this, a
stalled download (e.g. a host rate-limiting the connection) just sat at 0%
forever with no error and no way to retry — the mandatory first-run screen had
no escape hatch at all.

The same screen, reached later via the chat UI's "Models" button, additionally
lets a user fetch **optional, non-default** models over the network — only when
they explicitly tap "Download" on a specific entry. `ModelManager.downloadCatalogModel`
is the only code path in the shipped app that performs a network request;
`android.permission.INTERNET` is present in the build for that reason, but is
otherwise unused (in particular, never during chat/inference/retrieval).

An alternate build path (`modules/bundled-assets` + `plugins/withBundledModels.js`,
verified working but not used by default) can bake the default models directly
into the APK instead, for a build that needs zero network ever — see
`ARCHITECTURE.md`.

### Pre-seeding models you already have locally

Two different situations, two different mechanisms:

- **Building your own APK** and you already have the GGUF files on your dev
  machine: drop them into `assets/models/` with the exact filenames
  `scripts/setup-models.sh` expects (`primary-llm.gguf`,
  `qwen2.5-1.5b-instruct-q4km.gguf`, `embedding.gguf`) before running the
  script — it sha256-verifies whatever's already there and skips
  re-downloading anything that already matches, before `expo prebuild`
  bundles them into the APK (see previous paragraph). Does nothing for an
  app already installed on a device.
- **An already-installed debuggable build**, skipping the in-app download
  entirely: push the files straight into the app's private storage with
  `adb`. The app's storage isn't directly writable by `adb push`, so stage
  on `/sdcard` first and use `run-as` (only works on a **debuggable**
  build — a signed release build will refuse this):

  ```bash
  adb push primary-llm.gguf /sdcard/Download/
  adb shell run-as team.nido.app mkdir -p files/models
  adb shell run-as team.nido.app cp /sdcard/Download/primary-llm.gguf files/models/primary-llm.gguf
  ```

  Repeat per asset. Two things must match exactly or `ModelManager.statusOf`
  treats the file as corrupt/absent and deletes it: the **filename**
  (`models/<name>.gguf`, per `src/models/manifest.ts`'s `filename` field)
  and the **byte size** (`sizeBytes` in the same file — this is the only
  check the app makes at runtime; sha256 is only checked on demand, nothing
  calls it automatically). Worth confirming with `ls -la` against the
  manifest before pushing, since a re-uploaded or differently-quantized
  file from Hugging Face can silently differ in size.

## Verification

Every catalog entry is declared in `src/models/manifest.ts` with a `sha256` and
`sizeBytes`. `ModelManager` verifies bundled installs by exact byte size (cheap,
safe for multi-GB files) and can verify full sha256 on demand (used for the
small embedding model; a multi-GB full-file JS-side sha256 is a known,
documented limitation — see `ARCHITECTURE.md` Status). `scripts/setup-models.sh`
does the authoritative sha256 verification, once, on the dev machine, before
`expo prebuild` bundles the files into the build.
