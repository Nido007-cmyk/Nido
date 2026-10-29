# Time to first word: what the model has to read (measured 2026-10-29)

The wait before the first word of an answer is mostly the model reading its
prompt (prefill). How long that takes depends on the phone, but the number of
tokens it has to read does not, and the time scales with it. These
measurements were made without a phone: llama.cpp on a 2-core x86 CPU, with
NIDO's default model (Qwen2.5-1.5B-Instruct Q4_K_M, the same file and sha256
as the catalog) and prompts built by NIDO's own code (`assembleChatMessages`,
"Succinct" style).

## What a question with sources costs

| Part | Tokens |
| --- | --- |
| System message (identity, style, limits, source rules) | 285 |
| Whole prompt with 4 sources (median of 12 questions) | 753 |

Prefill on this CPU: about 52 tokens/s, so a 753-token prompt took about
15 s. The alpha notes measured about 20 s on a Galaxy Tab A9+ with sources,
the same order of magnitude.

## Change 1 — the chat title no longer uses the model

After the first answer of a new chat, NIDO asked the model for a 3–5 word
title on the same llama.cpp context. llama.rn keeps the part of the previous
prompt that the next prompt shares (`find_common_prefix_length` in
`cpp/rn-completion.cpp`), so the title prompt replaced the cached system
message and the second question had to read it again.

Tokens the second question had to read, three real question pairs:

| Pair | With the cache kept | After the model title |
| --- | --- | --- |
| photosynthesis → black hole | 510 | 795 |
| inflation → earthquakes | 523 | 808 |
| Roman Empire → revolutions | 418 | 703 |

About 285 fewer tokens (−36%) for the second question of every new chat,
roughly 5 s at this CPU's speed, plus the title generation itself, which no
longer runs. The title now comes from the first question
(`src/services/sessionTitle.ts`).

## Change 2 — the system message puts what doesn't change first

The rules about sources were in the middle of the system message, so a
question with sources after one without (or the other way round) shared only
the beginning of it. They now go at the end: identity, style and limits stay
identical and are reused (about 85 more tokens kept in those cases). The
text is the same; only the order changed.

## Rejected — trimming each source to its most relevant sentences

Cutting each of the 4 sources to the sentences that share the most words with
the question made the prompt 19% shorter (753 → 609 tokens, 14.8 s → 11.9 s
here), but the answers got worse: with full sources, 4 of 12 answers were
fully backed by the sources (NIDO's own check, `verifyGroundedAnswer`); with
trimmed sources, none were. Not shipped.

## Not measured here

- The first question after opening the app still reads the whole prompt.
  Preparing the system message in advance would help, but it needs testing on
  a phone first (it runs while the person may already be typing).
- Thread count and big/little cores on real phones.
- Retrieval quality: these runs used a simple keyword search to pick the 4
  sources, which is enough to measure prompt size but not answer quality in
  the app.
