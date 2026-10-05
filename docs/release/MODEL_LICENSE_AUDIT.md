# Model + Corpus License Audit (2026-09-27)

**Status:** RESEARCH / EVIDENCE ONLY. No code changed, nothing committed.
**Scope:** every downloadable asset in `src/models/manifest.ts` (`MODEL_CATALOG`).
**Method:** manifest read verbatim; each `sourceUrl` verified with HTTP HEAD
(no multi-GB downloads — HEAD only); license labels cross-checked against the
authoritative upstream (Hugging Face API / model card / LICENSE file /
ai.google.dev); license texts read from their authoritative sources.

## Key architectural fact for this audit

The APK does **not** bundle model weights or corpus files (`bundled` is unused;
see `manifest.ts` header). Assets are downloaded **at runtime by the user's
device, directly from upstream** (Hugging Face / raw.githubusercontent.com /
GitHub Releases). NIDO therefore does not currently redistribute the weight
bytes itself — the user fetches them from the licensor's distribution point.
**If the bundled/pre-seeded build path is ever used, this audit must be
redone**: bundling = redistribution, which triggers the full redistribution
clauses below (notably LFM §4(a)).

## Per-asset table

| Asset | URL reachable? | SHA-256 in manifest? | Size: manifest vs HEAD | License (manifest → upstream-verified) | Redistribution OK? | Attribution requirement | Evidence source |
|---|---|---|---|---|---|---|---|
| `phi-3.5-mini-instruct-q4km` (LLM, optional) | YES — HTTP 200 | YES `e4165e3a…38eff5` | 2,393,232,672 B = 2,393,232,672 B ✓ | MIT → MIT ✓ | YES — MIT permits redistribution with copyright + permission notice | Preserve copyright + permission notice | HF API `bartowski/Phi-3.5-mini-instruct-GGUF` → `license:mit` |
| `bge-small-en-v1.5-q8` (embedding, **required**) | YES — HTTP 200 | YES `ec38e8da…f514` | 36,806,944 B = 36,806,944 B ✓ | MIT → MIT ✓ | YES — same as above | Preserve copyright + permission notice | HF API `CompendiumLabs/bge-small-en-v1.5-gguf` → `license:mit` |
| `qwen2.5-1.5b-instruct-q4km` (LLM, **required**) | YES — HTTP 200 | YES `1adf0b11…6c3370` | 986,048,768 B = 986,048,768 B ✓ | Apache-2.0 → Apache-2.0 ✓ | YES — with license copy + NOTICE + change notices | Give recipients a copy of the license; retain NOTICE; state changes | HF API `bartowski/Qwen2.5-1.5B-Instruct-GGUF` → `license:apache-2.0` |
| `qwen2.5-7b-instruct-q4km` (LLM, optional) | YES — HTTP 200 | YES `65b8fcd9…a1423` | 4,683,074,240 B = 4,683,074,240 B ✓ | Apache-2.0 → Apache-2.0 ✓ | YES — same as above | Same as above | HF API `bartowski/Qwen2.5-7B-Instruct-GGUF` → `license:apache-2.0` |
| `lfm2.5-8b-a1b-q4km` (LLM, optional) | YES — HTTP 200 | YES `4923ec14…9b2bb0` | 5,155,564,768 B = 5,155,564,768 B ✓ | LFM Open License v1.0 → LFM Open License v1.0 ✓ | YES, **with conditions** (see §5 below) | §4: give recipients a **copy of the license**; mark modified files; retain copyright/patent/trademark/attribution notices; include NOTICE-file contents | LICENSE file read in full from `https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF/raw/main/LICENSE` |
| `gemma-4-e4b-it-q4_0` (LLM, optional) | YES — HTTP 200 | YES `676c3507…53fbaee` | 5,154,941,280 B = 5,154,941,280 B ✓ | Apache-2.0 → Apache-2.0 ✓ | YES — Apache-2.0 terms | Give recipients a copy of the license; retain NOTICE; state changes | HF API `google/gemma-4-E4B-it-qat-q4_0-gguf` → `license:apache-2.0`; model card links `https://ai.google.dev/gemma/docs/gemma_4_license`, which renders the full Apache License 2.0 text |
| `corpus-standard` (corpus, optional) | YES — HTTP 200 (pinned rev `9898b35e`) | YES `2aeff76d…85d2ff` | 614,084 B = 614,084 B ✓ | CC BY-SA 4.0 (Wikipedia) — declared | YES — with BY-SA conditions | Attribution (creator, license notice, link); ShareAlike on adaptations | `sourceUrl` + `revision` in manifest; per-document `source` fields in the JSON point to en.wikipedia.org |
| `corpus-full` (corpus, optional) | YES — HTTP 200 (pinned rev `9898b35e`) | YES `6d602003…c570be` | 2,530,725 B = 2,530,725 B ✓ | CC BY-SA 4.0 (Wikipedia) — declared | YES — same as above | Same as above | Same as above |
| `wiki-vital5` (corpus sqlite-pack, optional) | YES — HTTP 200 | YES `d3b87d56…1aecc666` | 163,647,488 B = 163,647,488 B ✓ | CC BY-SA 4.0 (Wikipedia) — declared | YES — with BY-SA conditions | Same as above | GitHub Release asset on `rferrari/boar-app` (`knowledge-pack-v1`) |

