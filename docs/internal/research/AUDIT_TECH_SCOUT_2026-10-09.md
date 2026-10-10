# Technology scouting audit — 2026-10-09

**Scope:** read-only research. New open-source projects/technologies relevant
to NIDO, in four areas: (a) offline LLM inference, (b) Bluetooth P2P
reliability, (c) on-device RAG, (d) battery-efficient background processing.
**Builds on — does not repeat** — the existing docs in this directory:
`LLAMACPP_SD695_TUNING` (OfflineLLM, ik_llama.cpp, voxsumdroid, smolbenchmark,
llama.kt, androidlm, aide-os),
`P2P_SCHEDULING_SERVICES` (Briar, BlueLib, Eccles BlueChat, prayer-reminder,
saturn, expo-geopulse, batre, flipper-messenger, react-native-background-actions,
AndruavLinkService),
`SHINIGAMI_CORE_REVIEW`, `OFFLINE_UX_PATTERNS` (PocketPal AI, AnythingLLM mobile,
Briar manual), `BATCH3_INVESTIGATION`, `IMPLEMENTATION_VERDICT`.

**License rule applied:** every project's license was verified on its GitHub
repo page on 2026-10-09 (the "License:" field). Verdicts:
**ADAPTABLE** = permissive license verified (MIT/Apache-2.0/BSD), code may be
adapted with attribution; **IDEAS ONLY** = copyleft/custom/unverified license —
study the patterns, write our own implementation, cite as prior art.

---

## (a) Offline LLM inference optimizations

### A1. MNN / MNN-LLM — Alibaba's mobile inference engine
- **What:** production mobile inference framework (30+ Alibaba apps, OSDI'22
  paper) with an LLM runtime (MNN-LLM) and a full Android chat app running
  Qwen models on-device. Hand-tuned ARM assembly kernels; explicitly documents
  **ARMv8.2 sdot/FP16 paths** ("2.5x faster to use sdot for ARMv8.2").
- **URL:** https://github.com/alibaba/MNN
- **License: Apache-2.0 — VERIFIED** (GitHub repo page, 2026-10-09).
  Verdict: **ADAPTABLE** (with attribution).
- **Ideas for NIDO:**
  - Their ARMv8.2 sdot note independently corroborates the open DOTPROD
    question in `LLAMACPP_SD695_TUNING` §6 — same SoC class, same kernel
    family. If NIDO ever builds its own native lib, MNN's `armv8.2+dotprod+fp16`
    kernel selection is the reference for what "correct" looks like.
  - The MNN-LLM Android app is a **benchmark comparison target**: published
    tok/s numbers for Qwen-class models on mid-range Snapdragon would tell us
    whether llama.cpp or MNN is the right long-term runtime. Watch item, not a
    migration — replacing llama.rn is out of scope for any current lane.
  - Heterogeneous CPU/GPU backend scheduling is their core abstraction; if
    NIDO ever experiments with Adreno 619 Vulkan offload, MNN's scheduler is
    the studied prior art for "when the GPU wins vs. when it doesn't."
- **Applies to:** `src/inference/LlamaEngine.ts` (runtime choice),
  `docs/MODELS.md` (long-term runtime roadmap). No immediate code change.

### A2. bitnet.cpp — 1-bit LLM inference on CPU
- **What:** Microsoft's official inference framework for 1-bit (1.58-bit)
  ternary-quantized LLMs. Reports **1.37x–5.07x speedups on ARM CPUs** and
  **55–70% energy reduction** vs. full-precision baselines; a 100B model runs
  on a single CPU at reading speed.
- **URL:** https://github.com/microsoft/BitNet
- **License: MIT — VERIFIED** (badge + repo, 2026-10-09).
  Verdict: **ADAPTABLE** (future).
