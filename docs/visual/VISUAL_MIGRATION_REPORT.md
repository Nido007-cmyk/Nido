> **Language:** English · [Español](../es/visual/VISUAL_MIGRATION_REPORT.md)

# VISUAL MIGRATION REPORT — v0.3 → v2 3D

**Date:** 2026-09-27
**Authorization:** explicit instruction from Arsrs (project owner), 2026-09-27:
"EL PDF NIDO_3D_Character_Design_System_v2.pdf ES LA NUEVA SOURCE OF TRUTH PARA EL
DISEÑO DE PERSONAJES NIDO."
**Scope:** visual system / characters / assets / customization / motion only.
**Does not touch:** protocol, security, cryptographic identity, Policy
Engine, technical architecture, conformance.

## Compared sources

| ID | Source | Status after this migration |
|---|---|---|
| v0.3 | `docs/visual/nido-brand-guide.jpg` + `docs/NIDO_VISUAL_IDENTITY_SYSTEM.md` v0.3 + `docs/NIDO_AVATAR_SYSTEM.md` v0.3 | **SUPERSEDED FOR CHARACTER DESIGN.** Commit and history preserved. The JPG guide remains valid at brand level (tagline, ring language) but is no longer a character reference. |
| V2 | `docs/visual/NIDO_3D_Character_Design_System_v2.pdf` ("3D CHARACTER DESIGN SYSTEM · v2.0") | **NEW SOURCE OF TRUTH for characters.** |

## Comparison table

Classification: **KEEP FROM V0.3** · **REPLACE WITH V2** · **MERGE** · **DEPRECATE**

