# NIDO Bug Audit — 2026-10-09 (Worker 2)

**Scope:** read-only systematic review of `src/p2p/`, `src/agent/loop/`, `src/notify/`, `src/security/backup.ts`, `src/ui/BackupScreen.tsx`, `src/i18n/`.
**Method:** line-level code reading of every file in scope + grep for callers + review of the existing test files to exclude anything already covered by a regression test.
**Not modified:** zero source changes (read-only task).

**Headline:** 21 findings. 2 high, 9 medium/high-medium, 10 low. The two high-severity items are both in the P2P reconnect path introduced/changed in the 2026-10-08/09 batches, and neither is covered by tests. The backup/restore flow has a doc-vs-code gap (the header claims a DEK-open validation that was never implemented) plus a latent SHA-256 bug that will break verification if anyone wires the manifest check in the future.

---

## A. P2P transport (`src/p2p/`)

### B1 — HIGH — Two independent auto-reconnect loops fire on every disconnect
**Files:**
- `src/p2p/nativeTransport.ts:1223-1252` (`scheduleReconnect`, added FIX 2026-10-09 BlueLib)
- `src/p2p/reconnectManager.ts` (singleton, still wired)
- `src/ui/NidoScreen.tsx:333-351` (`onPeerLost` → `reconnectManager.notifyPeerLost` + `.schedule`)
- `src/ui/NidoScreen.tsx:793` (`reconnectManager.setConnector(handleConnectPaired)`)

**What happens:** on a real socket drop, `NidoBluetoothTransport.onNativeDisconnected` (line ~1201) does BOTH: (a) emits `onPeerLost(pk)`, and (b) calls its own `scheduleReconnect(mac, pk)`. The `onPeerLost` propagates through `NidoMessenger.startLink` (`messenger.ts:364-367`) into NidoScreen's handler, which starts the UI-level `reconnectManager` cycle. Result: **two independent backoff loops** (transport: 1s/2s/4s/8s/16s × 5 attempts; UI: 5s/10s/20s/40s/60s × 5 attempts, each firing a full multi-MAC sweep with jitter via `handleConnectPaired`) hammer `connect()` concurrently.

**Consequences:** duplicate HELLO storms and radio contention on every disconnect (battery + the exact "read failed, socket might closed" ambient failures the backoff was built to avoid); the two loops race each other into `connect()` for the same MAC, which triggers B2 (promise hijack) below. The loops also have inconsistent lifecycles: the transport loop dies on `stopLink()` (`stopped=true`, line 1229) while the UI singleton deliberately survives navigation.

**Repro:** pair two tablets, connect, kill the peer's Bluetooth (or walk out of range). Watch logs: both a transport-level `connect(mac)` and a UI-level `handleConnectPaired` sweep start within seconds of each other.

**Fix direction:** pick ONE owner. The transport-level loop (state-driven, keyed by MAC, cancels on manual disconnect) is the better substrate; remove the `reconnectManager.schedule` call from NidoScreen's `onPeerLost` (keep the singleton only if some UI-only path needs it, otherwise delete) — or vice versa, but never both. The 2026-10-09 batch added the transport loop without retiring the UI one.

**Test gap:** `nativeTransport.test.ts:1618-1658` tests the transport trigger in isolation; `reconnectManager.test.ts` tests the singleton in isolation. No test covers their interaction (there can't be one at unit level — it's a wiring bug in `NidoScreen` + `messenger.startLink`).

---

### B2 — HIGH — `connect()` hijacks an in-flight handshake's promise; first caller never settles
**File:** `src/p2p/nativeTransport.ts:665-670`
```ts
const existing = this.pending.get(mac);
if (existing) {
  return new Promise<P2PPeerInfo>((resolve, reject) => {
    existing.resolve = resolve;   // <-- overwrites
    existing.reject = reject;     // <-- overwrites
  });
}
```

**What happens:** a second `connect()` for the same MAC (double-tap on "Connect" in the UI, or the B1 double-loop race) **replaces** the first caller's `resolve`/`reject`. The first promise never settles — no resolve, no reject, ever. In NidoScreen the first tap's `setConnecting` state is cleared in a `finally` that never runs → **"Connecting…" spinner stuck forever**, and the user has no way to know the connection actually succeeded underneath.

