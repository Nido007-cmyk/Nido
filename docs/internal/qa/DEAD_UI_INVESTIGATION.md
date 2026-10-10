# Dead-UI investigation — UsageStats / SystemMonitor (2026-09-27)

**Status:** INVESTIGATION ONLY. No files deleted yet. Recommendation below; deletion
is a staged code change for the next implementation batch.

**Re-verified 2026-09-27 (independent re-run):** all claims below re-checked with a
fresh full-`src` reference search. All four verdicts confirmed unchanged. No test
file references either dead component, so removal is unblocked test-wise.

## Method

Full-`src` reference search for each component (imports + navigation registry).

## Findings

| Component | Referenced from | In navigation? | Verdict |
|---|---|---|---|
| `src/ui/SystemMonitor.tsx` | **nothing** | no | **REMOVE** |
| `src/ui/UsageStatsScreen.tsx` | **nothing** (only itself) | no | **REMOVE** (wrapper only) |
| `src/ui/UsageStatsContent.tsx` | `ModelSetupScreen.tsx` (live) | n/a (embedded) | **KEEP** |
| `src/ui/DrawerFooterStats.tsx` | `Drawer.tsx` (live) | n/a (embedded) | **KEEP** |

## Evidence & reasoning

### SystemMonitor → REMOVE
- Zero imports, zero navigation entries: unreachable code, confirmed dead.
- Original intent (BOAR-era): RAM/storage "budget" bars (`RAM_BUDGET_BYTES`,
  `STORAGE_BUDGET_BYTES` from the model manifest).
- It is **superseded by design**: the Offline Center spec (`../specs/OFFLINE_CENTER_SCREEN.md`)
  covers storage with honest Tier 2 copy ("numbers, not gauges"). Two surfaces for
  the same numbers would be duplication.
- Its vocabulary ("budget", bounty-era caps) conflicts with the frozen Tier 2
  direction (compare vs device, no bounty language).

### UsageStatsScreen → REMOVE (wrapper), keep content
- The screen wrapper is unreachable (not in any navigator).
- The actual stats UI (`UsageStatsContent`) is **live** inside `ModelSetupScreen`
  and stays there — Tier 2 keeps per-run stats (tok/s, TTFT, peak memory) with
  Export/Clear.
- Removing the wrapper loses nothing the user can reach today.

### Kept as-is
- `UsageStatsContent.tsx` — live in the setup flow.
- `DrawerFooterStats.tsx` — live in the drawer.

## Staged change (not yet applied)

```bash
git rm src/ui/SystemMonitor.tsx src/ui/UsageStatsScreen.tsx
```

Verify after removal: `tsc` clean, full test suite green, no new dead imports.
If any test imports the removed files, the removal is blocked pending test updates —
do not force it.
