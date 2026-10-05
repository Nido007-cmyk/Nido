> **Language:** English · [Español](es/EVAL_QUERIES.md)

# Evaluation

The bounty's bar is answer quality on real research questions, including ones
a 1B dense model typically fails (multi-hop reasoning, synthesis, comparison).
This document defines a fixed evaluation set and a reproducible way to run it
on an Android device against different models and routing configurations, so
their answers and costs can be compared side by side.

There is no automated judge. The harness produces structured results
(JSONL/CSV) that you grade by hand, using the grading notes below.

## The evaluation set (v1)

Source of truth: [`src/eval/evalSet.ts`](../src/eval/evalSet.ts). Bump
`EVAL_SET_VERSION` there whenever a query changes; every result row records
the version it was produced with.

"Expected KB article" means the bundled corpus has an article on the topic,
so a correct retrieval should surface it (recorded as `expectedKbHit`). The
`no-kb-content` queries have no relevant article on purpose.

| id | category | query | expected KB article(s) |
|---|---|---|---|
| greeting-1 | greeting | hey, what's up? | — |
| factual-1 | factual | What is the capital of Australia? | — |
| factual-2 | factual | Who proposed the theory of evolution by natural selection? | Evolution |
| explanation-1 | explanation | How do vaccines work? | Vaccine |
| explanation-2 | explanation | Explain photosynthesis in simple terms. | Photosynthesis |
| comparison-1 | comparison | Compare the French Revolution and the Industrial Revolution. | French Revolution, Industrial Revolution |
| comparison-2 | comparison | Contrast how supply and demand explains price changes with how behavioral economics complicates that picture — where does the simple model break down? | Supply and demand, Behavioral economics |
| synthesis-1 | synthesis | What do the Agricultural Revolution and the Industrial Revolution have in common as turning points in human history, and how did they differ in how quickly they changed daily life? | Agricultural revolution, Industrial Revolution |
| synthesis-2 | synthesis | How does the immune system's response to a pathogen relate to how a vaccine works — walk through the mechanism. | Immune system, Vaccine |
| synthesis-3 | synthesis | Why is the Amazon rainforest considered important for global climate, and what does biodiversity loss there actually threaten beyond the obvious loss of species? | Amazon rainforest |
| reasoning-1 | reasoning | A train leaves at 3:40 pm and the trip takes 2 hours and 35 minutes. What time does it arrive? | — |
| reasoning-2 | reasoning | A device has a 12GB RAM budget. The OS and app overhead take 2GB, the embedding model needs 200MB, and the LLM's KV cache needs 1.5GB. How much is left for the LLM's weights, and would a 9GB model fit if loaded fully into RAM? | — |
| reasoning-3 | reasoning | If a Mixture-of-Experts model has 100B total parameters but only activates 8B per token, and each parameter needs 1 byte at Q8, what's the minimum disk footprint, and why doesn't RAM usage scale with the 100B figure? | — |
| grounded-1 | retrieval-grounded | Why did the Western Roman Empire fall? | Fall of the Western Roman Empire |
| grounded-2 | retrieval-grounded | What is a black hole and how does one form? | Black hole |
| no-kb-1 | no-kb-content | Who was Napoleon Bonaparte? | — (the corpus only has "Randy Napoleon", which must not be cited) |
| no-kb-2 | no-kb-content | How do antibiotics work, and why does antibiotic resistance develop? | — |

Each query's `gradingNotes` in `evalSet.ts` says what a good answer contains.

## Configurations

The harness runs the whole set once per selected configuration:

- **One per installed LLM** (`model:<id>`), including models added through the
  Hugging Face search. Every query goes to that model. Retrieval follows the same
  rule as the fixed-model chat path: skipped for greetings, calculation,
  translation and code, otherwise run. Generation goes through the routing
  executor in the model's own instruction format: the chat template embedded
  in its GGUF (`tokenizer.chat_template`, applied by llama.cpp), so Qwen gets
  ChatML, Phi gets `<|system|>…<|end|>`, and any other model gets whatever
  its file defines. Only a file with no embedded template falls back to the
  app's plain `Question:/Answer:` prompt. Every row records which one was used
  (`promptFormat`). Generation settings are otherwise identical in both cases
  (512 tokens, temperature 0.7); a template ends on the model's own
  end-of-turn token, the plain prompt on the app's stop strings. All three
  curated GGUFs (Phi-3.5-mini, Qwen2.5-1.5B, Qwen2.5-7B) ship a template.
