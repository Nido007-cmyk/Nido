> **Language:** English · [Español](es/MANIFESTO.md)

# The BOAR Manifesto

*An offline research companion for today, and a workbench for the one we're still waiting for.*

## The dream

Vitalik described it plainly: a research tool that lives on your phone, works with
no signal at all, and is more than half as good as internet search plus a frontier
AI model. He also sketched how it might work: an extreme mixture-of-experts model,
around 100B parameters, mostly sitting on disk, with less than 1B of them waking up
for each token.

That model doesn't exist yet. Nobody can download it today, and we can't train it
ourselves.

We built BOAR anyway.

## What BOAR is today

**A useful offline companion.** Install it, let it download its models once, and
put your phone in airplane mode. It still answers questions, explains things,
compares ideas, and searches a local knowledge base, all on the device. Nothing
leaves your phone. No account, no API, no Google Play Services.

**An honest workbench.** BOAR measures itself. Every answer records which model
ran, how long it took to load, how long until the first word, how fast it
generated, how much memory it used, and what it retrieved. Our first real-phone
benchmarks (Xiaomi, Dimensity 8300, 11.6 GB RAM) look like this:

| Model | Speed | Median answer time | What we saw |
|---|---|---|---|
| Qwen2.5-1.5B | ~11–17 tok/s | 10–21 s | Fast, fine on simple questions, slips on synthesis; with the Wikipedia pack, 6/6 knowledge questions right |
| LFM2.5-8B-A1B (MoE) | ~15 tok/s | 57 s | 8B total, ~1.5B active: fastest generation and the only one to solve the RAM question, but thinks so long 4 of 17 answers ran out of budget |
| Phi-3.5-mini | ~4 tok/s | 73 s | Best comparisons, slow, invents citations |
| Qwen2.5-7B | ~3 tok/s | 107 s | Accurate, often too slow to finish |
| Instella-MoE-16B | — | — | Didn't load: architecture not supported yet |

Not the dream, and we say so. Every number comes from a real phone, the raw
results are in [docs/evidence](evidence/), and every run is reproducible
from this repository.

## What we believe

1. **Offline means offline.** One download at setup, then nothing. Not "mostly
   local", not "offline except when it matters".
2. **Measure, don't hype.** A model card isn't a benchmark. Total parameters,
   active parameters and "mobile-ready" labels mean little until a phone runs the
   model and we write down what happened, failures included.
3. **The phone decides.** Prompt processing, memory bandwidth, heat and the
   runtime matter as much as the model. A model that thinks well but takes two
   minutes to start talking isn't useful on a mountain.
4. **Useful now beats perfect later.** 4–15 tok/s is enough to find out how to
   treat a blister, what a museum is about, or why the train isn't running, when
   there's no signal and nobody around to ask.
5. **Open and reproducible.** Code, models, data sources and benchmark results
   are all in the repo. If our numbers look wrong, run them yourself and tell us.
6. **It should be fun.** Watching a new model boot on your phone, seeing if it
   survives the reasoning questions, comparing notes with others: that's the
   good part of building this.

## Join us

BOAR is a tool for anyone curious about what phones can really do.

- **Test a new model before your next trip.** Found a promising GGUF on Hugging
  Face? Download it from the app's model browser and benchmark it on your own
  phone:

  ```bash
  npm run eval:device -- --models <model>
  ```

  You get load time, time to first token, tokens/sec, peak memory and every
  answer side by side. See [docs/EVAL_QUERIES.md](EVAL_QUERIES.md).
- **Share your results.** Different phones, different chips, different numbers.
  A result from your device is data nobody else has.
- **Break it.** Ask the questions a 1B model fails on. Find where retrieval pulls
  in nonsense. Open an issue with the output.
- **Build the missing pieces.** Expert-aware caching for mixture-of-experts
  models streaming from storage. Bigger offline knowledge packs. Better routing
  between small and large models. Each one moves us closer to the dream model
  running here.

Getting started: [README.md](../README.md) for the app, [AGENTS.md](../AGENTS.md) for
building from source.

## The deal

When the dream model finally arrives, a huge mixture-of-experts model that runs from
a phone's storage and thinks like a frontier model, it should have a place
to land: an app, real measurements, and people who already know how to
test it.

Until then: keep your phone charged, pack BOAR, and go somewhere without signal.

🐗
