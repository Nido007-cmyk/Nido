# NIDO rebrand branch — merge-readiness report

**Date:** 2026-09-27
**Branch:** `ui/rebrand-nido-identity` @ `13ccb5c`
**Merge target:** `master` @ `b4b7bf1`
**Merge base:** `47c5dd0` (the T-007 device-tested commit)
**Method:** trial merge in a throwaway worktree (detached HEAD), `--no-commit --no-ff`.
Neither real branch was modified. Worktree removed after analysis.

## Result: 0 textual conflicts

`git merge` auto-merged every file. Unmerged paths: **0**.

- Files changed on master since base: **59**
- Files changed on rebrand side since base: **24**
- Files touched by **both** sides: **3** — `src/i18n/locales/{en,es,pt}.json` only,
  all auto-merged cleanly.

### i18n key-level analysis (all three locales)

Flattened-JSON comparison of base → rebrand vs base → master:

- Rebrand added 48 keys per locale (Tier 2 UI copy, `modelLoadErrorCard.*`, theme strings).
- Master added 10 keys per locale (P1 confirm/pair copy, P2 `insufficientStorage`).
- Keys added by both: **0**. Keys changed by both: **0**. Value conflicts: **none**.
- Merged locale files validated as well-formed JSON.

## Verification of the merged tree

Ran inside the throwaway worktree (node_modules symlinked, read-only):

- `npx tsc --noEmit`: **CLEAN**
- `npm test`: **817/817 PASS** (66 files)

The merge is mechanically clean and functionally green at unit/integration level.

## Risk areas

### 1. P1/P2 overlap: NONE

The rebrand touches **zero** security/reliability files. It does not modify:
`src/agent/tools/` (confirm.ts, handlers.ts, manifest.ts, approval tools),
`src/p2p/` (store, messenger, crypto, approvalInbox),
`src/models/ModelManager.ts`, `downloadErrors.ts`, `installState.ts`,
`src/diagnostics/security.ts`, `src/notify/`, `src/services/appReset.ts`,
`src/inference/`.

Rebrand file surface is confined to: `src/ui/**` (screens, theme, components),
`src/models/settings.ts` (ThemeId narrowing only), and the three locale files.

### 2. Semantic integration point — error card vs P2 taxonomy (FOLLOW-UP, not a blocker)

`diagnose()` in the rebranded `src/ui/components/ModelLoadErrorCard.tsx`
classifies errors into `corrupt` / `missing` / `memory` / `general` by substring.
P2 introduced the `insufficientStorage` code (kind `resource`) whose mandated
user message is "free up space", never "network error". There is **no `storage`
branch** in `diagnose()`, so a disk-full failure would fall through to the
`general` category and lose the specific recovery guidance.

Recommended post-merge fix (small, isolated): add a `storage` branch to
`diagnose()` plus `modelLoadErrorCard.storage.{title,detail,recommendation}`
i18n keys in EN/ES/PT, with targeted tests. Do not change the P2 taxonomy.

### 3. Theme narrowing (SAFE)

Rebrand narrows `ThemeId` from 5 values to `"daylight" | "nightgarden"` and
`getThemeId()` migrates persisted legacy ids (`midnight`/`amber`/`frontier`)
to `nightgarden`. Verified: **no remaining references** to the old ids anywhere
in `src/` outside the migration code. Dark-mode users keep a dark theme.

### 4. ChatHeader (rebrand) vs ChatScreen (master P1)

Composition relationship only: rebrand restyled `ChatHeader.tsx`; master P1
wired the confirmation dialog in `ChatScreen.tsx`. Typecheck and the full
suite pass. The native confirm-dialog path remains UNVERIFIED on device
(unchanged by this merge).

### 5. Visual verification

The rebrand remains **visually UNVERIFIED** — no device or screenshot review
of the merged result has happened. Tier 2 was approved as a design direction;
this merge does not constitute visual approval.

## Recommended merge strategy

1. **Merge now, before v42 integration prep.** v42 is 3D-only (writes to
   `staging/`, untracked) and does not interact with this merge. Merging the
   rebrand first gives v42's eventual asset-integration work the final UI.
2. Use `git merge --no-ff ui/rebrand-nido-identity` to preserve the lane as a
   merge commit (keeps the 13ccb5c checkpoint traceable).
3. **Pre-merge gates already satisfied:** trial merge clean, tsc clean, 817/817.
4. **Post-merge:** run `npm test` + `tsc` once on the real merge commit;
   then implement the `storage` branch follow-up (§2) as a small separate commit.
5. Visual sign-off on a real device/APK when available — the rebrand's
   Daylight/Night Garden rendering is still UNVERIFIED until seen.

## Verdict: READY-WITH-CAVEATS

**READY** because: zero textual conflicts, zero i18n key conflicts, zero
overlap with P1/P2 security/reliability files, and the merged tree is
provably green (tsc clean, 817/817 tests).

**CAVEATS** because:
- Post-merge follow-up required: `storage` branch in `ModelLoadErrorCard.diagnose()`
  for P2's `insufficientStorage` class (small, isolated, testable).
- The rebrand is visually UNVERIFIED until reviewed on a real device.
- Do not merge while intending to also push — pushes remain blocked by the
  GitHub suspension; this is a local-only merge.

Do NOT treat this report as visual approval or as authorization to distribute.
