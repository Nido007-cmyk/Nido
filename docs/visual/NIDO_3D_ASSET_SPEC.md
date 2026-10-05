> **Language:** English · [Español](../es/visual/NIDO_3D_ASSET_SPEC.md)

# NIDO 3D Asset Spec — v2.0

**Date:** 2026-09-27
**Normative:** `NIDO_3D_VISUAL_SYSTEM.md` + `NIDO_3D_Character_Design_System_v2.pdf` (§10–11).
**Production status:** no production 3D asset exists yet. Everything listed
here is **PENDING** unless stated otherwise.
**Rule:** assets are produced in the 3D pipeline (BASE_MASTER → derivatives).
Characters are not AI-generated as official assets; the PDF renders are
reference, not production assets.

---

## 1. Pipeline (from the PDF, §10)

1. Create a neutral 3D **BASE_MASTER** with an approved turnaround.
2. Separate mesh/materials: body, face, sprout, mantle, core, accessories.
3. Create shape keys or rigs for allowed silhouettes and expressions.
4. Generate presets as data/layers; don't duplicate full characters
   unnecessarily.
5. Export LODs: hero, app, compact, and icon.
6. Generate deterministic thumbnails for the editor.
7. Automatic QA of names, pivots, materials, dimensions, LOD, and missing
   files.
8. Human visual QA against the Source of Truth before accepting an asset.

## 2. Naming

`nido_<layer>_<variant>_<version>` · Examples: `nido_mantle_olive_v01`,
`nido_sprout_dual_v02`, `nido_accessory_glasses_round_v01`.

Layers (`<layer>`): `body` · `face` · `sprout` · `mantle` · `core` ·
`accessory` · `preset` · `lod` · `thumb` · `motion`.

---

## 3. Exact asset list

### 3.1 BASE_MASTER

| Asset | Name | Status |
|---|---|---|
| Neutral 3D character (no personality) | `nido_body_master_v01` | PENDING |
| Front turnaround | `nido_master_turnaround_front_v01` (3D render) | PENDING |
| 3/4 turnaround | `nido_master_turnaround_threequarter_v01` (3D render) | PENDING |
| Side turnaround | `nido_master_turnaround_side_v01` (3D render) | PENDING |
| Back turnaround (resolves mantle + sprout birth) | `nido_master_turnaround_back_v01` (3D render) | PENDING |
| Slight top view | `nido_master_turnaround_top_v01` (3D render) | PENDING |

Criterion: the back must resolve how the mantle wraps and how the sprout is
born; topology prepared for smooth deformation.

### 3.2 Separated meshes and materials

| Asset | Name | Status |
|---|---|---|
| Body mesh + material (cream plush/felt) | `nido_body_base_v01` | PENDING |
| Facial grammar (oval eyes, minimal mouth, subtle blush) | `nido_face_base_v01` | PENDING |
| Base sprout (1–3 organic leaves) | `nido_sprout_base_v01` | PENDING |
| Base mantle (partial wrapping matte cloth) | `nido_mantle_base_v01` | PENDING |
| Base core (warm emissive ring) | `nido_core_base_v01` | PENDING |
| PBR material sheet + palette (§3 values of the system) | `nido_materials_pbr_v01` | PENDING |

### 3.3 Silhouettes (6 variants, as shape keys/rigs within limits)

| Variant | Name | Status |
|---|---|---|
| Standard (= base) | `nido_body_standard_v01` | PENDING |
| Compact | `nido_body_compact_v01` | PENDING |
| Tall | `nido_body_tall_v01` | PENDING |
| Round | `nido_body_round_v01` | PENDING |
| Soft square | `nido_body_softsquare_v01` | PENDING |
| Floating | `nido_body_floating_v01` | PENDING |

Criterion: all keep the sprout legible in silhouette; proportions within
0.70–0.78H width except the variant that justifies it (Tall/Floating) with
explicit approval.

### 3.4 Layer libraries

| Library | Minimum content | Status |
|---|---|---|
| Sprouts | natural leaf shapes and colors (L2) | PENDING |
| Mantles | colors (§9 palette), drapes, collars, folds, finishes (L3) | PENDING |
| Cores | state/identity color variants in accessible palette (L4) | PENDING |
| Accessories | glasses, hats, headphones, goggles, small objects (L5, max 2–3) | PENDING |

### 3.5 Expressions and states (8, as animatable rigs/shape keys)

| State | Motion asset | Status |
|---|---|---|
| Idle | `nido_motion_idle_v01` | PENDING |
| Listening | `nido_motion_listening_v01` | PENDING |
| Thinking | `nido_motion_thinking_v01` | PENDING |
| Working | `nido_motion_working_v01` | PENDING |
| Talking | `nido_motion_talking_v01` | PENDING |
| Completed | `nido_motion_completed_v01` | PENDING |
| Offline | `nido_motion_offline_v01` | PENDING |
| Error | `nido_motion_error_v01` | PENDING |

Behavior specification: `NIDO_3D_MOTION_SPEC.md`.

### 3.6 Personalities (12 presets as data/layers)

`nido_preset_minimalista_v01` · `nido_preset_profesional_v01` ·
`nido_preset_creativo_v01` · `nido_preset_deportivo_v01` ·
`nido_preset_naturaleza_v01` · `nido_preset_futurista_v01` ·
`nido_preset_elegante_v01` · `nido_preset_divertido_v01` ·
`nido_preset_aventurero_v01` · `nido_preset_tecnico_v01` ·
`nido_preset_tranquilo_v01` · `nido_preset_personalizado_v01`

Status: PENDING (all). Criterion: presets as data over the BASE_MASTER,
without duplicating full characters; combinable in the editor without
revealing private info by default.

### 3.7 LODs

| LOD | Use | Status |
|---|---|---|
| `hero` | marketing, large screens, AR/VR | PENDING |
| `app` | in-app avatar (96 px+) | PENDING |
| `compact` | 32–64 px, wearable, large groups | PENDING |
| `icon` | 16–24 px, silhouette + sprout | PENDING |

### 3.8 Editor thumbnails

Deterministic thumbnails per layer/preset for the customization editor
(`nido_thumb_<layer>_<variant>_v01`). Status: PENDING.

### 3.9 Runtime avatar assets (per size tier)

| Tier | Representation | Runtime asset |
|---|---|---|
| 16–24 px | simplified brand/silhouette | `nido_lod_icon` |
| 32–64 px | simplified 3D avatar (face+sprout+mantle+core) | `nido_lod_compact` |
| 96 px+ | full 3D character | `nido_lod_app` |
| AR/VR, marketing | full asset | `nido_lod_hero` |

### 3.10 Rendered tests

| Test | Status |
|---|---|
| NIDO↔NIDO test (luminous link between cores) | PENDING |
| Group test (individual participants + partial states) | PENDING |
| Layered customization editor preview | PENDING |

---

## 4. QA per asset

- **Automatic:** naming per convention, pivots, materials, dimensions,
  correct LOD, missing files.
- **Human:** visual QA against the Source of Truth (the PDF) before
  accepting.
- **Acceptance:** 12-point checklist in `NIDO_3D_QA_CHECKLIST.md`; each
  asset needs its QA sheet with PASS/FAIL.

## 5. App implementation gate

No asset enters the app until:

1. The BASE_MASTER has an approved turnaround (5 views).
2. The asset passes automatic QA.
3. The asset passes human visual QA against the PDF.
4. The asset has a QA sheet with the 12 points at PASS.
5. The visual migration audit is closed (`NIDO_3D_QA_CHECKLIST.md` §5).
