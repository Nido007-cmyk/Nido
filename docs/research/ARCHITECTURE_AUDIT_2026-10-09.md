# ARCHITECTURE AUDIT — NIDO @ 6daf61a5

**Date:** 2026-10-09
**Auditor:** Architecture & design pass (structural integrity)
**Scope:** Module boundaries, state management, startup, data flow, feature flags, migrations, offline-first, team scalability
**Method:** Direct code reading (file:line), import-graph tracing, startup-flow tracing, doc cross-check
**Rules:** READ-ONLY. Severity: **RISK** (architectural risk) / **DEBT** (tech debt to track) / **OK**.

**Overall:** The architecture is coherent for a single-developer codebase with strong conventions. The foundation layers (`security/`, `privacy/`) are clean. The structural weaknesses are: (1) the P2P layer depends upward on the agent layer in three places (layering inversion), (2) there is no schema migration framework — only fail-closed version checks, (3) UI state management is component-local with god-components, and (4) the module-ownership map lives in code, not docs. None of these block the current release; items 1 and 2 should be addressed before the codebase doubles in size or ships v1.0.

---

## 1. Module boundaries

### RISK-1: P2P layer depends on the agent layer (layering inversion, 3 sites)

The intended layering appears to be `ui → agent → p2p → security/privacy` (agent tools call the transport; the transport never knows about cognition). Three files break it in the opposite direction:

- `src/p2p/store.ts:14` — imports `getMemoryDb, getMemoryDbEpoch, writeMemoryTransaction` from `../agent/memory/memoryStore`. The P2P contact/message store reaches into the agent's memory subsystem. (The comment at `src/agent/memory/memoryStore.ts:53` acknowledges the coupling: "módulos que cachean estado derivado del esquema (p. ej. el DDL de p2p/store)".)
- `src/p2p/p2pAuthorization.ts:24-25` — imports `authorize, AuthDecision` from `../agent/policy/authorization` and `ToolAction` from `../agent/policy/policyEngine`. Transport authorization depends on the agent's policy engine.
- `src/p2p/messenger.ts:1221-1223` — dynamically imports `../agent/delegation/delegationService` to route `"delegation"` envelopes. Combined with `src/agent/delegation/delegationService.ts:45,184,193,368,388` importing `../../p2p/crypto`, `../../p2p/store`, `../../p2p/negotiationService`, this is a **bidirectional dependency** between `p2p` and `agent/delegation`. The dynamic `import()` breaks the static load-time cycle, so nothing crashes — but statically the modules are circular, which defeats tree-shaking reasoning, complicates testing (mock one side, the other drags it back), and will confuse any bundler/strict-mode analysis.

**Recommendation:** define the boundary explicitly — e.g. `p2p` exposes a `registerEnvelopeHandler(type, fn)` registry, and `agent/delegation` registers itself at init. That removes all three upward imports without changing behavior.

### DEBT-1: UI imports agent internals directly (no facade)

- `src/ui/ChatScreen.tsx:53,59` — imports `runDeepResearch` from `../services/orchestrator` and `runAgentLoop, assertPromptBudget, estimatePromptTokens` from `../agent/loop/agentLoop`, plus `classifyIntent` from `../agent/loop/intent` and `buildToolHandlers` from `../agent/tools/handlers`.
- `src/ui/NidoScreen.tsx:255,277` — wires `delegationService.setSendFunction` and `negotiationService.setSendFunction` directly; imports from `../p2p/store`, `../p2p/negotiationService`, `../p2p/pairingCeremony`, `../p2p/packShareService`.

There is no service/facade layer between screens and the agent/P2P engines. Every screen that needs a capability reaches past the nominal module API into implementation files. This works while one person holds the whole graph in their head; a second engineer adding a screen will copy the pattern and deepen the coupling.

### OK-1: Foundation layers are clean

`src/security/*.ts` and `src/privacy/*.ts` (non-test) import **nothing** from `p2p/`, `agent/`, or `ui/` (verified by grep). The crypto/keystore/DB-machinery foundation has no upward dependencies — the one layering direction that matters most is correct.