- **Adaptive routing** (`adaptive`). Every query goes through `runAdaptiveChat`,
  exactly as in chat with Adaptive Routing on, using the routing preset
  currently stored in settings (default `balanced`; there's no picker in the UI
  yet). This runs whether or not the Adaptive Routing toggle is on.
  `routingPreset` on each row records which preset was used. It keeps
  live-chat prompt formatting, which today means Qwen2.5-1.5B uses its
  template and every other model (Phi included) the plain prompt, so it
  measures the product as users get it; `promptFormat` shows the difference.

Held constant for every run and recorded on every row: the system prompt (the
default `succinct` personality), `maxTokens` = 512, no conversation history
(every query is answered on its own). Sampling temperature is the app's normal
0.7, so answers vary a little between runs; compare several runs before drawing
conclusions from small differences.

Configs run one after another, each over the full set, so each model loads once
per config. The first query of each config therefore carries the model load
cost (`modelResidency: "cold"` or `"switched"`, `modelLoadMs` > 0) and the rest
are `"resident"`. When the run ends, the model that was loaded before it is
reloaded, so chat carries on as before.

## Running it from the computer (recommended)

A walkthrough with example output, how it works and tips is in
[DEVICE_EVALUATION.md](DEVICE_EVALUATION.md).

`npm run eval:device` runs the evaluation on a USB-connected phone and brings
the results back, with no tapping. It's transport only: it writes a request
into the app's private storage over adb, the app runs it through the same
evaluation service as the Evaluation screen (which opens on the phone and shows
progress), and the script polls for completion and pulls the result.

### Prerequisites

- `adb` on your `PATH` (Android SDK platform-tools), and Node/npm with
  `npm install` done in the repo.
- The phone connected over USB with **USB debugging** enabled and this computer
  **authorized** (accept the "Allow USB debugging" prompt). `adb devices` must
  list it as `device`, not `unauthorized` or `offline`.
- A **debuggable development build** of the app (package `team.nido.app`),
  e.g. from `npx expo run:android`. Release/EAS builds don't work: reading the
  results needs `run-as`, and the request pickup only exists in development
  builds. With `--install` (or if the app is missing) the script builds and
  installs one with `npx expo run:android --no-bundler`.
- **Metro running** in another terminal: `make start` (or
  `npx expo start --localhost`). The script sets up `adb reverse tcp:8081` and
  reloads the app from Metro, so the phone always runs the current code.
- First-run setup finished on the phone, and every model you want to compare
  already downloaded. The script never downloads models.
- Phone plugged in with the screen on (e.g. Developer options → Stay awake).

### Commands

```bash
npm run eval:device                                   # every installed model + adaptive, all 17 queries
npm run eval:device -- --models qwen2.5-1.5b,phi-3.5  # only these models (id or a fragment of it)
npm run eval:device -- --adaptive                     # only adaptive routing
npm run eval:device -- --models instella --adaptive   # a model and adaptive
npm run eval:device -- --queries greeting-1,reasoning # a subset, by query id or category
npm run eval:device -- --dry-run                      # print every adb command, run nothing
npm run eval:device -- --help                         # all options (--serial, --timeout-min, --no-reload, …)
```

A model selector must match exactly one installed model; a typo or an
ambiguous fragment (`qwen2.5` with both Qwen models installed) stops the run
and lists what is installed.

### What it does

1. Checks `adb devices` for exactly one authorized device (or `--serial`).
2. Checks that `team.nido.app` is installed and debuggable, installing it if
   missing.
3. Checks Metro and runs `adb reverse tcp:8081 tcp:8081`.
4. Writes `files/eval/requests/pending.json` through `run-as` and reloads the
   app through the dev-client link.
5. Once models are loaded, the app claims the request and opens the Evaluation
   screen. It writes progress to `files/eval/requests/<requestId>.status.json`,
   which the script polls every 5 seconds.
