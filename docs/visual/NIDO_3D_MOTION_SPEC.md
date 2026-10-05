> **Language:** English · [Español](../es/visual/NIDO_3D_MOTION_SPEC.md)

# NIDO 3D Motion Spec — v2.0

**Date:** 2026-09-27
**Normative:** `NIDO_3D_VISUAL_SYSTEM.md` §6 + `NIDO_3D_Character_Design_System_v2.pdf` (§6–7).
**Status:** specification; no motion clip exists yet (PENDING).

---

## 1. Principles

- Only visible operational state; **never** represent internal reasoning.
- The core may anticipate a state change **80–150 ms before** the body.
- Avoid restless loops suggesting the agent is "watching" the user.
- In Error: slight concern; never terror or guilt.
- In Talking: simple animated mouth; avoid hyperrealistic human lip-sync.

## 2. Normative timings

| Type | Duration |
|---|---|
| Idle (near-imperceptible breathing) | 2–5 s loop |
| State transitions | 180–450 ms |
| Expressive actions | 500–1200 ms |
| Core anticipation | 80–150 ms before the body |

## 3. The 8 states

| State | Body / face | Core | Sprout | Notes |
|---|---|---|---|---|
| **Idle** | minimal breathing | stable | rest | 2–5 s loop, near imperceptible |
| **Listening** | slight tilt | cool/soft | — | no exaggerated gestures |
| **Thinking** | contained gaze/pose | slow pulse | rest | active pause |
| **Working** | deliberate movement | pulse or flow around the core | rest | contained activity |
| **Talking** | simple animated mouth | stable | — | no hyperrealistic lip-sync |
| **Completed** | brief micro-celebration | warm | upright | 500–1200 ms, then back to Idle |
| **Offline** | serene, dimmed | faint or off | softly drooped | dignified, not "dead"; local remains available |
| **Error** | minimal contraction, sober tone | faint, no alarming blink | rest | no alarmism |

**9th operational app state** (`waiting for approval`, from v0.3): expectant
pause directed at the user — expectant posture + slow core pulse. Implemented
by reusing existing rigs, not as a new expression.

## 4. Reduced Motion

- Remove bounce, floating, and parallax.
- Keep discreet light/pose changes.
- States are communicated via static shape/color.
- Each state must have an approved static alternative.

## 5. Prohibitions

- Restless idle loops or "surveillance" micro-movements.
- Terror, guilt, or alarmism in Error.
- Hyperrealistic human lip-sync.
- Representing internal reasoning (chain-of-thought) in any form.
- Using motion to suggest authority, verification, or trust levels.

## 6. Motion deliverables (all PENDING)

- Rig / shape key specification (`nido_rig_spec_v01`).
- 8 motion clips, one per state (`nido_motion_<state>_v01`).
- State transitions (180–450 ms).
- Reduced Motion variants per state.
- Motion QA sheet with PASS/FAIL against this document.