### OK-2: The agent→p2p direction is the intended one

`src/agent/tools/handlers.ts:36-47` imports `NidoMessenger`, `StaleReplaceConflictError`, `decodePairingPayload`, `pairingBindingWarning`, `findContactRowAny`, `fingerprint/fromHex` from `../../p2p/*`. Tools calling the transport is the correct direction (agent commands, P2P delivers). No finding here — recorded so a future reader doesn't "fix" it.

---

## 2. State management

### OK-3: Singleton pattern is consistent and explicit

Module-level singletons are the established pattern, all in-memory, no DI container:

- `src/inference/LlamaEngine.ts:479` — `export const llamaEngine = new LlamaEngine()`
- `src/rag/embed.ts:113` — `export const embeddingEngine = new EmbeddingEngine()`
- `src/p2p/reconnectManager.ts:162` — `export const reconnectManager = new ReconnectManager()`
- `src/p2p/negotiationService.ts:848` — `export const negotiationService = NegotiationService.getInstance()`
- `src/p2p/sessionManager.ts:218`, `src/p2p/replayProtection.ts:168-169`, `src/privacy/networkAudit.ts:98` — `global*` prefixed singletons

Every singleton is created at module load and lives for the process lifetime. For a single-process mobile app this is coherent — there is exactly one of each thing, and the code says so.

### DEBT-2: Three `ModelManager` instances

- `App.tsx:31` — `const modelManager = new ModelManager()`
- `src/services/downloadManager.ts:98` — `const modelManager = new ModelManager()`
- `src/eval/evalHarness.ts:44` — `const modelManager = new ModelManager()` (eval-only, acceptable)

`ModelManager.requiredModelsPresent()` gates the entire app (`App.tsx:150`). If the App-level and downloadManager-level instances ever disagree about what's downloaded (different catalog state, races during download), the UI can show "setup complete" while downloads think otherwise, or vice versa. `downloadManager.ts:84-100` keeps its own module-level `state`/`inFlight` maps, so download dedup is safe — the risk is confined to *read* divergence on model presence. Should be one shared instance (or a module-level singleton like the rest).

### DEBT-3: No global UI store; ChatScreen is a god-component

`src/ui/ChatScreen.tsx` is **1967 lines** with ~25 `useState` hooks (`ChatScreen.tsx:161-185`: messages, input, ready, loadStatus, generating, drawerOpen, showAbout ×5 modals, voiceInputEnabled, sessions, activeSessionId, processing, deepResearch ×2, liveTokPerSec…). Sibling files are similarly large: `src/p2p/store.ts` (1688), `src/p2p/messenger.ts` (1651), `src/agent/tools/handlers.ts` (1048), `src/p2p/nativeTransport.ts` (1373).

There is no global store (zustand/redux/context-for-state) — state is component-local plus module singletons. This is fine at the current team size of one, but these five files are at the size where two engineers editing them will conflict constantly. Splitting ChatScreen (message list, composer, drawer, modals) is the highest-leverage refactor before the team grows.

---

## 3. Startup sequence

Traced in `App.tsx`:

1. `runStartupGate()` (`App.tsx:183`) — `wipeInterrupted()` check → `recoverInterruptedWipe()` if a Clear-All-Data was killed mid-flight. **Correct: wipe recovery runs before anything touches DBs, models, or normal UI** (`App.tsx:167-181`).
2. `enterKeyLossIfNeeded()` (`App.tsx:204`) — `getDatabaseKeyHex()`; a `KeyLossError` routes to the honest recovery screen instead of a fake first-run (`App.tsx:122-127`). **Correct ordering.**
3. `finishStartup()` (`App.tsx:139`) — `initHaptics()`, `runStartupRoutines()` (fire-and-forget), `verifyCatalogSignature(MODEL_CATALOG, …)` (fail-closed), `modelManager.requiredModelsPresent()` → `"locked"` screen (biometric gate before any data is shown).

### OK-4: Startup order is correct

