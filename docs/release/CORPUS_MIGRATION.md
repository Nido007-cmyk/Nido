# Corpus migration: runtime separation from the upstream project infrastructure (2026-09-27)

**Status (2026-09-28): PARTIAL/STOPPED — 0 of 3 artifacts anonymously
reachable on NIDO hosting; all 3 reverted to temporary upstream endpoints
(proven working, byte-exact, SHA-256 verified).**

2026-09-28 correction (parent agent): `scripts/verify-manifest-pins.mjs`
(the upstream project idea #2, now wired into CI as `npm run verify:pins`) proved that the
NIDO release asset for `wiki-vital5`
(`releases/download/corpus-v1/wiki-vital5.sqlite.2`) returns **404
anonymously** — HEAD, ranged GET and full GET all fail, because the NIDO repo
is **private**. The earlier "genuinely migrated ✅" claim is retracted as a
*runtime* claim: the file is byte-identical and SHA-verified (verified via
authenticated API after the owner's upload), and it is preserved as a release
asset for the day the repo/releases go public — but it cannot serve anonymous
runtime downloads today. `wiki-vital5` was therefore reverted to the upstream
release URL (`github.com/rferrari/boar-app/releases/download/knowledge-pack-v1/wiki-vital5.sqlite`),
which returns 200 anonymously and serves byte-exact content matching the
manifest sha256. Same TEMPORARY status as the two JSONs.

2026-09-27 correction (parent agent): the "COMPLETE" claim above was
premature and is retracted. The two JSON mirrors were committed to the NIDO
repo (tag `corpus-v1-data`, commit `11b14ff5…`) and are byte-identical as git
objects — but the NIDO repo is **private**, so
`raw.githubusercontent.com/arsrs91-png/NIDO/11b14ff…/…` returns **404
without authentication** (verified 2026-09-27). Those URLs were never proven
as anonymous runtime endpoints, and the 88/88 unit tests do not test public
accessibility. They must NOT ship in a build.

**Current state (2026-09-27):**
- `wiki-vital5` → NIDO release asset ✅ (`releases/download/corpus-v1/wiki-vital5.sqlite.2`,
  SHA-256 verified after owner upload). This one is genuinely migrated.
- `corpus-standard`, `corpus-full` → **reverted to the upstream endpoints**
  (`raw.githubusercontent.com/rferrari/boar-app/9898b35e…/assets/corpus/…`),
  which return 200 anonymously and serve **byte-exact** content matching the
  manifest sha256 (re-verified 2026-09-27 by downloading the pinned URLs and
  hashing). TEMPORARY until public, immutable NIDO hosting exists for these
  two files. Integrity is host-independent: ModelManager verifies sha256
  after every download.
- Full migration completes only when all three artifacts sit on public,
  immutable, anonymously-downloadable NIDO infrastructure with the bytes
  proven from an unauthenticated fetch.

2026-09-27 final update: the owner uploaded `wiki-vital5.sqlite` to the
`corpus-v1` release (asset `wiki-vital5.sqlite.2`, 163,647,488 B). Downloaded
back via the API and SHA-256-verified: `d3b87d56…cc666` MATCHES the manifest.
`src/models/manifest.ts` now points all three corpora at NIDO-controlled,
immutable locations (two via pinned commit `11b14ff5…` under tag
`corpus-v1-data`, one via release asset). **Zero `rferrari/boar-app` runtime
URLs remain in the manifest** (only provenance comments reference the former
source, as required). Test suite: 88 passed (models/network/rag), `tsc` clean.
Manifest change is UNCOMMITTED — no push until build 36357101406 is preserved.

2026-09-27 update (parent agent): the release-asset upload path stayed blocked
from the sandbox (HTTP 401 on `uploads.github.com`), so the two small corpora
were mirrored a different way — committed to the NIDO repo itself under a new
immutable tag `corpus-v1-data` (commit `11b14ff51f83eff0ae1075a59953488673be7094`,
parent `aad6aaf0`, via the Git Data API, which works from this environment).
Byte-identity proven by downloading both blobs back through the API and
matching SHA-256 against the manifest (both MATCH). `src/models/manifest.ts`
now points `corpus-standard` and `corpus-full` at
`https://raw.githubusercontent.com/arsrs91-png/NIDO/11b14ff51f83eff0ae1075a59953488673be7094/corpus/<file>`
(pinned to the commit SHA — immutable). Targeted tests green
(manifest/pinnedSource/verifyChecksum: 16; network+rag: 59) and `tsc` clean.
Manifest change is UNCOMMITTED (no push until build 36357101406 is preserved).

The original §5 "STOPPED at the publish step" below is now superseded for
`corpus-standard` and `corpus-full`. It still applies to `wiki-vital5`
(163,647,488 B): too large for git (100 MB limit), release-asset upload
blocked from sandbox. Owner has the file locally; remaining step is uploading
it to the `corpus-v1` release from a logged-in browser, then the parent
verifies SHA-256 from the new URL, swaps the manifest URL, and re-runs tests.

## 1. Artifacts identified (all fetched from the upstream project infrastructure at runtime)

| id | kind | original sourceUrl | size (B) | sha256 (manifest) |
|---|---|---|---|---|
| `corpus-standard` | corpus json | `https://raw.githubusercontent.com/rferrari/boar-app/main/assets/corpus/corpus-standard.json` (pinned rev `9898b35e92bf42984a62c62a1d5f4b5895372b27` via `pinnedSourceUrl`) | 614,084 | `2aeff76db48098851e1304fb37dc8013d9facf9214395897e7e05f276f85d2ff` |
| `corpus-full` | corpus json | `https://raw.githubusercontent.com/rferrari/boar-app/main/assets/corpus/corpus-full.json` (same pinned rev) | 2,530,725 | `6d602003bb9da59200e3e55b75b9e15bb073a4b9b1357da2c2d47b2803c570be` |
| `wiki-vital5` | sqlite-pack | `https://github.com/rferrari/boar-app/releases/download/knowledge-pack-v1/wiki-vital5.sqlite` (immutable release asset) | 163,647,488 | `d3b87d562baba3489f6878bf99783f50d504db94c347029771e53f6d1aecc666` |

No other runtime URL in `src/models/manifest.ts` points at the upstream project infrastructure
(the 6 model weights come from Hugging Face; verified in Track C).

## 2. Byte preservation + verification (done)

Downloaded 2026-09-27 to `docs/ci-evidence/corpus-migration/`:

| file | size on disk | sha256 of downloaded bytes | matches manifest? |
|---|---|---|---|
| `corpus-standard.json` | 614,084 | `2aeff76d…85d2ff` | ✅ exact |
| `corpus-full.json` | 2,530,725 | `6d6020…570be` | ✅ exact |
| `wiki-vital5.sqlite` | 163,647,488 | `d3b87d56…cc666` | ✅ exact |

Content was **not** modified in any way (no re-encoding, no re-zipping).

## 3. Redistribution clearance (independently confirmed, not just reusing Track C)

All three packs are **verbatim, unmodified copies of Wikipedia-derived works
licensed CC BY-SA 4.0**. CC BY-SA 4.0 §3 permits sharing verbatim copies
provided attribution is given; no ShareAlike trigger fires because nothing is
adapted. Attribution is preserved three ways:
1. per-document `source` fields inside the packs (`"Wikipedia — https://en.wikipedia.org/wiki/…"`);
2. the app's chat UI renders `SourceFootnotes` citations (existing behavior);
3. the NIDO release notes (below) carry the license statement + link + © Wikipedia contributors notice.

Verdict per artifact: **cleared for mirroring** — no artifact was stopped on legal grounds.

## 4. NIDO hosting prepared (release created, assets pending)

- **Release:** `arsrs91-png/NIDO` → tag **`corpus-v1`** (release id `397860675`,
  target `master`, not a draft): https://github.com/arsrs91-png/NIDO/releases/tag/corpus-v1
- Release notes include: original source per file, SHA-256 per file, CC BY-SA 4.0
  license statement + link, © Wikipedia contributors attribution, and the
  purpose statement (operational independence; content unchanged, only the
  download origin moves).
- Creating the tag did **not** trigger the Android APK workflow (it fires only
  on `master` branch pushes with build-path filters — verified: no new run).
- **Assets uploaded: 0 of 3** — blocked, see §5.

Planned immutable URLs (once assets are uploaded):
- `https://github.com/arsrs91-png/NIDO/releases/download/corpus-v1/corpus-standard.json`
- `https://github.com/arsrs91-png/NIDO/releases/download/corpus-v1/corpus-full.json`
- `https://github.com/arsrs91-png/NIDO/releases/download/corpus-v1/wiki-vital5.sqlite`

GitHub Release asset URLs are immutable (tied to the release); no `revision`
pinning needed afterward.

## 5. Blocker: asset upload (technical, not legal)

**Symptom:** `POST https://uploads.github.com/repos/arsrs91-png/NIDO/releases/397860675/assets?name=<file>`
returns `HTTP 401 {"message":"Bad credentials"}` on every attempt (retried;
small 614KB file and the same code path fail identically, so it is not a
size/timeout issue).

**Diagnosis:** the sandbox's GitHub credential (`custom.github` surrogate,
swapped for the real PAT at egress) is honored on `api.github.com` (release
creation succeeded) but **not** on `uploads.github.com` — a control GET to
`https://uploads.github.com/` returns 200 with no auth at all, proving the
earlier "200 = authenticated" reading false and the 401 genuine. The upload
script (`/tmp/upload_asset.py`, reuses the approved `dynamic_credentials`
flow) is correct; the credential simply has no scope on the upload host from
this environment.

**Not attempted (out of scope / unsafe):** extracting the raw PAT (forbidden),
`gh auth login` (needs interactive login / raw token), committing the 164MB
sqlite through git (exceeds GitHub's 100MB per-file hard limit), chunking the
sqlite (breaks the single-file SHA-256 contract and would need download-code
changes).

## 6. Resume procedure (for the parent agent / owner)

1. **Upload** the 3 verified files from `docs/ci-evidence/corpus-migration/`
   to release `397860675` — easiest path: drag-drop onto
   https://github.com/arsrs91-png/NIDO/releases/tag/corpus-v1 in a logged-in
   browser (owner), or any environment whose GitHub token reaches
   `uploads.github.com`.
2. **Verify**: download each asset from the §4 URLs, `sha256sum`, compare to
   the table in §2 (must match exactly).
3. **Manifest** (`src/models/manifest.ts`, working tree only — no commit/push
   until build `36357101406`'s artifact is preserved): replace the three
   `sourceUrl`s with the §4 URLs; drop the now-stale `revision` fields and
   Q-2 pin comments on the two JSONs (release-asset URLs are immutable);
   keep `sha256`/`sizeBytes` unchanged (they must still match — that is the
   byte-identity proof); keep the `CC BY-SA 4.0 (Wikipedia)` license labels.
4. **Tests**: `npx tsc --noEmit`, then the targeted subset —
   `src/models/manifest.test.ts`, `src/models/pinnedSource.test.ts`,
   `src/models/verifyChecksum.test.ts`, `src/privacy/networkAudit.test.ts`,
   `src/privacy/networkAudit.limits.test.ts`, `src/rag/pure.test.ts`,
   `src/rag/retrieve.lexical.test.ts`, `src/rag/retrieve.relevance.test.ts`
   (vitest run with these paths). Full suite only if time permits.
5. **Byte-identity proof**: the unchanged `sha256` values passing
   `verifyChecksum` against the new URLs *is* the proof — record the test
   output in this doc.
6. Commit + push only after the running build's artifact is preserved.

## 7. What was NOT done (deliberately)

- Manifest URLs unchanged — current downloads keep working; zero runtime risk.
- No commit, no push (build `36357101406` untouched, still `in_progress`).
- No content changes to any pack; no attribution removed anywhere.
- The 6 Hugging Face model URLs were not touched (not the upstream project infrastructure;
  their `/resolve/main/` drift is a separate, already-documented issue).
