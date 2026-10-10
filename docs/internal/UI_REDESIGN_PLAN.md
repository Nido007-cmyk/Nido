# NIDO UI Redesign — Plan v1

**Date:** 2026-10-05
**Directive:** UI propia, profesional, que no se parezca a BOAR.
**Status:** APPROVED 2026-10-05 — Direction: 'Calm Agent' (airy, subtle mascot, memory transparency, agency receipt).

## Problem

NIDO's current UI (Tier 2: Daylight/Night Garden) has its own color system,
but the layouts, components, and interaction patterns still feel like BOAR:
- Chat-first layout with standard message bubbles
- Settings as long scrolling lists
- Model management as cards in a grid
- Generic drawer navigation

BOAR is a research/Q&A tool. NIDO is a personal agent. The UI should feel
like a personal assistant, not a search engine.

## Design Direction: "Calm Agent"

**Principles:**
1. **Agent, not app.** The UI should feel like talking to someone who knows
   you, not operating software. Warm, personal, calm.
2. **Privacy is visible.** The zero-network, encrypted nature should be felt
   in the UI — not as a badge, but as a calm confidence. No cloud spinners,
   no "syncing" states, no account avatars.
3. **Professional, not playful.** Clean typography, generous whitespace,
   subtle motion. Think premium productivity tools, not chat apps.
4. **Distinct from BOAR.** No research-paper aesthetic. No citation-heavy
   layouts as the default. No "query → results" pattern.

**Visual language:**
- **Typography:** System fonts, clear hierarchy. Large, confident headings.
  Body text optimized for reading (not dense like a research tool).
- **Color:** Keep the Tier 2 palette (Daylight/Night Garden are NIDO's own),
  but use it differently — more whitespace, less chrome, accent colors used
  sparingly for meaning (not decoration).
- **Shape:** Soft, rounded, approachable. Not sharp/technical like BOAR.
- **Motion:** Subtle, purposeful. The agent "thinks" visibly but calmly.
  No bouncy animations.
- **Layout:** Conversational first. Tools and settings are quiet, accessible
  but not prominent. The agent is the interface.

## Screen Redesign Priorities

### Phase 1: Core (highest impact)
1. **ChatScreen** — The main interface. Redesign as a calm conversation,
   not a chat app clone. Agent status visible but subtle. Memory indicators
   show what NIDO remembers (transparency).
2. **NidoScreen** — The home/agent dashboard. What does "your agent" look
   like when you're not chatting? Briefings, suggestions, memory overview.
3. **Settings** — Reorganize around user goals (Privacy, Memory, Voice,
   Models), not technical categories.

### Phase 2: Secondary
4. **ModelSetupScreen / SetupWizard** — First-run experience. Must feel
   welcoming and trustworthy, not technical.
5. **KnowledgeBaseScreen** — Personal library, not a "database". Warm,
   browsable, personal.
6. **MemorySettings** — Memory as a personal journal, not a database table.

### Phase 3: Tertiary
7. Remaining screens (Evaluation, Telemetry, Voice settings, etc.)

## What Changes vs Tier 2

**Keep:**
- Daylight/Night Garden color tokens (they're NIDO's own)
- Accessibility standards
- The NidoIcon system (already NIDO-specific)

**Change:**
- Layout patterns (not BOAR's card grids and dense lists)
- Component designs (custom, not generic RN)
- Navigation structure (agent-centric, not feature-centric)
- Micro-interactions (calm, not snappy)
- Empty states (warm and helpful, not technical)
- Error states (human language, per the tone guide)

## Implementation Approach

1. Create new design tokens (spacing, radius, shadows) in `src/ui/theme/`
2. Build new core components (`AgentMessage`, `MemoryChip`, `QuietButton`, etc.)
3. Redesign ChatScreen first (biggest impact)
4. Migrate other screens incrementally
5. Keep all existing functionality — this is a visual redesign, not a
   feature change. All tests must keep passing.

## Decisions (owner approved 2026-10-05)

1. **Mascot:** Subtle but present — empty states, chat avatar, loading. Not on every screen.
2. **Density:** Airy and calm. Generous whitespace. Not information-dense.
3. **Direction:** 'Calm Agent' — feels like talking to someone who knows you.

## Status

- [ ] Design direction approved by owner
- [ ] New design tokens created
- [ ] Core components built
- [ ] ChatScreen redesigned
- [ ] NidoScreen redesigned
- [ ] Settings redesigned
- [ ] All tests passing
- [ ] Visual review