| # | Area | v0.3 | V2 PDF | Classification | Decision |
|---|---|---|---|---|---|
| 1 | Character source of truth | `nido-brand-guide.jpg` | The v2 PDF + the rendered 3D family | **REPLACE WITH V2** | The PDF is the normative character reference. |
| 2 | Render style | "LIKE THE PHOTO": soft plush 3D, not flat | Precise PBR: cream fine plush/felt, microfiber only up close, high roughness, low specular; dense matte mantle with no shiny plastic; organic satin sprout; warm emissive core with controlled halo, never burned to white; large softbox, soft shadows, low-medium contrast, cream background, no black outline | **REPLACE WITH V2** | The "like the photo" directive is absorbed into the PBR specification. |
| 3 | Proportions | height ≈ 1.15 × width; no visible legs (or minimal feet) | Height 1.00H, width 0.70–0.78H; face upper-central zone; eyes large but not anime; short soft arms close to the body; small wide feet; core below the facial center, integrated with the mantle | **REPLACE WITH V2** | V2 wins: normative numbers. |
| 4 | Face | oval eyes + faint smile; no nose; no human features | two separated dark oval eyes; short friendly mouth; very subtle blush; no mandatory nose | **MERGE** | V2 grammar adopted (adds subtle blush); "no human features" kept. |
| 5 | Core | luminous ring, symbolic, never meter/authority | luminous ring on the chest; communicates identity, connection, and state; not a generic button | **MERGE** | Ring confirmed. The v0.3 rule (never key/authority/trust/permissions/meter) kept, reinforced by V2. |
| 6 | Master asset views | front / side / back (+ optional 3/4) | Minimum: front, 3/4, side, back, and slight top. The back must resolve how the mantle wraps and how the sprout is born | **REPLACE WITH V2** | 5 normative views. |
| 7 | Hex palettes | body/mantle/sprout/core with hex codes | No hex in the PDF, but the rule: don't use Meta blue as a structural brand color | **MERGE** | v0.3 hexes kept; blues (`#6C7EE7` mantle, `#8CE0FF` core) remain NON-structural options, never the default brand color. |
| 8 | Silhouettes | 6 variants (Standard, Compact, Tall, Round, Soft square, Floating) | L1: standard, compact, tall, round, soft square, floating, within proportion limits | **KEEP FROM V0.3** | Same six; V2 confirms them as layer L1. |
| 9 | Personalities | 12 (same names) | 12 same names; they are presets, not rigid identities; the editor must not reveal private info by default | **MERGE** | Same 12 names; the editor privacy rule is added. |
| 10 | Customization layers | FIXED/BOUNDED/FREE/FORBIDDEN envelope | L0 locked species; L1 silhouette; L2 sprout; L3 mantle; L4 core; L5 accessories (max 2–3 by default); L6 theme | **MERGE** | Mapping: L0→FIXED, L1–L5→BOUNDED, L6→FREE, FORBIDDEN kept and extended with the V2 prohibitions. |
| 11 | Accessory limit | 0–1 dominant | max 2–3 simultaneous by default | **REPLACE WITH V2** | V2 wins: 2–3 by default. |
| 12 | States/expressions | 9 states (8 from the photo + waiting-for-approval); face/core/sprout table | 8 animatable states with precise motion semantics: Idle, Listening, Thinking, Working, Talking, Completed, Offline, Error | **MERGE** | Canonical set = the 8 V2 states with their motion. `waiting for approval` kept as the 9th **operational app state** (not a character expression), rendered with an existing expression. |
| 13 | Motion | Unspecified (reduced-motion only) | Full system: idle 2–5 s; transitions 180–450 ms; actions 500–1200 ms; the core anticipates 80–150 ms; Reduced Motion without bounce/floating/parallax; restless loops prohibited | **REPLACE WITH V2** | New `NIDO_3D_MOTION_SPEC.md`. |
| 14 | NIDO↔NIDO | mutual orientation + neutral link; "Identity verified" as separate UI chip | temporary luminous link between cores; don't fuse bodies; the bond is not an authority mark | **MERGE** | Luminous link between cores (V2) + separate verification chip (v0.3). |
| 15 | Groups | 3–5 compact row; 6+ abstract to circles/cores | individual participants and partial states; large groups: compact avatars derived from the same DNA | **MERGE** | Large groups use compact avatars of the same DNA (more faithful than abstract circles). |
| 16 | Sizes | 16/24/48/profile/full + degradation order | Table: 16–24 brand/silhouette; 32–64 simplified 3D avatar (face+sprout+mantle+core survive); 96+ full character; wearable/auto compact; AR/VR full asset | **MERGE** | The V2 table is adopted; the v0.3 degradation order kept (accessories→texture→face→core→silhouette/sprout never lost). |
| 17 | Asset pipeline | Didn't exist | 8 steps: BASE_MASTER → mesh separation → shape keys/rigs → presets as data → LODs (hero/app/compact/icon) → deterministic thumbnails → automatic QA → human visual QA | **REPLACE WITH V2** | New `NIDO_3D_ASSET_SPEC.md`. |
| 18 | Asset naming | Didn't exist | `nido_<layer>_<variant>_<version>` (e.g. `nido_mantle_olive_v01`) | **REPLACE WITH V2** | Normative from now on. |
| 19 | QA | design-deliverable checklist | 12-point acceptance checklist + automatic QA + human visual QA against the source of truth | **REPLACE WITH V2** | New `NIDO_3D_QA_CHECKLIST.md`. |
| 20 | Originality | review against Muse/Meta/generic mascots | Don't copy others' silhouette/face/iconography/palette/motion/trade dress; no structural Meta blue; don't describe as a "version of" another mascot; legal review before public release | **MERGE** | The v0.3 review kept, plus the pre-release legal review. |
| 21 | Authority separation | Avatar=expression, Keys=identity, Policy=authority, User=final authority | The core "communicates identity, connection, and state" (visual); the bond is not an authority mark | **KEEP FROM V0.3** | The v0.3 formulation is stricter and kept intact. |
| 22 | Avatar privacy | LOCAL/CONTACT/PUBLIC tiers + explicit export rules | No tiers; the editor must not reveal private info by default | **KEEP FROM V0.3** | Tiers kept; the editor rule added. |
| 23 | Tagline and Brand Mark | "TU AGENTE. TU MUNDO."; separate Brand Mark | The board includes "TU AGENTE. TU MUNDO." and the context "NIDO↔NIDO: conexión segura, identidad verificada" | **KEEP FROM V0.3** | Brand level, no conflict. |
| 24 | Naming | NIDO = technical codename; Memini/Amparo/Umbral/Meus/Nidal frozen | "The official reference is only this NIDO system" | **KEEP FROM V0.3** | No changes. |
| 25 | Documentation rule | "No flat illustration" (style directive) | **NON-NEGOTIABLE:** never replace the 3D character with flat illustration again, not even to explain it; diagrams use 3D renders + technical overlays | **REPLACE WITH V2** | Rule hardened: not even for diagrams. The v0.2 web artifact (flat SVG) is formally deprecated. |

