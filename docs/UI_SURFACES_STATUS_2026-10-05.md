# UI Surfaces Status — NIDO Calm Agent Direction

**Date:** 2026-10-05  
**Design Direction:** Calm Agent (airy, generous whitespace, soft shapes, subtle motion)

## Completed

### Accessibility (a11y)
Added `accessibilityRole="button"` and `accessibilityLabel` to close/done buttons in:
- AboutScreen.tsx
- EvaluationScreen.tsx
- ExecutionTelemetryScreen.tsx
- KnowledgeBaseScreen.tsx
- UsageStatsScreen.tsx

Screens with existing a11y:
- ChatScreen.tsx (6 labels: rate up/down, show/hide reasoning, copy, stop)
- KeyLossRecoveryScreen.tsx (6 labels)
- ModelSetupScreen.tsx (10 labels)
- NidoScreen.tsx (4 labels)
- SetupWizardScreen.tsx (16 labels)

### Design System
Calm tokens available in `src/ui/theme/calm.ts`:
- calmSpacing (tight/cozy/comfortable/airy/spacious/generous)
- calmRadii (subtle/moderate/ample)
- calmShadows
- calmTypography extensions

ChatScreen uses Calm tokens for message bubbles (asymmetric design).

### Component Tests (Jest)
- `src/ui/smoke.component.test.tsx` — basic smoke test
- `src/ui/ChatScreen.component.test.tsx` — tests TestMessageItem harness (not full ChatScreen)

## Pending (Deliberately Deferred)

The following screens are functional but have not undergone full Calm redesign:
- AboutScreen, EvaluationScreen, ExecutionTelemetryScreen, KeyLossRecoveryScreen,
  KnowledgeBaseScreen, ModelSetupScreen, NidoScreen, SetupWizardScreen, UsageStatsScreen

**Reason:** Full visual redesign of 10 screens requires design review and visual
verification (screenshots/emulator) which is not available in this environment.
The screens are functional, accessible (labels added), and use the existing
theme system. They are NOT broken.

**Calm components (staged, NOT integrated):**
- `src/ui/components/calm/AgencyReceipt.tsx`
- `src/ui/components/calm/AgentMessage.tsx`
- `src/ui/components/calm/MemoryChip.tsx`

These require H-15 (i18n: EN/ES/PT keys for hardcoded strings) before integration.
Per directive: DO NOT integrate just to mark phase complete.

## Honest Classification

- **Implemented:** All screens render, navigation works, accessibility labels present
- **Not claimed:** "Fully redesigned in Calm style" — only ChatScreen has full Calm treatment
- **Staged:** Calm components awaiting H-15 i18n

## Next Steps (requires design review)
1. Visual review of each screen (screenshots)
2. Apply Calm spacing/radii/shadows systematically
3. Full Jest component tests with real screen imports (not harnesses)
4. H-15: Add i18n keys for Calm components, then integrate