**Notes:**
- All 9 HEAD `Content-Length` values match `sizeBytes` in the manifest **exactly**.
- Only `corpus-standard` / `corpus-full` pin an upstream revision (`9898b35e92bf42984a62c62a1d5f4b5895372b27`);
  the six Hugging Face URLs use `/resolve/main/` (a moving branch pointer — bytes can change upstream;
  `ModelManager` enforces the sha256, so a silent swap fails closed, but the label/size could drift).
- `wiki-vital5` points at a GitHub **Release asset** (`knowledge-pack-v1`) — immutable once published.

## License summaries (from authoritative texts)

### LFM Open License v1.0 (Liquid AI) — full text read 2026-09-27
- **Permits:** reproduction, Derivative Works, public display/performance, sublicensing,
  distribution in Source or Object form (§2 copyright grant, §3 patent grant).
- **Redistribution conditions (§4):** (a) give every recipient **a copy of this License**;
  (b) modified files must carry prominent change notices; (c) retain copyright/patent/
  trademark/attribution notices; (d) reproduce NOTICE-file attribution notices.
  Own copyright statement / different terms on *your modifications* are allowed.
- **Commercial Use Limitation (§5) — the sharp edge:** commercial-use rights are conditioned
  on the Legal Entity **not exceeding $10M USD annual revenue**. Commercial use above the
  threshold **is not licensed at all**. (Qualified non-profits doing non-commercial/research
  use are exempt from the threshold.)
- **Not copyleft.** No trademark grant beyond describing origin (§7). Breach = **automatic
  termination**, must cease use and delete all copies (§11).
- **No conflict with the app's MIT license** (separate works; no copyleft bleed), but the
  revenue cap is a live business constraint to monitor.

### Gemma — NO legacy Gemma Terms of Use asset present
- The catalog's only Gemma-family asset is **Gemma 4 E4B**, which Google ships under
  **Apache License 2.0** (model card: "License: Apache 2.0"; license page renders the full
  Apache 2.0 text). The old Gemma Terms of Use (prohibited-use terms of Gemma 1/2/3)
  **do not apply** to anything in this catalog. Manifest label "Apache-2.0" is correct.
- Apache-2.0 permits redistribution with: a copy of the license, retained NOTICE,
  and change notices. No copyleft; no conflict with the app's MIT license.

### MIT (Phi-3.5-mini, bge-small-en-v1.5)
- Permits redistribution provided the copyright and permission notice travel with it.
  No conflict with the app's MIT license.

### CC BY-SA 4.0 (all three corpus assets, Wikipedia-derived)
- **BY:** attribution required when sharing — identify the creator/source, give a license
  notice, link the material. **SA:** adaptations shared publicly must carry the same license.
- The corpus JSONs already carry **per-document** `source` attribution
  (`"Wikipedia — https://en.wikipedia.org/wiki/…"`) and the chat UI renders
  `SourceFootnotes` citations — the attribution *practice* is in place.
