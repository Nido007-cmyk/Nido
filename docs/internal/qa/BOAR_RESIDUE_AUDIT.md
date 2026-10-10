# BOAR residue audit — 2026-09-27

**Status:** AUDIT + REMOVAL STAGED IN WORKING TREE. No commit, no push (CI run
36357101406 still running at time of writing).

**Owner directive (2026-09-27):** keep BOAR **only where legally required**.
The MIT copyright notice lines in `LICENSE` are the legal condition and stay.
Everything else — including the previously planned factual "Forked from BOAR"
credit line — is removed.

**Method:** case-insensitive `grep -r "boar"` over the repo excluding
`node_modules`, `.git`, conformance vectors. False positives (`keyboard`,
`clipboard`, `onboarding`, `dashboard`) filtered. 182 files matched overall;
the actionable set below excludes CI logs, APK artifacts, corpus data and
historical docs (classified, not changed).

## Classification

- **(a) LEGALLY REQUIRED — kept:** MIT copyright notice lines in `LICENSE`
  (byte-identical, untouched). This is the single enforceable condition.
- **(b) PROVENANCE CREDIT — removed per owner directive:** the planned
  "Forked from BOAR" line in AboutScreen was NOT added; no in-app credit
  remains. Historical mentions in repo docs (README, ARCHITECTURE, TRIAGE,
  review docs) stay as written history — they are not in the app and not
  branding.
- **(c) ACCIDENTAL/IDENTITY — removed:** everything below.

## Removed / replaced (working tree, uncommitted)

| # | File | Hit | Action |
|---|---|---|---|
| 1 | `src/ui/AboutScreen.tsx:35` | Hero title `BOAR` | → `NIDO` |
| 2 | `src/ui/AboutScreen.tsx:20` | `🐗` emoji header icon | Removed (Tier 2: zero emoji chrome) |
| 3 | `src/ui/AboutScreen.tsx:66` | `github.com/rferrari/boar-app` as repo identity | → `github.com/arsrs91-png/NIDO` |
| 4 | `src/constants/personalities.ts` (×3) | System prompts `"You are Boar, …"` (sent to the LLM — the assistant identified as Boar) | → `"You are Nido, …"` |
| 5 | `src/models/storageBudget.ts:40` (+ doc comment :13) | User-facing error `"Not enough room in BOAR's … storage budget"`; "Bytes BOAR already uses" comment | → `NIDO's` / `NIDO` |
| 6 | `src/ui/theme/colors.ts:4` | `BOAR Design System` comment | → `NIDO Design System` |
| 7 | `src/models/ModelManager.ts:59,62` | `BOAR stores` / `BOAR's offline assets` comments | → `NIDO` |
| 8 | `src/rag/packs.ts:81` | Pack format `"boar-knowledge-pack"` | → `"nido-knowledge-pack"`; reader accepts legacy `"boar-knowledge-pack"` so existing packs keep loading (embedding-SHA check unchanged) |
| 9 | `scripts/build-knowledge-pack.mjs:231` | Pack writer `format: "boar-knowledge-pack"` | → `"nido-knowledge-pack"` |
| 10 | `scripts/build-knowledge-pack.mjs:18` | `USER_AGENT = "BOAR-knowledge-pack-builder/1.0 (…boar-app)"` | → `NIDO-knowledge-pack-builder/1.0 (…arsrs91-png/NIDO)` |
| 11 | `src/rag/seedCorpus.ts` (×6) | Internal `__boarSeeding` / `__boarSeedListeners` | → `__nidoSeeding` / `__nidoSeedListeners` |
| 12 | `modules/download-wake-lock/index.ts:12`, `DownloadWakeLockModule.kt:50` | Wake-lock TAG `"BOAR:ModelDownload"` | → `"NIDO:ModelDownload"` |
| 13 | `src/rag/pure.test.ts` (×3 + comment) | `"You are Boar."` fixtures; "BOAR has no ability" comment | → `"You are Nido."`; "the upstream app" |
| 14 | `src/routing/classify.test.ts:41` | "action request BOAR has no tool for" | → "the upstream app" |
| 15 | `src/privacy/networkAudit.ts:17` | "BOAR had no network audit surface" | → "the upstream app" |
| 16 | `src/ui/ChatHeader.tsx:22` | `🐗 BOAR mascot` comment | → `NIDO mascot` |
| 17 | `package.json:4` | Spanish description "…Fork de BOAR (MIT)…" | → English NIDO description, no BOAR |
| 18 | `assets/boar.png`, `assets/boar_app_avatar.png` | Dead mascot assets (zero code references) | **Deleted** |
| 19 | `scripts/setup.mjs`, `scripts/lib/setup-lib.mjs`, `scripts/push-knowledge-pack.mjs`, `scripts/eval-*.mjs`, `scripts/lib/eval-*.mjs` | Dev-CLI user-facing strings ("Install BOAR on your phone", "NIDO Device Evaluation", …) | → NIDO (functional constants/URLs untouched) |
| 20 | `Makefile:4` | `@echo "BOAR - Adaptive Local Intelligence"` | → `"NIDO - Your Offline Agent"` |
| 21 | `AGENTS.md` | "installing BOAR from source", "existing BOAR", `grep BOAR:ModelDownload` | → NIDO |

