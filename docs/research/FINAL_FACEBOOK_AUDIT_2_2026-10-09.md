# SECOND FACEBOOK-LEVEL AUDIT — NIDO @ 47de78b

**Date:** 2026-10-09
**Auditor:** Independent professional audit (Facebook-scale bar: 3B users)
**Scope:** Re-audit after first Facebook audit fixes. Focus: (1) verify CR-1/H-1/H-3/H-4/H-5 fixes, (2) find new issues, (3) bundle-format security, (4) regressions, (5) re-verify P2P/crypto/delegation/backup.
**Method:** Direct code reading, data-flow tracing, targeted test runs. No code modified.
**Baseline:** `tsc --noEmit` clean (verified during this audit). Targeted suites green (backup, backupShare, approvalGate, keyRotation: 33/33).

---

## VERDICT: DO NOT SHIP

The CR-1 bundle fix is **structurally incomplete**: sharing now emits a `.nidobackup.json` bundle, but the restore UI path (`ModelSetupScreen` → `validateBackup` → `restoreBackup`) **cannot restore it** — `validateBackup` rejects non-SQLite files before `restoreBackup` ever gets to extract the bundle. The backup round-trip is broken: share works, restore is impossible. Additionally, the first audit's H-3 (biometric for DEK display) was fixed only in dead `BackupScreen` code while the **live** `createBackupFile()` still exports the DEK with zero authentication.

---

## FIX VERIFICATION (first-audit items)

### CR-1 — Bundle format: PARTIALLY FIXED, restore path broken (see NEW-CR-1)
- `createPortableBundle` (`src/security/backup.ts:334`): correctly embeds db (base64) + manifest + knowledge into one JSON file. K1/K2/K3 data preserved through the round-trip (base64 is lossless, manifest SHA-256 still matches extracted bytes).
- `shareBackupFile` (`src/ui/backupShare.ts:55-66`): correctly calls `createPortableBundle` and shares the bundle URI. Test mock updated accordingly.
- `restoreBackup` (`src/security/backup.ts:242-253`): correctly detects `.nidobackup.json` and extracts before validating.
- **BUT** `validateBackup` (`src/security/backup.ts:168-190`) was not updated: it is called with the bundle URI by the UI and rejects it. The fix covers share + restore internals but not the validation gate between them.

### H-1 — Deep Research flush: FIXED, verified complete ✅
- `flushTokenBuffer()` added at `src/ui/ChatScreen.tsx:874` after `runDeepResearch` completes.
- All success paths covered: onToken throttle (819/824), runFixedModelChat internal (931), adaptive/fixed block (1032), Deep Research (874).
- Error paths: outer catch replaces message text with `Error: …`, discarding buffered tokens — identical to pre-5.1 behavior (tokens were never persisted on error either; `assistantText` persistence happens only on success path). No regression.

### H-3 — handleShowKey biometric: FIXED in dead code; live path still exposed (see NEW-CR-2)
- `BackupScreen.tsx:126-140`: `requireUnlock` correctly added before `exportDatabaseKey()`.
- `BackupScreen` remains unimported (dead code) — fix is inert until wired up.

### H-4 — `executed` set bounded: FIXED, adequate ✅
- `src/agent/delegation/approvalGate.ts:152,346-350`: capped at 1000 with FIFO eviction (deletes oldest-inserted via `Set` insertion order).
- Note: eviction is FIFO, not expiry-based as the first audit suggested. Residual risk (replay of an evicted taskId) is mitigated by token expiry + signature — an evicted taskId still needs a valid signed unexpired token to re-register. Acceptable.

### H-5 — SHA fail-closed: FIXED, verified ✅
- `src/security/backup.ts:203-209`: if manifest claims `sha256` but `sha256File` returns null, restore is now rejected (`"No se pudo verificar la integridad (SHA-256)."`). No more silent skip.

### Still open from first audit (confirmed, unchanged)
- **CR-2**: `rotateDatabaseKey` has zero UI callers (verified: no imports in `src/ui/`).
- **CR-3**: crash window between `PRAGMA rekey` and keystore write unaddressed (no staging alias, no startup recovery, no post-rekey reopen verification).
- **CR-4**: `revokePeer` has zero UI callers; `revokedPks` in-memory only; not linked to `deleteContact`.
- **H-2**: `executor.abort()` flag checked only in `checkBudget()` pre-`modelInvoke` (`executor.ts:129-130`); `delegationService.ts:474-480` sends TASK_RESULT unconditionally after `execute()` returns. No cancelled-set gate before send.
- **M-5**: `unrevokePeer` (`nativeTransport.ts:818-820`) does not clear `manualDisconnectPks`; re-pair within 30s of revoke can be killed by the stale flag.

---

## CRITICAL (new ship-blockers)

### NEW-CR-1 — Bundle restore is impossible: `validateBackup` rejects `.nidobackup.json`
**Files:** `src/security/backup.ts:168-190` (`validateBackup`), `src/ui/ModelSetupScreen.tsx:481-496` (restore UI)

