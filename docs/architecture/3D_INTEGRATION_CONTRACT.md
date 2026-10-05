> **Language:** English · [Español](../es/architecture/3D_INTEGRATION_CONTRACT.md)

# 3D Integration Contract — NIDO app ↔ 3D avatar assets

**Status:** SPECIFICATION ONLY (2026-09-27). No implementation.
**Purpose:** define a clean, versioned interface between the NIDO app and its 3D
avatar assets so that models (BASE_MASTER, variants, states, LODs) can be
replaced or upgraded later **without rewriting app logic**.
**Source of truth for visuals:** `docs/visual/NIDO_3D_Character_Design_System_v2.pdf`
and `docs/visual/NIDO_BASE_MASTER_V2_REFERENCE.jpg`.
**Normative companions:** `docs/visual/NIDO_3D_ASSET_SPEC.md`,
`docs/visual/NIDO_3D_MOTION_SPEC.md`, `docs/visual/NIDO_3D_QA_CHECKLIST.md`,
`docs/NIDO_AVATAR_SYSTEM.md` (tiers LOCAL/CONTACT/PUBLIC + state→expression mapping),
`docs/NIDO_PRINCIPLES.md` (privacy, authority separation).

**Current state:** NOT BUILT. The app has no 3D renderer and no 3D assets bundled.
`src/ui/NidoScreen.tsx` is currently a P2P messenger screen (chats/contacts/QR),
not an avatar screen. No `three.js`/`filament`/GLB loading dependency exists in
`package.json`. This contract is forward-looking; nothing here is wired yet.

---

## 1. Design goals

1. **Replaceability:** swapping BASE_MASTER v2 → v3 (or any variant/state/LOD)
   is a data + asset change, never an app-code change.
2. **Renderer independence:** the app depends on an abstract `AvatarRenderer`
   interface, not on a specific 3D engine. The engine is a replaceable backend.
3. **Data-driven avatars:** every visual choice is a serializable
   `AvatarDescriptor` (JSON). No avatar parameters hard-coded in components.
4. **Privacy by construction:** avatar tiers (LOCAL/CONTACT/PUBLIC) enforced at
   export time; shared assets carry no private metadata; the avatar is never an
   identity proof (`NIDO_AVATAR_SYSTEM.md` §7).
5. **Graceful degradation:** defined LOD ladder by display size, with a 2D
   fallback (pre-rendered PNG) when 3D is unavailable.
6. **Offline-first:** all assets and the renderer run fully offline; assets are
   verified by checksum at load (same pattern as model weights in `ARCHITECTURE.md`).

---

## 2. Core interfaces (TypeScript sketches — spec, not code)

### 2.1 `AvatarDescriptor` — the only thing app code manipulates

```ts
/** Versioned, serializable description of "which NIDO to show". */
interface AvatarDescriptor {
  schema: "nido.avatar/v1";
  /** Asset-set identity, e.g. "nido_body_master_v02". Must match the manifest. */
  baseModel: string;
  /** Layer selections; each value is an asset id from the manifest. */
  layers: {
    body: string;      // e.g. "nido_body_base_v01"
    face: string;      // e.g. "nido_face_base_v01"
    sprout: string;    // e.g. "nido_sprout_dual_v02"
    mantle: string;    // e.g. "nido_mantle_olive_v01"
    core: string;      // e.g. "nido_core_warm_v01"
    accessory?: string;// e.g. "nido_accessory_glasses_round_v01" (max 1 dominant)
  };
  /** Personality preset id, or "custom" with explicit layer overrides above. */
  preset: string;      // e.g. "nido_preset_profesional_v01"
  /** Operational state → expression/motion (see §5). */
  state: AvatarState;  // "idle" | "listening" | "thinking" | "working" |
                       // "talking" | "completed" | "offline" | "error"
  /** Requested fidelity; renderer may step down (never up) per §4. */
  lod: "hero" | "app" | "compact" | "icon";
  /** Privacy tier of this render (see §6). */
  tier: "local" | "contact" | "public";
}
```

Rules:
- App components NEVER reference `.glb` paths, mesh names, or material names.
  They build/consume `AvatarDescriptor` objects only.
- Unknown `baseModel` or layer ids → renderer falls back to the bundled
  default descriptor (fail-closed to a known-good look, never a crash).