6. Pulls `files/eval/<runId>.jsonl`, saves it and prints the report.

### Output

```
eval-results/<YYYY-MM-DD>/
  <runId>.jsonl        raw results, one row per answer (authoritative)
  <runId>.answers.md   every config's answer grouped by query, for grading
  <runId>.status.json  the final request status from the phone
```

The terminal report shows, per configuration: queries succeeded/failed,
TTFT, model load time (over the queries that loaded a model), generation
latency, tokens/sec (average and p50), total time per query, peak RSS,
residency counts, model switches and retrieval use (with how many expected
corpus articles were found). Re-print it any time with
`npm run eval:summary -- --report eval-results/<date>/<runId>.jsonl`.

## Running it on the device by hand

1. Build and install the app as described in [AGENTS.md](../AGENTS.md), finish
   first-run setup, and download any extra models you want to compare
   (Settings → Models).
2. Keep the phone plugged in with the screen on (for example, Developer options
   → Stay awake). Backgrounding or locking the phone can interrupt a run.
3. Open the drawer → **Execution Telemetry** → **🧪 Evaluate**.
4. Tick the configurations to compare (by default, every installed model plus
   adaptive routing) and tap **▶ Run**. Progress shows the current config and
   query. **■ Stop** ends the run after the current answer and keeps partial
   results.
5. When it finishes, the results are saved on the device as
   `files/eval/<runId>.jsonl`. **⬇ JSONL** and **⬇ CSV** open the share
   sheet to send them to your computer.

Expect roughly 17 answers × (seconds to a minute each) per config, depending
on the model and phone.

### Getting results onto your computer

Any of these works:

- **Share sheet**: the export buttons (file manager, email, Nearby Share, …).
- **Metro terminal**: with the dev client connected, every answer is printed as
  one `[EVAL] {...}` line. Save the terminal output to a file; the summary
  script reads those lines directly.
- **adb** (debuggable/dev-client builds):

  ```bash
  adb exec-out run-as team.nido.app ls files/eval
  adb exec-out run-as team.nido.app cat files/eval/<runId>.jsonl > <runId>.jsonl
  ```

Every row is also written to the regular execution telemetry, so eval runs show
up in the Execution Telemetry screen and its exports like any other message.

## Comparing results

```bash
node scripts/eval-summary.mjs results/*.jsonl            # one line per run + config
node scripts/eval-summary.mjs --report results/*.jsonl   # detailed per-config report (as printed by eval:device)
node scripts/eval-summary.mjs --answers results/*.jsonl  # answers side by side, per query (markdown)
```

The summary lists, per config, successes, failures, how many expected KB
articles were retrieved, median TTFT, median tokens/sec, median total time,
max model load time and peak RSS. `--answers` groups every config's answer
under each query, for grading against the notes above.

### Result fields

Each JSONL row (and CSV line) contains:

- **Run:** `runId`, `evalSetVersion`, `configId`, `configLabel`,
  `routingPreset` (adaptive only), `personalityId`, `maxTokens`, `createdAt`.
- **Query:** `queryId`, `category`, `query`, `expectedKbTitles`.
- **Answer:** `answer`, `promptFormat` (`chat-template`/`plain`), `outcome` (`success`/`failure`/`cancelled`),
  `errorMessage`, `timedOut`.
- **Routing:** `modelId` (the model that generated the answer), `taskType`,
  `adaptiveRoutingUsed`, `reasonCodes`.
- **Retrieval:** `retrievalUsed`, `retrievedTitles`, `expectedKbHit`.
- **Model:** `modelSwitches` (within the plan), `crossMessageModelSwitch`,
  `modelResidency`, `modelLoadMs`.
- **Timing and resources:** `ttftMs` (from the generate call to the first
  token, load excluded), `generationLatencyMs` (first token to finish),
  `totalLatencyMs` (whole query), `tokensGenerated`, `tokPerSec`,
  `peakRssBytes`.

The metric fields mean exactly what they mean in the execution telemetry (see
`src/services/executionTelemetry.pure.ts` and `src/routing/executor.ts`).
