# NIDO — Rebrand pre-merge audit (analysis only, 2026-09-27)

Branch: `ui/rebrand-nido-identity` → current master. No merge performed.
No branch or master ref was modified. Trial merges were done in throwaway
worktrees under /tmp (deleted afterwards).

## PROVEN

- Trial merge of `ui/rebrand-nido-identity` into current master HEAD was
  executed in a throwaway worktree: **3 content conflicts, all in the i18n
  locale files** (`src/i18n/locales/{en,es,pt}.json`). All three are
  positional (both sides appended new sections at the same insertion
  point). **0 overlapping added keys, 0 changed-value conflicts** across
  all three locales (verified by key-level diff against the merge base).
- A key-level union resolution of the three locale files was constructed
  programmatically and validated: JSON valid, **`npx tsc --noEmit` clean,
  full suite 829/829 PASS** on the resolved merged tree.
- The branch touches **zero** security/P2P/model/storage/dependency files.
  All P1 (M-3/M-4/M-5/M-6), P2 (journal, SHA-256, staging, atomic promote),
  SecureStore, Clear All Data, CSPRNG, and bb02d1a i18n behavior is
  byte-identical between master and the merged tree.
- Correction to the earlier quick review (docs/qa/REBRAND_MERGE_READINESS.md,
  run against master b4b7bf1): it reported 0 conflicts. Against current
  master bb02d1a there are 3 (all locale, all mechanical). The earlier
  "ModelLoadErrorCard lacks a storage branch" finding is a **pre-existing
  master gap, identical on both sides** — verified line-by-line that
  `diagnose()` is the same function on branch and master. The merge
  neither fixes nor regresses it.

## BRANCH STATE

- Branch name: `ui/rebrand-nido-identity`
- Branch HEAD: `13ccb5c83e4a7e25dc472ac16def612ce26a303d`
- Master HEAD: `bb02d1ac9366eb0a3b666fc835aca5f6170b9321`
- Merge base: `47c5dd003c9d72c4f39b9ca428df7cd3bc192b77`
- Commits unique to branch: **1**
- Commits unique to master: **20** (P1 security x4, P2 reliability x6,
  i18n bb02d1a, expo-dev-client removal ee8e12e, docs x4, eval/RAM
  harness, CSPRNG/session-restore f20bbb8, economic research, audit
  hardening 1f1f65b)
- Stale files on the branch: only the 3 locale files. They predate P2's
  `downloadErrors` keys (9e5aaea), bb02d1a's `agentTasks`/`p2p`/
  `agentConfirm.pairBinding*`/`common.confirm` keys. The branch does **not**
  hold old versions of any P1/P2 implementation file — it never touches
  `src/agent/`, `src/p2p/`, `src/security/`, `src/services/`, or any model
  installation file.

## COMMITS

Single unique commit:

- `13ccb5c` — `ui(brand): NIDO identity rebrand — Daylight/Night Garden
  themes, own prompts, brand mark`
  - Purpose: apply the frozen Tier 2 visual direction (Daylight primary,
    Night Garden dark) across the app; replace the provisional mascot with
    the approved golden-ring+sprout launcher icon; rewrite UI copy in a
    plain-language NIDO voice with EN/ES/PT parity; replace six
    the upstream project-inherited benchmark prompt ideas with six NIDO-original
    offline-first prompts sourced from i18n.
  - Major surfaces: 18 `src/ui/**` screens/components, `src/ui/theme/`
    (colors.ts, index.ts), `src/models/settings.ts` (ThemeId), 3 locale
    files.
  - Mixing assessment: the commit mixes UI rebrand with one deliberate
    behavior change — `ThemeId` narrowed from 5 ids to 2 with legacy-id
    migration (`midnight`/`amber`/`frontier` → `nightgarden`). This is an
    intended part of the authorized Tier 2 direction, not an unrelated
    behavior change. No security, P2P, inference, licensing, dependency,
    or native-config changes (stated in the commit message and verified
    by file list).

## FILE DIFF

24 files changed vs merge base. Grouped:

- **UI/components (18)**: AboutScreen, AccordionSection, CatalogItemCard,
  ChatHeader, Drawer, DrawerFooterStats, EvaluationScreen,
  ExecutionTelemetryScreen, KnowledgeBaseScreen, NidoScreen,
  ProcessingIndicator, PromptIdeasCarousel, SystemMonitor,
  UsageStatsContent, UsageStatsScreen,
  components/ModelLoadErrorCard, components/SourceFootnotes,
  components/ThemeSelector. Pattern is uniform: static
  `import { colors } from "./theme/colors"` → `useTheme()` +
  `getStyles(colors)` so Night Garden applies at runtime; copy moved to
  friendlier tone via i18n keys.
- **Themes/design tokens (2)**: `src/ui/theme/colors.ts` (midnight/amber/
  frontier palettes removed; daylight + nightgarden only; `getThemeColors`
  switch reduced; `migrateLegacyThemeId` added),
  `src/ui/theme/index.ts` (exports narrowed accordingly).
- **Settings (1)**: `src/models/settings.ts` — ThemeId narrowed; `getThemeId()`
  migrates legacy stored ids to `nightgarden`; fresh installs default to
  `daylight`.
- **Localization (3)**: `src/i18n/locales/{en,es,pt}.json` — 84 existing
  values rewritten (friendlier tone, full ES/PT parity), 48 keys added
  (`themeSelector`, `usageStats`, `promptIdeasCarousel.items`, etc.),
  0 keys removed.
- **Navigation**: none (Drawer is a component; navigation structure
  unchanged).
- **SetupWizard**: none. **Activity**: none. **Chat**: ChatHeader only
  (theme + brand mark). **Android/native config**: none. **Dependencies/
  package files**: none. **Model installation**: none. **Security/P2P**:
  none. **Storage/database**: none. **Tests**: none. **Documentation**:
  none. **Assets**: none added/removed/replaced (branch references the
  already-approved `assets/icon-nido.png`).

## CONFLICTS

Three conflicts, one per locale file, all the same shape:

- **Why**: at one insertion point, master (bb02d1a) added the
  `agentTasks` + `p2p` sections while the branch (13ccb5c) added the
  `themeSelector` + `usageStats` sections. Git cannot order two
  independent additions at the same location.
- **Newer security/reliability behavior**: the master side. It carries
  P1/P2/i18n keys (`agentTasks.*`, `p2p.sendChat*`,
  `agentConfirm.pairBinding*`, `downloadErrors.*`, `common.confirm`).
  The branch side carries only new UI copy sections.
- **Overwrite risk**: none from the rebrand itself — the branch adds 0
  keys that master also added, and changes 0 values that master also
  changed. The risk is purely in manual resolution: a careless resolution
  that keeps only one side would silently drop either the security keys
  (master side) or the new UI copy (branch side).
- **Safest resolution**: keep both blocks (key-level union). This exact
  resolution was constructed and validated: tsc clean, 829/829. The
  English-fallback behavior means even a dropped key would render English
  rather than a raw key, and the migratedStrings tests would fail loudly
  on missing security keys.
- Do NOT resolve yet (per directive). No other file conflicts: all 21
  non-locale files auto-merge (master changed none of them except
  ChatScreen.tsx, whose T-008 session-restore + i18n button-label changes
  sit in different regions and merged cleanly).

## SECURITY IMPACT

Inspected each named surface; branch touches none of them:

- `withConfirmation()`, sensitive tool list, `nido_pair`,
  `pairingBindingWarning()`, `resolveContactByName()`, approval inbox,
  `agent_task` state transitions, SecureStore fail-closed, DB encryption
  key handling, P2P identity handling, Clear All Data, scheduled
  notification deletion, CSPRNG message IDs — all live in
  `src/agent/`, `src/p2p/`, `src/security/`, `src/services/`, which the
  branch does not touch (verified by file list).
- `ModelLoadErrorCard.diagnose()`: verified line-by-line identical on
  both sides — same categories (`corrupt`/`missing`/`memory`/`general`),
  same match logic. The missing `storage` branch is a pre-existing master
  gap (P2's `insufficientStorage` falls through to `general` on master
  today); the merge preserves the gap exactly. Not a regression; remains
  a recommended post-merge follow-up.
