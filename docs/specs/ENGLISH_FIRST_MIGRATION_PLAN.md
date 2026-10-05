# English-First i18n Migration Plan — NIDO

> **SPECIFICATION ONLY.** No code changes, no commits, no pushes.
> Implementation waits for the running CI build (`36357101406`) to finish and
> its artifact to be preserved. This plan stages the work; it does not start it.

**Date:** 2026-09-27
**Standing rule:** the app's native/default/fallback language is English, with full
i18n from the start. No hard-coded UI strings. (See `docs/NIDO_LANGUAGE_REQUIREMENT.md`.)

## 1. Current i18n wiring — verified status (2026-09-27)

| Item | Status |
|---|---|
| Config | `src/i18n/index.ts` — i18next + react-i18next, `fallbackLng: "en"`, `useSuspense: false`, no network |
| Locales | `src/i18n/locales/{en,es,pt}.json` — 29 namespaces, **369 leaf keys each, full EN/ES/PT parity** |
| Screens using `useTranslation` | **24** (About, CatalogItemCard, ChatHeader, ChatScreen, CorpusSettingsTab, Drawer, DrawerFooterStats, Evaluation, ExecutionTelemetry, KnowledgeBase, MemorySettings, ModelSetup, NidoScreen, PersonalDocuments, PersonalitySettings, ProcessingIndicator, PromptIdeasCarousel, SetupWizard, SystemMonitor, UsageStatsScreen, VoiceSettings, LanguageSelector, ModelLoadErrorCard, ReasoningPeek, SourceFootnotes) |
| Default language | English **regardless of device locale** (`deviceDefaultLanguage()` returns `"en"` in `src/models/settings.ts`) |
| Persisted selection | Yes — `LanguageContext` reads `getLanguageId()` on mount and `setLanguageId()` persists via settings store |
| Notifications | i18n-wired via lazy `require("../i18n")` (avoids native-module import cycle), `notifications.*` keys consumed, hard-coded English fallback object for pre-init path |
| Key parity | 340 keys used in code vs 369 in en.json — **2 keys MISSING** (see §3), 1 dead namespace (`lockScreen`) |

**Bottom line:** the infrastructure is complete and correct. The remaining work is
migrating hard-coded strings in files that never adopted it, plus fixing 2 missing keys.

## 2. Inventory — hard-coded user-facing strings (verified 2026-09-27)

Method: automated pass over `src/**` (tests, `__tests__`, conformance vectors and
eval harness excluded), matching JSX text nodes, string props
(`placeholder`/`title`/`accessibilityLabel`/…), `Alert.alert`, thrown `Error`s
(plain and template-literal), agent tool `description:` fields, and notification
payloads — then manual spot-checks of every flagged file. Counts are per-file
unique user-facing strings.

**Total: ≈155 hard-coded user-facing strings across ~30 files.**

### 2a. Agent tools — descriptions in SPANISH (English-first violation)

| File | n | i18n? | Examples |
|---|---|---|---|
| `src/agent/tools/manifest.ts` | 25 | no | "Guarda una nota de texto en el almacén local cifrado.", "Título de la nota" |
| `src/agent/tools/analyze.ts` | 5 | no | "El texto no contiene filas.", "No se detectaron columnas. ¿Es un CSV válido?" |
| `src/agent/skills/builtIn.ts` | 2 | no | "Armar el plan del día: combina calendario, hora actual…" |

These descriptions surface in the agent confirmation UI shown to the user.

### 2b. P2P errors — in SPANISH

| File | n | Examples |
|---|---|---|
| `src/p2p/nativeTransport.ts` | 20 | "HELLO no es JSON.", "HELLO de tipo desconocido." |
| `src/p2p/pairing.ts` | 11 | "Ponle un nombre a tu NIDO para emparejar.", "Clave pública inválida." |
| `src/p2p/protocol.ts` | 8 | "Mensaje demasiado grande.", "Envelope inválido." |
| `src/p2p/messenger.ts` | 6 | "Primero crea tu identidad NIDO.", "Ese es tu propio QR." |
| `src/p2p/crypto.ts` | 3 | "Clave en hex inválida.", "Claves de sesión inválidas." |
| `src/p2p/transport.ts` | 2 | "Sin conexión loopback." |
| `src/p2p/store.ts` | 1 | "Clave de firma del contacto inválida." |
| `src/p2p/base64.ts` | 1 | "base64 inválido." |

### 2c. Services / security errors

