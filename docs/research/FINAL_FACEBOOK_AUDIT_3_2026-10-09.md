# THIRD FACEBOOK-LEVEL AUDIT — NIDO @ 94b72e7

**Date:** 2026-10-09
**Auditor:** Deep professional audit (third pass)
**Scope:** Verify fixes for NEW-CR-1, NEW-CR-2, NEW-H-1, NEW-H-2 from audit #2; hunt for new issues
**Method:** Code review of diff 94b72e7, end-to-end flow tracing (backup → share → validate → restore), test suite (2145/2145), TSC clean
**Baseline:** `FINAL_FACEBOOK_AUDIT_2_2026-10-09.md`

---

## VERDICT: DO NOT SHIP

One new HIGH (silent knowledge-DB loss on every bundle restore) and one re-confirmed HIGH (manifest type-confusion still present in the raw-.db path). The four fixes from audit #2 are verified correct for what they cover, but the bundle feature they belong to is still functionally incomplete.

---

## 1. Fix verification (audit #2 findings)

### NEW-CR-1 (bundle restore impossible) — ✅ FIXED, verified
`validateBackup` (`src/security/backup.ts:211`) now detects `.nidobackup.json` and delegates to `validateBundle()`. The UI flow (`ModelSetupScreen.tsx:481` → `496`) works end-to-end: validate accepts the bundle, `restoreBackup` extracts it, then re-validates the extracted `.db` (K1/K2 still enforced on extracted files). Round-trip is structurally sound.

### NEW-CR-2 (DEK disclosure without biometric, live flow) — ✅ FIXED, verified
`createBackupFile` (`src/ui/backupShare.ts:32-47`) now calls `requireUnlock("Crear backup")` before `createBackup`/`exportDatabaseKey`. This is the only reachable DEK-display path (`ModelSetupScreen.tsx:419-442` shows the key in an Alert). The bundle itself contains no DEK (only `dekFingerprint`), so the "Compartir backup" button correctly needs no auth.

**Tradeoff noted (not a blocker):** `requireUnlock` throws `BiometricUnavailable` on devices with no lock screen enrolled, and `createBackupFile` converts all failures to "Autenticación cancelada". On a fresh tablet without a PIN, backup creation is impossible. Fail-closed is the defensible default for key export (standard for password managers), but it is stricter than the dead-code `BackupScreen` path, which warns-but-continues when biometrics are unavailable (R2). Inconsistent philosophy between the two paths; the live one is the safer choice.

### NEW-H-1 (bundle no size cap → OOM) — ✅ FIXED (partially), verified with caveat
`validateBundle` caps at 500 MB and rejects < 100 bytes. However, 500 MB of JSON parsed via `readAsStringAsync` + `JSON.parse` will OOM-crash the app on a phone long before the cap matters (base64 inflates ~33%; transient memory ~2–3× file size). The cap prevents unbounded allocation but is set far above what a mobile device can survive. A realistic mobile cap would be ~100 MB. Typical NIDO DBs are KBs–MBs, so this is a latent DoS vector (app crash on malicious bundle), not a data-compromise risk. Recommend lowering to 100 MB.

Also note: `createPortableBundle` has no corresponding guard — building a bundle from a very large DB holds ~2.7× DB size transiently. Same latent class.

### NEW-H-2 (manifest type-confusion) — ⚠️ FIXED FOR BUNDLES ONLY, still present in raw-.db path
`validateBundle` now requires `bundle.format === "nidobackup"`, `manifest` to be an object, and `manifest.sha256`/`manifest.dekFingerprint` to be strings. Good.

**But the identical flaw survives in the non-bundle path** (`src/security/backup.ts:244-276`): `JSON.parse(manifestRaw)` result is used without shape validation, and the whole block sits inside `try { ... } catch { /* basic validation */ }`. A present-but-malformed manifest (e.g., a JSON array, a string, or truncated JSON) → `manifest.sha256` is `undefined` → K1/K2 checks silently skipped → falls through to `{ valid: true }`. An attacker crafting a backup package (`.db` + sibling `.manifest.json`) can bypass DEK-mismatch and SHA-integrity checks with a malformed manifest. Same severity as the original NEW-H-2. **This is a re-confirmed HIGH.**

