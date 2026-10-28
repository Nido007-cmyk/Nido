> **Language:** English · [Español](es/KNOWLEDGE_PACKS.md)

# Knowledge packs

NIDO answers from an offline knowledge base on the phone. It always has the small
built-in one (about 5,300 short Wikipedia-derived articles). A **knowledge pack**
adds many more articles in one ready-made file: text, a keyword search index and
embeddings, all built on a computer so the phone doesn't have to index anything.

## Using the ready-made pack

The setup wizard offers the Wikipedia Vital Articles pack as an optional
download, and Settings → Offline Knowledge Base lists it too. You don't need
anything below unless you want a bigger or custom pack.

## Building your own

You need a computer with Node.js and this repository (`npm install` done), and an
internet connection for the build (the phone stays offline).

```bash
npm run pack:build                        # Wikipedia Vital Articles level 5 (~50k articles, ~2-3 hours)
npm run pack:build -- --level 4           # level 4 (~10k articles, ~30 minutes)
npm run pack:build -- --titles my.txt     # your own list: one Wikipedia article title per line
npm run pack:build -- --limit 200         # a quick test build
npm run pack:build -- --help              # all options
```

Or with make: `make knowledge-pack` (level 5) or `make knowledge-pack-small` (level 4).

What the builder does:

1. Gets the list of titles: every article linked from Wikipedia's
   [Vital Articles](https://en.wikipedia.org/wiki/Wikipedia:Vital_articles) lists
   at the chosen level, or your own list.
2. Downloads each article's introduction through the Wikipedia API.
3. Splits the introductions into chunks of about 600 characters (at most 3 per
   article).
4. Embeds every chunk with the same bge-small-en-v1.5 model the app uses
   (`assets/models/embedding.gguf`, downloaded and checksum-verified if missing),
   using llama.cpp through `node-llama-cpp`. Desktop and phone embeddings match
   (cosine similarity 0.9999).
5. Writes one SQLite file with the chunks, an FTS5 keyword index and the
   embeddings (8-bit), plus metadata.

During embedding, `node-llama-cpp` may warn that tokenizing and detokenizing the
model "resulted in a different text". That's expected for this model (its
tokenizer lowercases text) and doesn't affect the embeddings.

Every step is cached in `build/knowledge-pack/<id>/`, so if the build stops you
can run the same command again and it continues where it left off.

The result:

```
build/knowledge-pack/<id>.sqlite        the pack
build/knowledge-pack/<id>.sqlite.json   its size, SHA-256, article and chunk counts
```

Wikipedia text is CC BY-SA 4.0; keep the attribution if you share a pack.

### Packs from your own guides

The builder can also take Markdown guides instead of Wikipedia titles:

```bash
npm run pack:build -- --guides knowledge-packs/nido-esencial --id nido-esencial --embedding e5
```

Each guide is a `.md` file with front matter (`title`, `lang`, `sources`, and
optionally `category`) and sections that start with `##`. Every section becomes
one or more chunks named "Guide title — Section"; very short sections (a
one-line intro, the closing note) are folded into a neighbour. The pack's
license and attribution say the text was written by NIDO from the cited
sources (CC BY 4.0).

`knowledge-packs/nido-esencial/` is NIDO's own pack: 58 guides in Spanish and
58 in English on first aid, health at home, disasters and survival, written
from Red Cross, AHA, WHO, UNICEF, CDC, FEMA and other public guidance (each
guide cites its sources). `scripts/check-pack-retrieval.mjs` checks that real
questions (`retrieval-checks.json`) find the right guide, and CI
(`.github/workflows/knowledge-pack.yml`) builds and checks it.

### Format v2: indexed questions and verified facts (0.1.55)

A guide can also declare, in its front matter, `id` (stable across languages,
e.g. `local-chile`), `region` (ISO 3166-1 code), `verified` (the date it was
last checked) and `questions` (real questions it answers, separated by `|`).
A section can list its own with a line `<!-- preguntas: … | … -->` (or
`questions:`). These questions are indexed with the section (full-text and
embedding) but never shown; keep the questions in `retrieval-checks.json`
different from them, so the check still measures real retrieval.

A pack folder can carry `facts.json`: regions (names, "in X" phrases, aliases)
and facts, each with `key`, `region`, `value`, `label` in es/en/pt and a
`source` with `title`, `url`, the exact `quote` from that page and the
`checked` date. The builder refuses a fact without all of it. The app answers
"what number do I call in X?" from this table, without retrieval or the model,
and cites the source and date. `scripts/check-pack-claims.mjs` reopens every
source and checks the quote is still there; `.github/workflows/pack-claims.yml`
runs it weekly.