- **Ideas for NIDO:** not actionable today (no 1-bit Qwen-class instruct model
  in NIDO's catalog), but this is the technology that could put a **2–3B-class
  model inside the 4 GB RAM budget** later. The ternary-kernel techniques are
  also the extreme end of the quantization curve NIDO's `ramBudget.ts`
  estimator should be aware of. File as a model-roadmap watch item.
- **Applies to:** `docs/MODELS.md`, `src/inference/ramBudget.ts` (future
  estimator terms). No immediate code change.

### A3. StreamingLLM (attention sinks) — principled context shifting
- **What:** MIT/HAN-lab technique: keep the KV of the **first ~4 tokens**
  ("attention sinks") plus a sliding recent window, discard the middle.
  Stabilizes infinite-length streaming with no fine-tuning (up to 22.2x vs.
  sliding-window-with-recompute). Integrated by NVIDIA TensorRT-LLM, HF
  Transformers, Intel Extension for Transformers.
- **URL:** https://github.com/mit-han-lab/streaming-llm
- **License: MIT — VERIFIED** (GitHub repo page, 2026-10-09).
  Verdict: **ADAPTABLE** (ideas; the repo is PyTorch research code, the
  *policy* is what transfers).
- **Ideas for NIDO:** `LLAMACPP_SD695_TUNING` §3 recommends enabling
  `ctx_shift` ("keep system prompt + recent, drop the middle"). StreamingLLM
  is the *principled version* of that policy: **whatever the shift policy
  keeps, it must include the first tokens**, because the model dumps
  disproportionate attention on them — evicting them is what makes naive
  window shifting degrade. Concrete check: grep found **no `ctx_shift` /
  `n_keep` parameter set in `src/inference/LlamaEngine.ts`** — so either
  llama.rn 0.13.0-rc.6 doesn't expose it or NIDO hasn't wired it. When it is
  wired, set the keep-count to cover the system prompt AND at least the first
  4 tokens (they coincide here, but the invariant to test is "initial tokens
  are never evicted").
- **Applies to:** `src/inference/LlamaEngine.ts` (context-shift params),
  `src/agent/loop/agentLoop.ts` (`buildSystemPrompt` length interacts with
  the keep window). Effort: small once the param is confirmed exposed.

### A4. llama.cpp prompt-cache / slot save-restore — skip re-prefill on cold start
- **What:** llama.cpp can persist a slot's KV cache to disk (`--prompt-cache`
  in the CLI; `POST /slots/{id}?action=save|restore` on the server, backed by
  `--slot-save-path`). Restoring replays the cached prompt state instead of
  re-running prefill.
- **URL:** https://github.com/ggml-org/llama.cpp
  (tools/server/README.md documents the slot save/restore API)
- **License: MIT — VERIFIED** (upstream repo; NIDO already depends on it via
  llama.rn). Verdict: **ADAPTABLE** if exposed.
- **Ideas for NIDO:** NIDO's system prompt is long (agent instructions +
  tools); every cold start re-prefills it. Caching the system-prompt KV to a
  file keyed by **(model SHA-256, prompt hash, llama.cpp build)** would cut
  time-to-first-token on every app start to near zero for the fixed prefix.
  **Caveat (honest):** llama.rn 0.13.0-rc.6 almost certainly does **not**
  expose this — it would need an upstream feature request or a native-module
  bridge. Also note the pi-llama-cpp finding: on some builds restore is
  byte-perfect but the server still reprocesses — verify on-device before
  claiming the win. File as upstream watch + native-bridge candidate.
- **Applies to:** `src/inference/LlamaEngine.ts`, `src/models/ModelManager.ts`
  (load path), `src/inference/ramBudget.ts` (cache file size accounting).

### A5. PowerInfer — activation locality / heterogeneous execution
- **What:** CPU/GPU LLM serving engine exploiting *activation locality*:
  frequently-activated ("hot") neurons stay on the fast processor, cold ones
  on the slow one, with a lightweight predictor routing per token.
- **URL:** https://github.com/SJTU-IPADS/PowerInfer
- **License: MIT — VERIFIED** (repo badge, 2026-10-09).
  Verdict: **ADAPTABLE** (ideas).
