> **Language:** English · [Español](es/DEVICE_EVALUATION.md)
# Benchmark models on a real phone

BOAR can benchmark any installed model on a real Android phone, driven from
your computer with one command. The phone runs the questions and shows live
progress on its Evaluation screen, and the computer collects the results.

```bash
npm run eval:device -- --models lfm2.5
```

```
✓ device SSYLAQFILNBEKBEQ
✓ team.nido.app installed (debuggable)
✓ Metro running, adb reverse tcp:8081 set
✓ request req-20260924t054219-safr written: {"requestId":"req-20260924t054219-safr","models":["lfm2.5"]}
✓ app reloading from Metro
  [00:00] waiting for the app to pick up the request…
  [00:20] 0/17 — model:hf-liquidai-lfm2-5-8b-a1b-… / greeting-1
  [01:52] 3/17 — model:hf-liquidai-lfm2-5-8b-a1b-… / explanation-1
  …
BOAR Device Evaluation — eval-2026-09-24T… (set v1, 17 queries)
  Queries:         17 ok · 0 failed · 0 cancelled (of 17)
  TTFT:            avg … · p50 …
  Tokens/sec:      avg … · p50 …
  Peak RSS:        … GB
  …
Raw results (authoritative): eval-results/2026-09-24/eval-….jsonl
Answers for grading:         eval-results/2026-09-24/eval-….answers.md
```

Every answer gets the same measurements, straight from the phone: model load
time, cold/switched/resident, time to first token, generation time,
tokens/sec, total time, peak memory, which articles were retrieved, and which
prompt format the model got (its own chat template, or the plain fallback).

## Two ways to run it

**From the computer (recommended).** `npm run eval:device` checks the phone,
sends the request, reloads the app so it runs your current code, waits, pulls
the results and prints the report. Nothing to tap.

**On the phone.** Drawer → Execution Telemetry → 🧪 Evaluate. Tick the models
and adaptive routing, tap ▶ Run, and export JSONL or CSV through the share
sheet when it's done.

Both run the same evaluation code (`src/eval/`), so results are identical in
shape and comparable.

## Setup, once

1. **On the computer:** Node/npm with `npm install` done, and `adb` (Android SDK
   platform-tools) on your `PATH`.
2. **On the phone:** Developer options → USB debugging on. Connect the cable
   and accept "Allow USB debugging". `adb devices` must show it as `device`.
3. **A development build of BOAR** installed (`npx expo run:android`, or
   `npm run eval:device -- --install` builds and installs one). Release builds
   can't be driven this way on purpose: request pickup only exists in
   development builds, and reading results needs a debuggable app.
4. **Metro running** in another terminal: `make start` (or
   `npx expo start --localhost`).
5. **Models downloaded** in the app (Settings → Models). The tool never
   downloads models.

## Commands

```bash
npm run eval:device                                   # every installed model + adaptive routing, all 17 questions
npm run eval:device -- --models qwen2.5-1.5b,phi-3.5  # specific models (id or a fragment of it)
npm run eval:device -- --adaptive                     # adaptive routing only
npm run eval:device -- --queries greeting-1,reasoning # some questions, by id or category
npm run eval:device -- --dry-run                      # print every adb command, run nothing
npm run eval:device -- --help                         # all options (--serial, --timeout-min, --no-reload, …)
npm run eval:summary -- --report <file.jsonl>         # re-print a report
npm run eval:summary -- --answers <file.jsonl>        # answers side by side, for grading
```

A model name must match exactly one installed model. A typo or an ambiguous
name (`qwen2.5` with two Qwen models installed) stops the run and lists what's
installed.

## Results

Saved under `eval-results/<date>/` (gitignored; commit a run on purpose when
you want it on record):

- `<runId>.jsonl` — one row per answer, the authoritative result
- `<runId>.answers.md` — every model's answer to each question, side by side
- `<runId>.status.json` — the final status reported by the phone

The questions and every result field are described in
[EVAL_QUERIES.md](EVAL_QUERIES.md).

## How it works

The computer never talks to the model. It only writes a small request file
into the app's private storage (through `adb run-as`) and reads results back
the same way. Inside the app, a development-only watcher picks up the request,
opens the Evaluation screen and runs it; the app never calls adb.

```
computer                                    phone (BOAR, development build)
─────────                                   ───────────────────────────────
adb devices, checks install and Metro
write files/eval/requests/pending.json ───▶ picks up the request once models are loaded
reload the app from Metro                   runs every question on the selected models
poll …/<requestId>.status.json ◀─────────── writes progress after each answer
pull files/eval/<runId>.jsonl ◀──────────── saves the results
print the report
```

## Tips

- **Keep the screen on and the app open.** Locking the phone moves BOAR to the
  background, and some phones cut its connection or throttle it. Some phones,
  such as Xiaomi/HyperOS, block changing "Stay awake" over adb. If the screen
  would time out during a long run, send a keypress now and then:
  `while true; do adb shell input keyevent KEYCODE_WAKEUP; sleep 30; done`.
- **Heat matters.** Tokens/sec dropped about a third over a 66-minute run as
  the phone warmed up. Compare models from runs in similar conditions, and
  note the battery temperature (`adb shell dumpsys battery`).
- **Don't start a run during a model download.** The run reloads the app, and
  a download can't resume after a reload.
- **A model that fails to load isn't skipped silently.** Every question is
  recorded as a failure with the reason, and the run moves on to the next
  model.
- **Answers vary slightly between runs** (temperature 0.7). Timings compare
  well; for quality, look at more than one run.

## Q4_K_M vs Q5_K_M A/B — Qwen2.5-0.5B (P2.1, device-gated)

The 0.5B ships as Q4_K_M (`qwen2.5-0.5b-instruct-q4km`). A Q5_K_M variant
(`qwen2.5-0.5b-instruct-q5km`, +22 MB) exists in the model catalog as an A/B
candidate. **The shipped default does not change until this A/B shows a
measurable quality gain** — evidence over theory.

Procedure (same phone, same conditions, back-to-back):

```bash
# 1. In the app: Settings → Models → download BOTH
#    "Qwen2.5-0.5B-Instruct (Q4_K_M)" and "Qwen2.5-0.5B-Instruct (Q5_K_M) [A/B]".
# 2. Run the full eval set on both, model-pinned (no adaptive routing):
npm run eval:device -- --models qwen2.5-0.5b-instruct-q4km,qwen2.5-0.5b-instruct-q5km
# 3. Grade the answers side by side:
npm run eval:summary -- --answers eval-results/<date>/<runId>.jsonl
```

Metrics to capture (all recorded per question in the JSONL):

- **Quality:** manual grading from the side-by-side answers (grading notes in
  EVAL_QUERIES.md). Focus on instruction-following and structured-output
  reliability — the 0.5B's weak points — not trivia recall.
- **Latency:** `totalLatencyMs` and tokens/sec per model (heat affects this;
  run both in the same session and note battery temperature).
- **Memory:** `peakRssBytes` per model (Q5's larger weights + same 4096 n_ctx
  KV cache must still fit low-RAM phones).

Decision rule: switch the default to Q5_K_M only if quality improves
measurably with no latency/memory regression that breaks the low-RAM target.
Otherwise stay on Q4_K_M and close the experiment.
