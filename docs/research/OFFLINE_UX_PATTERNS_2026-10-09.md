# Offline-first UX patterns for NIDO — 2026-10-09

**Scope:** read-only research. Novel UX patterns for offline-first apps that
NIDO can adopt, grounded in named apps/articles (sources at the end). No code
involved; patterns only.

## 1. Offline state communication

- **Invert the framing: never show "You're offline" warnings.** The best
  local-first apps quietly do their job; reliability without commentary is
  what builds trust. NIDO's inversion opportunity: replace the whole
  connectivity vocabulary with a persistent **"on-device" indicator** (always
  green, always true) — the absence of spinners/warnings becomes the primary
  trust signal. NIDO is offline-by-design, not offline-tolerant; there is no
  sync state to report.
- **Micro-signals for local state** ("Saved locally", "Updated just now")
  give users a sense of control over exactly what happened to their data.
- **Outbox honesty:** failed items get a `failed` state with retry/discard
  actions — never silently dropped, never a success toast before a durable
  local commit.

## 2. Slow-model UX (making a 0.5B model feel fast)

- **Doherty's threshold: own the first 400ms, narrate the rest.** Echo the
  user's text into the thread instantly; replace generic "thinking"
  animations with real named states ("reading your memory…", "checking
  reminders…"); every wait gets an exit (cancel, edit/resend) and a reason.
- **Deterministic instant lanes for common intents.** Built-in tools
  (calculator, date/time, device state) answer instantly with a distinct
  "instant" visual treatment vs. the "thinking" treatment for model replies —
  common queries never touch the model.
- **Design from the model's actual capabilities outward.** On-device ~3B
  models are positioned for focused tasks (summarization, extraction); don't
  ask them for code, math, or factual Q&A. Keep user data local, use strict
  output schemas, "show your work."
- **Uncertainty as a first-class visible state.** Graduated confidence
  signals; if the agent cannot say "I'm not sure," redesign the interaction
  before adding capability. A hallucination in the same font as a fact is
  more dangerous than an honest error message.

## 3. Onboarding for on-device AI

- **Three-step funnel: install → download model → load**, with a **"fit
  badge"** telling the user whether a model runs well on *their* phone
  (device-scaled context/RAM) — the raw model list overwhelms non-technical
  users.
- **Wi-Fi-only, resumable, determinate downloads** shown as a system
  notification; model catalog ships inside the signed APK so models only
  change via app update.
- **Honest ceiling stated upfront** — say the limitation before first use
  ("NIDO is smart about your life, not the world's trivia — on purpose").
  Never meet the user with a dead input box.
- **Contextual permission asks, not a pile:** Bluetooth/Nearby-devices only
  when the user taps "Connect to a friend's NIDO"; alarms only when creating
  the first reminder. Benefit-stated microcopy each time.
- **Anti-pattern to avoid:** silently downloading a multi-GB model without
  consent (the canonical example of how *not* to ship on-device AI).

## 4. Privacy-as-UX

- **"Your data never leaves this device" as a badge, not a policy line.**
  Falsifiable, simple, in plain language, embedded in the flow.
- **Invisible security:** protection surfaces only when needed; repeated
  "This is secure!" warnings backfire. Specific honest statements beat vague
  ones.
- **The airplane-mode proof demo:** the strongest trust gesture — invite the
  user to enable airplane mode during onboarding and watch the assistant keep
  working. Nothing communicates "private" like a falsifiable live demo.
- **Data-flow transparency:** a local data explorer showing memory entries,
  what's encrypted, and a "Clear all" path (already in NIDO's baseline).

## 5. P2P / device-to-device UX

- **Briar's "add contact nearby" ceremony:** explicit warning to meet in
  person → Bluetooth discoverable → mutual QR scan → "waiting for contact"
  → automatic addition. "Make Introduction" flow for mutual contacts.
- **Signal safety numbers + mark-as-verified:** per-chat fingerprint (digits
  + QR) derived from identity keys, verified in person, framed explicitly as
  MITM protection.
- **Mutual short-authentication-string (SAS):** both sides independently
  compute a short human-comparable fingerprint from both public keys and
  visually confirm before committing — one extra screen closes MITM on both
  legs (known limit: users who tap "Confirm" without comparing).
- **Proximity as implicit trust signal:** first pairing always requires
  physical proximity; remote pairing carries visibly higher-friction
  verification.

## Top 5 concrete adoptions for NIDO (ordered by impact)

1. **"Airplane-mode-proof" trust badge + guided proof moment in onboarding.**
   Persistent unobtrusive status indicator ("On-device · no network needed")
   plus an onboarding moment inviting the user to enable airplane mode and
   watch NIDO keep working.
2. **Fast-lane UI for deterministic answers + 400ms acknowledgment + named
   thinking states.** Instant echo of user text; "instant" vs "thinking"
   visual treatments; named steps; cancel/regenerate on every generation.
3. **Curated model onboarding:** one "Recommended for this device" card with
   fit badge, size + Wi-Fi warning, determinate resumable progress, and an
   honest-ceiling line upfront. Advanced users keep a secondary model browser.
4. **Signal-style trust ceremony for NIDO↔NIDO pairing:** mutual QR scan +
   short authentication string both parties visually confirm before commit,
   proximity required for first pairing, "verified" state persisted per
   contact.
5. **Sourced answers + graceful "I don't know" as first-class UI.** Answers
   carry small source chips ("from your memory"); when ungrounded, the model
   says so plainly with a specific offer — implements NIDO's Phase-3
   honest-abstention directive as interface, turning small-model limits into
   trust.

## Key sources

- https://medium.com/@exlinelabs/why-exline-labs-designs-offline-first-because-users-dont-wait-for-wi-fi-524d8046e0db
- https://www.inkandswitch.com/local-first/
- https://uxdesign.cc/stop-blaming-the-model-for-slow-ai-heres-how-to-design-for-it-doherty-s-threshold-as-a-guideline-5fa6d52e23fc
- https://github.com/a-ghorbani/pocketpal-ai
- https://github.com/Mintplex-Labs/anythingllm-mobile
- https://www.welaunch.sh/blog/spotlight-local-llm-chat-with-ai-on-your-iphone-no-cloud-involved
- https://github.com/thenguyentrong/watch-ai/blob/HEAD/docs/adr/0003-gemma-on-device.md
- https://github.com/vaimalaviya1233/aicorechat
- https://briarproject.org/manual/
- https://github.com/sodre90/term-bridge/blob/HEAD/docs/superpowers/specs/2026-07-10-pairing-mitm-fingerprint-design.md
