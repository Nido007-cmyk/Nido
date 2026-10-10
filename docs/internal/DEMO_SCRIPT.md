> **Language:** English · [Español](../es/internal/DEMO_SCRIPT.md)
# Demo script

For the public demo post the bounty asks for: the app running offline, several
questions including ones a 1B model would fail on, the repo link, and a short
explanation of the approach. Every question here comes from the
[device evaluation](../DEVICE_EVALUATION.md), so the result shown on camera matches a
measured result.

## Before filming

1. Install the exact release build you'll submit (see `SUBMISSION_CHECKLIST.md`).
2. Have **Qwen2.5-1.5B** and **LFM2.5-8B-A1B** downloaded (Settings → Reasoning Models).
3. Settings → Assistant Tone & Response Style:
   - **Max Output Tokens: 1024.** LFM2.5 reasons before answering, and at 512
     tokens it ran out before the answer on 4 of 17 benchmark questions.
   - **Adaptive Routing: off**, so the model you pick with "Select & Use" is
     the one answering.
   - Tone: Succinct & Direct.
4. Charge the phone and let it cool down; speed drops as it heats up.
5. Do a full rehearsal of every question below on the same build and settings.
   Only film questions that answered correctly in the rehearsal.

## Recording

Screen-record the phone (or film it) in one take, status bar visible.

### 1. Prove it's offline (10 s)

Swipe down the quick settings: airplane mode on, Wi-Fi off, mobile data off.
Keep the status bar in view for the whole video.

### 2. The question a small model gets wrong (60 s)

With **Qwen2.5-1.5B** active, ask:

> A device has a 12GB RAM budget. The OS and app overhead take 2GB, the embedding
> model needs 200MB, and the LLM's KV cache needs 1.5GB. How much is left for the
> LLM's weights, and would a 9GB model fit if loaded fully into RAM?

In the benchmark it answered "5GB … a 9GB model would fit": both wrong.

Switch to **LFM2.5-8B-A1B** (Settings → Reasoning Models → Select & Use), long-press your
question to put it back in the input, and send it again. While it reasons, the
💭 indicator shows it thinking. In the benchmark it answered: "About 8.3 GB
remains, and a 9 GB model would not fit." (correct, about 30 s).

Say it: this is a mixture-of-experts model, 8B parameters in total, about 1.5B
active per token.

### 3. A comparison (60 s)

> Compare the French Revolution and the Industrial Revolution.

Point out the cited sources under the answer: both articles come from the
offline knowledge base on the phone.

### 4. A synthesis (60 s)

> What do the Agricultural Revolution and the Industrial Revolution have in common
> as turning points in human history, and how did they differ in how quickly they
> changed daily life?

### 5. A practical traveler question (optional, 45 s)

> How do vaccines work?

or something a traveler would actually ask offline. Rehearse it first.

### 6. Show the measurements (20 s)

Drawer → Execution Telemetry: every answer you just asked, with the model, load
time, time to first token, tokens/sec and peak memory. Then About → "Benchmark it
yourself".

## Post draft

> BOAR: an offline AI research app for Android. No signal needed after a 1 GB
> first-run setup.
>
> Airplane mode on, and it still answers explanations, comparisons and multi-step
> questions from a local knowledge base, with sources.
>
> It runs a mixture-of-experts model on the phone (LFM2.5, 8B total, ~1.5B active
> per token) at ~15 tok/s on a Dimensity 8300, and it measures itself: every
> model is benchmarked on the device, results in the repo.
>
> [video]
>
> Repo: https://github.com/rferrari/boar-app
> Bounty: https://poidh.xyz/mainnet/bounty/31

Adjust the numbers to whatever the final benchmark run shows.