- The **license notice itself** (a statement that the corpus is CC BY-SA 4.0 with a link
  to the license) is not currently shipped anywhere user-visible or in-repo — see gaps.
- No conflict with the app's MIT license: the corpus is a separate data work, not linked code.

## What the app already does (partial compliance, verified in source)
- `src/ui/CatalogItemCard.tsx` displays `item.license` (the short label) per asset in the
  download catalog — users see the license name before downloading.
- `src/ui/UsageStatsContent.tsx` shows an "Open Weights License" row for the active model.
- Chat shows `SourceFootnotes` citations for RAG answers (supports BY attribution).

## Gap list (missing notices)
1. **No `THIRD_PARTY_NOTICES.md` in the app repo.** (Recommended long ago; the isolated
   `licensing/compliance-notices` branch exists but is unmerged by design.)
2. **No license copies shipped.** LFM §4(a) and Apache-2.0 both require recipients to *receive
   a copy of the license*. Today only short labels ("LFM Open License v1.0", "Apache-2.0",
   "MIT", "CC BY-SA 4.0") are shown — no text, no link. Currently moot for redistribution
   (runtime download from upstream, not bundling), but a hard blocker the moment anything
   is bundled/pre-seeded.
3. **No CC BY-SA 4.0 license notice** for the corpus (per-document Wikipedia source links
   exist; the license statement + link does not).
4. **AboutScreen has no attribution/legal section** (shows version + mascot only).
5. **No in-app or setup-wizard link to full license texts** — the catalog shows labels only.
6. HF URLs (6 of 9) use the moving `/resolve/main/` pointer; only the two small corpora pin
   a revision. Integrity is enforced by sha256, but license/size drift upstream is possible.

## Verdicts

### Private-alpha sideload (single device, runtime download from upstream, no bundling)
| Asset | Verdict |
|---|---|
| phi-3.5-mini-instruct-q4km | **GO** — MIT, upstream-verified |
| bge-small-en-v1.5-q8 (required) | **GO** — MIT, upstream-verified |
| qwen2.5-1.5b-instruct-q4km (required) | **GO** — Apache-2.0, upstream-verified |
| qwen2.5-7b-instruct-q4km | **GO** — Apache-2.0, upstream-verified |
| lfm2.5-8b-a1b-q4km | **GO (conditional)** — LFM Open License v1.0 permits this use; conditions: (a) entity stays under the $10M/yr commercial-use threshold, (b) do NOT bundle/pre-seed weights into the APK without first shipping the §4(a) license copy + notices |
| gemma-4-e4b-it-q4_0 | **GO** — Apache-2.0 (not legacy Gemma Terms), upstream-verified |
| corpus-standard / corpus-full / wiki-vital5 | **GO** — CC BY-SA 4.0 honored via per-document Wikipedia attribution + chat source footnotes; license-notice gap is documentation debt, not a distribution blocker at private-alpha scale |

### Wider distribution (beyond private alpha)
**CONDITIONAL GO — all assets, provided these gates close first:**
1. Add `THIRD_PARTY_NOTICES.md` with every entry verified from the actual source
   (model weights, corpus, SQLCipher, node-forge election — per the licensing lane's rule:
   no assumed obligations).
2. Ship license copies/texts or canonical links for LFM Open License v1.0, Apache-2.0,
   MIT, and CC BY-SA 4.0 (in-repo + reachable from the app, e.g. About → Legal).
3. Add a CC BY-SA 4.0 notice covering the corpus packs (BY-SA statement + license link).
4. LFM §5: establish revenue-threshold monitoring — crossing $10M/yr annual revenue
   terminates the LFM commercial-use grant; plan the model-catalog consequence *before*
   it matters.
5. Re-run this audit (URLs, license labels, sizes) per release — upstream cards and
   `/resolve/main/` bytes can change; the manifest's labels must be re-verified, not trusted.
6. If the bundled/pre-seeded build path is ever used: full redistribution analysis first
   (LFM §4(a) license copy inside the distributable becomes mandatory).

**Explicit non-goals of this audit:** legal advice (counsel review still required before
public distribution); patent-claim analysis beyond the license texts' express grants;
verification of the *weights'* provenance beyond the upstream card/license declarations.