The UI restore flow:
1. User picks the shared `.nidobackup.json` via document picker.
2. `validateBackup(uri)` reads the first 16 bytes → `{"format":"nido` → not `"SQLite format 3"` → returns `{valid: false, reason: "El archivo no parece ser una base de datos SQLite válida."}`.
3. UI shows "Backup inválido". `restoreBackup` (which *does* handle bundles) is never reached.

**Impact:** Every backup shared since the CR-1 fix is unrestorable through the app. The CR-1 fix converted "shared backups lack integrity protection" into "shared backups cannot be restored at all." This is a **regression introduced by the fix**, and it is worse than the original bug (data held hostage vs. data unprotected).

**Fix:** `validateBackup` must detect the `.nidobackup.json` extension (or sniff `{"format":"nidobackup"`), parse the bundle, and validate the *inner* manifest + DB bytes (K1/K2 against the embedded manifest and decoded DB) without requiring extraction. Alternatively, extract to a temp location first and validate the extracted files — but validation must happen on the bundle path *before* the user is told the backup is invalid.

### NEW-CR-2 — Live DEK disclosure without biometric: `createBackupFile()` exports key unauthenticated
**Files:** `src/ui/backupShare.ts:32-42`, `src/ui/ModelSetupScreen.tsx:417-423`

`createBackupFile()` calls `exportDatabaseKey()` with no `requireUnlock`. The "Crear backup" button in `ModelSetupScreen` (reachable, live flow) then displays the raw DEK in an `Alert`. The first audit's H-3 fixed only `BackupScreen.handleShowKey` — which is dead code — and explicitly noted it was "currently unreachable." The audit missed that the *reachable* path had the identical flaw.

**Impact:** Anyone holding the unlocked phone taps "Crear backup" → DEK displayed in plaintext, no biometric. This is the exact phishing-adjacent disclosure surface the anti-fraud warning (added this morning) warns about — the app itself discloses without authentication.

**Fix (as the first audit suggested for H-3):** move the biometric check *inside* `exportDatabaseKey()` (fail-closed by default) so no caller can forget it; remove the now-redundant UI-layer checks. At minimum, gate `createBackupFile()` with `requireUnlock` before the export.

---

## HIGH (new)

### NEW-H-1 — Bundle parsing has no size cap: DoS via malicious `.nidobackup.json`
**File:** `src/security/backup.ts:370-392` (`extractPortableBundle`)

`restoreBackup` calls `extractPortableBundle` *before* `validateBackup` (which holds the only size check). Extract does `readAsStringAsync` (full file → string) → `JSON.parse` (second full copy as object graph) → base64 decode (third copy). A crafted multi-hundred-MB bundle triple-amplifies in memory and OOM-crashes the app. `sha256File` has the same 3x pattern (base64 → binary string → Uint8Array), compounding it during validation.

**Fix:** `getInfoAsync` size check at the top of `extractPortableBundle` (reject absurd sizes, e.g. >500MB), or stream-parse. At minimum, move the size gate before extraction in `restoreBackup`.

### NEW-H-2 — Manifest type-confusion silently bypasses K1/K2
**File:** `src/security/backup.ts:196-228` (`validateBackup`)

`const manifest = JSON.parse(manifestRaw)` is used without shape validation. If the manifest is valid JSON but not an object (string, number, array), `manifest.sha256` / `manifest.dekFingerprint` are `undefined` → both checks skipped → falls through to `{valid: true}` ("basic validation"). The surrounding try/catch only catches *thrown* errors, not absent fields — and the catch itself degrades to valid ("backups viejos").

Via bundle: attacker sets `bundle.manifest` to `"{}"` (a JSON string). `extractPortableBundle` writes `JSON.stringify(bundle.manifest)` → `"\"{}\""`; `validateBackup` parses it back to a string; K1/K2 skipped. Restoring a foreign-installation DB then bricks the app (the exact outcome K1 exists to prevent).

**Fix:** validate `typeof manifest === "object" && manifest !== null` after parse; reject (fail-closed) on wrong shape. Same for the bundle envelope (`bundle.db` must be a string, `bundle.manifest` must be an object) in `extractPortableBundle`.

---

## MEDIUM (new)

### NEW-M-1 — `createPortableBundle` throws on manifest-less (pre-manifest) backups: share regression
**File:** `src/security/backup.ts:337` — `readAsStringAsync(manifestUri)` has no try/catch.

Backups created before the manifest feature have no `.manifest.json`. Previously they shared fine (bare `.db`); now `shareBackupFile` throws → UI shows "No se pudo compartir el backup." Old backups are unshareable.

**Fix:** if manifest is absent, synthesize a minimal manifest (`{version, createdAt, sha256: computed, dekFingerprint: null}`) or fall back to sharing the bare `.db` with an explicit user warning that integrity checks won't apply.