Fix: separate "manifest absent" (old backups → basic validation OK) from "manifest present but malformed" (fail-closed). Validate shape before use, mirroring `validateBundle`.

---

## 2. NEW issues found (third pass)

### NEW3-H-1 — HIGH — Bundle restore silently drops the knowledge DB (K3 regression)
**File:** `src/security/backup.ts:352` (`restoreBackup`, step 5)

```ts
const knowledgeBackupUri = `${backupUri}.knowledge.db`;
```

When restoring from a bundle, `backupUri` is the `.nidobackup.json` path, so this resolves to `...nidobackup.json.knowledge.db` — which never exists. The knowledge DB extracted by `extractPortableBundle` to `${actualUri}.knowledge.db` (`restored.db.knowledge.db`) is never consulted. **Every bundle restore silently discards the knowledge base**, the exact data M3/K3 and the bundle format were designed to carry. No warning is shown; the user believes the restore was complete.

Fix: use `${actualUri}.knowledge.db` (identical to `backupUri` in the non-bundle flow, correct in the bundle flow).

### NEW3-M-1 — MEDIUM — `restoreBackup` extracts the bundle before validating it (defense in depth)
**File:** `src/security/backup.ts:294-302`

`extractPortableBundle` runs before any validation inside `restoreBackup`. It re-parses the JSON with no size cap and no shape check beyond `format`. The UI flow validates first (`ModelSetupScreen.tsx:481`), so exploitation requires calling the exported `restoreBackup` directly — but exported security-critical functions should not trust their inputs. A malicious bundle passed directly causes full in-memory parse + base64 decode + disk writes before any check. Recommend calling `validateBundle` at the top of `restoreBackup` for bundle inputs (or folding validation into `extractPortableBundle`).

### NEW3-M-2 — MEDIUM — K1 skipped when device has no DEK (fresh-install wrong-backup trap)
**File:** `src/security/backup.ts:262-275`

```ts
const currentDek = await getDatabaseKeyHex().catch(() => null);
if (currentDek) { ...fingerprint check... }
```

On a fresh install (no DEK yet), the DEK-fingerprint check is skipped entirely. Restoring another installation's backup then "succeeds," but the restored DB is encrypted with a DEK the keystore doesn't have → the app cannot open it. Fail-open on the exact scenario K1 was built for. The user does hold the DEK (shown at backup time), so recovery is possible but undiscoverable. Recommend: when `manifest.dekFingerprint` exists but no current DEK, warn explicitly that the backup belongs to a different installation and require confirmation.

### NEW3-M-3 — MEDIUM — `sha256File` hashes a JS-string coercion, not file bytes
**File:** `src/security/backup.ts:52-71`

The file is base64-decoded, converted to a JS string via `String.fromCharCode`, and hashed with `digestStringAsync`. If expo-crypto interprets the string as UTF-8, bytes ≥ 0x80 expand to multi-byte sequences and the digest is not the true file SHA-256. It is self-consistent (same function at backup and verify time), so integrity checking works, but the stored `manifest.sha256` is not a real SHA-256 of the file. Any external tool verifying the manifest will disagree. Cosmetic for NIDO's own use; misleading as a format. Recommend documenting or switching to a byte-based digest.

### NEW3-L-1 — LOW — Fragile `.db` extension replacement in `createPortableBundle`
**File:** `src/security/backup.ts:410`

```ts
const bundleUri = backupUri.replace(/\.db$/, ".nidobackup.json");
```

If `backupUri` doesn't end in `.db`, the replace is a no-op and `writeAsStringAsync` overwrites the source DB with JSON, destroying the backup it was meant to package. All current callers pass `.db` paths (`createBackupFile`, `findLatestBackup` filter), so this is latent. Recommend an explicit guard that throws when the extension is absent.

### NEW3-L-2 — LOW — Dead-code `BackupScreen.handleCreateBackup` exposes DEK before biometric
**File:** `src/ui/BackupScreen.tsx:48` vs `:55`

