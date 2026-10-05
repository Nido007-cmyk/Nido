# BOAR idea review for NIDO — 2026-09-27

**Scope:** read-only research. What in the BOAR repo (upstream `rferrari/boar-app`
plus its open PRs) is worth adopting as *ideas* for NIDO — and what to avoid.
Not authorization to implement anything. Roadmap reference:
`docs/NIDO_PRODUCT_ROADMAP.md`.

**Method:** GitHub API review of `rferrari/boar-app` (20 stars, 3 forks, created
2026-09-22): all commits, 2 releases, 14 issues/PRs, contributor list. Prior
deep-dive (`~/workspace/offline-muse/BOAR_DEEP_DIVE.md`, 2026-09-26) already
covers `main` as of 2026-09-26; this report focuses on what's new since, and on
the 12 open PRs that postdate it.

**Headline structural fact:** all 12 open PRs (#2–#11, #13, #14) come from a
single fork, **`r4topunk/boar-app`**, all in `draft` state, all unmerged, all
opened 2026-09-26/27. This is a large parallel workstream (UI redesign, engine,
trust/offline, eval, device lab), not reviewed upstream code. Treat every idea
below as a *proposal to evaluate*, never as vetted practice. (PR bodies mention
"the team's integration branch", but the contributors API on both repos lists
only `rferrari` — single-account workstream as far as the record shows.)

---

## @btcjasper affiliation check — UNCONFIRMED

`GET /repos/rferrari/boar-app/contributors` → **only `rferrari`** (168
contributions). Same result on the `r4topunk/boar-app` fork. There is **no repo
evidence** that X user @btcjasper ("Jasper") contributes to BOAR. The warm
reply from the verified @boar_app account suggests some relationship, but it
remains tentative and unconfirmed — do not treat him as a BOAR team voice on
repo evidence.

---

## Ideas worth adopting (ranked)

### 1. Streaming SHA-256 + honest integrity errors — the hardened T-005
**Where:** PR #5 `feat/trust-offline` (fork `r4topunk/boar-app`), files
`modules/file-hash/android/.../FileHashModule.kt` (new, 136 lines),
`src/models/fileHash.ts` (new, 102), `src/models/integrity.ts` (new, 162).

A native Kotlin module that hashes files **streaming in 1 MiB chunks** (a 5 GB
model never sits in memory), with progress events, cancellation, and
`copyWithSha256` — copy + hash in a **single pass**, delete-on-failure, fsync.
The JS fallback (`sha256Chunked`) reads 4 MiB at a time and yields between
chunks. It also fixes a real 2 GB bug: `expo-file-system` measured
`content://` sizes with an `Int`, so files over 2 GB read as 0 bytes; the
native module measures a `Long`.

`integrity.ts` adds `AssetIntegrityError` with a `permanent` flag — *retrying
the same source won't help* (wrong bytes, no space): auto-retry must skip it
and the user needs a different action. `DownloadError` carries the resume
detail (`bytesDone`/`bytesTotal`, stall seconds).

**Why for NIDO:** NIDO just lived this bug class (T-005: `verifyChecksum`
hashed base64 text; fixed in JS). The fork's version is the *hardened* form of
the same lesson: hash raw bytes, never hold multi-GB files in JS memory,
report progress, support cancel, and — the part NIDO doesn't have yet —
**distinguish permanent from transient failures** so a user is never stranded
at ~96% without a clear recovery path. Directly serves roadmap Priority 5
(resilient model installation). Evaluate when NIDO next touches model
installation; the pure-TS `integrity.ts` error taxonomy is adoptable without
the native module.

### 2. Pinned downloads + a manifest-verification script
**Where:** PR #5, `scripts/verify-manifest-pins.mjs` (new, 137 lines); every
`sourceUrl` in their manifest pinned to an immutable Hugging Face revision
(40-hex commit SHA, e.g.
`.../resolve/d32f8c040ea3b516330eeb75b72bcc2d3a780ab7/bge-small-en-v1.5-q8_0.gguf`).

The script re-checks every catalog entry against its host: HF files via the
Hub `paths-info` API (size + LFS sha256, never downloading large files),
release assets via HEAD size checks, with 429-aware retries. `npm run
manifest:verify`.

**Why for NIDO:** NIDO already pins corpus URLs to an immutable commit SHA
(`11b14ff…`, tag `corpus-v1-data`) — the *practice* of a CI script that
re-verifies pins against hosts is the adoptable part. Serves Priorities 5 and
8. Small, cheap, high-value.

### 3. Offline build variant + a build-time APK audit script
**Where:** PR #5, `plugins/withBuildVariant.js` (new, 211 lines),
`src/config/variant.ts` (new, 29), `scripts/audit-offline-apk.sh` (new, 119),
`docs/BUILD_VARIANTS.md`, `docs/OFFLINE_INSTALL.md`.

Two build flavors from one codebase: `downloader` (declares INTERNET, in-app
downloads) and `offline` (**no INTERNET permission at all**; models imported
from files via the phone's file picker, hashed while copying). The audit
script **fails the build** if the offline APK declares `INTERNET`,
`ACCESS_NETWORK_STATE`, ships `gms`/`firebase`/`mlkit`/`expo-updates`/
`retrofit`/`ktor`/`volley`/`sentry` packages, or lacks `allowBackup=false`,
`usesCleartextTraffic=false`, and `dataExtractionRules`. (Adapted from Field
Atlas's `verify_offline.sh`, Apache-2.0, attributed in the script header.)

**Why for NIDO:** "Nuestro fuerte es offline" is the strategy. NIDO's current
plan is a runtime Network Audit; a **build-time** audit script is the
complementary proof — the strongest possible evidence for the offline claim,
checkable in CI on every release. Note it also enforces `allowBackup=false`
and `dataExtractionRules`, which the deep-dive flagged as open privacy gaps
in the inherited tree. Serves Priorities 3 and 8. Caution: two APK variants
double distribution complexity — NIDO may prefer one audited build rather
than two flavors. Adopt the *audit*, decide the *variant* later.

### 4. Honest voice policy (consent-gated system voice)
**Where:** PR #5, `src/voice/voicePolicy.ts` (new, 50 lines, pure + tested).

A pure policy function: on-device recognition is used whenever available;
the system service (usually Google's, which **may send audio to its servers**)
requires **explicit user consent** before first use; the offline build never
uses the system service at all. Reason codes
(`on-device`/`system-accepted`/`system-needs-consent`/`system-blocked-offline`)
drive the UI honestly.

**Why for NIDO:** the deep-dive flagged voice as a privacy gap
(`SpeechRecognizer` + `EXTRA_PREFER_OFFLINE` does not guarantee offline).
NIDO's long-term plan is on-device STT (whisper.cpp); this consent gate is
the honest *interim* pattern — small, pure, tested, adoptable now. Serves
Priority 2 (user-data protection).

### 5. GGUF-header-aware memory fit
**Where:** PR #2 `feat/engine-routing` (fork), `src/inference/memoryFit.ts`
(new, 277 lines, pure + tested).

Replaces the `fileSize × 1.15 > free RAM → refuse` heuristic (which NIDO
inherited in `compatibility.ts`) with an estimate that understands mmap:
**anonymous memory** (KV cache + compute buffers, must be resident — the only
thing that justifies refusing a load) vs **file-backed weights** (page cache,
evictable). Reads the GGUF header via `llama.rn`'s `loadLlamaModelInfo`.
Verdicts: `resident` / `streaming` / `thrashing` / `insufficient`, each with a
human-readable explanation, plus `contextSizeForRam` (n_ctx sized by device
RAM) and a preference for the OS's own available-memory figure over the
`total − RSS − 2GB` heuristic.

**Why for NIDO:** the Galaxy Tab A9+ question "will this model actually run?"
deserves better than ×1.15. Honest fit verdicts improve model suggestions and
setup UX. Serves Priority 1 (prove the core on physical hardware). Pure
module — evaluable in isolation without the PR's routing complexity.

### 6. Device lab: Maestro e2e flows + per-uid network audit script
**Where:** PR #13 `test/device-lab` (fork), `e2e/flows/*.yaml` (10 Maestro
flows: setup downloader, setup offline-import, ask-with-sources, **airplane
mode**, places, model switch, knowledge, reset), `e2e/scripts/netaudit.sh`
(20 lines: per-uid socket snapshot from `/proc/net/{tcp,tcp6,udp,udp6}` +
`dumpsys netstats detail`), `docs/DEVICE_LAB.md` (toolchain recipe: AOSP
emulator **without Google Play Services**, measured disk footprint).

**Why for NIDO:** roadmap Priority 8 explicitly calls for a release
qualification suite (clean install, offline launch, interrupted
download/resume, Keystore failure, network-audit expectations…). This PR is a
concrete template for exactly that, and `netaudit.sh` is the device-side
companion to NIDO's Network Audit lane. Note their lab is macOS/Apple
Silicon; the *pattern* transfers, the recipe doesn't. Also note the honest
framing: emulator is a stand-in, never a replacement for the physical tablet
— consistent with NIDO's device-gate directive.

### 7. Offline eval vs frontier + a safety/honesty gate
**Where:** PR #14 `feat/eval-frontier` (fork, +177k lines mostly reports),
`eval/README.md`, `eval/dataset/` (v1: 96 research questions with licenses;
v2 "Vitalik style": 61; `safety`: first-aid questions EN/PT; cryptopack).

Desktop harness: reference answers from Claude Opus + web search (no paid LLM
API, subscription only), **blind judge in both A/B orders**, calibration
with hand labels + Cohen's kappa, quality×latency charts. The stated rule:
**the safety/honesty gate is what every prompt or retrieval change must
pass.** Known limitations are disclosed in the README (judge and reference
are both Claude → self-preference; desktop latency is a proxy).

**Why for NIDO:** the transferable idea is the *gate* — no prompt/retrieval
change lands without passing eval — plus the transparency practice
(published methodology, disclosed limitations, per-item licenses). That
matches the repo's "serious reader" bar. Serves Priority 8. Caution: heavy
generated-report bulk; and judge+reference sharing a model is a signal, not
ground truth.

### 8. Honest corpus: `RETIRED_SEED_IDS`
**Where:** PR #11 `feat/knowledge` (fork), `src/rag/seedCorpus.ts` —
`RETIRED_SEED_IDS` deletes, on the next seed run, five hand-written seed
notes from older installs *because they answered the eval's own questions
and inflated retrieval results*. "Only text taken from a citable source
belongs in the knowledge base."

**Why for NIDO:** an integrity practice, not a feature: never game your own
benchmarks, and repair old installs when you find contamination. Adopt as
principle for NIDO's eval/seed work.

### 9. ADR (Architecture Decision Record) practice
**Where:** PR #9 `spike/moe-deep` (fork), `docs/adr/0001-deep-tier.md` —
context, constraints, measured alternatives, recommendation, **success
criteria, rollback, triggers to reopen**, plus an explicit UNKNOWN section.

**Why for NIDO:** the format, not the topic (theirs is MoE expert-streaming).
NIDO faces ADR-grade decisions (release signing key, SQLCipher, voice engine,
distribution) — this template (especially "triggers to reopen" and the
UNKNOWN section) fits the roadmap's "reference for future planning" purpose.

### 10. Release discipline and honesty on `main` (new since deep-dive)
- **Release signing** (commit `4e77d43e`, 2026-09-24): `plugins/withReleaseSigning.js`
  signs release builds from `BOAR_UPLOAD_*` gradle properties, explicitly
  "never in the repo"; without them the build falls back to debug signing so
  anyone can still build from source. Serves Priority 6. (Note: same
  `BOAR_UPLOAD_*` names NIDO's brand audit flagged — rename on adoption.)
- **Checksum sidecar + user-facing verification** (release `v1.0.0`,
  2026-09-26): `boar-v1.0.0-arm64.apk` (123 MB, 41 downloads) ships with a
  `.sha256` sidecar; README (commit `12570893`) tells users to download and
  verify. Adopt the sidecar practice for NIDO releases (Priority 6).
- **About-screen honesty** (commit `66749975`): real version badge (was
  hard-coded "v0.1.0 - PRODUCTION BUILD"), "Benchmark it yourself" card, and
  **dropped the "selective verification" claim because it doesn't run by
  default**. The principle: never claim what the build doesn't do — directly
  NIDO's verification ethos.
- **Setup UX hardening** (commits `8ae9d444`, `4928ccd3`, `edf47a08`,
  2026-09-25): indexing progress with counter + time-left, install and
  indexing as separate wizard steps, embedding model loaded before indexing
  with serialized embedding (fixes llama.rn "Context is busy"). NIDO's setup
  wizard will hit the same issues — steal the fixes, not the code.

### 11. UX-audit → design-system practice (not their visuals)
**Where:** PR #4 `feat/ui-foundation` (fork): starts from a code-level UX
audit with `file:line` evidence (no real navigation, broken theme switching,
emoji as icons…), then builds tokens (OKLCH palette, light+dark, 4pt
spacing, 44/48 touch targets), a native navigation shell, and spec docs
(`flows-spec.md`, `chat-spec.md`) with a11y review.

**Why for NIDO:** NIDO already froze its own visual direction (Tier 1.1 +
Tier 2) — do not import their "Fogueira & Luar" aesthetic. The adoptable
part is the *practice*: audit with file:line evidence, spec docs before
screens, a11y review. Useful when NIDO implements its approved direction.

---

## Explicitly avoid

1. **Adopting the fork workstream wholesale.** 12 draft PRs, ~400k added
   lines, zero upstream review. Cherry-pick ideas (above), never branches.
2. **PR #2's engine complexity.** `answerService.ts` (1239 lines),
   `context.ts` (1347 lines), depth routing, calculators — NIDO's roadmap
   principle ("don't rewrite mature components to raise the original-code
   percentage") cuts both ways: don't import complexity NIDO doesn't need.
3. **New location/places surface.** Offline POI packs + foreground GPS
   ("restaurants near me") expand the privacy surface of a privacy-first app.
   Their `locationPolicy.ts` is careful, but the *feature* needs the
   strictest justification before NIDO ever considers it.
4. **Eval circularity.** PR #14's judge and reference are both Claude (they
   disclose it). Frontier-as-judge is a useful signal, never ground truth —
   especially when marketing "offline" quality.
5. **iOS work (PR #3).** Swift native modules, iOS build docs — irrelevant to
   NIDO's Android-first roadmap; reference only.
6. **The phone-browser download flow** in `docs/OFFLINE_INSTALL.md`. Honest
   about the trust boundary (the browser downloads, the app verifies), but
   clunky UX. Adopt the *verifiability*, not the flow.

## Notes / observations

- `main` is otherwise quiet: latest commit `9898b35e` (2026-09-26, "release
  smoke test and published v1.0.0"); `pushed_at` 2026-09-27T10:52:44Z
  reflects the v1.0.0 release publication, no newer code.
- Issue #12 (open, no comments): user feedback that Gemma 4 LiteRT "runs
  crazy fast" vs BOAR at ~20 tok/s feeling "like a step back in time".
  Datapoint for NIDO: on-device tok/s expectations are rising; track tok/s
  targets in the qualification suite (Priority 8).
- The fork's `scripts/` show a consistent habit worth copying: every claim
  gets a script (`verify-manifest-pins.mjs`, `audit-offline-apk.sh`,
  `netaudit.sh`). NIDO's "BUILD LESS. VERIFY MORE." is the same instinct —
  meet it with the same tooling density.
