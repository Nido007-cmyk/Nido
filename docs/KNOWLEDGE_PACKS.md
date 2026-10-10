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

## How the app searches a pack

For each question, the pack's keyword index picks up to 400 candidate chunks, and
only those are compared with the question's embedding. The results are merged
with the built-in knowledge base, keeping at most 2 chunks per article so one
article can't crowd out another topic. Comparing a question against every
embedding in a 100k-chunk pack would take seconds on the phone, so candidates
come from keywords first. A pack built with a different embedding model is
ignored with a warning, since its embeddings wouldn't match the app's.