- **Ideas for NIDO:** the direct transfer is conceptual, not code: on big.LITTLE
  (2x A78 + 6x A55) the decode phase is barrier-bound by the slowest thread —
  PowerInfer's hot/cold split is the formalization of "don't let slow units
  gate fast ones." It strengthens the case for the 2-big-cores decode
  recommendation already in the tuning doc, and suggests a future experiment:
  **predictor-routed heterogeneous execution** (hot layers on A78, cold on A55)
  if NIDO ever owns its native runtime. No near-term code change; cite as
  prior art in `docs/architecture/` if the threading lane reopens.

### A6. ExecuTorch — XNNPACK-based on-device runtime (strategic alternative)
- **What:** PyTorch's on-device inference runtime; delegates to XNNPACK CPU
  kernels, has an export path for Llama-class models, runs on Android via a
  small runtime.
- **URL:** https://github.com/pytorch/executorch
- **License: BSD — VERIFIED** (README "ExecuTorch is BSD licensed" + LICENSE
  file, 2026-10-09). Verdict: **ADAPTABLE** (strategic).
- **Ideas for NIDO:** a second candidate runtime alongside MNN if llama.cpp
  ever becomes a constraint (e.g. the `n_threads_batch` gap in
  `IMPLEMENTATION_VERDICT` §3 never closes upstream). XNNPACK's ARM
  microkernels are also a reference for what "correctly built for ARMv8.2"
  performs like. Watch item only.

**Not recommended / already covered:** GBNF grammar tool-call constraints are
already adopted (`LlamaEngine.ts` `responseFormat`/`grammar`, P2.5-2026-10-08).
Q4_0 A/B and Vulkan offload stay in the tuning doc's future list.

---

## (b) Bluetooth P2P reliability

### B1. android-BluetoothChat — the canonical RFCOMM state machine
- **What:** Google's official Bluetooth RFCOMM chat sample: two-way text chat
  over Bluetooth Classic between two Android devices. Its enduring value is
  the **connection state machine**: `AcceptThread` / `ConnectThread` /
  `ConnectedThread` with states `NONE / LISTEN / CONNECTING / CONNECTED`, all
  transitions serialized through one service object; a new connect attempt
  cancels any in-progress accept/connect first.
