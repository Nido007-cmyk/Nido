> **Language:** English · [Español](../es/architecture/TECH_DEBT.md)

# Tech Debt — NIDO

**Status:** REGISTER (2026-09-27, read-only audit). No fixes applied — this
track is documentation-only.
**Severity:** HIGH = data-loss/security/correctness risk · MEDIUM = blocks
near-term features or degrades quality · LOW = polish/inconsistency.

---

## HIGH

### TD-1 — "Clear All Data" misses the memory DB and all Keystore keys
`resetAllAppData()` (`src/services/appReset.ts:27-35`) deletes
`aoair_knowledge.db`, `models/`, `corpus/`, `settings.json` — but never calls
`clearMemoryDb()` (`src/agent/memory/memoryStore.ts:295`, exists but
unreferenced by any UI/reset path) and never deletes SecureStore keys.
After "Danger Zone > Clear All Data": agent facts/notes/reminders, the P2P
identity + contacts + message history, and all three Keystore keys
**survive**. For a privacy-first app, a factory reset that leaves identity
and memory behind is a correctness bug, not polish. The file's own header
comment (`appReset.ts:12-17`) is stale — it predates `nido_memory.db`.

### TD-2 — NidoScreen's Bluetooth transport is an explicit-fail stub
`createPlatformTransport()` falls back to `NativeP2PTransport`, which throws
`"Transporte P2P nativo no disponible: compila el módulo nido-p2p…"`
(`src/p2p/nativeTransport.ts:189-193`). The Kotlin module exists in
`modules/nido-p2p/` but is not compiled into the current build path, so
P2P discovery/connect/send fail loudly at runtime. The crypto, pairing,
queue, and inbox layers above it are real — the transport is the gap.
Tracked until the first real APK includes the compiled module (C-1).

### TD-3 — Dev-mode plaintext fallback for both encrypted DBs
`getDatabaseKeyHex()` returns `null` in `__DEV__` without SecureStore → both
DBs open **unencrypted** with only a console warning
(`src/agent/memory/memoryStore.ts:110-115`). Production is fail-closed
(throws), but any release build that still defines `__DEV__` would silently
store plaintext. `src/diagnostics/security.ts` exists to verify
SQLCipher/Keystore on-device — CONFIGURED ≠ VERIFIED applies here.

## MEDIUM

### TD-4 — `settings.json` is plaintext
All 17 settings fields (`src/models/settings.ts:44`) — including
`customSystemPrompt`, `modelRoleAssignments`, `activeModelId` — are readable
by anything with file access. Inconsistent with the encrypted-DB bar.
Proposed: encrypt the whole file with the SQLCipher DEK or move sensitive
keys into the encrypted DB (`DATA_MODEL.md` §2.5, §3).

### TD-5 — No schema migration framework
`meta.schema_version = 1` is written but never read for migration
(`memoryStore.ts:142-148`). Evolution is ad-hoc `CREATE TABLE IF NOT EXISTS`
plus one-off ALTERs (`src/rag/db.ts:180`, `src/p2p/store.ts:38-42`). Any
future column/type change risks breaking existing installs with no
upgrade/downgrade path. Fix before the first public release: versioned
`up()` migrations, never skipped (`DATA_MODEL.md` §3).

### TD-6 — Dead memory tables: `people`, `daily_log`, `preferences`
Full CRUD exists in `memoryStore.ts` but `savePerson`/`logDay`/`setPreference`
have **zero non-test callers** — reads always return empty. Either wire them
up (user profile needs `preferences`) or drop them before v1; dead schema
invites wrong assumptions (`DATA_MODEL.md` §2.1).

### TD-7 — Foreign keys not enforced
`chat_messages.session_id` / `answer_feedback.message_id` declare
`REFERENCES` but no `PRAGMA foreign_keys = ON` anywhere. Deletes are manual
(`chatHistory.ts:deleteSession`). Works today; a future writer bypassing the
helper orphans rows.

### TD-8 — Two implemented screens are unreachable (dead UI)
`UsageStatsScreen.tsx` and `SystemMonitor.tsx` have zero references anywhere
— real logic, never rendered. Decide: wire them into navigation (the drawer
already has a Telemetry entry pointing at UsageStatsContent) or delete them.

### TD-9 — NidoScreen bypasses i18n entirely + has no QR scanner
20 hard-coded Spanish strings, zero `t()` calls — the single biggest i18n
hole (`I18N_ARCHITECTURE.md` §3). Separately: QR *display* is pure-JS and
real, but QR *scanning* is not built ("Sin cámara todavía",
`NidoScreen.tsx:412`) — pairing requires pasting the code as text.

### TD-10 — Reminder text leaks to the OS notification tray
Reminder *bodies* are encrypted in `agent_reminders`, but
`src/routines/startup.ts:48-52` fires them as OS notifications — plaintext
then lives in the tray/lock screen. Needs a "never put secrets in reminders"
rule and, ideally, a redaction option.

### TD-11 — i18n default is Spanish-first, directive says English
`deviceDefaultLanguage()` (`src/models/settings.ts:222`) and the
`src/i18n/index.ts` header comment enshrine a Spanish-first default;
`NIDO_LANGUAGE_REQUIREMENT.md` mandates English native/default/fallback.
Small fix, but it touches first-run behavior — needs the product decision in
`I18N_ARCHITECTURE.md` §5.1.