**Repro:** on the peer list, double-tap a peer's Connect button quickly (or trigger B1's double loop). First promise pends forever.

**Fix direction:** multicast — keep a `Set` of `{resolve, reject}` pairs per pending MAC and settle all of them (or reject the second caller immediately with "handshake already in progress" so the UI can ignore the duplicate tap). Also note the overwritten wrapper previously cleared the hello-timeout timer; after overwrite the timer lifecycle belongs to the hijacker.

**Test gap:** no test for concurrent `connect()` calls (grep for "dos llamadas"/"double" in `nativeTransport.test.ts` → none).

---

### B3 — MEDIUM-HIGH — `disconnect()` is a silent no-op during an in-flight handshake → ghost connection
**File:** `src/p2p/nativeTransport.ts:767-777`
```ts
async disconnect(peerPkHex: string): Promise<void> {
  const mac = this.pkToMac.get(peerPkHex.toLowerCase()); // undefined pre-handshake
  if (mac) { ...manual marking, cancelReconnect... }
  this.forgetRoute(peerPkHex);   // no-op
  if (mac) await this.bt().disconnect(mac).catch(() => {}); // skipped
}
```

**What happens:** `disconnect()` resolves the MAC from `pkToMac`, which is only populated *after* `establishRoute`. During an outgoing handshake the peer's pk→mac mapping doesn't exist yet, so `mac` is `undefined`: no manual-disconnect marking, no socket close, and — critically — the `this.pending` handshake is never cancelled (it's keyed by MAC, unreachable via pkHex). The handshake continues in the background, `establishRoute` fires, the session goes live, and the UI (which awaited `disconnectPeer` successfully) shows "disconnected" while the devices are actually connected. Worse, since the manual-disconnect flag was never set, a later drop triggers auto-reconnect the user explicitly declined.

**Repro:** tap Connect on a paired contact, then tap Disconnect within the ~15 s handshake window. `disconnectPeer` resolves cleanly; seconds later the peer appears online with a live session.

**Fix direction:** track pending outgoing handshakes by target pkHex as well as MAC (the UI knows the contact's pk when it dials), or expose `cancelHandshakeFor(mac)` and have `messenger.disconnectPeer` fail pending handshakes whose eventual identity is unknown. At minimum, `disconnect()` should refuse silently-successful no-ops: throw or return `false` when neither a route nor a pending handshake exists for the pk.

**Test gap:** no test for disconnect-during-handshake (only `destroy()`-with-handshake at `nativeTransport.test.ts:1275`).

---

### B4 — MEDIUM-LOW — Ephemeral secret not wiped when `stopDiscovery()` kills a mid-flight `beginHello`
**Files:** `src/p2p/nativeTransport.ts:543-556` (`stopDiscovery` clears `pending` without zeroing secrets), `nativeTransport.ts:856-906` (`beginHello` catch → `failHello` early-returns when the map entry is gone)

**What happens:** `stopDiscovery()` iterates `this.pending`, clears timers and rejects — but never `fill(0)`s `myEphSecret`. If `beginHello` is suspended at an `await` (signing, `sendFrame`) when `stopDiscovery()` runs, its slot is deleted from the map; when it resumes, its `catch` calls `failHello(mac)`, which does `this.pending.get(mac)` → `undefined` → **early return, secret never zeroed**. The orphaned secret lingers in memory, and the resumed `beginHello` still sends its HELLO onto the wire after discovery stopped.

**Fix direction:** zero `myEphSecret` in `beginHello`'s own `finally`/catch unconditionally (don't rely on map presence), and zero secrets in `stopDiscovery()`'s pending-cleanup loop. This codebase treats ephemeral hygiene as a security invariant (R7) — this path breaks it.

**Test gap:** R7 tests (`nativeTransport.test.ts:1422+`) cover `failHello` and mid-handshake `onDisconnected`, but not the `stopDiscovery`-during-`beginHello` interleave.

---

### B5 — LOW-MEDIUM — `reconnectAttempts` counter never resets on success; backoff starts inflated
**File:** `src/p2p/nativeTransport.ts:1223-1252`

The counter is incremented in `scheduleReconnect` (line 1236) and deleted on exhaustion (1230) or when the timer finds a live route (1241) — but **not on a successful handshake**. After one disconnect→reconnect cycle that used 3 attempts, the *next* real disconnect starts at attempt 3 (8 s delay instead of 1 s). Also, on UI-level reconnect success (`reconnectManager.cancel` in `handleConnectPaired`), the transport counter is untouched (it self-cancels only when its own timer later fires and sees the route).

**Fix direction:** delete `reconnectAttempts` for the MAC in `establishRoute`, and expose a transport-level cancel that the UI success path can call.

---

### B6 — LOW — `onPeerLost` emitted with a raw MAC, violating the `(pkHex: string)` contract
**File:** `src/p2p/nativeTransport.ts:1211-1214` (`onNativeDisconnected` else-branch) and `src/p2p/transport.ts:32` (contract).

When a socket drops with no route (most notably: right after a *manual* `disconnect()`, which calls `forgetRoute` *before* `bt().disconnect(mac)`, so the native `onDisconnected` always takes the else-branch), the transport emits `onPeerLost(mac)` with a Bluetooth MAC like `AA:BB:CC:DD:EE:FF` where every consumer expects a 64-hex-char pk. Downstream impact today is benign (messenger's `handleDisconnect` does a no-op map lookup; NidoScreen's contact lookup misses), but it's a type-level lie that will bite the next consumer (e.g. anything that persists or compares the "lost peer").

**Fix direction:** don't emit `onPeerLost` at all when there's no route for the MAC — or emit a distinct event. At minimum, document that the payload may be a MAC.

---

### B7 — LOW — `scheduleReconnect` fires into a dead radio; `connectWithBackoff` outlives the hello timeout
**File:** `src/p2p/nativeTransport.ts:1237-1250`, `:708-738`.

- The reconnect timer calls `this.connect(mac)` unconditionally; if Bluetooth was turned off meanwhile, `ensureLinked()` throws inside, the `void …catch` swallows it, and attempts burn silently. Should check `isBluetoothEnabled()` before spending an attempt.
- `connectWithBackoff` can run up to ~3 attempts × (7 s native watchdog + backoff) ≈ 24 s, exceeding the 15 s `HELLO_TIMEOUT_MS` armed in `connect()`. If the socket finally connects at ~15 s+, `failHello` already rejected the caller, and the late `onConnected` spawns an *orphan* handshake (new pending, no waiter) that can still establish a route — the user saw "connection failed" but the devices link. Low impact (UI shows the peer via `onPeerFound`), but the timeout and the backoff budget disagree with each other.

---

### Dead code noted (P2P)
- `src/p2p/sessionManager.ts` — `SessionManager`/`globalSessionManager` have **zero production callers** (only `negotiation.e2e.test.ts` uses it). It also mints session IDs with `Math.random()` (line ~101) — non-CSPRNG; harmless while dead, but flag before anyone wires it into production.
- `src/p2p/p2pMemoryMock.ts`, `src/p2p/sqliteTestBridge.ts` — test scaffolding; fine.

### Verified non-issues (P2P — covered by tests, not reported as bugs)
R4 HELLO/CONFIRM invariants, R7 secret wiping on `failHello`/mid-handshake-disconnect, R8 inbound rate limiting, simultaneous-dial tie-break, nonce-claim atomicity, replay rejection, cooldown — all have dedicated tests (`nativeTransport.test.ts`, `r4-adversarial.test.ts`, `handshakeV3.test.ts`).

---

## B. Agent loop (`src/agent/loop/`)

### A1 — MEDIUM — System prompt injects the UTC date as "today" — wrong day for UTC− timezones after ~17:00 local
**File:** `src/agent/loop/agentLoop.ts:338-343`
```ts
const today = new Date();
const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD  <-- UTC!
const todayLong = today.toLocaleDateString("es-ES", { ... }); // <-- local tz
```
For a user in America/Phoenix (UTC−7), at 20:00 local on Oct 9, `toISOString()` yields Oct 10 03:00Z → the prompt says `Hoy es viernes, 9 de octubre de 2026 (2026-10-10)` — **the two dates in the same sentence disagree**, and the model is told to ground dates on the ISO string. Evening/night reminders ("recuérdame mañana a las 8") can land a day off, and the deterministic pre-router (which uses local `Date`) and the model (which sees the UTC ISO date) can disagree with each other.

**Fix direction:** build the ISO date from local parts (`getFullYear()/getMonth()/getDate()`), and use the UI language — not hardcoded `"es-ES"` — for `todayLong` (see I2).

**Test gap:** `agentLoop.test.ts` doesn't pin the injected date.

---

### A2 — MEDIUM — Model tool path `create_reminder` accepts past dates; deterministic path doesn't
**File:** `src/agent/tools/handlers.ts:192-214`
```ts
const d = new Date(at);
if (!Number.isNaN(d.getTime())) dueAt = d.toISOString(); // no past check
```
The deterministic pre-router has the M2 rollover (past → next day, `actionRouter.ts`), but the *model-driven* `create_reminder` tool accepts any parseable date — including yesterday, which the model frequently produces given A1's UTC-date confusion. `scheduleReminderNotification` then schedules a DATE trigger in the past (expo-notifications fires it immediately or drops it, depending on version), and the startup `getDueReminders()` fallback fires it *again* → duplicate/confusing alerts.

**Fix direction:** mirror the M2 logic in `createReminderHandler`: if `dueAt <= now`, roll forward one day (or reject with an actionable error so the model retries). Also add the past-date guard in `scheduleReminderNotification` itself as defense in depth.

---

### A3 — LOW — System prompt is mostly Spanish even when `lang="en"`
**File:** `src/agent/loop/agentLoop.ts:345-395` (`buildSystemPrompt`).

Only the persona line and one style line switch on `lang`; the security rule (`REGLA DE SEGURIDAD…`), the grounding rule (`REGLA DE GROUNDING…`), the date rule (`Fechas sin año → …`), and the intent hints stay in Spanish. English-mode users get a mixed-language prompt, which measurably degrades a 0.5B model's instruction-following.

**Fix direction:** localize the whole prompt template per `lang` (it's a pure function — easy).

### Verified non-issues (agent loop)
Loop bounded by `maxSteps` (no infinite loop); `assertPromptBudget` fail-closed before each generate; constrained→legacy retry chain in the no-tool-call path; observations truncated (M2) and wrapped as untrusted; `parseToolCalls` ignores malformed blocks. All covered by `agentLoop.test.ts` / `toolCallJson.test.ts`.

---

## C. Reminders / notifications (`src/notify/`, `src/agent/`, `src/routines/`)

### N1 — MEDIUM — "Once per session" exact-alarm alert has no session flag — alerts on every reminder
**File:** `src/notify/notifications.ts:116-141` (comment at line 121: *"Se avisa una vez por sesión"*).

The code checks `canScheduleExactAlarms()` on **every** `scheduleReminderNotification` call and shows the `Alert` every time permission is missing. There is no module-level `alreadyWarned` flag, so creating 3 reminders without the permission → 3 identical system-settings dialogs. The comment documents behavior the code doesn't implement.

**Fix direction:** add a module-scope boolean set after the first alert.

**Test gap:** `notifications.test.ts:82-101` covers scheduling success/failure, not the alert frequency.

---

### N2 — LOW-MEDIUM — `initNotifications()` re-registers the received-listener on every call
**File:** `src/notify/notifications.ts:86-101`.

`Notifications.addNotificationReceivedListener(...)` is called unconditionally inside `initNotifications()`. The subscription is never stored or removed. Today it's called once per process (`App.tsx:143` → `runStartupRoutines`), so it's benign — but any second invocation in the same JS runtime (Fast Refresh during dev, a future foreground re-init) stacks duplicate listeners → duplicate `completeReminder` calls and duplicate side effects.

**Fix direction:** module-level `initialized` guard or keep the `Subscription` and `.remove()` before re-adding.

---

### N3 — LOW — Daily briefing only (re)scheduled when the app opens; missed days have no briefing
**File:** `src/notify/notifications.ts:186-211`, `src/routines/startup.ts:61-74`.

`refreshBriefingNotification` sets a single one-shot DATE trigger for the next 8:00 and is only called from `runStartupRoutines`. If the user doesn't open the app for 3 days, no briefing is ever scheduled for the missed days (and the single trigger fires once). This is a design limitation more than a bug, but the product promise ("resumen diario") silently degrades.

**Fix direction:** use a daily repeating trigger (`SchedulableTriggerInputTypes.DAILY`) with content refreshed opportunistically, instead of a one-shot rescheduled only on cold start.

### N4 — LOW — `scheduleReminderNotification` doesn't reject past dates (pairs with A2)
**File:** `src/notify/notifications.ts:108-115`. No validation that `at > now`. A past DATE trigger's behavior is backend-defined (immediate fire vs. drop) — fail closed with an explicit error/rollforward instead.

### Verified non-issues (notify)
Timezone/DST handling is **correct**: `parseReminderDateTime`/`parseRelativeTime` compute in local device time, stored as UTC ISO, scheduled as an absolute epoch — DST transitions can't shift the fire time. Per-reminder identifiers + `cancelReminderNotification` before schedule prevent duplicates; the 2026-10-08 delivered→`completeReminder` listener plus the startup `getDueReminders` fallback are both idempotent (`UPDATE … SET done=1`). ISO-string comparison in `getDueReminders` is chronologically sound.

---

## D. Backup / restore (`src/security/backup.ts`, `src/ui/BackupScreen.tsx`)

### K1 — HIGH — `restoreBackup` never opens the backup with the current DEK, despite the header claiming it does
**File:** `src/security/backup.ts:189-244`; the module header (lines 12-17) claims *"BK-3 FIX: validación real antes de sobrescribir (header SQLCipher + apertura con DEK)"*.

`validateBackup` (lines 140-176) checks only: file exists, size ≥ 1024 bytes, and the 16-byte `SQLite format 3` magic. **It never attempts to open the database with the current key.** Scenario: user restores a backup taken under a *different* DEK (older install, or after Clear All Data regenerated the key — a flow this app explicitly supports). Validation passes, the live DB is overwritten, the app restarts per the UI instructions (`ModelSetupScreen.tsx:495-500`), SQLCipher fails to decrypt, and the user is left with a bricked database. The `.pre-restore-*` safety copy exists on disk but there is **no UI path to recover it** — the user must know to dig through the app's private directory.

**Repro (code-level):** `validateBackup()` on any 1 KB+ file starting with `SQLite format 3` returns `{valid: true}` regardless of encryption key. No test exercises `restoreBackup` at all (`backup.test.ts` covers only validation + key export).

**Fix direction:** implement the documented BK-3: before overwriting, open the candidate with the current DEK (e.g. `PRAGMA cipher_migrate` / `SELECT count(*) FROM sqlite_master`) and fail with an actionable message ("this backup was encrypted with a different key") if it doesn't open. Also verify the manifest SHA-256 (see K2).

---

### K2 — MEDIUM — Manifest SHA-256 is written but never verified — and it's computed over the wrong bytes
**File:** `src/security/backup.ts:49-70` (`sha256File`), `:117-127` (manifest), `:189-244` (`restoreBackup` never reads the manifest).

Two compounding problems:
1. Nothing on the restore path reads `${dest}.manifest.json`. Corruption or truncation between backup and restore is undetectable until decrypt time.
2. `sha256File` builds the digest input as `Array.from(bytes).map(b => String.fromCharCode(b)).join("")` and feeds that JS string to `Crypto.digestStringAsync`, which UTF-8-encodes it. Every byte ≥ 0x80 becomes a **2-byte UTF-8 sequence** — the stored `sha256` does not equal the SHA-256 of the file. If anyone later "fixes" restore to check the manifest, **every existing backup fails verification**.

**Fix direction:** hash raw bytes (expo-crypto `digestStringAsync` can't do this; use a byte-oriented digest or chunk the file through a native module), and actually verify `manifest.sha256` in `validateBackup`/`restoreBackup`.

---

### K3 — MEDIUM — Restore drops the knowledge DB that backup carefully preserves
**File:** `src/security/backup.ts:189-244` vs `:99-109`.

`createBackup` (M3 FIX) also copies `nido_knowledge.db` to `<dest>.knowledge.db`. `restoreBackup` only restores the main DB — the companion knowledge file is ignored. After a restore, the memory DB and the knowledge DB are from different points in time (stale embeddings, orphaned pack rows, or a missing knowledge DB if the user wipes).

**Fix direction:** in `restoreBackup`, if `<backupUri>.knowledge.db` exists (or the path recorded in the manifest's `knowledgeBackupPath`), validate + restore it alongside, with the same safety-copy/rollback treatment.

---

### K4 — MEDIUM — The DEK is shown in a non-copyable `Alert.alert`; transcription errors make restore impossible
**Files:** `src/ui/BackupScreen.tsx:43-48`, `:92-98`; `src/ui/ModelSetupScreen.tsx:424-431`.

Both backup flows display the 64-hex-char key inside `Alert.alert(...)`. On Android, Alert text **cannot be selected or copied** — the user must hand-transcribe 64 hex characters. One wrong character = unrestorable backup, discovered only at the worst possible moment. There is a `copy()` helper with `Clipboard` in `NidoScreen.tsx:797-800`; the backup flows don't use it.

**Fix direction:** show the key in a selectable `TextInput` (or auto-copy + "Copied" confirmation) behind the biometric gate. Never rely on manual transcription for a 256-bit key.

---

### K5 — MEDIUM — No fresh biometric auth before revealing the raw DEK
**Files:** `src/ui/BackupScreen.tsx:89-101` (`handleShowKey`), `src/ui/ModelSetupScreen.tsx` backup card.

`biometricGate.ts` exists and the app has an app-level lock, but displaying the database encryption key — the single secret that decrypts *everything* — requires no re-authentication at the moment of reveal. Anyone holding the unlocked phone can export the DEK in seconds.

**Fix direction:** call the biometric gate (e.g. `requireBiometricAuth()`-style) immediately before `exportDatabaseKey()` in both `handleShowKey` paths.

---

### K6 — LOW — `src/ui/BackupScreen.tsx` is dead code; the live UI is elsewhere
`BackupScreen` has **zero callers** (verified by grep). The real backup UX lives in `ModelSetupScreen.tsx:403-520` + `src/ui/backupShare.ts`. The task brief pointed at `BackupScreen.tsx` — anyone auditing or patching "the backup screen" will edit a file that never renders. Either delete it or re-export the live flow from it.

### K7 — LOW — Misc backup nits
- `createBackup`: two concurrent calls to the same `destinationUri` interleave copy/manifest writes (no lock); `appVersion` hardcoded `"1.0.0"` with a TODO to read `app.json`.
- `restoreBackup` doesn't `fsync` the replaced DB before declaring success (a crash between `copyAsync` and restart can leave a torn file; the safety copy mitigates).

---

## E. i18n (`src/i18n/`)

### I1 — MEDIUM — Portuguese locale is missing 37 keys (offered in the picker, incomplete in practice)
**Files:** `src/i18n/locales/pt.json` vs `en.json` (key-diffed programmatically).

Missing in `pt` (falls back to English via `fallbackLng: "en"` — never blank, but visibly half-translated): `negotiationCard.*` (13 keys incl. `scopeLabels.*`), `negotiations.*` (5), `nido.connect`, `nido.connectPaired`, `nido.connecting`, `nido.noNearbyForPaired`, `nido.pairedNotFound`, `nido.waitingForPeer`, `settings.delegationTitle/Desc`, `tasks.deny`, `tasks.requestTask`, `tasks.taskCancel`, `evaluation.pbkdf2WarnTitle/Msg`. Notably these are exactly the P2P/delegation strings shipped in the 2026-10-08 batches — new features aren't getting PT translations. Spanish is complete (0 missing vs en).

**Fix direction:** add the 37 keys to `pt.json`; add a CI test asserting key-parity across locales (the existing `migratedStrings.test.ts` pins a fixed key list — extend it to diff `Object.keys` of all three locales).

### I2 — MEDIUM — Hardcoded Spanish strings in live code paths (not just dead screens)
| Location | String(s) |
|---|---|
| `src/ui/ModelSetupScreen.tsx:407-515` | Backup card: "Backup", "Exporta tu base de datos cifrada…", "Crear backup", "Compartir backup", "Restaurar backup" |
| `src/ui/NegotiationsTab.tsx:431` | `"Contacto:"` label |
| `src/routines/startup.ts:34-36,61-74` | Briefing body: `Hoy es …`, `Tienes ${n} datos guardados en memoria.`, `"NIDO · Recordatorio"` |
| `src/agent/tools/handlers.ts:137-147` | `fmtDateTime` hardcodes `"es-MX"` locale |
| `src/agent/tools/handlers.ts:151-162` | `deviceTime` tool hardcodes `"es-MX"` |
| `src/agent/loop/agentLoop.ts:340-343` | `todayLong` hardcodes `"es-ES"` even when `lang="en"` |
| `src/agent/loop/agentLoop.ts:565-570` | reminder confirmation `dateStr` hardcodes `"es"` for `toLocaleDateString`/`toLocaleTimeString` |

An English-mode user gets Spanish dates, Spanish briefing text, and a Spanish backup card. The 2026-10-08 batch ("cambio de idioma con chat abierto") fixed canned-response language but not these.

### I3 — LOW — `cannedResponses` is binary es/en; PT users get Spanish fallback or no match
**File:** `src/agent/loop/cannedResponses.ts:108-130` (`getUiLocale` returns `null` for `pt` → `detectLang` heuristics → English markers or Spanish default). PT is a first-class picker option but has no canned templates; "olá"/"obrigado" don't even match the greeting regex. Acceptable short-term (falls through to the model), but the picker over-promises.

### I4 — LOW — `en` is missing `common.deny` (reverse gap)
`src/i18n/locales/en.json` lacks `common.deny` (exists in `es`). Masked today because the sole caller (`TaskApprovalCard.tsx:111`) passes an inline default: `t("common.deny", "Deny")`. One more caller without a default renders the raw key. Add it to `en.json`.

### Verified non-issues (i18n)
`fallbackLng: "en"` guarantees no blank strings for missing keys; `p2pT`/`approvalT`/`notifyStrings` all have EN fallbacks and never throw; `migratedStrings.test.ts` pins EN/ES/PT parity for the migrated key set.

---

## F. Suggested fix order (by risk × effort)

1. **B1** — retire one of the two reconnect loops (small diff, kills duplicate connect storms + the B2 trigger).
2. **B2** — multicast or reject-second in `connect()` (small diff, fixes stuck "Connecting").
3. **K1** — implement the documented DEK-open check in `validateBackup` (the header already promises it; prevents bricking restores).
4. **B3** — cancel in-flight handshakes on `disconnect()` (ghost-connection fix).
5. **K4 + K5** — copyable key display behind fresh biometric auth.
6. **A1 + A2** — local-date system prompt; past-date guard on the model reminder path.
7. **K2** — fix `sha256File` byte handling AND verify the manifest on restore (do both together; either alone is pointless).
8. **K3** — restore the companion knowledge DB.
9. **I1 + I2** — PT key parity + locale-aware date/briefing strings (+ CI key-parity test).
10. **N1, B4, B5, B6, N2, K6, K7, I3, I4, A3, N3, N4, B7** — hygiene backlog.

## G. What was explicitly checked and found sound (not bugs)

- Handshake v3/CONFIRM state machine, R4 route-establishment invariant, anti-replay nonce claim, R8 inbound rate limiting, tie-break, cooldown — extensive adversarial tests exist and the code matches.
- Outbox persist-first, ACK timers, F-1 guarded `markOutboundSent`, dedup/re-ACK paths — sound.
- `taskProtocol.ts` validators are fail-closed; `delegationToken.ts:152` enforces the token-lifetime upper bound the message validator omits.
- Approval inbox: `decideAgentTask` is the single exit from "queued"; no auto-execution path.
- Agent loop: bounded steps, per-step budget asserts, untrusted-wrapping of tool results.
- Reminder timezone/DST: absolute-epoch scheduling is correct; per-id cancel-before-schedule prevents dupes.
- `sessionManager.ts` is dead in production (only tests import it) — noted, not filed as a live bug beyond B-list hygiene.