- **URL:** https://github.com/googlearchive/android-BluetoothChat
  (migrated to https://github.com/android/connectivity)
- **License: Apache-2.0 — VERIFIED** (GitHub repo page, 2026-10-09).
  Verdict: **ADAPTABLE** (with attribution).
- **Ideas for NIDO:** audit `modules/nido-p2p` (`NidoP2PManager.kt`,
  `NidoP2PService.kt`) and `src/p2p/nativeTransport.ts` against two of its
  invariants: (1) **exactly one thread owns connection state** — every
  transition (including the `onNativeDisconnected` → `forgetRoute()` path at
  `nativeTransport.ts:1192-1205`) must be serialized, no races between the
  retry timer and a fresh connect; (2) **connect cancels everything else
  first** — NIDO's `connect()` should cancel pending accept/retry work before
  opening the socket, mirroring the sample. These are cheap, structural,
  and directly harden the handshake-timeout failures.
- **Applies to:** `modules/nido-p2p/android/.../NidoP2PManager.kt`,
  `src/p2p/nativeTransport.ts`, `src/p2p/reconnectManager.ts`.

### B2. Nordic Android-BLE-Library — operation queue + per-op timeouts
- **What:** Nordic Semiconductor's production BLE library (2,400+ stars):
  `BleManager` serializes **all** operations through a request queue (no
  overlapping ops), enforces **per-operation timeouts** (connect, disconnect,
  wait-for-notification), auto-retries with `autoConnect` semantics, exposes
  connection/bond state as observable flows, and is designed mockable for
  tests.
- **URL:** https://github.com/NordicSemiconductor/Android-BLE-Library
- **License: BSD-3-Clause — VERIFIED** (GitHub repo page, 2026-10-09).
  Verdict: **ADAPTABLE** (patterns; GATT specifics don't transfer to RFCOMM).
- **Ideas for NIDO:** three transport-agnostic disciplines to adopt in
  `NidoP2PManager.kt`: (1) **a serialized operation queue** — discovery,
  connect, handshake, and retry never overlap (this is the structural fix
  behind BlueLib's "stop discovery before connecting"); (2) **a timeout on
  every operation, especially the handshake** — NIDO's 15s handshake timeout
  failure mode should be a *bounded, typed* timeout that feeds the
  `isRetryable` taxonomy, not an emergent stall; (3) **state as an observable
  flow** so `ReconnectManager` reacts to transitions (complements the
  BlueLib state-driven retry already approved in `IMPLEMENTATION_VERDICT` §4).
- **Applies to:** `modules/nido-p2p/android/.../NidoP2PManager.kt`,
  `src/p2p/reconnectManager.ts`, `src/p2p/nativeTransport.test.ts`
  (mockable-transport test seams).

### B3. Kable — structured-concurrency link ownership
- **What:** Kotlin Multiplatform BLE library with a coroutines/Flow API.
  Notable discipline: **connection lifetime is tied to a coroutine scope** —
  cancelling the scope always tears down the connection, so leaked links are
  structurally impossible.
- **URL:** https://github.com/juullabs/kable
- **License: Apache-2.0 — VERIFIED** (JuulLabs org page, 2026-10-09).
  Verdict: **ADAPTABLE** (ideas).
- **Ideas for NIDO:** in `NidoP2PManager.kt`, bind each socket's lifetime to a
  supervisor scope that is cancelled on disconnect/timeout — the
  structured-concurrency equivalent of BlueLib's "never leak sockets." If the
  native audit in `IMPLEMENTATION_VERDICT` §4 finds any close()-on-failure gap,
  this is the pattern that closes the whole class, not just the instance.
- **Applies to:** `modules/nido-p2p/android/.../NidoP2PManager.kt`.

### B4. Reticulum — link economics + store-and-forward messaging
- **What:** cryptography-based mesh networking stack (LoRa/packet-radio/WiFi/
  BLE): link establishment costs **3 packets / 297 bytes total**, link
  keepalive **0.44 bits/second**; announce-based discovery; LXMF messaging
  gives delay-tolerant store-and-forward with unforgeable delivery receipts.
- **URL:** https://github.com/markqvist/Reticulum
- **License: custom "Reticulum License" — NOT permissive (GitHub:
  NOASSERTION; README states the reference implementation is under the
  Reticulum License).** Verdict: **IDEAS ONLY — do not copy code.**
- **Ideas for NIDO:** (1) **measure our handshake against 297 bytes /
  3 packets** — `src/p2p/handshakeV3.ts` should have a documented budget; if
  we're 10x over, that's complexity to justify; (2) **keepalive economics** —
  the P2P foreground service should know its bits-per-second cost of an idle
  link and prefer bounded sessions (Briar's lesson, quantified); (3) LXMF's
  **store-and-forward with delivery receipts** is the right shape for NIDO's
  delegated-task outbox (`src/p2p/taskProtocol.ts`, `negotiationService.ts`):
  queue encrypted tasks, sync opportunistically, confirm with receipts —
  never assume the link is alive.
- **Applies to:** `src/p2p/handshakeV3.ts`, `src/p2p/taskProtocol.ts`,
  `src/p2p/negotiationService.ts`, `modules/nido-p2p/.../NidoP2PService.kt`.

### B5. Nearby Connections API — evaluated and deferred
- **What:** Google Play Services API for offline P2P (Bluetooth + BLE +
  Wi-Fi Direct) with `P2P_CLUSTER` strategy, managed encryption, and
  automatic bandwidth upgrade to Wi-Fi. Community evidence (reticulum-kt's
  `NearbyInterface`) confirms it works for mesh-style Android P2P.
- **URL:** https://developers.google.com/nearby/connections/overview
- **License:** platform API (no code to copy). Verdict: **evaluated
  alternative — NOT recommended for NIDO.**
- **Why deferred:** it requires **Google Play Services**, which conflicts
  with NIDO's self-reliance principle ("si BOAR falla, nosotros no" extended
  to infrastructure). NIDO's custom RFCOMM transport also keeps the
  QR-pairing trust ceremony and the zero-third-party-SDK posture intact.
  Revisit only if the custom transport proves unfixable on the physical gate.

---

## (c) On-device RAG

### C1. on-device-rag-android — the reference architecture to mirror
- **What:** a complete, dependency-light **on-device RAG SDK for Android**
  (Kotlin): four swappable interfaces — `TextChunker` / `Embedder` /
  `VectorStore` / `PromptBuilder` (+ `LlmGenerator`) — with
  `SentenceAwareChunker`, `MediaPipeTextEmbedder`, brute-force and
  **disk-persistent** vector stores, a prompt builder producing **numbered,
  citeable context blocks with character-budget truncation**, and JVM unit
  tests using **deterministic fakes** for the embedder/generator.
- **URL:** https://github.com/swapnilpkale/on-device-rag-android
- **License: MIT — VERIFIED** (GitHub repo page, 2026-10-09).
  Verdict: **ADAPTABLE** (with attribution).
- **Ideas for NIDO** (`src/rag/`):
  1. **Interface-per-piece seams.** NIDO already separates pure logic
     (`pure.ts`) from native-bound code (`db.ts`, `embed.ts`) for testability
     — this SDK shows the next step: formal `Embedder` and `VectorStore`
     interfaces so the embedding backend (llama.cpp GGUF today, MediaPipe
     TFLite tomorrow — see C2) and the store (SQLite today, vec index later)
     are swappable without touching `retrieve.ts`.
  2. **Numbered, citeable context blocks.** Directly serves Model Phase 3 and
     the OFFLINE_UX "sourced answers" pattern: retrieved chunks get stable
     `[1]`, `[2]` ids carried into the prompt so the model can cite and the
     UI can render source chips. Implement in `pure.ts`/`retrieve.ts`.
  3. **Token-budget-aware chunking** (their roadmap item): chunk by token
     budget, not characters — NIDO can implement this now in `pure.ts` since
     the tokenizer is local.
  4. **Deterministic fakes** for the embedder in tests — matches NIDO's
     existing `pure.test.ts` philosophy; extend to `retrieve.ts` pipeline
     tests.
- **Applies to:** `src/rag/retrieve.ts`, `src/rag/pure.ts`, `src/rag/embed.ts`,
  `src/rag/db.ts`, `src/rag/retrieve.types.ts`.

### C2. MediaPipe Text Embedder — lighter embedding backend
- **What:** MediaPipe Tasks (`com.google.mediapipe:tasks-text`, Maven) runs
  a **Universal Sentence Encoder TFLite model (~6–25 MB)** fully on-device
  with a built-in `cosineSimilarity()`; no second LLM context needed.
- **URL:** https://github.com/google-ai-edge/mediapipe
- **License: Apache-2.0 — VERIFIED** (GitHub repo page, 2026-10-09).
  Verdict: **ADAPTABLE** (with attribution).
- **Ideas for NIDO:** `src/rag/embed.ts` currently loads a **second GGUF in a
  second llama.cpp context** (<300 MB) just for embeddings — RAM that
  competes with the 1.5B model's budget (`ramBudget.ts`). A TFLite embedder
  behind the `Embedder` interface from C1 would free most of that. **Three
  honest caveats:** (1) MediaPipe Tasks' privacy notice states the APIs send
  **performance/usage metrics to Google** — NIDO's zero-network posture
  requires verifying an opt-out/disable before adoption; (2) the embedding
  space must match the knowledge packs — packs in `src/rag/packs.ts` are
  embedded with the app's GGUF model, so switching embedders means
  re-embedding packs (pack format already stores int8 vectors —
  `cosineSimilarityInt8` in `pure.ts` — the pipeline supports it);
  (3) needs a small Expo native module (Maven artifact + config plugin),
  same pattern as the existing five custom modules. **Verdict: strong
  candidate for a dedicated lane, with a quality A/B (retrieval eval in
  `src/rag/eval/`) as the gate.**
- **Applies to:** `src/rag/embed.ts` (new backend), `modules/` (new
  `text-embedder` module or extension of an existing one),
  `src/rag/eval/` (quality gate), `src/rag/packs.ts` (re-embedding),
  `src/inference/ramBudget.ts` (budget update).

### C3. sqlite-vec — vector index for SQLite (watch item)
- **What:** pure-C SQLite extension (`vec0` virtual tables) for vector
  similarity search — float/int8/**binary** vectors, brute-force KNN plus
  HNSW indexes, metadata columns for hybrid scalar+vector queries. Mozilla
  Builders sponsored. Also of note: sibling project `sqlite-lembed`
  generates embeddings from **GGUF models inside SQLite**.
- **URL:** https://github.com/asg017/sqlite-vec
- **License: Apache-2.0 — VERIFIED** (GitHub repo page, 2026-10-09).
  Verdict: **ADAPTABLE — but not directly usable.**
- **Why not directly:** `expo-sqlite` does not support loadable extensions,
  so NIDO cannot `.load` it. **Ideas only:** (1) their int8/binary
  quantization distance math can inform `pure.ts` if NIDO ever quantizes
  further than int8; (2) the `vec0` schema (vectors + metadata + partition
  keys in one table) is the shape NIDO's `db.ts` chunk store should converge
  toward; (3) if NIDO ever writes its own native SQLite module, this is the
  vector index to bundle. Honest status: watch item.
- **Applies to:** `src/rag/db.ts` (schema direction), `src/rag/pure.ts`
  (quantization math reference).

### C4. Reciprocal-rank fusion — small refinement to existing fusion
- **What:** no new project needed. NIDO already fuses lexical + vector
  results with **weighted-sum fusion** (`fuseRetrievalResults` in
  `src/rag/pure.ts`, called from `src/rag/retrieve.ts:137`).
- **Idea:** **reciprocal-rank fusion (RRF)** is the standard refinement —
  it fuses by rank rather than raw score, which makes it robust when the two
  scorers live on incomparable scales (BM25-ish lexical scores vs. cosine).
  Small, pure, unit-testable change in `pure.ts` with the existing
  `retrieve.lexical.test.ts` / `retrieve.relevance.test.ts` as the gate.
- **Applies to:** `src/rag/pure.ts`, `src/rag/retrieve.ts`.

---

## (d) Battery-efficient background processing

### D1. expo-background-fetch / expo-task-manager — the deferrable-work lane
- **What:** Expo's own background APIs (part of the Expo SDK, MIT):
  `TaskManager.defineTask` + `BackgroundFetch.registerTaskAsync`
  (`minimumInterval`, `stopOnTerminate: false`, `startOnBoot: true`).
- **URL:** https://docs.expo.dev/versions/latest/sdk/background-fetch/
- **License: MIT** (Expo SDK). Verdict: **ADAPTABLE.**
- **Ideas for NIDO:** NIDO (Expo 57.0.25) uses none of this today (grep:
  zero hits for `expo-background-fetch`/`expo-task-manager`). These APIs are
  **15-minute-minimum, Doze-deferred, best-effort** — useless for exact
  reminders (which stay on the exact-alarm path from `BATCH3`), but exactly
  right for **deferrable** work: delegated-task outbox flush, periodic P2P
  peer re-announce, embedding backfill for new documents, pack-index
  maintenance. Proposed home: a new `src/services/backgroundTasks.ts`
  registered from `src/routines/startup.ts`. **Note:** newer Expo SDKs
  renamed the package to `expo-background-task` — check the pinned SDK's
  docs before adopting.
- **Applies to:** `src/routines/startup.ts`, new
  `src/services/backgroundTasks.ts`, `src/p2p/taskProtocol.ts` (outbox
  flush trigger).

### D2. User-Initiated Data Transfer (UIDT) jobs — Android 14+ transfer path
- **What:** Android 14's official replacement for foreground services for
  long transfers: `JobInfo.Builder.setUserInitiated(true)` +
  `android.permission.RUN_USER_INITIATED_JOBS`. System-granted priority,
  constraint-aware (e.g. unmetered Wi-Fi), no foreground-service type needed,
  survives better than FGS under Android 14+ background restrictions.
  Real-world migration evidence: httrack-android moved its crawl into a UIDT
  `JobService`; the `background_downloader` plugin's PR #710 shows the exact
  `setUserInitiated(true)` + WorkManager-fallback pattern.
- **URL:** https://developer.android.com/develop/background-work
  (reference impl: https://github.com/781flyingdutchman/background_downloader/pull/710)
- **License:** platform API (no license needed); the reference plugin shows
  GitHub NOASSERTION → **its code is IDEAS ONLY**, the API pattern is free.
- **Ideas for NIDO:** P2P **backup/migration-bundle receive** and
  **knowledge-pack sharing** (`src/p2p/packSharing.ts`,
  `src/p2p/packShareService.ts`) are long, user-initiated transfers
  currently with no dedicated transfer vehicle — UIDT is the Android-blessed
  path: add a `JobService` + `RUN_USER_INITIATED_JOBS` to the nido-p2p
  module's `AndroidManifest.xml`, schedule on user accept, fall back to the
  existing foreground service below API 34. This also future-proofs against
  the `dataSync` FGS type's announced deprecation.
- **Applies to:** `modules/nido-p2p/android/src/main/AndroidManifest.xml`,
  new `JobService` in `modules/nido-p2p/.../nidop2p/`,
  `src/p2p/packShareService.ts`, `src/p2p/negotiationService.ts`.

### D3. REQUEST_IGNORE_BATTERY_OPTIMIZATIONS — the missing permission
- **What:** the standard Android API for asking the user to exempt the app
  from Doze/App-Standby (`Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`,
  guarded by `PowerManager.isIgnoringBatteryOptimizations()`).
- **License:** platform API. Verdict: **directly usable.**
- **Finding:** grep over `src/` and `modules/` found **zero hits** —
  NIDO never checks or requests it. The Play-policy restriction on this
  permission (which is why many apps avoid it) **does not apply to NIDO**:
  the APK is distributed directly, not via Google Play. Add it to the
  battery-settings checklist screen (the batre "honest OEM guidance" pattern
  from `P2P_SCHEDULING_SERVICES`) alongside the exact-alarm grant flow from
  `BATCH3`: one screen, two grants (exact alarms + battery exemption), each
  with a deep link into Settings and a plain-language reason. Low risk,
  direct P2P-service survival win on Samsung/Xiaomi-style OEMs.
- **Applies to:** `src/ui/` settings screen, `src/notify/notifications.ts`
  (alongside the exact-alarm check), `app.json` permissions,
  `modules/` (tiny native bridge, same pattern as the planned
  `canScheduleExactAlarms()` bridge).

### D4. dontkillmyapp.com — content source for the OEM checklist
- **What:** Urbandroid's long-running, device-measured database of exactly
  which OEMs (Xiaomi, OPPO, vivo, Samsung, …) kill background apps and which
  settings steps exempt an app on each.
- **URL:** https://dontkillmyapp.com
- **License:** content reference (not code). Verdict: **reference material.**
- **Idea:** use it as the **content authority** for the battery checklist
  screen from D3 — per-OEM steps (autostart, battery saver exceptions,
  "lock in recents") instead of hand-written guesses. Already aligned with
  the batre "honest OEM guidance" adoption.

### D5. Fossify Clock — exact-alarm handling patterns (ideas only)
- **What:** the community-maintained open-source clock/alarm app (Simple
  Clock lineage): exact alarms, Doze behavior, reboot rescheduling, per-OEM
  quirks — the same problem space as NIDO reminders.
- **URL:** https://github.com/FossifyOrg/Clock
- **License: GPL-3.0** (Fossify org standard). Verdict: **IDEAS ONLY.**
- **Idea:** cross-check NIDO's reminder pipeline (`src/notify/notifications.ts`
  + the planned `canScheduleExactAlarms()` bridge from `BATCH3`) against
  their alarm-scheduling edge cases (reboot, time-zone change, DST) — a
  checklist source, not code.

**Already handled — not repeated:** `connectedDevice` FGS type is already
declared (`modules/nido-p2p/.../AndroidManifest.xml:23`); event-driven
posture, one-shot exact alarms, and the Receiver→FGS pipeline are adopted
from the prior doc.

---

## Priority ranking (new items only)

1. **D3 battery-optimization exemption + D4 OEM checklist content** — half-day,
   zero-risk, directly improves P2P service survival; pairs with the BATCH3
   exact-alarm grant flow on the same screen.
2. **B1+B2 transport discipline** (serialized op queue, per-op handshake
   timeout, single-owner state machine) — structural hardening of the exact
   subsystem failing on the physical gate; Apache-2.0/BSD-3 clean.
3. **C1+C2 RAG architecture** (interface-per-piece seams now; MediaPipe
   embedder as a gated lane) — the embedder swap is the biggest RAM lever in
   the RAG subsystem, but it needs the retrieval-eval gate first.
4. **D2 UIDT jobs** for pack/backup transfers — Android-blessed, small native
   addition, future-proofs the transfer path.
5. **A3 attention-sink keep policy + A4 prompt-cache** — both blocked on
   confirming llama.rn param exposure; file as upstream watch items with the
   policy written down now so it's ready.

## License verification summary

| Project | URL | License (verified 2026-10-09) | Verdict |
|---|---|---|---|
| alibaba/MNN | github.com/alibaba/MNN | Apache-2.0 (repo page) | ADAPTABLE |
| microsoft/BitNet (bitnet.cpp) | github.com/microsoft/BitNet | MIT (badge) | ADAPTABLE |
| mit-han-lab/streaming-llm | github.com/mit-han-lab/streaming-llm | MIT (repo page) | ADAPTABLE |
| ggml-org/llama.cpp | github.com/ggml-org/llama.cpp | MIT (upstream) | ADAPTABLE |
| SJTU-IPADS/PowerInfer | github.com/SJTU-IPADS/PowerInfer | MIT (badge) | ADAPTABLE |
| pytorch/executorch | github.com/pytorch/executorch | BSD (README+LICENSE) | ADAPTABLE |
| googlearchive/android-BluetoothChat | github.com/googlearchive/android-BluetoothChat | Apache-2.0 (repo page) | ADAPTABLE |
| nordicsemi/Android-BLE-Library | github.com/NordicSemiconductor/Android-BLE-Library | BSD-3-Clause (repo page) | ADAPTABLE |
| juullabs/kable | github.com/juullabs/kable | Apache-2.0 (org page) | ADAPTABLE |
| swapnilpkale/on-device-rag-android | github.com/swapnilpkale/on-device-rag-android | MIT (repo page) | ADAPTABLE |
| google-ai-edge/mediapipe | github.com/google-ai-edge/mediapipe | Apache-2.0 (repo page) | ADAPTABLE |
| asg017/sqlite-vec | github.com/asg017/sqlite-vec | Apache-2.0 (repo page) | ADAPTABLE |
| Expo SDK (background-fetch/task-manager) | docs.expo.dev | MIT | ADAPTABLE |
| markqvist/Reticulum | github.com/markqvist/Reticulum | custom Reticulum License (repo: NOASSERTION) | IDEAS ONLY |
| FossifyOrg/Clock | github.com/FossifyOrg/Clock | GPL-3.0 | IDEAS ONLY |
| 781flyingdutchman/background_downloader | github.com/781flyingdutchman/background_downloader | NOASSERTION (LICENSE file present — verify before adapting) | IDEAS ONLY |

*Research method note: licenses read from each repo's GitHub "License" field
or LICENSE/README badge on 2026-10-09. "ADAPTABLE" still requires keeping the
project's attribution/notice requirements (e.g. Apache-2.0 §4) when code or
substantial patterns are reused — NIDO's existing ATTRIBUTION.md is the place.*