- `schema` version gates parsing: a descriptor with an unsupported schema
  version is rejected and replaced by the default.

### 2.2 `AvatarRenderer` — the engine abstraction

```ts
interface AvatarRenderer {
  readonly name: string;            // e.g. "expo-gl+three" (backend id)
  /** True if this backend can run on the current device. */
  isAvailable(): Promise<boolean>;
  /** Preload + verify assets for a descriptor (checksums vs manifest). */
  prepare(descriptor: AvatarDescriptor): Promise<void>;
  /** Render into a provided view; returns a handle for state updates. */
  mount(view: unknown, descriptor: AvatarDescriptor): Promise<AvatarHandle>;
}

interface AvatarHandle {
  /** Switch expression/motion without remounting (state changes are cheap). */
  setState(state: AvatarState): Promise<void>;
  /** Swap descriptor (preset/layers) — may reload assets. */
  setDescriptor(descriptor: AvatarDescriptor): Promise<void>;
  /** Release GPU/native resources. */
  dispose(): Promise<void>;
}
```

Rules:
- The app selects a backend via capability check (`isAvailable()`), with
  ordered preference and a 2D fallback (§4). Backend choice is configuration,
  not code branching in screens.
- `setState()` must be lightweight (< 1 frame budget target): state changes
  are the hot path (listening → thinking → talking). Full reloads only on
  descriptor swaps.

### 2.3 `AvatarAssetManifest` — what exists on disk

```json
{
  "schema": "nido.avatar-manifest/v1",
  "baseModel": "nido_body_master_v02",
  "assets": [
    { "id": "nido_mantle_olive_v01", "layer": "mantle", "file": "nido_mantle_olive_v01.glb",
      "sha256": "<hex>", "bytes": 123456,
      "lods": { "hero": "…_hero.glb", "app": "…_app.glb", "compact": "…_compact.glb" } }
  ],
  "presets": [ { "id": "nido_preset_profesional_v01", "layers": { "body": "…", "face": "…", "sprout": "…", "mantle": "…", "core": "…", "accessory": "…" } } ],
  "thumbnails": { "nido_mantle_olive_v01": "thumbs/nido_mantle_olive_v01.png" }
}
```

Rules:
- Every asset load verifies `sha256` before use (same discipline as model
  weights). Corrupt/tampered asset → fall back to default descriptor, log to
  diagnostics (never crash the screen).
- The manifest is the single registry: UI pickers (future editor) enumerate
  `assets`/`presets` from it — no hard-coded lists in components.
- Asset ids follow `nido_<layer>_<variant>_<version>` (`NIDO_3D_ASSET_SPEC.md` §2).

---

## 3. Target shape — v2 visual contract

The contract is shaped for the approved v2 direction
(`NIDO_BASE_MASTER_V2_REFERENCE.jpg`). The renderer and asset pipeline must
support, at minimum, these separable, independently replaceable elements:

| Element | v2 reference spec | Contract implication |
|---|---|---|
| Body | egg/bean, head-body integrated, cream `#F6F4E9`, plush/felt, no hard edges | `body` layer: single watertight mesh, smooth normals, PBR subsurface-ish softness |
| Face | big dark eyes, small smile, subtle blush | `face` layer: swappable expression rig (eyes+mouth+blush), closed expression set |
| Sprout | 2–3 organic leaves on crown, `#8FA67A` | `sprout` layer: must stay legible in silhouette at all LODs |
| Mantle | sage `#6B7F5B` cloth scarf, wraps diagonally, real volume/folds, matte textile | `mantle` layer: cloth-like mesh with fold detail; never covers face or core fully |
| Core | glowing golden ring `#FFD27A`, warm diffused light + bloom, **integrated in the mantle at chest** | `core` layer: emissive ring mesh + light; color variants per state/identity within accessible palette |
| Accessories | max 1 dominant (glasses, hats…), never over the core | `accessory` layer: optional, anchored, excluded from `compact`/`icon` LODs |

Silhouette variants (standard/compact/tall/round/soft-square/floating) are
shape-key/rig deformations of the same base mesh — not separate characters —
so the contract treats them as `body` morph targets, selectable via descriptor.

---

## 4. LOD ladder and 2D fallback

