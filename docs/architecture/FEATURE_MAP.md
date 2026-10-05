> **Language:** English · [Español](../es/architecture/FEATURE_MAP.md)

# Feature Map — NIDO app (screen by screen)

**Status:** AUDITED 2026-09-27 (read-only audit of the real codebase).
**Method:** every screen/component under `src/ui/` + `App.tsx` read and
classified against its actual backing code. No feature is listed as working
unless the code shows real backing logic.
**Legend:** BUILT = fully functional against real services · PARTIAL = works
but with identified missing/broken pieces · MOCK = renders but backed by fake
or non-functional controls · NOT BUILT = referenced but not implemented ·
DEAD = implemented but unreachable from any navigation path.

**Navigation model:** no React Navigation — a manual state machine.
`App.tsx`: `checking` → `locked` (biometric/PIN gate) → `required-setup` |
`chat`. ChatScreen is the hub; settings/about/telemetry/NIDO render as
full-screen replacements via boolean flags (no stack history). Drawer is a
custom `Animated` overlay.

---

## 1. App shell & onboarding

| Screen | Purpose | Status | Evidence / notes |
|---|---|---|---|
| App root + LockScreen (`App.tsx`) | Biometric/PIN gate, required-setup vs chat routing | BUILT | `ensureUnlocked` (l.38–108); gating via `ModelManager.requiredModelsPresent()`; 0 hard-coded strings |
| SetupWizardScreen | Mandatory 4-step first-run: hardware scan → tier select → model downloads → offline indexing | BUILT | Real RAM/disk probing, resumable downloads, embedding load + KB seeding; 1 hard-coded: "BOAR" hero title |
| ModelSetupScreen (`mode="required"`) | First-run model download UI | BUILT | Real `downloadManager` + `llamaEngine.load()`; 0 hard-coded |

## 2. Chat (core)

| Screen / component | Purpose | Status | Evidence / notes |
|---|---|---|---|
| ChatScreen | Main chat: streaming inference, RAG, sessions, feedback, TTS, deep research, adaptive routing, agent loop | BUILT | Real `llamaEngine`, `retrieve`/`assemblePrompt`, `chatHistory` CRUD, `runAgentLoop`, `runAdaptiveChat`, `speakAloud`; 75 `t()` calls; 1 hard-coded: drawer label `"NIDO"` |
| ChatHeader | Top bar: drawer, brand, offline pill, model label, tone/new-chat, deep-research toggle, live tok/s | BUILT | Props wired; 2 hard-coded: "BOAR", "tok/s" |
| Drawer | Sessions list + new chat + nav (Prompts, My Documents, Settings, Telemetry, NIDO, About) + footer stats | BUILT | Real session list; 1 hard-coded: "BOAR" |
| DrawerFooterStats | Live RAM/disk bars + last-query tok/s | BUILT | Polls real native stats; degrades if module unlinked; 0 hard-coded |
| PromptIdeasCarousel | Dismissible demo-prompt carousel | BUILT | Persists dismissal; **12 hard-coded English strings** (not in i18n) |
| ProcessingIndicator | Retrieving/thinking/generating status animation | BUILT | Presentational; 0 hard-coded |
| MarkdownMessage | Chat markdown + code blocks with copy/share | BUILT | Real parse + `Share.share`; 2 hard-coded: "COPY / SHARE", "✓ SHARED" |
| ReasoningPeek | Collapsible live reasoning ticker | BUILT | Real timer + peek text; 0 hard-coded |
| SourceFootnotes | Expandable RAG citation chips | BUILT | Real `RetrievedChunk`s; 0 hard-coded |
| VoiceInputButton | Mic → Android SpeechRecognizer dictation | BUILT | Real `VoiceInput` module; honest unavailable path; **2 hard-coded English Alert strings** |
| Toast | Auto-dismissing toast | BUILT | Prop-driven; 0 hard-coded |

## 3. Models & knowledge

| Screen / component | Purpose | Status | Evidence / notes |
|---|---|---|---|
| ModelSetupScreen (`mode="optional"`) | Settings dashboard: 9 accordion sections | BUILT | Real downloads/activation/danger zone; 0 hard-coded |
| CatalogItemCard | Model/corpus row: compat badge, progress/speed/ETA, use/remove | BUILT | Real `downloadManager` state; 0 hard-coded |
| CorpusSettingsTab | Corpus packs + personal documents | BUILT | Composes real components; 0 hard-coded |
| PersonalDocumentsManager | Import/list/toggle/export/delete document collections | BUILT | Real `documentImporter`; 0 hard-coded |
| KnowledgeBaseScreen | Drawer shortcut → PersonalDocumentsManager | BUILT | Thin wrapper; 0 hard-coded |
| ModelLoadErrorCard | Diagnoses load errors with retry/settings/wizard actions | BUILT | Keyword `diagnose()`; 1 hard-coded: "ERR_LOCAL_INIT" tag |

## 4. NIDO P2P (messenger)

| Screen | Purpose | Status | Evidence / notes |
|---|---|---|---|
| NidoScreen (tabs: chats/contactos/enlace) | P2P identity, QR pairing, contacts, encrypted chats | PARTIAL | **Real:** identity/fingerprint/pairing-code, pure-JS QR render, contacts + conversation from encrypted `p2p/store`, sends queued via `messenger.sendChat`. **Broken:** `createPlatformTransport()` → `NativeP2PTransport` stub throws explicit error until `modules/nido-p2p` (Kotlin Bluetooth RFCOMM) is compiled — discovery/connect/send fail loudly. **Missing:** QR *scanner* ("Sin cámara todavía", l.412 — paste code as text). **i18n:** entire screen bypasses `t()` — **20 hard-coded Spanish strings** |