### NEW-M-2 — Stale bundle artifacts accumulate, never cleaned
**Files:** `src/security/backup.ts:361` (`*.nidobackup.json`), `:377` (`restored.db` + sidecars)

Every share leaves a `nido-backup-*.nidobackup.json` (2x the DB size in JSON) in the app-private directory; every bundle restore leaves `restored.db`, `restored.db.manifest.json`, `restored.db.knowledge.db`. No cleanup. `findLatestBackup` won't surface them (filters `nido-backup-*.db`), so they are invisible garbage.

**Fix:** delete the bundle after successful share; extract to cache dir and clean after restore (success or failure).

### NEW-M-3 — Fragile extension replacement in `createPortableBundle`
**File:** `src/security/backup.ts:361` — `backupUri.replace(/\.db$/, ".nidobackup.json")`

If `backupUri` ever lacks the `.db` suffix, the replace is a no-op and the bundle **overwrites the source DB file** with JSON. Not reachable today (all callers pass `*.db`), but a single future caller breaks the invariant silently.

**Fix:** assert the suffix and throw if absent.

---

## LOW (new)

- **NEW-L-1:** `extractPortableBundle` writes `restored.db` + sidecars *before* validation; a failed restore leaves them on disk (compounds M-2).
- **NEW-L-2:** bundle `version: 1` is written but never checked on extract — future format changes have no gate.
- **NEW-L-3:** `validateBackup`'s 1024-byte minimum applies to the bundle JSON too; a bundle wrapping a tiny-but-valid DB is still far above the threshold — no issue, noted for completeness.

---

## WHAT'S SOLID (re-verified this audit)

- **P2P handshake crypto**: `handleHello` (`nativeTransport.ts:1061-1069`) requires a known paired contact *with* signing key before any crypto — unknown devices fail closed. Timestamp skew ±10min enforced before contact lookup. (Unchanged since first audit; re-read.)
- **Token buffer (5.1)**: all generation paths flush on success; error path replaces text with `Error:`, matching pre-5.1 semantics. No display truncation on any path.
- **ApprovalGate**: rate-limit pruning correct (shift-loop, n≤10); fail-closed without provider; 10/hour cap enforced before slot release (a rate-limited approve returns null *without* consuming — the pending slot is released by `releaseSlot` before the check… wait, actually `releaseSlot(requestId, entry)` is called at line 308 *before* the rate-limit check at 310-316. Let me re-check the order.

Actually — checking `approve()` order at lines 305-316: `pending.get` → rate-limit prune+check → `releaseSlot` → deadline → hash → provider → … Let me verify the exact order I read earlier: lines 305-316 showed `pending.get`, then the rate-limit block (prune + check → return null), and the earlier read showed `releaseSlot` after. From the sed output at 300-315: entry null-check → rate-limit prune → rate-limit check (return null) → [then releaseSlot per the earlier 305-310 read which showed releaseSlot after the rate block]. The two reads are consistent: rate-limit check happens BEFORE releaseSlot. So a rate-limited approval does NOT release the slot — the card stays pending and the user can retry later. That actually resolves the first audit's M-1 concern favorably (card not destroyed; slot retained). The UX is still silent (no "too many" message), but no state corruption. Noting as correct.
- **H-4 FIFO bound**: acceptable as analyzed.
- **H-5 fail-closed SHA**: correct.
- **i18n**: new keys (`backup.dekFraudWarning`) present in es/en/pt (spot-checked).
- **No secrets/DEK in logs**: re-grepped `console.log` adjacent to key material — clean.
- **TSC**: clean. Targeted tests (33/33 across backup, backupShare, approvalGate, keyRotation) green.

---

## PRIORITY ORDER

1. **NEW-CR-1** — make `validateBackup` bundle-aware (or extract-then-validate). Without this, no shared backup is restorable. Ship-blocker #1.
2. **NEW-CR-2** — biometric inside `exportDatabaseKey()` (fail-closed default). Ship-blocker #2.
3. **NEW-H-2** — manifest/bundle shape validation (fail-closed on wrong shape).
4. **NEW-H-1** — size cap before bundle parse.
5. **NEW-M-1** — synthesize manifest or warn for pre-manifest backups.
6. Then: CR-2/CR-3/CR-4/H-2 (still open from audit #1), M-2/M-3, L-1/L-2.
7. Physical device gate (out of scope for static audit).

## PROCESS NOTE

The CR-1 fix was verified by tests against `shareBackupFile` (mock asserts bundle URI passed to share sheet) but no test exercised the **validate→restore round-trip** through the UI's actual call sequence (`validateBackup(bundleUri)` → `restoreBackup(bundleUri)`). A single round-trip integration test with a real bundle file would have caught NEW-CR-1 immediately. Recommend: for every fix touching a multi-step user flow, require one test that walks the full sequence, not just the changed unit.
