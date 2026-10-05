# Spec — Offline Center screen (advance work, not yet implemented)

**Status:** SPECIFICATION ONLY. Do not implement until the Tier 2 UI lane reaches
Settings/Setup screens.
**Why:** "Nuestro fuerte es offline" must be *visible*. Today offline capability is
scattered across the setup wizard and Settings. This screen makes it one calm,
truthful dashboard: what works offline on this device, right now.

## 1. Concept

Settings → **Offline center**. One screen answering: "What can NIDO do with zero
network today?"

## 2. Layout (Tier 2 Daylight tokens)

### Status card (top, always visible)
- "Fully offline ready" (all core assets present) or
  "Offline ready — 2 items missing" (actionable, not alarming).
- Subtitle: "Everything below works in airplane mode."

### Sections

**Models**
- Each installed model: name, size, quantization, "Verified" (SHA-256) line.
- Missing/replaceable models: "Download" (goes through the same audited
  ModelManager path; every download lands in the Network Audit log).
- Delete action per model (frees space; reversible by re-download).

**Knowledge**
- Built-in corpus: article count, size, "Verified".
- Downloadable packs (see `../KNOWLEDGE_PACKS.md`): name, article count, size,
  "Download" / installed state / delete.
- "Build your own" row → points at the docs (deep link later).

**Voice**
- Honest state machine, three states:
  - "On-device voice ready" (whisper.cpp integrated — future)
  - "System voice (may use network)" — current truth, labeled as a limitation
  - Never show a green check on system voice. R-2: honest capability signaling.

**Storage**
- Bar: models + knowledge + app data vs free space. Numbers, not gauges (Tier 2 rule).

## 3. Copy (English, frozen-style; i18n keys from day one)

- Title: "Offline center"
- Status ok: "Fully offline ready" / "Everything on this screen works in airplane mode."
- Status incomplete: "Almost there" / "Download the missing items to go fully offline."
- Voice limitation: "System voice may send audio to the network. On-device voice is coming."

## 4. Data sources (all local)

- Models: ModelManager manifest + installed-assets state.
- Knowledge: corpus manifest + installed packs registry.
- Voice: capability flag (system vs on-device).
- Storage: `expo-file-system` disk info.

## 5. Non-goals

- Not a second download manager: it *surfaces* ModelManager state, it does not
  reimplement downloading, retry, or verification.
- No "optimize storage" magic button at v1. Show the numbers; let the user decide.
- Must render fully in airplane mode (it only reads local state).

## 6. Relationship to other specs

- Every download started here appears in the Network Audit screen (`NETWORK_AUDIT_SCREEN.md`).
- Integrity lines reuse the T-005 `verifyChecksum()` result already stored per asset.
- The setup wizard keeps its own first-run flow; Offline Center is the permanent home.