- `pairingBindingWarning()` strings: the branch predates the bb02d1a
  `agentConfirm.pairBinding*` keys; the merge keeps master's keys
  untouched. Branch changed 84 copy values, none in any security-semantic
  section.
- ThemeId narrowing: `getThemeId()` migrates legacy ids; tsc clean on the
  merged tree proves no dangling references to removed palettes; no
  settings/security test broke (829/829).
- **Verdict: no security regression introduced by the rebrand.**

## P2 IMPACT

- Branch touches no P2 file: ModelManager, installState journal,
  `.partial`/staging logic, DownloadResumable handling, resume tokens,
  streaming SHA-256, size verification, atomic promotion, `statusOf()`,
  manifest pins/hashes, model/corpus URLs, storage pre-flight, progress
  semantics, recovery/error taxonomy — all untouched.
- Only P2-adjacent surface is `ModelLoadErrorCard` copy (titles/details/
  recommendations rewritten in friendlier tone; categories and routing
  logic unchanged) and `UsageStatsContent` storage-segment labels
  (labels only; data-source calls `getAppPeakRssBytes`,
  `getDeviceTotalRamBytes`, `getFreeDiskStorageAsync`,
  `getLastQueryStats`, `getMemoryInfo`, `getModelInfo` verified identical
  on both sides).
- `downloadErrors.*` keys (P2 taxonomy UI strings) are master-side and
  preserved by the merge.
- **Verdict: no P2 regression.**

## DEPENDENCY/CONFIG IMPACT

- Branch changes **nothing** in package.json, package-lock.json,
  app.json, eas.json, android/, tsconfig, or test config.
- No dependency additions, removals, or version changes from the branch.
- Stale expo-dev-client references: the branch tree contains only
  pre-existing doc mentions (AGENTS.md, ARCHITECTURE.md, android-apk.yml)
  inherited unchanged from the base; the branch does not reference the
  package in code or config. Master's ee8e12e (package removal) applies
  cleanly — no conflict, nothing reintroduced. No APK/native graph change.
- applicationId: untouched (`team.nido.app` in app.json, unchanged file).

## I18N IMPACT

- The branch holds older locale files missing master's 33 added keys
  (`agentTasks`, `p2p`, `agentConfirm.pairBinding*`, `downloadErrors`,
  `common.confirm`). The merge must keep master's keys — the validated
  resolution does.
- Zero overlapping added keys and zero changed-value conflicts across
  en/es/pt: no key would be silently overwritten in either direction.
- The branch's own copy work has full ES/PT parity (spot-checked:
  `drawer.subtitle` → "Tu agente. Tu mundo." / "Seu agente. Seu mundo.";
  6 prompt items in all three locales). No English-only gaps introduced.
- Master's T-008 ChatScreen change uses `t("common.confirm")`; the key
  exists in master's `common` section, which auto-merges (branch never
  touched `common` except no changes at all — branch kept base's
  `common.cancel: "Cancel"`, master added `confirm`).
- Master i18n/security behavior wins everywhere; no deliberate counter-
  reason found on the branch side.

## ASSET/BRAND IMPACT

- Assets: none added, replaced, or deleted by the branch. It swaps image
  references from `assets/nido-mascot-provisional.png` to the already-
  approved `assets/icon-nido.png` in Drawer header, ChatHeader, and About
  hero. The approved launcher icon is preserved, not redesigned.
- Visible app name: "NIDO" unchanged. Tagline becomes "Your agent. Your
  world." (ES/PT equivalents) — per the authorized Tier 2 direction.
- About screen: keeps the legally required factual attribution
  "Forked from BOAR (MIT License)." (now via i18n `aboutScreen.repoBody`);
  repo URL moved to i18n with unchanged value
  `github.com/arsrs91-png/NIDO`. No the upstream project runtime branding reintroduced;
  no operational dependency on the upstream project added.
- the upstream project references in `src/ui/`: identical counts branch vs master, except
  the branch's PromptIdeasCarousel replaces six the upstream project-inherited benchmark
  prompts with six NIDO-original offline-first prompts (i18n-sourced).
  Note: the "NIDO-original" claim is a code comment, not independently
  verified — informational only, no action needed.