### TD-12 — Notification copy is hard-coded Spanish
`src/notify/notifications.ts`: channel names ("Recordatorios de NIDO",
"Resumen diario de NIDO") and titles ("NIDO · Recordatorio", "NIDO · Tu día")
are literals. Must move to locale keys.

### TD-12b — M-5 security warning copy is Spanish-only (Priority 1 i18n debt)
~~M-5 (`b27bde1`) added security warning copy with Spanish literals and no
locale keys — recorded here as accepted debt, NOT fixed in the Priority 2
lane per the isolation rule. Must be migrated to EN-first i18n keys (en/es/pt)
in a dedicated i18n pass.~~
**RESOLVED.** Migrated to EN-first i18n keys in the i18n debt lane (see
commit below): `agentConfirm.pairBindingKnownSameName`,
`agentConfirm.pairBindingKnownOtherName`, `agentConfirm.pairBindingNameConflict`
in `en`/`es`/`pt`, with English fallbacks in `handlers.ts`. The same lane
also migrated the other unambiguous hardcoded P1/P2 user-visible strings:
M-6 approval dialog + review/decide outputs (`agentConfirm.approveTask*`,
`agentConfirm.taskNotFound`, `agentTasks.*`), M-3 confirm gate
(`agentConfirm.confirmBlocked`, `agentConfirm.confirmCancelled`), and M-4
`sendChat` errors (`p2p.sendChat*`). Spanish output is byte-identical to the
previous literals (proven by `src/i18n/migratedStrings.test.ts`).

**Remaining i18n debt (documented, not changed in this lane):**
- M-6 date rendering still uses hardcoded `toLocaleString("es-MX", …)` in
  `nido_review_tasks` — locale-aware date formatting is a design change, out
  of scope here.
- Many older (pre-P1/P2) hardcoded Spanish strings remain (tool outputs,
  `fmtDateTime()`, device-time Spanish, app-launcher text) — need a full
  catalog pass with product copy review, not a mechanical migration.

## LOW

### TD-13 — "the upstream project" branding remnants
`AboutScreen.tsx`, `ChatHeader.tsx`, `Drawer.tsx` (×"the upstream project"), `SetupWizardScreen.tsx`
(hero title), repo URL `github.com/rferrari/boar-app` in About. Rebrand to
NIDO incomplete — visible to users.

### TD-14 — Hard-coded English strings in otherwise-localized screens
`UsageStatsContent.tsx` (16 headers), `PromptIdeasCarousel.tsx` (12),
`ThemeSelector.tsx` (8+), `VoiceInputButton.tsx` (2 alert strings),
`MarkdownMessage.tsx` (2), misc singletons ("LANGUAGE", "ERR_LOCAL_INIT",
"🧭 adaptive", "tok/s"). Full list in `FEATURE_MAP.md` §9.

### TD-15 — ThemeSelector ships decorative fake telemetry + typo
`"18.4 tok/s • 0ms Cloud Latency • 100% Offline"` is invented preview text
(`components/ThemeSelector.tsx:264`) and l.142 reads "for dad & bright
glare". Cosmetic, but fake numbers in a telemetry context erode trust —
replace with clearly-labeled sample data or remove.

### TD-16 — Knowledge packs are plaintext SQLite (by design, LOW)
`src/rag/packs.ts:76` opens corpus packs with no key. Public data only — no
user content — so acceptable; recorded so nobody "fixes" it into an
incompatible format later.

### TD-17 — Eval/dev artifacts outside the reset path
`documentDirectory/eval/` (JSONL, pending/status files) is plaintext and not
cleared by `resetAllAppData()`. Dev-only surface; include in reset for
completeness.

### TD-18 — P2P sessions are memory-only (deliberate trade-off)
Encrypted sessions + frame reassemblers (`src/p2p/messenger.ts:54-63`) die on
restart; outbox persists so nothing is lost, but every restart forces
re-handshake. Acceptable; record `last_handshake_at` per contact when the
state model lands (`DATA_MODEL.md` §2.4).

---

## Risky dependencies (watch list)

| Dependency | Risk |
|---|---|
| `llama.rn@0.13.0-rc.4` | **Release candidate**, not stable — native build breakage risk (already the long pole in CI); pin and re-evaluate before any upgrade |
| `expo-sqlite` + SQLCipher | Encryption is wired in code but **unverified on a physical device** (C-1 open); `PRAGMA cipher_version` check exists precisely for this |
| `expo@57` / `react-native@0.86.3` / `react@19.2.3` | Bleeding-edge major versions; expect churn in the 57/0.86 line |
| `modules/nido-p2p`, `modules/voice-input` | Custom native modules; Kotlin `promise.reject()` arity already broke once on SDK 57 (fixed) — treat native-module upgrades as high-risk |
| No React Navigation | Manual state-machine navigation (deliberate, small surface) — fine now, but deep-linking or complex flows will want a real router later |

## Functions with no real implementation (recap)

- `savePerson` / `logDay` / `setPreference` — full CRUD, zero non-test callers (TD-6)
- `clearMemoryDb()` — exists, unreferenced by UI/reset (TD-1)
- `NativeP2PTransport` — explicit-fail stub until the Kotlin module compiles (TD-2)
- QR scanner — absent; paste-as-text only (TD-9)

## What is NOT tech debt (deliberate, keep)

- Telemetry never storing prompt/response text — privacy by design.
- P2P private keys only in SecureStore, never in the DB — correct.
- `chunks_fts`/`chunk_embeddings` plaintext-adjacent packs — public corpus.
- Manual navigation instead of React Navigation — acceptable at this size.
