> **Language:** English · [Español](es/NIDO_DESIGN_LANGUAGE.md)

# NIDO Design Language

**Status:** design proposal, v0.1 — for review, not implementation.
**Rule:** the UI *represents* NIDO's rules. It never weakens Policy Engine, consent, minimum disclosure, or local-first to simplify a screen.

---

## 1. Design principles

1. **Warm before clever.** Every screen should feel like a quiet room, not a cockpit.
2. **Private is visible, never noisy.** Privacy state is always one glance away, never a lecture.
3. **Human, not childish.** Friendly curves, grown-up typography, no cartoon excess.
4. **Calm by default.** Nothing pulses, badges, or begs for attention unless a human decision is genuinely required.
5. **Premium minimalism.** Generous whitespace, one idea per card, honest materials (paper, sand, leaf — not glassmorphism neon).
6. **Futuristic without sci-fi.** No holograms, no gradients-from-space, no robot chrome. The future here is quiet and domestic.
7. **The agent is someone you talk to, not a dashboard you operate.** Home is a conversation starter, not a control panel.

---

## 2. Color

Palette is built on warm neutrals + botanical greens. **No Meta blues anywhere.** Primary action color is **olive**, not blue — this is the single strongest differentiator from Meta/Google/Microsoft assistant UIs.

### Tokens

| Token | HEX | Usage |
|---|---|---|
| `--cream` | `#FAF6ED` | App background |
| `--paper` | `#FFFDF7` | Cards, sheets, chat bubbles (NIDO) |
| `--sand` | `#ECE1C9` | Secondary surfaces, pressed states |
| `--sand-deep` | `#DECFAE` | Borders on sand, dividers |
| `--sage` | `#DDE3D0` | Soft sage surface (info chips, availability) |
| `--sage-ink` | `#5C6B47` | Text/icons on sage |
| `--olive` | `#6C7346` | Primary actions, active states, links |
| `--olive-deep` | `#545A34` | Pressed primary, emphasis text on light |
| `--olive-ghost` | `#EFF1E4` | Tinted surface for primary-adjacent content |
| `--charcoal` | `#2B2A25` | Primary text |
| `--bark` | `#4A463C` | Secondary text |
| `--muted` | `#8B8471` | Tertiary text, placeholders |
| `--line` | `#E6DCC4` | Hairline borders |
| `--clay` | `#B26E4B` | Attention / "Never" tier / destructive (terracotta, not red-alert) |
| `--clay-ghost` | `#F6E9DD` | Tinted surface for attention |
| `--gold` | `#C99B3F` | Sparingly: approval highlights, stars — never as primary |

### Rules