- applicationId `team.nido.app`: unchanged.
- No v41/v42 3D integration in the branch. None added by this audit.

## TEST IMPACT

- Branch adds 0 tests, modifies 0, deletes 0.
- Merged tree (validated resolution): **67 files, 829/829 PASS** — the
  full master baseline is preserved and passing.
- No security or reliability test weakened or deleted; the rebrand has no
  test surface of its own.
- New-test total after merge: 829 (no legitimate new tests introduced by
  the rebrand).

## RISKS

- **MEDIUM** — `src/i18n/locales/{en,es,pt}.json`: manual resolution must
  keep both sides' added sections. A wrong resolution would silently drop
  master's P1/P2/i18n security keys (`agentConfirm.pairBinding*`,
  `agentTasks.*`, `p2p.sendChat*`, `downloadErrors.*`) or the branch's new
  UI copy. Mitigations: the key-level union resolution is already
  constructed and validated (tsc clean, 829/829); English fallback plus
  `migratedStrings.test.ts` would fail loudly on dropped security keys.
- **LOW** — 84 rewritten copy values (`modelLoadErrorCard.*`,
  `catalogItemCard.*`, `drawer.*`, etc.): tone changes only, no semantic
  or security behavior change; full ES/PT parity; categories and routing
  logic in `diagnose()` untouched.
- **LOW** — `src/models/settings.ts` ThemeId narrowing + legacy migration:
  deliberate Tier 2 change; tsc clean proves no dangling palette
  references; settings tests pass; persisted old ids map to Night Garden.
- **LOW** — PromptIdeasCarousel content swap (the upstream project-inherited → NIDO
  prompts): no test depends on old prompt text; reduces brand
  contamination; prompts are i18n-sourced EN/ES/PT.
- **LOW** — stale expo-dev-client mentions in docs (AGENTS.md,
  ARCHITECTURE.md, android-apk.yml): inherited from base on both sides,
  untouched by the branch; no code/config effect.
- **No HIGH. No BLOCKING.**

## PROPOSED MERGE PLAN (DO NOT EXECUTE)

1. Normal `git merge --no-ff ui/rebrand-nido-identity` into master (local
   only, no push). A plain merge is sufficient and safest: single coherent
   branch commit, 3 mechanical conflicts, zero semantic collisions. No
   cherry-pick or manual port needed — selective integration would only
   add risk of dropping the validated whole.
2. Resolve the 3 locale conflicts by key-level union (keep both blocks),
   using the already-validated resolution as reference.
3. Run gates: `npx tsc --noEmit`, full suite (expect 829/829), plus the
   targeted P1/P2/security suites.
4. Land the known post-merge follow-up as a separate small commit: add
   the `storage` branch to `ModelLoadErrorCard.diagnose()` with
   EN/ES/PT keys + tests (pre-existing gap, unchanged by this merge).
5. Device/screenshot review of the merged UI remains UNVERIFIED until the
   next APK on the Tab A9+.

## EXPECTED POST-MERGE GATES

- TypeScript clean — validated on the resolved tree.
- Full suite PASS — 829/829 validated on the resolved tree.
- 829-test baseline preserved; no security/reliability test deleted or
  weakened (branch adds none).
- P1 security suites PASS; P2 installation reliability suites PASS;
  streaming SHA suites PASS; manifest/pin verification PASS — all
  included in the 829 run on the merged tree.
- No applicationId regression (`team.nido.app` untouched).
- No the upstream project runtime branding regression (attribution preserved, no
  operational dependency).
- No unexplained dependency/native changes (branch changes none).
- New test total: 829 (branch introduces no tests).

## BLOCKERS

None technical. The only blocker is authorization: this audit was
analysis-only, and the merge itself requires explicit owner approval.

## NEXT RECOMMENDED STEP

Await explicit merge authorization. On approval: merge `--no-ff` locally,
resolve the 3 locale files with the validated key-union procedure, run
tsc + the full 829 suite, then land the `storage`-branch follow-up for
`ModelLoadErrorCard` as a separate commit. Do not push (GitHub appeal
pending).
