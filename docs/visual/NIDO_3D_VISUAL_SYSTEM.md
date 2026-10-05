> **Language:** English · [Español](../es/visual/NIDO_3D_VISUAL_SYSTEM.md)

# NIDO 3D Visual System — v2.0

**Version:** v2.0 (official system under development — NOT a final production asset)
**Status:** Normative specification for visual review and approval by Arsrs.
**Source of truth:** `docs/visual/NIDO_3D_Character_Design_System_v2.pdf`
("NIDO · 3D CHARACTER DESIGN SYSTEM · Build, customization, animation, and QA
guide · v2.0"). The rendered 3D family in the PDF defines the visual DNA.
**Supersedes:** v0.3 is now **SUPERSEDED FOR CHARACTER DESIGN** (see
`VISUAL_MIGRATION_REPORT.md`). Its history is preserved.
**Date:** 2026-09-27
**Do not touch:** protocol, cryptography, identity, Policy Engine,
permissions, conformance, wire formats, domain separators. Design never
accommodates architecture; architecture doesn't change for design.

**Non-negotiable rule (from the PDF):** never replace the 3D character with a
flat illustration again, not even to explain the system. If a diagram is
needed (anatomy, proportions, materials, rig, layers, states), use a 3D render
of the character with technical overlays: construction lines, measurements,
and callouts.

---

## 0. Permanent principles

**ONE FAMILY. MILLIONS OF INDIVIDUALS.** · Tagline: **TU AGENTE. TU MUNDO.**

**Separation of authorities (from v0.3, intact):**

- **Avatar = expression.** The character expresses state and personality.
  Nothing else.
- **Keys = identity.** Cryptographic identity lives in the keys, never in
  the drawing.
- **Policy = authority.** Authority lives in the Policy Engine, never in the
  avatar.
- **User = final authority.** The user decides.

The luminous core is **purely visual/symbolic** (the user's private space).
It NEVER represents a cryptographic key, authority, trust level, or
permissions, and is never used as a meter (bars, percentages, traffic
lights). Real security is shown separately in the UI ("Identity verified"
only when cryptographically true, outside the avatar).

**Naming:** NIDO remains the technical codename. The visual identity must
survive a future public rebrand (Memini / Amparo / Umbral / Meus / Nidal
frozen — no winner).

---

## 1. Mandatory visual DNA

Five pieces make a NIDO recognizable even when its personality changes.
[3D render: labeled view of the 5 pieces — pending BASE_MASTER production.]

1. **Body:** compact seed/pebble-like volume, cream, soft and rounded.
   Head and torso read as a single mass.
2. **Face:** two separated, simple, dark oval eyes; short friendly mouth;
   very subtle blush. No mandatory nose. Eyes large but not anime.
3. **Sprout:** 1–3 organic leaves. Must look vegetal, not like a
   technological antenna.
4. **Mantle:** soft cloth piece wrapping around the torso. It is the main
   customization surface. It represents protection, privacy, shelter, and
   user control — not clothing.
5. **Core:** luminous ring on the chest. Communicates identity, connection,
   and state; not a generic button.

**Species rule:** if accessories, special color, and context are hidden, the
character must still read immediately as NIDO from
body + face + sprout + mantle + core.

---

## 2. Proportions and 3D modeling

[3D render: turnaround with construction lines and measurements — pending
production.]

- Base height = **1.00H**. Approximate visual width **0.70–0.78H**.
- Avoid long limbs or human anatomy.
- The face occupies the upper-central zone; eyes stay large but not anime.
- The core sits below the facial center, integrated with the mantle.
- Short, soft arms close to the body; small wide feet.
- Stable, friendly, slightly heavy silhouette.
- Minimum master-asset views: **front, 3/4, side, back, and slight top**.
  The back must resolve how the mantle wraps and how the sprout is born.
- Topology prepared for smooth deformation. Don't rely on microscopic
  detail for identity to work.

---

## 3. Materials, light, and render

[3D render: material sheet with callouts — pending production.]

- **Body:** cream fine plush/felt; microfiber visible only up close; high
  roughness, low specular.
- **Mantle:** denser matte cloth; large soft folds; no shiny plastic.
- **Sprout:** satin organic leaf, discreet veins, natural variation.
- **Core:** warm emissive with controlled halo; preserve ring detail, never
  burn it to white.
- **Lighting:** large studio softbox, soft shadows, low-medium contrast,
  cream background. The shape must read without a black outline.

---

## 4. Customization system (layers L0–L6)

The user creates their NIDO without creating another species. Mapping to
the v0.3 envelope: L0→FIXED · L1–L5→BOUNDED · L6→FREE · FORBIDDEN remains.

- **L0 — Species (LOCKED):** base body, facial grammar, core position,
  sprout logic.
- **L1 — Silhouette:** Standard, Compact, Tall, Round, Soft square,
  Floating; always within proportion limits. No variant may lose the sprout
  in silhouette.
- **L2 — Sprout:** count (1–3), orientation (±30°), natural leaf color.
- **L3 — Mantle:** color, drape, collar, folds, and small finishes. Always
  partial and asymmetric; never fully covering face or core.
- **L4 — Core:** color within an accessible palette (warm `#FFD27A` by
  default); the ring stays recognizable. Never a meter.
- **L5 — Accessories:** glasses, hats, headphones, goggles, small objects;
  **max 2–3 simultaneous by default**; never over the face or core.
- **L6 — Theme:** nature, creative, technical, sporty, elegant, futuristic,
  etc. The theme modifies allowed layers, not the species.

**FORBIDDEN** (from v0.3 + V2): removing the sprout or making it
unrecognizable; detailed or hyperrealistic human face; weapons; authority
symbols (crowns, official insignias); religious/political iconography;
elements suggesting identity verification (checks, seals, padlocks) inside
the avatar; core as a meter; embedded text in the asset; sensitive personal
metadata in shared assets; deliberate resemblance to existing AI mascots.

**Editor privacy (V2):** customization options must not reveal the user's
private information by default.

---

## 5. Reference personalities

Minimalist · Professional · Creative · Sporty · Nature · Futuristic ·
Elegant · Fun · Adventurous · Technical · Calm · Custom.

They are presets, not rigid identities. Each is a combination of layers
L1–L6; the user starts from a preset and adjusts. None may break L0 or
enter FORBIDDEN. [3D renders of the 12 presets: see the PDF board;
preset production as data pending.]

---

## 6. Expressions and states

Canonical set: **8 animatable states** (see `NIDO_3D_MOTION_SPEC.md` for
motion semantics):

1. **Idle** — minimal breathing; stable core.
2. **Listening** — slight tilt; cool/soft core; no exaggerated gestures.
3. **Thinking** — contained gaze/pose; slow core pulse.
4. **Working** — deliberate movement; pulse or flow around the core.
5. **Talking** — simple animated mouth; avoid hyperrealistic human
   lip-sync.
6. **Completed** — brief micro-celebration; warm core.
7. **Offline** — serene state, not "dead"; communicates that local remains
   available.
8. **Error** — slight concern; never terror or guilt.

**9th operational app state (from v0.3):** `waiting for approval` — expectant
pause directed at the user. Not a character expression; rendered with an
existing expression (expectant posture + slow core pulse).

Face rules: extremely simple (oval eyes + faint minimal mouth); detailed
human eyebrows, teeth, tongue, realistic tears prohibited. Only visible
operational state; **never** represent internal reasoning.

---

## 7. NIDO ↔ NIDO and groups

- Each character keeps its visual identity. Connection is represented
  **between cores** via a temporary luminous link; don't fuse bodies or turn
  the bond into an authority mark.
- **The visual connection never proves identity.** The UI shows separately,
  only when cryptographically true, "Identity verified" (UI text + icon,
  outside the avatar). Without verification: neutral or absent link; never
  a padlock/check inside the avatar.
- In groups: show individual participants and partial states. For large
  groups use compact avatars derived from the same visual DNA.
- [3D render: NIDO↔NIDO and group test — pending production.]

---

## 8. Usage by size and platform

| Context | Representation | Rule |
|---|---|---|
| 16–24 px | Simplified brand/silhouette | Don't attempt to render full eyes, texture, and accessories. |
| 32–64 px | Simplified 3D avatar | Face + sprout + mantle + core must survive. |
| 96 px+ | 3D character | Full materials, expression, and customization. |
| App/desktop | Avatar + state | Don't use the mascot to block functional content. |
| Wearable/auto | Compact version | Immediate readability, minimal motion. |
| AR/VR | Full 3D asset | Smooth scale and presence; no invading personal space. |

**Degradation order** (from v0.3, no conflict): accessories → texture →
face → core detail (becomes ring/dot) → **silhouette and sprout are never
lost.**

**Monochrome:** single solid color; the core becomes a ring/outline; the
mantle differentiates by shape, not tone. **Dark mode:** inverted palette
with the core's warm glow preserved; the core stays legible in light/dark
and at avatar size.

---

## 9. Official palette (from v0.3, with V2 restriction)

| Family | Tones |
|---|---|
| Body | `#F8F4E9` · `#EDE4D6` · `#D9C8B7` |
| Mantle (greens) | `#6B7158` · `#8FA47A` · `#A7BC9A` |
| Mantle (others) | `#6C7EE7` · `#FFA25B` · `#F4A2C1` · `#7AC0E0` |
| Sprout | `#5B7150` · `#6FA47A` · `#8FC08A` · `#C9A05A` |
| Core | `#FFD27A` (warm, default) · `#8CE0FF` · `#A78BFA` · `#FFBEC6` |

**V2 restriction:** don't use Meta blue as a structural brand color. Blues
(`#6C7EE7`, `#8CE0FF`) remain non-structural options, never the default
brand color. Any palette extension requires explicit approval.

---

## 10. Avatar privacy (tiers, from v0.3)

The avatar is **never a protocol identifier**.

- **LOCAL:** Full detailed Personal NIDO. Exists only on the device.
- **CONTACT:** simplified version the user chooses to share (without
  personal FREE elements). The user controls what each contact sees.
- **PUBLIC:** minimum (silhouette + sprout, or Brand Mark). Public/unknown
  contexts.

Rules: no sensitive personal information or unnecessary metadata in shared
assets; CONTACT and PUBLIC are generated by explicit export, never by
leaking the LOCAL one.

---

## 11. Originality

- The goal is NIDO's own identity: don't copy another company's silhouette,
  face, iconography, palette, motion, or trade dress.
- Don't use Meta blue as a structural color or elements resembling their
  logo.
- Don't describe the character as a "version of" another mascot in
  production. The official reference is only this NIDO system.
- Accessories may change a lot; the base anatomy and the core don't.
- **Before public release: legal review of name, brand, and final assets.**
- Permanent rule: if strong similarity with another brand appears, change
  our direction keeping the philosophy (seed + sprout + mantle + core),
  never moving toward the foreign reference.

---

## 12. Accessibility

- Core and face contrast verifiable in light/dark.
- `prefers-reduced-motion`: states are communicated via static shape/color.
- The character is never the sole carrier of critical information (there
  is always text/UI).
- Each state has an accessible text label (when implemented in app).

---

## History

- v2.0 (2026-09-27): adoption of the PDF as the character source of truth.
  See `VISUAL_MIGRATION_REPORT.md`.
- v0.3: SUPERSEDED FOR CHARACTER DESIGN. History preserved in
  `docs/NIDO_VISUAL_IDENTITY_SYSTEM.md` and `docs/NIDO_AVATAR_SYSTEM.md`.