| File | n | Examples |
|---|---|---|
| `src/security/secureDatabase.ts` | 5 (template-literal) | "integrity_check no pasó en la base migrada.", "DEK inválida (fail-closed)." |
| `src/models/ModelManager.ts` | 5 (template-literal) | model download/integrity errors |
| `src/privacy/keyManager.ts` | 7 | "keyManager: SecureStore no disponible.", "keyManager: fuente aleatoria inválida." |
| `src/inference/LlamaEngine.ts` | 6 | "Failed to load", "LlamaEngine: model not loaded", "EmbeddingEngine: model not loaded" (`src/rag/embed.ts`: 1) |
| `src/services/thinking.ts` | 3 | thought-label fragments |
| `src/services/documentImporter.ts` | 3 | share-sheet error fragments |
| `src/services/executionTelemetry.ts` | 1 | share-sheet error fragment |
| `src/services/chatHistory.ts` | 1 | "New chat" (default chat title) |
| `src/services/citations.ts` | 1 | — |
| `src/services/appReset.ts` | 1 | — |
| `src/services/telemetry.ts` | 1 | — |
| `src/privacy/networkAudit.ts` | 1 | — |
| `src/agent/loop/agentLoop.ts` | 1 | — |
| `src/agent/memory/memoryStore.ts` | 2 | — |
| `src/agent/tools/confirm.ts` | 4 | confirmation prompt fragments |
| `src/agent/tools/dispatcher.ts` | 1 | — |
| `src/rag/seedCorpus.ts` | 1 | — |

### 2d. UI files without i18n

| File | n | Examples |
|---|---|---|
| `src/ui/UsageStatsContent.tsx` | 28 | "RAM & PROCESS MEMORY", "APP PROCESS RSS", "12GB Bounty RAM Audit…" |
| `src/ui/components/ThemeSelector.tsx` | 7 | "COLOR PALETTE & CONTRAST" |
| `src/ui/VoiceInputButton.tsx` | 2 | "Voice input unavailable", "No on-device speech recognition service was found on th…" |
| `src/ui/ExecutionTelemetryScreen.tsx` | 1 | "🧭 adaptive" (emoji label remnant) |
| `src/ui/theme/ThemeContext.tsx` | 1 | "useTheme must be used within a ThemeProvider" (dev error; low priority) |

### 2e. High-visibility screens — already migrated, residual items

`SetupWizardScreen`, `ModelSetupScreen`, `ChatScreen`, `NidoScreen`, `Drawer`,
`ChatHeader`, `PersonalDocumentsManager`, `MemorySettings`, `VoiceSettings`,
`PersonalitySettings`, `CorpusSettingsTab`, `KnowledgeBaseScreen`,
`AboutScreen`, `EvaluationScreen`, `CatalogItemCard` all use `useTranslation`.
Residual: **3 inline `t()` defaults** in `ChatScreen.tsx`
(`chatScreen.rateHelpful`/"Helpful", `chatScreen.rateUnhelpful`/"Unhelpful",
`chatScreen.copied`/"Copied") — keys exist; defaults are English and harmless,
but batch 1 removes the inline text for key-only calls.

### 2f. Key-parity findings (bugs to fix)

1. **MISSING keys (render wrong today):** `personalDocumentsManager.chunkCount`,
   `personalDocumentsManager.docCount` — used in code, absent from all 3 locale files.
2. **Dead namespace:** `lockScreen` (9 keys) — zero references in `src`. Remove from
   all 3 locale files.
3. **Namespaces orphaned by dead-UI removal:** `usageStatsScreen`, `systemMonitor`
   are consumed only by `UsageStatsScreen.tsx` / `SystemMonitor.tsx` (both slated
   for removal per `docs/qa/DEAD_UI_INVESTIGATION.md`). Remove the namespaces when
   the components go.
4. `personalities.*` is consumed **dynamically** (`t(\`personalities.${p.id}.label\`)`)
   — do NOT delete; static analysis misses it.

## 3. Migration batches (ordered)

### Batch 0 — Dead-code + dead-key cleanup (no translation)
- `git rm src/ui/SystemMonitor.tsx src/ui/UsageStatsScreen.tsx` (per dead-UI investigation; no test references — unblocked).
- Remove `systemMonitor`, `usageStatsScreen`, `lockScreen` namespaces from
  `en.json`, `es.json`, `pt.json`.
- Acceptance: `tsc` clean, full suite green, key-parity check shows 0 dead namespaces.

### Batch 1 — Highest-visibility screens (setup wizard, chat, drawer)
Files: `SetupWizardScreen.tsx`, `ModelSetupScreen.tsx`, `ChatScreen.tsx`,
`NidoScreen.tsx`, `Drawer.tsx`, `ChatHeader.tsx`, `PromptIdeasCarousel.tsx`,
`ProcessingIndicator.tsx`, `MarkdownMessage.tsx`.
- Work: remove the 3 inline `t()` defaults in `ChatScreen.tsx`; sweep for any
  remaining literal (emojis-as-icons are Tier 2 visual lane, NOT this batch).
- Acceptance: zero hard-coded user-facing strings in these files (static check);
  EN/ES/PT render verified on device for setup + chat + drawer.