## Kept — with reason

| File | Hit | Why kept |
|---|---|---|
| `LICENSE` | MIT copyright lines (aoair contributors) | **Legally required.** The MIT condition. Untouched. |
| `src/models/manifest.ts:198,215,234` | Download URLs `raw.githubusercontent.com/rferrari/boar-app/…`, `github.com/rferrari/boar-app/releases/…wiki-vital5.sqlite` | **FUNCTIONAL — user decision required.** The app downloads the corpus/knowledge pack from these endpoints at runtime. Changing them without NIDO-hosted copies **breaks downloads**. See open decisions. |
| `src/models/pinnedSource.test.ts:52,55` | Same URLs as test fixtures | Fixtures pinning byte-exact upstream URLs; change together with manifest. |
| `android/app/build.gradle:101-106,123` | `BOAR_UPLOAD_*` gradle property names | Internal signing config; renaming requires coordinated CI-secret changes. Not user-visible. |
| `.github/workflows/android-apk.yml:23` | Comment "uses BOAR_UPLOAD_* keys" | Describes the property names above. |
| `scripts/setup.mjs:15` | `REPO = "rferrari/boar-app"` | **FUNCTIONAL.** Fetches latest release APK from that repo. Changing breaks the script until NIDO publishes releases. |
| `src/rag/packs.ts:81-86` | Legacy `"boar-knowledge-pack"` accepted by reader | Backward compatibility for already-built packs; documented in code. |
| Repo docs (`README`, `ARCHITECTURE`, `TRIAGE`, reviews…) | Historical "forked from / derived from BOAR" mentions | Written history, not app branding, not shipped in the APK. |

## applicationId — already NIDO, no decision needed

`android/app/build.gradle:90-92`:

```gradle
namespace 'team.nido.app'
applicationId 'team.nido.app'
```

The package identity is **already NIDO**. Install-as-update continuity on the
tablet is preserved — nothing to decide.

## CONFLICT FLAG — licensing branch vs owner directive

The isolated branch `855128bab` (`~/workspace/nido-app-licensing`,
`licensing/compliance-notices`) contains:

- `NOTICE` with **fork-disclosure-as-request** (non-binding, explicitly not an
  MIT condition), and
- an AboutScreen **"Forked from BOAR" provenance card**.

Both **conflict with the owner directive of 2026-09-27** ("keep BOAR only
where legally required"). On merge review, `NOTICE` must be revised to the
legally-required-only rule and the AboutScreen provenance card dropped (this
track already removed BOAR from AboutScreen in the main working tree; the
branch's version must be reconciled, not re-applied).

Note: the licensing branch also independently made the `personalities.ts`
"You are Boar" → "NIDO" and storage-budget message changes — those now overlap
with this track's working-tree changes; merge must not double-apply.

## Open decisions for the user

1. **Corpus/knowledge-pack download URLs** (`manifest.ts`): keep downloading
   from `rferrari/boar-app` (works today, but every install phones home to
   BOAR's GitHub for the corpus), or mirror `corpus-standard.json`,
   `corpus-full.json`, `wiki-vital5.sqlite` to `arsrs91-png/NIDO` (releases or
   raw) and repoint. Mirroring is the clean break; it needs the files published
   under NIDO first.
2. **`scripts/setup.mjs` `REPO` constant**: repoint to `arsrs91-png/NIDO` once
   NIDO publishes release APKs.

## Verification

- `npx tsc --noEmit`: **clean** (exit 0).
- No test or source references the deleted assets (`boar.png`, `boar_app_avatar.png`),
  the old `__boarSeed*` identifiers, or `"You are Boar"` (grep, 2026-09-27).
- `scripts/lib/eval-report.test.mjs` fixture updated alongside the
  "NIDO Device Evaluation" rename.
- Full test suite NOT re-run (per brief); tsc + reference greps only.
- Changes are **uncommitted in the working tree** — commit + push only after
  CI run 36357101406 finishes and its artifact is preserved.