- Text on `--cream`/`--paper` is `--charcoal` (contrast ≥ 12:1).
- `--olive` (#6C7346) on `--paper` = 5.9:1 — OK for large text/UI; body text in olive uses `--olive-deep` (7.4:1).
- `--muted` on `--paper` = 4.6:1 — tertiary only, never for essential info.
- Never use pure black, pure white, or saturated blue/purple gradients.
- Dark mode is out of scope for v0; the palette is specified to remain warm if one is added later (no inversion to cold dark).

---

## 3. Typography

- **Display:** *Fraunces* (warm serif, soft optical sizes) — headlines, greetings, empty states. Conveys premium + human, and is visually far from Meta's geometric sans and Apple's SF.
- **UI/Body:** *Inter* — everything else. Neutral, legible, excellent at small sizes.
- On Android product builds, Inter maps to the system stack; Fraunces ships as the single bundled display font (offline-first: no runtime font downloads).

| Style | Size / Weight | Usage |
|---|---|---|
| Display L | 32 / 600 Fraunces | Onboarding headline |
| Display M | 24 / 600 Fraunces | Screen greetings ("Good evening, Arsrs") |
| Title | 18 / 600 Inter | Card titles, sheet headers |
| Body | 15 / 400 Inter | Main text |
| Body-strong | 15 / 600 Inter | Emphasis |
| Caption | 13 / 400 Inter | Secondary info |
| Micro | 11 / 600 Inter, +0.04em tracking, uppercase | Eyebrows, section labels ("PRIVACY", "WORKING") |

Line height 1.45 for body, 1.2 for display. Minimum body size 15sp; the app must honor system text scaling up to 200% without clipping (scroll, don't truncate, critical actions).

---

## 4. Spacing, radii, elevation

- **Spacing scale (4pt base):** 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48. Screen gutters 20.
- **Corner radii:** `--r-sm: 12` (chips, small controls), `--r-md: 20` (cards, bubbles), `--r-lg: 28` (sheets, hero cards), `--r-pill: 999` (inputs, primary buttons).
- **Elevation:** soft and warm, never harsh. Resting card: `0 1px 2px rgba(74,60,32,.06)`; raised (sheets, dialogs): `0 12px 32px rgba(74,60,32,.14)`. No elevation on flat list rows — separation by `--line` hairlines.
- **Texture:** an extremely subtle paper grain may be applied to `--cream` backgrounds at ≤3% opacity. Never gradients-as-decoration.

---

## 5. Components

### 5.1 Cards
`--paper` fill, `--r-md`, 1px `--line` border *or* resting shadow (not both), 16–20 padding. One idea per card: title → content → at most one action row. Cards never contain nested cards.

### 5.2 Buttons
- **Primary:** `--olive` fill, `--paper` text, pill, 52px height, 600 weight. Pressed: `--olive-deep`.
- **Secondary:** transparent fill, 1.5px `--olive` border, `--olive-deep` text, pill, 52px.
- **Tertiary:** text-only `--olive-deep`, 44px min target.
- **Destructive/attention:** `--clay` variants of the above.
- Approval dialogs always offer three explicit options, never a single "OK": **"Only this time"** (primary) / **"Always for María"** (secondary) / **"Never"** (tertiary, clay). This maps 1:1 to `ALLOW_ONCE` / `ALLOW_FOR_CONTACT` / `DENY`.

### 5.3 Inputs (voice/text)
The main input is a **pill, 60px**, `--paper` with `--line` border: `[＋] Ask NIDO anything… [mic]`. Voice and text are equals — the mic is not a secondary mode. Listening state: the pill border becomes `--olive` and the mascot (small, 28px) appears at the left with the *listening* pose; a live caption line shows recognized words. No full-screen voice takeover.

### 5.4 Chips & status pills
- **Privacy chips** (sage): `Processed on device`, `Offline`, `No Internet used`, `Direct NIDO connection`. Small nest glyph + 13px `--sage-ink` text on `--sage`.
- **Mode pill** (sand, subtle): `Offline` / `Local-first` / `Online enhanced` — appears in headers and contextually, never as a hero badge.
- **Task state chips:** Working (olive), Waiting for another NIDO (sand), Needs your approval (clay), Completed (sage).

### 5.5 Toggles & permission tiers
No bare toggles for capabilities. Permissions use the **three-tier list** (Contact permissions screen):
- **Can automatically** — olive check in a sage circle.
- **Must ask me** — clay dot in a sand circle.
- **Never** — clay ✕ in a clay-ghost circle.
Each row shows the capability in plain words ("Ask if I'm available") plus the exact `capability/version` in micro type underneath for verifiability. Tapping a row cycles tiers with a confirmation for widening (widening = explicit new decision, never silent).

### 5.6 Privacy indicators
The **nest glyph**: three concentric broken arcs (a nest seen from above) — our original mark for "stays in the nest" = on-device / private. Used in privacy chips, Privacy Activity rows, and the approval dialog header. Never accompanied by crypto jargon.

### 5.7 Agent-to-agent indicators
The **bridge glyph**: two rounded squares (two NIDOs) joined by a single curved line. Identity is always explicit with four distinct treatments:
- **You** — your initial in a sand circle.
- **Your NIDO** — the mascot mini (28px).
- **Other person** — their initial in a sage circle.
- **Their NIDO** — the mascot mini in *outline* style (same shape, unfilled) + their initial beneath.
Inter-agent work is shown as a single status line, never message logs: *"Your NIDO ↔ María's NIDO — Negotiating availability…"* → *"Found a time — 6:00 PM"*. Chain-of-thought and protocol messages are never rendered.

### 5.8 Progress & waiting
- Determinate: 4px olive bar, `--r-pill`, on sand track.
- Indeterminate/waiting on another NIDO: the bridge glyph with a slow drifting dot along the curve (respects reduced motion → static). Text states what is awaited and who holds it: "Waiting for María's NIDO to respond".
- Long tasks persist as cards in Tasks; the conversation never becomes an infinite scroll of status lines.

---

## 6. Motion

- **Calm:** 200–300ms, `ease-out`, small distances (8–16px), fade+rise for sheets.
- The mascot drifts (never bounces): 2–4px float on a 4s loop in hero contexts only.
- **Reduced motion:** honor `prefers-reduced-motion` / Android animator settings — all loops become static, transitions become fades ≤150ms.
- No haptic beyond the system keyboard/confirmation defaults.

---

## 7. Mascot system — "Nidito"

### 7.1 Concept & name
**Nidito** — diminutive of *nido* (nest). A small, soft, pebble-shaped being that *carries its nest with it*: it sits in a shallow woven nest wherever it goes. The metaphor is the product: shelter, home, "your mind has a nest". The name is ownable, Spanish-rooted like the product, and unused by any known assistant.

### 7.2 Visual design (original — see originality review §10)
- **Body:** a smooth pebble/dome — wider at the base, sand-colored (`#E9DCBE`) with a soft inner shade (`#DCC99E`) on the lower third. No limbs, no ears, no antennae.
- **Nest:** 3–4 hand-drawn curved strokes beneath the body in olive-bark (`#8A6F4D`), forming a shallow woven bowl. The body always sits *in* the nest — never floating.
- **Face:** two charcoal dot eyes + one small calm smile arc. Nothing else. No blush, no eyebrows.
- **What it is NOT:** not a plush toy, not a chick, not a ghost, not a robot, not a sprout-creature. No crown/wreath, no toga, no clothing of any kind.

### 7.3 Poses (SVG, reused everywhere)
1. **Idle** — level, gentle smile. Default presence.
2. **Thinking** — 6° tilt, eyes glance upward, three small dots rising above (no question marks, no gears).
3. **Listening** — level, smile slightly wider, two small sound arcs on one side.
4. **Confirming** — eyes become happy upward arcs, tiny 2px lift (static in reduced motion).
5. **Resting** (offline/sleep) — eyes become soft horizontal lines, nest strokes slightly dimmed.

### 7.4 Behavior & size rules
| Context | Size | Behavior |
|---|---|---|
| Onboarding hero | ≤160px, once | Gentle 4s drift |
| Home header | 40px | Idle; becomes *thinking* while working |
| Chat avatar | 28px | Idle; *listening* while mic is live |
| NIDO↔NIDO card | 32px pair | *Thinking* while negotiating; *confirming* on agreement |
| Privacy confirmation | 32px | *Confirming* |
| Task completed | 40px inline | *Confirming*, once |
| Error/recovery | 40px | *Resting* eyes → idle; copy leads, mascot supports |
| Waiting/offline | 32px | *Resting* |

**Iron rule:** in daily use Nidito is a discreet presence (≤40px). It never occupies half the screen outside onboarding. It never speaks in first person *as* the assistant in a cutesy voice — NIDO's copy stays calm and plain; Nidito is a presence, not a character with dialogue.

---

## 8. Privacy-as-UX language

Approved phrases (plain, no jargon). Crypto works underneath; the user sees outcomes.

- `Processed on device`
- `Offline` / `No Internet used`
- `Direct NIDO connection` (for Bluetooth/LAN agent links)
- `Shared: Availability 6–7 PM` (always names exactly what left)
- `No calendar details shared`
- `Nothing left your phone today`
- `Waiting for María's NIDO` (names who holds the next step)
- Attribution for peer content: `From María's NIDO — not verified`

Forbidden on screen: "encrypted", "AES", "Ed25519", "hash", "signature", "zero-knowledge", "military-grade", "unhackable", "blockchain". (The Privacy Activity screen may link to a "How it works" explainer in docs, not in UI copy.)

---

## 9. Accessibility

- **Contrast:** body text ≥ 7:1 on backgrounds (`--charcoal` on `--paper` ≈ 13:1); UI accents ≥ 4.5:1; tertiary `--muted` ≥ 4.5:1 (never carries essential meaning alone).
- **Touch targets:** ≥ 48×48dp for all interactive elements; permission tier rows are full-width 64dp rows.
- **Text scaling:** honor system font scale to 200%; layouts scroll, critical actions never truncate.
- **Screen reader:** every mascot instance gets `contentDescription` per state ("NIDO is thinking", "NIDO is offline"); privacy chips read as full sentences ("Processed on device. Nothing left your phone."); the bridge glyph announces "Direct connection between your NIDO and María's NIDO".
- **State never color-only:** every status pairs color with an icon and a text label (chips always have text; tiers have ✓/•/✕ glyphs plus words).
- **Reduced motion:** see §6.

---

## 10. Originality review

Checked against: Meta AI app (blue/purple gradient orb, dark UI), Claude (terracotta "starburst", serif+orange), Siri (colorful gradient blob), Google Assistant/Gemini (four-color dots, blue/purple sparkle), ChatGPT (black/white minimalism), Alexa (blue ring), Bixby.

| Risk | Check | Verdict / change |
|---|---|---|
| Reference mockup (cream + plush character + bottom nav) | Our palette overlaps in warmth, but: primary is **olive** (theirs is sage/blue-grey), type is **Fraunces serif** display (theirs is geometric sans), mascot is a pebble-in-nest (theirs is a plush humanoid with wreath + toga), nav uses nest/home glyphs not generic icons | **Redesigned enough** — recorded |
| Chat bubbles | Standard pattern; ours are `--paper`/`--olive-ghost` with `--r-md` and no gradient | Standard, acceptable |
| "Ask anything" pill | Common; ours pairs mic as equal + mascot state, no sparkle icon | Acceptable |
| Orb/waveform assistant | We deliberately have **no orb, no waveform, no sparkle** — the mascot + bridge glyph replace them | **Differentiated** |
| Permission toggles | Replaced with the three-tier ✓/•/✕ list — no iOS-style switch rows | **Differentiated** |
| Blue "online" dots | Status uses olive/sage/clay with text labels, never blue dots | **Differentiated** |
| Bottom tab bar | Kept (platform convention, expected on Android) but with custom nest glyphs and olive active state; labels always visible | Platform convention, acceptable |

**Conclusion:** the combination of olive-primary + Fraunces display type + nest motif + pebble mascot + three-tier permissions is not visually confusable with any known assistant product. If future screens drift toward blue/purple gradients, orb iconography, or sparkle symbols, they must be redesigned per this section.