| Display size | LOD | Renders as |
|---|---|---|
| 16–24 px | `icon` | silhouette + sprout (flat or minimal 3D) |
| 32–64 px | `compact` | simplified 3D (face+mantle+core, no accessory) |
| 96 px+ | `app` | full character 3D |
| AR/VR, marketing | `hero` | full-fidelity asset |

Degradation order (what is lost first): accessories → texture detail →
face → core detail (ring → dot) → **silhouette + sprout are never lost**
(`NIDO_AVATAR_SYSTEM.md` §4).

**2D fallback (required):** if no 3D backend is available (or `isAvailable()`
is false), the app renders the deterministic pre-rendered PNG for the
descriptor's state (`nido_thumb_<layer>_<variant>_v01` family /
turnaround stills). The avatar is always *expressible*, never a broken view.
Static PNGs are also the interim integration path: the app can show approved
v2 renders long before a real-time 3D backend lands.

---

## 5. State → expression mapping (hot path)

App operational states map to avatar states exactly per
`NIDO_AVATAR_SYSTEM.md` §5 (idle, listening, thinking/planning, working,
talking/communicating, completed, offline, error, waiting-approval).
Constraints carried into this contract:

- `setState()` switches expression + motion + core glow behavior only.
- **Never render chain-of-thought or internal reasoning** in the avatar.
- `prefers-reduced-motion` → static pose + color per state, no animation.
- At ≤ 48 px the face may drop out; state is then carried by posture + core
  (the contract requires every state to be distinguishable at 48 px).
- NIDO↔NIDO link visuals are UI chrome *around* avatars, never inside the
  avatar mesh, and never imply identity verification.

---

## 6. Privacy tiers (enforced at export, not at render)

| Tier | Content | Where it may go |
|---|---|---|
| `local` | full Personal NIDO (all layers, custom) | device only |
| `contact` | user-chosen simplified version (no FREE-tier custom bits) | per-contact, explicit export |
| `public` | silhouette + sprout (or Brand Mark) | public/unknown contexts |

Contract rules:
- The descriptor carries its `tier`. A renderer MUST refuse to render a
  `local` descriptor into a `contact`/`public` context (fail-closed).
- CONTACT/PUBLIC descriptors are produced by an explicit export function that
  strips layers; never by filtering a local render at display time.
- Shared/exported assets contain no personal metadata (names, keys,
  identifiers, location). The manifest's `thumbnails` for shared tiers are
  generated from the exported descriptor, not from the local one.
- "Identity verified" UI is separate chrome, never part of the avatar asset.

---

## 7. Integration points in the app (when built)

- **Avatar provider (future):** a React context mirroring `LanguageContext`/
  `ThemeContext` patterns — `useAvatar()` returns the current
  `AvatarDescriptor` + `setState()` bridge fed by the orchestrator's
  operational state. Screens consume the context; they never touch the renderer.
- **Settings:** avatar preset picker, tier defaults per contact, reduced-motion
  override, 2D/3D preference — enumerated from the manifest (§2.3).
- **Diagnostics:** asset checksum failures, backend availability, and
  fallback activations are logged to the diagnostics channel (no PII).
- **Editor (future):** layer/preset pickers read the manifest; thumbnails are
  deterministic pre-renders (`nido_thumb_*`).

## 8. Non-goals / prohibitions

- No avatar parameter hard-coded in UI components (all via descriptor).
- No network fetch of avatar assets at runtime (bundled + verified, like models).
- The avatar is EXPRESSION (`AVATAR = EXPRESSION`). It is never identity,
  never a trust signal, never a meter/progress bar, never a carrier of
  private data.
- No new 3D assets enter the app until the BASE_MASTER turnaround is approved
  and each asset passes the 12-point QA (`NIDO_3D_ASSET_SPEC.md` §5).

## 9. Open questions

- Choice of 3D backend for React Native offline (three.js via expo-gl vs.
  filament vs. pre-rendered-only): needs a spike measuring APK size, RAM,
  and cold-start cost on a real device. **Not decided here.**
- Whether `hero` LOD ships in the APK or as an optional download pack.
- Exact `AvatarState` list if the 9 app states (`NIDO_AVATAR_SYSTEM.md` §5)
  need finer granularity (e.g. waiting-approval as distinct avatar state).