## What was kept from v0.3

- Tagline "TU AGENTE. TU MUNDO." and ring language at brand level.
- The 6 silhouette variants and the 12 personality names.
- Hex palettes (with the non-structural blues restriction).
- FIXED/BOUNDED/FREE/FORBIDDEN envelope (mapped to L0–L6).
- Authority separation (Avatar=expression, Keys=identity, Policy=authority,
  User=final authority) and the purely symbolic core.
- LOCAL/CONTACT/PUBLIC privacy tiers and export rules.
- "Identity verified" as separate UI, never inside the avatar.
- `waiting for approval` as the 9th operational app state.
- Size-based degradation order and monochrome/dark mode rules.
- Originality review (extended with legal review).
- Frozen naming and NIDO as technical codename.

## What V2 replaced

- Character source of truth (JPG → v2 PDF).
- Normative proportions (1.00H / 0.70–0.78H, short arms, wide feet).
- PBR material and light specification (softbox, no black outline).
- 5 mandatory master-asset views (including a back resolving mantle and
  sprout).
- Canonical set of 8 states with motion semantics.
- Full motion system (timings, core anticipation, reduced motion).
- 8-step asset pipeline + `nido_<layer>_<variant>_<version>` naming.
- Accessory limit: 2–3 by default.
- QA: 12-point checklist + automatic QA + human QA.
- Documentation rule: total ban on flat character illustration.

## What remains to be produced (gaps)

1. **Neutral 3D BASE_MASTER** — doesn't exist. Without it there are no
   turnarounds or derivatives.
2. **Turnarounds** (front, 3/4, side, back, slight top) — pending.
3. **Mesh/material separation** (body, face, sprout, mantle, core,
   accessories).
4. **Shape keys / rigs** for the 6 silhouettes and 8 expressions.
5. **Initial libraries**: sprouts, mantles, accessories, core variants.
6. **12 personality presets** as data/layers (not duplicated characters).
7. **PBR material sheet + palette** (§3 values of the 3D system).
8. **Motion clips** per state + rig specification.
9. **LODs**: hero, app, compact, icon.
10. **Deterministic thumbnails** for the editor.
11. **Editor preview** of layered customization.
12. **Rendered NIDO↔NIDO and group test**.
13. **QA sheets** with PASS/FAIL against the PDF.
14. **Legal review** of name, brand, and final assets (before public
    release).

## Assets needed before app implementation

See detail in `NIDO_3D_ASSET_SPEC.md`. Minimum summary:

- Approved neutral `BASE_MASTER` (5-view turnaround).
- Meshes and materials separated by layer with the
  `nido_<layer>_<variant>_<version>` naming.
- The 6 silhouettes as shape keys/rigs within limits.
- Initial library: sprouts, mantles, accessories, cores.
- The 8 states as animatable rigs/shape keys.
- LODs: hero, app, compact, icon.
- Deterministic editor thumbnails.
- Runtime avatar assets per size tier (§8 table of the 3D system).
- QA sheet with PASS on the 12 acceptance points per asset.

**No app implementation until the visual migration audit is complete**
(Arsrs's instruction). The audit lives in `NIDO_3D_QA_CHECKLIST.md`.

## Versioning

- v0.1 (Nidito / three arcs): archived as exploration.
- v0.2 (JPG reference + web SVG artifact): archived; artifact formally
  deprecated.
- v0.3 (brand guide JPG as source of truth): **SUPERSEDED FOR CHARACTER
  DESIGN** (2026-09-27). Commits and history preserved. Still valid at
  brand level (tagline, ring language).
- **v2.0 (this PDF): new character source of truth.**
  Normative documents: `NIDO_3D_VISUAL_SYSTEM.md`, `NIDO_3D_ASSET_SPEC.md`,
  `NIDO_3D_MOTION_SPEC.md`, `NIDO_3D_QA_CHECKLIST.md`.
