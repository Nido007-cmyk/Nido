> **Language:** English · [Español](es/NIDO_AVATAR_SYSTEM.md)

# NIDO Avatar System — Personal NIDO

> **STATUS: SUPERSEDED FOR CHARACTER DESIGN (2026-09-27).**
> The 3D character system is now governed by
> `docs/visual/NIDO_3D_VISUAL_SYSTEM.md` (source of truth:
> `docs/visual/NIDO_3D_Character_Design_System_v2.pdf`, v2.0).
> This document is kept as history (v0.3). The LOCAL/CONTACT/PUBLIC privacy tiers
> and associated rules remain in force per the migration
> (`docs/visual/VISUAL_MIGRATION_REPORT.md`).

**Version:** v0.3 — SUPERSEDED FOR CHARACTER DESIGN (official direction in development — NOT a final production asset)
**Status:** Design proposal for visual review and approval by Arsrs.
**Source of truth:** `docs/visual/nido-brand-guide.jpg` (complete 10-section guide).
**Companion:** `NIDO_VISUAL_IDENTITY_SYSTEM.md` (DNA, envelope, Brand Mark, states,
NIDO↔NIDO, privacy, originality). This document specifies the *personalization and
expression system*: parameters, expressions, sizes, NIDO↔NIDO rendering,
accessibility and avatar privacy rules.
**Rule:** the avatar is expression. Keys are identity. Policy is authority.
Never mix them.
**Render style:** soft 3D plush LIKE THE PHOTO of the guide (see Identity System
§1.1). No flat illustration.

---

## 1. Anatomy of the Personal NIDO (parameters)

Every Personal NIDO is built on the base character (Identity System §1)
through these parameters. Limits come from the personalization envelope.

| Parameter | Range | Notes |
|---|---|---|
| `body.tint` | `#F8F4E9` · `#EDE4D6` · `#D9C8B7` (+ approved extensions) | base body tone; always matte and tactile |
| `body.material` | soft plush / matte / ceramic / fabric | tactile 3D render like the photo; never aggressive metallic nor fully translucent |
| `sprout.leaves` | 1–3 | the sprout always legible in silhouette; shapes and colors by tier (guide §8) |
| `sprout.angle` | ±30° | |
| `sprout.size` | 10–20% of height | |
| `mantle.style` | smooth / woven / structured / light / rugged / refined | always partial and asymmetric; styles and accessories by tier (guide §8) |
| `mantle.tint` | greens `#6B7158` `#8FA47A` `#A7BC9A` · others `#6C7EE7` `#FFA25B` `#F4A2C1` `#7AC0E0` | never fully covers face or core |
| `core.glow` | `#FFD27A` warm (default) · `#8CE0FF` · `#A78BFA` · `#FFBEC6` | luminous ring; symbolic; never a meter |
| `face.style` | oval eyes / eyes + minimal subtle mouth | at most 2 base expressive elements |
| `accessory` | 0–1 dominant | glasses, headphones, caps (guide §8); never over the core |
| `theme` | seasonal / event: nature, space, tech… (FREE, guide §8) | doesn't alter FIXED |

