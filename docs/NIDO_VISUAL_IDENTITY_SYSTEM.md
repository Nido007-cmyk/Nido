> **Language:** English · [Español](es/NIDO_VISUAL_IDENTITY_SYSTEM.md)

# NIDO — Visual Identity System

> **STATUS: SUPERSEDED FOR CHARACTER DESIGN (2026-09-27).**
> 3D character design is now governed by
> `docs/visual/NIDO_3D_VISUAL_SYSTEM.md` (source of truth:
> `docs/visual/NIDO_3D_Character_Design_System_v2.pdf`, v2.0).
> This document is kept as history (v0.3). Still in force at brand level:
> tagline "TU AGENTE. TU MUNDO.", the ring language, and the authority-separation /
> privacy / originality / naming rules collected in the migration
> (`docs/visual/VISUAL_MIGRATION_REPORT.md`).

**Version:** v0.3 — SUPERSEDED FOR CHARACTER DESIGN (official direction in development — NOT a final production asset)
**Status:** Design proposal for visual review and approval by Arsrs.
**Supersede:** v0.2 (`docs/visual/nido-reference-v2.jpg`) is archived as prior
reference; the image `docs/visual/nido-brand-guide.jpg` ("NIDO — TU AGENTE. TU MUNDO. /
COMPLETE CHARACTER DESIGN GUIDE", 10 sections) is now the **visual SOURCE OF TRUTH**.
v0.1 (Nidito / three arcs) remains archived as exploration.
**Date:** 2026-09-27
**Do not touch:** protocol, cryptography, identity, Policy Engine, permissions, conformance,
wire formats, domain separators. Design never accommodates architecture; architecture
doesn't change for design.

---

## 0. Principle

**ONE FAMILY. MILLIONS OF INDIVIDUALS.**

**Official tagline (from the brand guide):** TU AGENTE. TU MUNDO.

Each user can make their NIDO their own. But even without color, clothing, accessories or face,
it must still be recognizable as part of the NIDO family.

**Authority separation (permanent):**

- **Avatar = expression.** The character expresses state and personality. Nothing more.
- **Keys = identity.** Cryptographic identity lives in the keys, never in the drawing.
- **Policy = authority.** Authority lives in the Policy Engine, never in the avatar.
- **User = final authority.** The user decides.

The luminous circle (Core) is **purely visual/symbolic** (the user's private space).
It does NOT represent a cryptographic key, authority, trust level or permissions.
Real security is shown separately in the UI (e.g. "Identity verified" only when
cryptographically warranted).

**Naming:** NIDO remains the technical codename. The visual identity must survive a
future public brand change (Memini / Amparo / Umbral / Meus / Nidal frozen —
no winner). Don't adapt the character to any candidate name.

---

## 1. The base character

Soft, compact, rounded seed-creature. It should feel:

- friendly, calm, protective
- premium and tactile (honest material: it looks soft to the touch, matte, with volume)
- recognizable
- **not overly infantilized** — it's an adult companion, not a toy

### 1.1 Visual DNA (5 elements)

**RENDER STYLE (Arsrs's directive, 2026-09-27): characters look LIKE THE
PHOTO of the brand guide.** Soft tactile 3D render: plush body with real volume,
draped mantle fabric with texture, organic sprout with natural light, core as a
warm diffuse light ring, warm enveloping lighting. **Not** flat vector
illustration, **not** minimalist SVG, **not** 2D "sticker" style. Every future
character asset (app, marketing, web artifact) must target this soft 3D
finish or reuse the guide renders as direct reference. Simplification
for small sizes (§1.4) reduces render detail, never converts it to flat.

1. **Shape (body):** ovoid/rounded mass, no edges. "Seed" silhouette.
   Approximate proportion: height ≈ 1.15 × width. Stable base, no visible legs
   (or minimal feet integrated into the mass).
2. **Sprout:** top leaves/sprout. **Distinctive element of the NIDO family.**
   Must work even in silhouette. Small variations allowed (1–3 leaves,
   angle, size) preserving the concept of growth and continuity.
3. **Mantle:** partially wraps the character (shoulder/torso, asymmetric).
   Represents **protection, privacy, refuge, user control** — not clothing.
   It's part of the NIDO visual DNA. It may vary in style, material and color between
   users without losing its familiar geometry (partial wrap band, natural
   drape, never fully covers the face or the core).
4. **Core:** **luminous ring** on the torso (the v0.3 brand guide renders it
   as a ring, not a filled disc — converging with the Brand Mark language).
   Represents the user's private space. An important element of the visual language,
   but **purely symbolic** (see §0). Diffuse warm light by default; in monochrome
   it's rendered as a simple outline.
5. **Face:** extremely simple. Two oval eyes + subtle smile (or eyes only in
   variants). No nose, no human features. Few expressions. Must remain
   recognizable when the face disappears at small sizes (silhouette rules).

**Materiality (from the guide, §4):** soft plush-like body; soft matte fabric mantle;
realistic organic sprout; warm diffuse light core. Tactile and premium in all
materials; never cheap plastic or aggressive metal.

### 1.2 Views

- **Front:** centered face, mantle crossing from one shoulder, core visible on the torso.
- **Side:** profile of the ovoid mass; the sprout reads in silhouette; the mantle falls down the back.
- **Back:** no face; mantle and sprout carry recognition; the core may
  peek as lateral glow or stay hidden (allowed variant: core visible only front/side).

### 1.3 Silhouette (recognition test)

The solid-black silhouette must read as NIDO by: ovoid mass + top sprout +
mantle band. **Scale rule:** at small sizes details are removed (face,
texture, accessories) **before** destroying the silhouette. The sprout is never removed.

### 1.4 Size tests

- **16px:** silhouette + sprout. No face, no detailed core (dot or nothing).
- **24px:** silhouette + sprout + mantle suggestion.
- **48px:** silhouette + sprout + mantle + core (ring) + optional minimal face.
- **Profile (avatar):** face + mantle + core.
- **Full character:** full detail.

### 1.6 Official palette (from the brand guide, §3)

| Family | Tones |
|---|---|
| Body | `#F8F4E9` · `#EDE4D6` · `#D9C8B7` |
| Mantle (greens) | `#6B7158` · `#8FA47A` · `#A7BC9A` |
| Mantle (others) | `#6C7EE7` · `#FFA25B` · `#F4A2C1` · `#7AC0E0` |
| Sprout | `#5B7150` · `#6FA47A` · `#8FC08A` · `#C9A05A` |
| Core | `#FFD27A` (warm, default) · `#8CE0FF` · `#A78BFA` · `#FFBEC6` |

The warm core `#FFD27A` is the default; cold/alternates live in BOUNDED
(Futuristic/Technical variants or explicit user choice). All color
customization uses these families unless a palette extension is explicitly approved.

### 1.7 Silhouette variants (from the guide, §7)

Six normative variants, all with a legible sprout: **Standard · Compact · Tall ·
Round · Soft Square · Floating**. The Standard variant is the base character (§1.1);
the rest are BOUNDED options for Personal NIDO (e.g. Calm → Round,
Futuristic → Floating). No variant may lose the sprout in silhouette.

### 1.8 Monochrome and dark mode

- **Monochrome:** one solid color. The core becomes a ring/outline. The mantle
  is distinguished by shape, not tone. Test: mental photocopy / engraving / fax.
- **Dark mode:** inverted palette with the core's warm glow preserved; the mantle
  must not disappear against dark backgrounds (subtle edge or raised tone).

---

## 2. Personal NIDO — one family, not an identical mascot

12 reference personalities, **rendered in the brand guide (§5) in the official
plush 3D style**. All share the §1 DNA; they vary within the §3 envelope.

1. **Minimalist** — neutral tones, no accessories, smooth mantle.
2. **Professional** — subtle glasses, structured dark mantle.
3. **Creative** — violet accents, playful asymmetric sprout.
4. **Sporty** — band/ribbon on the sprout, light mantle, warm colors.
5. **Nature** — moss/earth tones, matte texture, extra leaves on the sprout.
6. **Futuristic** — smooth dark surfaces, cold core glow, clean lines.
7. **Elegant** — sober palette, refined draped mantle, minimal detail.
8. **Fun** — pink tones, cheerful expression, small accessory.
9. **Adventurous** — explorer glasses over the sprout, rugged mantle.
10. **Technical** — light headphone/helmet, sober geometric details.
11. **Calm** — lavender/blue tones, closed serene eyes, even softer shapes.
12. **Custom** — user's open slot (see FREE envelope).

No personality may break the FIXED envelope or enter FORBIDDEN.

---

## 3. Personalization Envelope

### FIXED — never changes (family identity)

- Ovoid/rounded body mass without edges; base body proportion.
- Top sprout present and legible in silhouette.
- Partial wrap mantle with familiar geometry (never fully covers face or core).
- Core as a **ring** of light on the torso (position and shape, not its "meaning").
- Minimal face of at most 2 base expressive elements (eyes; optional mouth).
- Absence of human features (no nose, no articulated mouth, no human limbs).

### BOUNDED — customizable within limits

- **Color:** approved palettes (warm, cold, neutral, dark); the core keeps a warm
  glow except in Futuristic/Technical variants (cold glow allowed).
- **Material:** matte, soft, ceramic, fabric — always tactile and premium; never
  aggressive metallic or fully translucent.
- **Mantle:** style, length, texture and color; always partial and asymmetric.
- **Sprout:** 1–3 leaves, ±30° angle, 10–20% size of total height.
- **Expression:** closed set of expressions (see `NIDO_AVATAR_SYSTEM.md`).
- **Limited accessories:** glasses, bands, small hats, headphones — one dominant
  at most, never over the core.

### FREE — broad creativity

- Seasonal/event themes and "skins".
- Small personal elements (patches, embroidery, motifs on the mantle).
- Local avatar backgrounds and scenes.
- Personal NIDO name and pronouns (text, doesn't affect the shape).

### FORBIDDEN — destroys identity or creates confusion/risk

- Removing the sprout or making it unrecognizable in silhouette.
- Detailed or hyperrealistic human face.
- Weapons, authority symbols (crowns, official insignia), religious/political iconography.
- Elements suggesting identity verification (checks, seals, locks) **inside the
  avatar** — verification lives in the UI, separate.
- Core used as a meter (bars, percentages, "trust" traffic lights).
- Text embedded in the character asset (names, IDs).
- Sensitive personal metadata in shared assets (see §7).
- Deliberate resemblance to existing AI mascots (see §9 originality).

---

## 4. Brand Mark (refined separately)

The circular symbol of the base image is **exploration, not a definitive logo**.
Conceptual relation to the character and the core (circle = private space, continuity),
but it is **not** the same element reused without reflection.

Requirements:

- Works independently of the character.
- **16px / 24px / 48px**, app icon, monochrome, dark mode, hardware, engraving, wearables.
- Simple geometric construction: ring with aperture/suggested sprout gesture
  (a single interruption evoking the leaf without drawing it).
- Versions: color, positive mono, negative mono, app icon (background + mark).
- Minimum clearspace = 25% of diameter; minimum digital size 16px, printed 5mm.

---

## 5. Operational states (no chain-of-thought)

Nine normative states. Only operational state visible; **never** represent internal reasoning.
The brand guide (§6) illustrates 8 rendered expressions (Idle, Listening, Thinking,
Working, Talking, Completed, Offline, Error) in the official 3D style; the ninth
state (`waiting for approval`) follows the mapping in `NIDO_AVATAR_SYSTEM.md` §5.

1. **idle** — rest, subtle breathing.
2. **listening** — attention (slightly upright sprout / soft core pulse).
3. **planning** — active pause (gaze forward, stable core).
4. **working locally** — contained activity (soft rhythmic variation, all on-device).
5. **communicating with another NIDO** — oriented toward the other NIDO, link pulse
   **between** both (the link is visual, not proof of identity).
6. **waiting for approval** — expectant pause toward the user (the user decides).
7. **completed** — minimal nod / brief warm glow.
8. **offline** — dimmed, core off or subtle; the character is still present
   (offline is a dignified state, not an error).
9. **error** — minimal contraction, sober tone; no alarmism.

Each state must read at 48px with silhouette + core + posture. Expressive detail
lives in `NIDO_AVATAR_SYSTEM.md`.

---

## 6. NIDO ↔ NIDO and groups

- **Two NIDOs collaborating** (e.g. "Brett's NIDO ↔ Maria's NIDO"): the characters
  face each other with a visual link. **The visual connection never proves identity.**
- The UI shows separately, only when cryptographically warranted:
  **"Identity verified"** (UI text + icon, outside the avatar).
- Without verification: the link is shown neutral or absent; never a lock inside the avatar.
- **Groups 3–5:** compact view, characters in a row with partial overlap.
- **Groups 6+:** abstract group view (circles/cores), no individual faces.

---

## 7. Avatar privacy (three tiers)

The avatar **is never a protocol identifier**.

- **LOCAL AVATAR:** the user's complete detailed Personal NIDO. Only exists on the
  device. Can be as personal as they want.
- **CONTACT AVATAR:** simplified version the user chooses to share with contacts
  (less detail, no FREE personal elements). The user controls what each contact sees.
- **PUBLIC AVATAR:** minimal representation (silhouette + sprout, or Brand Mark). For
  public or unknown contexts.

Rules:

- The user may have a very detailed local NIDO without being obliged to share it.
- Don't embed sensitive personal information or unnecessary metadata in shared assets.
- Shared assets are generated by explicit export of the chosen tier, never by
  leakage of the local one.

---

## 8. Scale and contexts

Normative contexts (from the guide, §10): **Mobile app · Desktop · Wearable · AR/VR**.
Per-size strategy:

- **16px:** Brand Mark or NIDO silhouette (sprout mandatory).
- **24px:** silhouette + suggested mantle.
- **48px:** complete simplified character.
- **Profile:** half body with face.
- **Full character:** full detail (large screens / marketing only).

In automotive and AR/VR: high-contrast silhouette, no embedded text, legible at distance.

---

## 9. Originality review (permanent red-team)

The current direction (seed-creature + sprout + mantle + core) was evaluated against:

- **Muse / Meta AI:** no overlap — no floating abstract shapes, no corporate
  blue-violet gradients, no generic "sparkle". Our language is organic/tactile,
  not geometric/digital.
- **Generic AI mascots** (round robots, blobs with eyes): the **sprout in silhouette** +
  the **asymmetric mantle** + the **core** form a distinctive combination; no
  competitor brings all three together.
- **Risks to watch:** video-game "plant" characters (the mantle and core set us
  apart); any drift toward robot (FORBIDDEN: keep it organic).

Rule: if during refinement a strong similarity with another brand appears, our
direction is modified keeping the philosophy (seed + sprout + mantle + core), never
moving closer to the foreign reference to look "more familiar".

---

## 10. Accessibility and motion

- Core and face contrast verifiable in light/dark.
- `prefers-reduced-motion`: states communicated by static shape/color, without animation.
- The character is never the sole carrier of critical information (there's always text/UI).
- Minimum touch size and accessible labels for each state in the app (when implemented).

---

## 11. Deliverables of this iteration (design, not implementation)

- [ ] Refined base character: front / side / back / 3-4 + silhouette (guide's plush 3D style).
- [ ] 16px / 24px / 48px tests + monochrome + dark mode.
- [ ] 12 refined Personal NIDOs (guide §5 as direct reference).
- [ ] 6 silhouette variants (guide §7).
- [ ] 8 rendered expressions (guide §6) + mapping of the 9th state.
- [ ] Customization layers: sprout, mantle, accessories, core colors, themes (guide §8).
- [ ] Personalization envelope (this document, §3).
- [ ] States and expressions (9 states).
- [ ] NIDO ↔ NIDO + groups (3–5 and 6+).
- [ ] Local / contact / public avatars.
- [ ] Refined Brand Mark (separate system).
- [ ] Originality review (this document, §9).

**Don't implement in the app until Arsrs's visual approval.**