A v2 pack (`meta.formatVersion = 2`) adds the tables `guides`, `regions`,
`facts` and the column `chunks.keys`; older app versions keep reading it as
before.

## Putting a pack on your phone

**For testing, over USB** (a development build of NIDO, USB debugging on):

```bash
npm run pack:push -- build/knowledge-pack/<id>.sqlite
```

It copies the file into the app's storage and verifies it. NIDO uses any valid
pack in its `corpus/` folder from the next question on, no code changes needed.

**For everyone who installs your build**, add it to the catalog so the app can
download it:

1. Upload the `.sqlite` file somewhere public, for example as a GitHub Release
   asset (files over 100 MB can't go in the git repository itself).
2. Add an entry to `CORPUS_CATALOG` in `src/models/manifest.ts` with
   `kind: "corpus"`, `format: "sqlite-pack"`, `filename: "corpus/<id>.sqlite"`,
   and the size and SHA-256 from the `.json` summary.
3. To offer it in the setup wizard, add its id to a tier's `corpusPackIds`
   (`TIERS` in the same file).

## When a pack gets a new version

A new app version can ship a new version of a catalog pack (new size and
SHA-256 in the signed catalog). The pack already on the phone is not deleted:
it is still exactly the file that was verified when it was installed, so the
app keeps using it, also offline, and the Packs list shows **Update
available**. Answers with emergency numbers from it say that they come from an
older version of the pack, next to the date each source was checked. The new
version replaces the old file only once it has finished downloading and its
SHA-256 has been verified; if the download fails or is cut off, the old pack
stays. A pack file that changed after it was installed (any other bytes) is
not treated as an older version: it is deleted, as before. Models keep the
strict check.

## Passing a pack to another phone (no internet)

Since 0.1.55 a NIDO can hand a catalog pack (for example NIDO Essentials,
about 0.7 MB) to a connected contact over Bluetooth or local Wi-Fi: Packs tab
→ Share. The rules:

- Only **catalog packs** travel: the ones with a SHA-256 in NIDO's signed
  catalog. Packs built by hand (`local-…`) are never offered.
- The sender checks that its installed file still matches the catalog
  SHA-256 before offering it.
- The receiver only sees offers for catalog packs, and installs the file
  only if its bytes match the catalog SHA-256 exactly — the same file it
  would have downloaded. A pack with a single byte changed (say, an altered
  first-aid instruction) is rejected.
- The new file is written next to the old one and swapped in at the end; if
  anything fails, the previous pack stays in place.
- The two phones must run versions with the same catalog: a pack from a
  different catalog version is refused.
- Packs larger than 100 MB (the Wikipedia packs) cannot be shared this way.

## How the app searches a pack

For each question, the pack's keyword index picks up to 400 candidate chunks, and
only those are compared with the question's embedding. The results are merged
with the built-in knowledge base, keeping at most 2 chunks per article so one
article can't crowd out another topic. Comparing a question against every
embedding in a 100k-chunk pack would take seconds on the phone, so candidates
come from keywords first. A pack built with a different embedding model is
ignored with a warning, since its embeddings wouldn't match the app's.

### With multilingual search on

With multilingual search on (Settings → Offline Knowledge Base), NIDO uses the
multilingual-e5-small embedding model and the multilingual version of the
Vital pack (`wiki-vital5-e5`). A question in Spanish shares no keywords with an
English article, so keyword candidates aren't enough: the app builds, once and
in the background, a vector index of the whole pack and searches all of it.
Until that index is ready it falls back to keyword-first search.

e5 gives a high similarity to almost any pair of texts, so a fixed score floor
alone let unrelated articles through. Since 0.1.36 the best match must also
**stand out**: it has to beat the average of results 10–50 for the same
question by a margin (`distinctGap` / `packDistinctGap` in
`src/rag/embeddingProfile.ts`). If nothing stands out, the question has no
answer in the pack and no source is shown. The margin is calibrated in CI
(`.github/workflows/multilingual-e5.yml`, `scripts/multilingual/e5_pipeline.py`)
against questions in Spanish, English and Portuguese, including questions with
no answer in the base. At the chosen value (0.03), wrong sources dropped from
20 % to 10 % on the built-in base and from 33 % to 22 % with the Vital pack,
with no correct answers lost.