Keystore → DEK → wipe-recovery → catalog-trust → models → biometric-lock → UI. Each failure has an explicit screen (`checking` / `wipe-recovering` / `wipe-blocked` / `startup-error` / `key-loss` / `locked`), no infinite spinners (GAP-1 fix noted at `App.tsx:153-156`).

### DEBT-4: `runStartupRoutines()` is fire-and-forget

`App.tsx:143` calls `runStartupRoutines()` without `await`. Each routine has its own try/catch (`src/routines/startup.ts:55-73`), so failures are silent-by-design — but a future contributor adding a routine that *must* complete before chat (e.g. a migration) will reasonably assume it runs in sequence. Either `await` it or rename/document the fire-and-forget contract at the call site.

### RISK-2: `checkStaleRekeyStaging` is never called at startup

The crash-safe rekey recovery (`src/security/keyRotation.ts:126-164`, verified correct in re-audit #7) has **zero production callers** — it is not wired into the startup sequence above (carry-over CR-2). Staging files would accumulate in the app-private directory and recovery would never run. The startup sequence is the right home for it (after `enterKeyLossIfNeeded`, before `finishStartup`), once the F-KEY-1 UI exists.

### DEBT-5: `loadFeatureFlags()` contract violated

`src/config/featureFlags.ts:99` says "Hydrate overrides from disk. **Call once at startup.**" The only caller is `src/ui/NidoScreen.tsx:253-254` — a lazy dynamic import when the P2P screen mounts, not in the `App.tsx` startup path. Harmless today (one flag, default OFF = safe direction), but the next flag author will trust the docstring and assume startup hydration. Move the call into `runStartupGate` or fix the docstring.

---

## 4. Data flow

### Chat message (traced)

`ChatScreen.tsx:691` → `runAgentLoop(query, { engine: llamaEngine, handlers: buildToolHandlers({requestConfirm}), loadMemory, maxSteps: 3, … })` → `classifyIntent` → canned-response short-circuit → pre-routers → `engine` (`llamaEngine` singleton) inference → tool calls dispatched through `handlers` → results persisted via `memoryStore` → messages rendered from component state.

**Ownership is clear:** `agentLoop` orchestrates, `handlers` are functions, `llamaEngine`/`memoryStore` are singletons. One wrinkle (DEBT-6): `buildToolHandlers({ requestConfirm })` (`ChatScreen.tsx:693`) closes over a UI callback — the agent layer takes UI callbacks through its options bag. Pragmatic and explicit, but it means the agent loop can't run headless (e.g. in a background task) without a UI-shaped callback. If background agent runs are ever planned, this needs an interface, not a closure.

### P2P message (traced)

`nativeTransport` → `messenger` (persist-first: frame written to SQLite **before** ACK is emitted — `src/p2p/messenger.ts:1175,1317-1341`) → `store.ts` → UI.

### DEBT-7: P2P chat UI polls the database every 4 seconds

`src/ui/NidoScreen.tsx:419-424`:
```ts
// Refresco de la conversación abierta: polling local barato. El messenger
// guarda los frames entrantes al recibirlos; el polling los pinta.
const id = setInterval(() => void loadConversation(peer.pkHex), 4000);
```
The comment is honest about the tradeoff, but: 4s latency on incoming messages, a SQLite read every 4s while the screen is open (battery), and no path to background/heads-up notification on message arrival — the messenger *does* emit internally (`emitDeliveryAck`, `messenger.ts:1277`), the UI just doesn't subscribe. An event-driven subscription (or even `useSyncExternalStore` over the existing emitter) would remove the poll loop. Fine for v1; will not scale to "message arrives while app is backgrounded."

### OK-5: Delegation envelope routing is double-gated

`src/p2p/messenger.ts:1215-1223` checks `env.type === "delegation"` then `isFeatureEnabled("delegation.enabled")` before the dynamic import of `delegationService`, which itself re-checks the flag in `handleTaskMessage`. Belt and suspenders; the unreachable-when-off property holds.

---

## 5. Feature flags

### OK-6: The flag system is minimal and fail-safe

One flag: `delegation.enabled`, default OFF (`src/config/featureFlags.ts:33-36`). Persisted to `feature-flags.json`; `loadFeatureFlags` fails open to defaults — and defaults are all-OFF, which is the fail-closed direction for risky features. Checks exist at all four entry points (`delegationService.ts` ×4, `NegotiationsTab.tsx`, `ModelSetupScreen.tsx`, `messenger.ts`). **No half-state found:** with the flag off, protocol handlers return early and the UI hides the tabs.

### DEBT-8: The system doesn't scale past ~5 flags

`FeatureFlag` is a string-union type with a `Record<FeatureFlag, boolean>` defaults map — adding a flag is two lines, which is good. But there's no grouping, no kill-switch semantics, no remote config (by design — offline-first), and the persistence read-modify-write in `setFeatureEnabled` (`featureFlags.ts:60-93`) has no locking. Fine for booleans toggled rarely; flag it before anyone stores non-boolean config here.

---

## 6. Upgrade / migration

### RISK-3: No migration framework — version bumps are fail-closed bricks

- `src/security/formatVersion.ts` is explicit: *"L1 fija major 1 en todos los formatos; **no existen migraciones v1→v2**"* and *"nunca se interpreta un formato futuro"* (`formatVersion.ts:13-17, 130-134`).
- `src/security/databaseManager.ts:261-270` stamps `schema_version=1` into `meta` on creation and runs `checkFormatVersion` on every open — a mismatch **throws** (`MemoryDbVersionError`), failing the DB open.
- Schema evolution today is `CREATE TABLE IF NOT EXISTS` only (`databaseManager.ts:70-168`, `p2p/store.ts:67-153`). Additive tables/columns survive; any column rename, type change, or major bump renders existing installs unopenable with no upgrade path.

This is a deliberate pre-1.0 posture (fail-closed > silent corruption), and `docs/architecture/TECH_DEBT.md` TD-5 already records it: *"Fix before the first public release: versioned `up()` migrations."* It is still unaddressed. **Before the public APK: add versioned `up()` migrations keyed off the existing `schema_version`/`formatId` stamps, or accept that v1.0→v1.1 requires a data wipe.**

### DEBT-9: `settings.json` is still plaintext

`src/models/settings.ts:64,99` — settings (including `customSystemPrompt`, `modelRoleAssignments` per TD-4) are written via `writeAsStringAsync` to plaintext JSON in the app-private directory. Inconsistent with the encrypted-DB bar the rest of the app holds. (Recorded as TD-4 in `docs/architecture/TECH_DEBT.md`, still open.)

### OK-7: Wipe recovery is handled

Interrupted Clear-All-Data resumes and verifies **before** normal startup (`App.tsx:167-181`, `src/services/appReset.ts`). The install journal (`nido-install-state.json`) is versioned (`formatVersion.ts:52`). TD-1 (wipe missing memory DB + Keystore keys) appears resolved — `src/services/appReset.ts:13,20-22` now imports `clearMemoryDb`, `deleteDatabaseKey`, `deleteP2PPrivateKey`, `deleteP2PSigningKey`.

---

## 7. Offline-first

### OK-8: Zero `fetch()` in `src/`; single documented network touchpoint

A repo-wide grep finds **no `fetch(` calls** in non-test `src/` code. The only network-capable API is `expo-file-system`'s `downloadAsync` in `src/models/ModelManager.ts` — the one-time model download behind the mandatory setup screen (`App.tsx` gates on `requiredModelsPresent()`; `AGENTS.md` documents this as "the app's only required network access"). Model catalog URLs live in `src/models/manifest.ts` and are signature-verified at every startup (`verifyCatalogSignature`, `App.tsx:148`) before use.

**No hidden network assumptions found.** Calendar access is on-device (`expo-calendar` via `listCalendarEventsHandler`), notifications are local (`src/notify/`), reminders fire from the local DB. The offline-first posture is real, not aspirational.

---

## 8. Scalability of the codebase (team doubles tomorrow)

### DEBT-10: No module-ownership map for newcomers

`docs/architecture/` has `DATA_MODEL.md`, `TECH_DEBT.md`, `FEATURE_MAP.md`, `I18N_ARCHITECTURE.md` — but no top-level architecture overview stating "these are the layers, these are the allowed dependency directions, this is who owns what." `TECH_DEBT.md` is dated 2026-09-27 and partially stale (TD-1 and TD-12b are resolved; the file says "read-only audit, no fixes applied"). A new engineer learns the layering by reading 9,000 lines, not a page. The fix is cheap: a one-page `docs/architecture/OVERVIEW.md` with the layer diagram + the RISK-1 boundary rule.

### DEBT-11: Screen management is `useState` booleans

`App.tsx:46` — `type Screen = "checking" | "wipe-recovering" | … | "chat"` — plus ~6 `showX` booleans in `ChatScreen.tsx:168-174`. There is no navigation framework; screens are conditionally rendered. It works for the current ~8 screens. Adding deep links, back-button semantics, or 10 more screens will tangle this quickly. React Navigation (or even a tiny typed router) is the expected next step.

### OK-9: Conventions are strong and self-documenting

Every fix carries a `FIX 2026-10-09 (ID)` tag with file:line traceability; errors are named and greppable (`FormatVersionError` family); comments explain *why* in Spanish; 2145 tests guard regressions. A doubled team inherits a codebase that explains itself — this is the single biggest scalability asset in the repo.

---

## Summary table

| # | Severity | Area | Finding |
|---|---|---|---|
| RISK-1 | RISK | Modules | P2P layer depends upward on agent layer (3 sites); `p2p↔agent/delegation` statically circular via dynamic import |
| RISK-2 | RISK | Startup | `checkStaleRekeyStaging` never called at startup — rekey recovery is dead code in production |
| RISK-3 | RISK | Migrations | No migration framework; version bump = fail-closed brick. TD-5 still open; needs `up()` migrations before public release |
| DEBT-1 | DEBT | Modules | UI imports agent/P2P internals directly, no facade layer |
| DEBT-2 | DEBT | State | Three `ModelManager` instances (`App.tsx:31`, `downloadManager.ts:98`, `evalHarness.ts:44`) |
| DEBT-3 | DEBT | State | ChatScreen 1967 lines / ~25 useState; no global UI store |
| DEBT-4 | DEBT | Startup | `runStartupRoutines()` fire-and-forget at `App.tsx:143` — document the contract |
| DEBT-5 | DEBT | Startup | `loadFeatureFlags()` docstring says "call once at startup"; actual caller is `NidoScreen.tsx:253` |
| DEBT-6 | DEBT | Data flow | `buildToolHandlers({requestConfirm})` closes over UI callbacks — agent can't run headless |
| DEBT-7 | DEBT | Data flow | P2P chat polls SQLite every 4s (`NidoScreen.tsx:422`) instead of subscribing to the messenger emitter |
| DEBT-8 | DEBT | Flags | Flag system won't scale past ~5 flags (no grouping, unlocked read-modify-write) |
| DEBT-9 | DEBT | Migrations | `settings.json` still plaintext (`models/settings.ts:64,99`) — TD-4 still open |
| DEBT-10 | DEBT | Team | No module-ownership overview doc; `TECH_DEBT.md` partially stale |
| DEBT-11 | DEBT | Team | Screens managed by `useState` booleans, no navigation framework |
| OK-1…OK-9 | OK | — | Clean foundation layers; correct startup order; zero-fetch offline posture; double-gated delegation; wipe recovery; strong conventions + 2145 tests |

## Recommended order

1. **RISK-3** — versioned `up()` migrations before any public release (data-loss-class if skipped).
2. **RISK-1** — `registerEnvelopeHandler` registry to break the p2p→agent dependency (small, mechanical).
3. **RISK-2** — wire `checkStaleRekeyStaging` into `runStartupGate` when F-KEY-1 UI lands (already planned as CR-2).
4. **DEBT-3 / DEBT-11** — split ChatScreen + adopt a typed router before the next UI-heavy feature.
5. **DEBT-10** — one-page `docs/architecture/OVERVIEW.md` (cheapest item on the list).
6. The rest (DEBT-1, 2, 4–9) are track-and-fix as the relevant area is next touched.