### Batch 2 — Agent tool descriptions ES → EN (English-first violation)
Files: `src/agent/tools/manifest.ts` (25), `src/agent/tools/analyze.ts` (5),
`src/agent/skills/builtIn.ts` (2), `src/agent/tools/confirm.ts` (4).
- Work: author English-first descriptions, add `tools.*` namespace to all 3 locales
  with ES/PT translations. Tool descriptions are shown in the user-facing
  confirmation UI — they are product copy, not dev logs.
- Acceptance: no Spanish (or any non-English) user-facing string when language = en;
  ES/PT parity for every new key.

### Batch 3 — Settings, model UI, remaining screens
Files: `UsageStatsContent.tsx` (28), `ThemeSelector.tsx` (7),
`PersonalDocumentsManager.tsx` (+ fix the 2 missing keys),
`MemorySettings.tsx`, `VoiceSettings.tsx`, `PersonalitySettings.tsx`,
`CorpusSettingsTab.tsx`, `KnowledgeBaseScreen.tsx`, `CatalogItemCard.tsx`,
`ModelSetupScreen.tsx`, `VoiceInputButton.tsx` (2), `ExecutionTelemetryScreen.tsx` (1),
`EvaluationScreen.tsx`.
- Note: `UsageStatsContent` uses bounty-era vocabulary ("12GB Bounty RAM Audit");
  Tier 2 visual direction will rewrite this surface — migrate strings as-is now,
  rewrite copy in the Tier 2 batch. Do not block i18n on the redesign.
- Acceptance: zero hard-coded user-facing strings; EN/ES/PT parity; language
  switch in Settings re-renders every screen without restart.

### Batch 4 — Error messages (services, security, P2P, inference)
Files: `secureDatabase.ts`, `ModelManager.ts`, `keyManager.ts`,
`LlamaEngine.ts`, `embed.ts`, `thinking.ts`, `documentImporter.ts`,
`executionTelemetry.ts`, `chatHistory.ts` ("New chat" default title),
`citations.ts`, `appReset.ts`, `telemetry.ts`, `networkAudit.ts`,
`agentLoop.ts`, `memoryStore.ts`, `dispatcher.ts`, `seedCorpus.ts`,
all `src/p2p/*.ts` files (§2b).
- Work: template-literal errors become **parameterized keys** (`t("key", { var })`).
  Classify each error: user-visible (error cards, toasts, dialogs) → translate;
  dev-only (thrown where only logs/crash reports see it, e.g. `ThemeContext`
  provider misuse) → may stay English with a `// dev-only` comment.
- Many P2P/security errors are currently Spanish — these become English-first.
- Acceptance: with language = en, no user-visible surface shows Spanish;
  every user-visible error has EN/ES/PT keys.

### Batch 5 — Parity gate + regression guard
- Re-run the key-parity check: every `t("a.b.c")` (including dynamic
  `personalities.${id}.*` patterns) resolves in en/es/pt; zero dead namespaces.
- Add a CI lint (new file, e.g. `scripts/check-i18n-parity.mjs` run in `ci.yml`):
  fail on (a) missing keys in any locale, (b) hard-coded user-facing strings in
  `src/ui/**` outside `t()` calls.
- Acceptance: CI gate green; the 2 missing keys fixed and verified.

## 4. Acceptance criteria (all batches)

1. No hard-coded user-facing strings in migrated files (automated check).
2. EN/ES/PT parity for every new/changed key (automated check).
3. Language selection persists across restarts (already works — regression-test it).
4. English fallback: missing key in es/pt renders English, never blank (already
   configured — regression-test it).
5. `tsc` clean + full test suite green after each batch.
6. Device spot-check per batch on the Tab A9+ (setup, chat, settings language switch).

## 5. What NOT to touch

- **The running build.** No source change lands until CI run `36357101406`
  finishes and its APK artifact + SHA-256 + provenance are preserved. Batches are
  staged as separate commits on top, pushed one at a time via the Git Data API
  bridge (never `git push`).
- **BASE_MASTER 3D.** Mascot slots stay neutral until V2 Front + Front 3/4 approval.
- **Naming.** NIDO remains the internal codename; no renames in code or copy.
- **Tier 2 visual redesign.** Emoji-as-icons, bounty vocabulary rewrites, and the
  Daylight/Night Garden restyle are the UI lane's scope — this plan migrates
  strings as-is and does not redesign copy (except the Batch 2 English-first
  authoring, which is required by the language rule).
- **Licensing lane.** `~/workspace/nido-app-licensing` stays isolated until the
  standalone artifact is preserved.
- **Security posture.** No weakening of SQLCipher, Keystore, biometric gate, or
  integrity enforcement to make a batch pass.

## 6. Open questions (for the owner, not blockers)

1. P2P error strings: translate to ES/PT now, or English-only until P2P ships on
   real hardware? (Recommendation: English-first keys now, ES/PT with the batch —
   cheap while the files are open.)
2. `ThemeContext` dev error (`useTheme must be used within a ThemeProvider`):
   keep English dev-only, or key it? (Recommendation: keep, mark `// dev-only`.)