`name` and pronouns are associated free text (they don't affect the shape).

---

## 2. The 12 personalities (reference)

Defined in Identity System §2: Minimalist, Professional, Creative, Sporty,
Nature, Futuristic, Elegant, Fun, Adventurous, Technical, Calm,
Custom. Each is a preset of the §1 parameters; the user starts from a
preset and adjusts it within the envelope.

---

## 3. Expressions (closed set)

The face is extremely simple (oval eyes + subtle smile, like the photo).
The brand guide (§6) illustrates 8 expressions rendered in 3D: Idle, Listening,
Thinking, Working, Talking, Completed, Offline, Error. Allowed expressions
(eyes + minimal mouth):

- neutral · happy · curious · focused · sleepy · proud · shy · determined

Rules:

- No expression alters the FIXED geometry.
- At sizes ≤ 48px the face may disappear; the expression is carried by posture +
  the core (see §5).
- Forbidden: detailed human eyebrows, teeth, tongue, realistic tears.

---

## 4. Sizes and degradation

| Size | What shows |
|---|---|
| 16px | silhouette + sprout |
| 24px | silhouette + sprout + suggested mantle |
| 48px | simplified character (mantle + core ring + optional face) |
| profile | half body: face + mantle + core |
| full | full detail |

**Degradation order** (what's lost first when shrinking): accessories → texture →
face → core detail (remains as ring/dot) → **silhouette and sprout are never lost.**

---

## 5. Operational states → expression

Mapping of the 9 states (Identity System §5) to visual expression.
Only operational state visible; **never chain-of-thought.**

| State | Face/posture | Core | Sprout |
|---|---|---|---|
| idle | neutral, subtle breathing | stable subtle glow | at rest |
| listening | curious, slight tilt | soft pulse | slightly upright |
| planning | focused, gaze forward | stable | at rest |
| working locally | focused, contained rhythm | soft rhythmic variation | at rest |
| communicating | happy/curious toward the other NIDO | link pulse *between* both | oriented toward the other |
| waiting approval | shy/neutral toward the user | slow expectant pulse | slight tilt toward the user |
| completed | happy, minimal nod | brief warm glow | upright |
| offline | sleepy/neutral, dimmed | off or subtle | softly drooped |
| error | sober neutral, minimal contraction | subtle, no alarming blink | at rest |

Note: the visual link between two NIDOs **does not prove identity**. The UI shows
"Identity verified" separately and only when cryptographically warranted.

---

## 6. NIDO ↔ NIDO and groups (rendering)

- **1:1:** both characters at half body, facing each other; subtle visual link
  between cores. UI label (outside the avatar): contact name + verification state
  only if verified.
- **Without verification:** neutral or absent link; never a lock/check inside the avatar.
- **Group 3–5:** compact row with partial overlap; each keeps a visible sprout.
- **Group 6+:** abstraction to circles/cores; no individual faces.

---

## 7. Avatar tiers (privacy)

| Tier | Content | Where it lives |
|---|---|---|
| LOCAL | full detailed Personal NIDO | on the device only |
| CONTACT | user-chosen simplified version (no FREE elements) | chosen by the user per contact |
| PUBLIC | minimum: silhouette + sprout (or Brand Mark) | public/unknown contexts |

Normative rules:

1. The avatar is never a protocol identifier.
2. No sensitive personal information or unnecessary metadata in shared assets.
3. CONTACT and PUBLIC tiers are generated by **explicit export** of the chosen
   tier; never by leakage of the LOCAL one.
4. The user may have a very detailed LOCAL without being obliged to share it.
5. Identity verification ("Identity verified") is separate UI, not part of the avatar.

---

## 8. Accessibility

- Each state has an accessible text label (when implemented in the app).
- Face/core contrast verified in light and dark.
- `prefers-reduced-motion`: states conveyed by static shape/color.
- The avatar is never the sole carrier of critical information.

---

## 9. Approval checklist (for Arsrs)

- [ ] Base character (front/side/back/silhouette) preserves the reference identity.
- [ ] The sprout works as a distinctive feature in silhouette and at 16px.
- [ ] The mantle reads as protection/refuge, not casual clothing.
- [ ] The core is understood as symbolic, with no "meter" reading.
- [ ] The 12 personalities feel like family without being identical.
- [ ] The FIXED/BOUNDED/FREE/FORBIDDEN envelope is clear and applicable.
- [ ] The 9 states are distinguishable at 48px.
- [ ] NIDO↔NIDO doesn't suggest verification by itself.
- [ ] The three avatar tiers make sense and are controllable.
- [ ] The Brand Mark works alone, at 16px and in monochrome.
- [ ] Originality: clearly NIDO, no echoes of Muse/Meta or foreign mascots.

**Design only. No implementation in the app until visual approval.**