`exportDatabaseKey()` is called before `requireUnlock`. Unreachable today (screen has zero importers), but the H-3 fix pattern was applied to `handleShowKey` in the same file and missed here. If the screen is ever wired up, this becomes a live NEW-CR-2. Recommend fixing now (move auth before export) or deleting the screen.

### NEW3-L-3 — LOW — Safety copies (`*.pre-restore-*`) are never cleaned up
**File:** `src/security/backup.ts:374-376`

The comment says "Limpiar la copia de seguridad solo si todo salió bien" but no deletion code exists. Every restore permanently leaves a full DB copy in the SQLite directory. Safe (aids manual recovery) but unbounded disk growth. Recommend capping retained copies or documenting the retention policy.

### NEW3-L-4 — LOW — Bundle filename case sensitivity
`validateBackup`/`restoreBackup` branch on `uri.endsWith(".nidobackup.json")` (case-sensitive). A user-renamed `...NIDOBACKUP.JSON` falls into the raw-.db path and is rejected on the SQLite header check. Fail-closed, but confusing. Recommend case-insensitive match or content sniffing (`{"format":"nidobackup"` prefix).

---

## 3. Still open from audits #1–#2 (re-confirmed, not re-audited in depth)

- **CR-2**: `rotateDatabaseKey()` has no UI entry point (dead code).
- **CR-3**: Crash window between `PRAGMA rekey` and keystore write — staging exists only in comments (`src/security/keyRotation.ts:16-24`), not implemented.
- **CR-4**: `revokePeer()` has no UI and `revokedPks` is in-memory only (lost on restart).
- **H-2**: `TASK_CANCEL` aborts the executor, but `delegationService.ts:447-476` still sends `TASK_RESULT` afterwards — the peer cannot distinguish cancellation from a real result.

---

## 4. What's solid (verified this pass)

- **NEW-CR-1 fix**: bundle detection, extraction, and restore-time re-validation (K1/K2 on extracted files) are correct. Tampering with `bundle.db` is caught by the K2 SHA check after extraction — defense in depth holds.
- **NEW-CR-2 fix**: biometric gate placed before any DEK exposure in the live flow; bundle contains no raw DEK (fingerprint only).
- **H-1 (Deep Research flush)**: `flushTokenBuffer()` present on all streaming paths (lines 819, 824, 874, 931).
- **H-3**: `handleShowKey` requires biometric (dead code path, but correct).
- **H-4**: `executed` set bounded at 1000 with FIFO eviction; no memory-exhaustion vector.
- **H-5**: SHA computation failure now fails closed.
- **P2P revocation check** in `establishRoute` (`nativeTransport.ts:1195`) correctly rejects revoked pks before route establishment.
- **ApprovalGate rate-limit ordering**: slot retained when limit trips (no state corruption).
- **Suite**: 2145/2145 green, `tsc --noEmit` clean.
- **Test gap (unchanged)**: no round-trip tests for `createPortableBundle` → `validateBackup` → `extractPortableBundle` → `restoreBackup`, and no tests at all for `validateBundle`. The audit #2 process note still applies.

---

## 5. Priority order

1. **NEW3-H-1** (knowledge DB dropped on bundle restore) — one-line fix (`actualUri`), high data-loss impact.
2. **NEW-H-2 remainder** (manifest shape validation in raw-.db path) — same bypass class as already-fixed bundle path.
3. **NEW3-M-1** (validate bundle inside `restoreBackup` before extract).
4. **NEW3-M-2** (explicit warning when restoring foreign backup on fresh install).
5. Lower **NEW-H-1** cap to ~100 MB; guard `createPortableBundle` extension (NEW3-L-1); fix dead-code auth order (NEW3-L-2).
6. Then the carried-over CR-2/CR-3/CR-4/H-2.

## 6. Process note

Two consecutive audits have now found that fixes were correct in isolation but incomplete at the flow level (CR-1 → NEW-CR-1 → NEW3-H-1). The bundle feature has been patched three times, each patch revealing the next gap. Recommend: before the next fix, write the failing round-trip test first (bundle create → share → validate → restore → assert both DBs restored), then fix until it passes. The test, not the patch, is the definition of done for multi-step user flows.