## 5. Settings (9 real sections in ModelSetupScreen optional mode)

| Section | Component | Status | Notes |
|---|---|---|---|
| Tone | PersonalitySettings | BUILT | Response-style presets + custom prompt + max tokens + deep-research/adaptive toggles; all persisted |
| Models | (CatalogItemCard list) | BUILT | — |
| Knowledge Base | CorpusSettingsTab | BUILT | — |
| Memory | MemorySettings | BUILT | Auto-summarize, thresholds, caps, clear-all-history |
| Telemetry | UsageStatsContent | BUILT | **16 hard-coded English headers** — not localized |
| Display & Theme | ThemeSelector + haptics toggle | BUILT | Persisted theme/fontScale; **8 hard-coded English strings + decorative fake "18.4 tok/s • 0ms Cloud Latency • 100% Offline" preview text + typo "for dad & bright glare"** |
| Language | LanguageSelector | BUILT | Persisted via LanguageContext; 1 hard-coded: "LANGUAGE" header |
| Voice | VoiceSettings | BUILT | Enable toggle + engine probe; 0 hard-coded |
| Recovery & Danger Zone | (inline) | BUILT | Wizard relaunch + factory reset modal → `resetAllAppData()` (**which misses the memory DB and keys — see TECH_DEBT.md**) |

**Settings architecture note:** settings render from hand-built section
components (not yet a registry). Proposed: a settings registry
`{ key, type, default, scope, sensitive, ui }` so new settings (languages,
economy toggle, avatar prefs) render without per-setting UI code —
specified in `DATA_MODEL.md` §2.5. Language is selectable in Settings
(LanguageSelector) AND in the setup wizard — complies with "Settings →
Language".

## 6. Telemetry, evaluation, system

| Screen | Purpose | Status | Evidence / notes |
|---|---|---|---|
| ExecutionTelemetryScreen | Browse/export/clear persisted execution telemetry; launches eval | BUILT | Real list/export/clear; 1 hard-coded: "🧭 adaptive" |
| EvaluationScreen | Fixed eval set vs models/adaptive; progress, results, JSONL/CSV export; device-eval auto-run | BUILT | Real `evalHarness`; 0 hard-coded |
| AboutScreen | Static app info, version, air-gapped/hardware/benchmark cards | BUILT | Version from `app.json`; 2 hard-coded: "BOAR", repo URL |
| UsageStatsContent | Hardware telemetry: RAM/12GB audit, storage breakdown, inference stats | BUILT (i18n gap) | Real native stats; 16 hard-coded English strings |
| UsageStatsScreen | Fullscreen wrapper of UsageStatsContent | **DEAD** | Zero references; unreachable |
| SystemMonitor | RAM/disk bars vs budgets (4s poll) | **DEAD** | Zero references; unreachable (real logic, never rendered) |

## 7. Theming

| Piece | Status | Notes |
|---|---|---|
| ThemeContext + colors/spacing/typography | BUILT | Persisted `themeId` (midnight/amber/frontier) + `fontScale`; `useTheme()` app-wide |

---

## 8. Summary counts

| Status | Count | Items |
|---|---|---|
| BUILT | 30 | 10 screens (incl. App root + LockScreen) + 20 components |
| PARTIAL | 1 | NidoScreen (P2P crypto/pairing/queue real; BT transport explicit-fail stub; no QR scanner) |
| MOCK | 0 | No screen fakes backing data (closest: ThemeSelector's decorative preview text) |
| NOT BUILT | 0 | Everything referenced in navigation exists |
| DEAD (unreachable) | 2 | UsageStatsScreen, SystemMonitor |

**Zero** TODO/FIXME/stub markers in `src/ui/` — gaps are stated in plain
comments instead (NidoScreen:412, p2p transport comments).

## 9. i18n coverage column (summary)

Fully keyed via `t()`: App root, ChatScreen (75 calls), ModelSetupScreen,
SetupWizardScreen (except "BOAR"), KnowledgeBaseScreen, ExecutionTelemetryScreen
(except 1), EvaluationScreen, PersonalDocumentsManager, CorpusSettingsTab,
PersonalitySettings, MemorySettings, VoiceSettings, Drawer (except "BOAR"),
DrawerFooterStats, ProcessingIndicator, ReasoningPeek, SourceFootnotes,
AccordionSection, CatalogItemCard, Toast.
Gaps: NidoScreen (20 ES, no `t()` at all), UsageStatsContent (16 EN),
PromptIdeasCarousel (12 EN), ThemeSelector (8+ EN), VoiceInputButton (2 EN),
MarkdownMessage (2 EN), LanguageSelector header (1), misc brand/technical
("BOAR" ×4 screens, "tok/s", "ERR_LOCAL_INIT", "🧭 adaptive").
Notifications (`src/notify/notifications.ts`): hard-coded Spanish channel
names and titles ("Recordatorios de NIDO", "NIDO · Recordatorio",
"NIDO · Tu día") — must move to keys.

## 10. What's NOT in the app (confirmed absent)

- 3D avatar rendering of any kind (no three.js/filament/GLB; NidoScreen is a
  text messenger) — see `3D_INTEGRATION_CONTRACT.md`
- QR code *scanner* (only QR *display*)
- User profile screen / identity management UI beyond P2P pairing
- Economy UI of any kind (balances, inventory, ledger) — see
  `ECONOMY_ARCHITECTURE.md`
- Multi-device management UI
- Backup/export of identity or memory (only telemetry/collection exports)
- The 12 visual personality presets (exist only in design docs; in-app
  "personalities" are response-style presets)
