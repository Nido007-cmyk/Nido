> **Language:** English · [Español](es/C1_SQLCIPHER.md)
# C-1 — SQLCipher + Keystore + fail-closed migration · Report

Date: 2026-09-27. Branch: `master`. Commits: `f2a347e`, `f515b65`, `974d1b5`,
`40dc2a0`, `91c4c87`, `5f1db0d`, `c95c02b`.

## Objective

Eliminate sensitive storage in the clear: real SQLCipher for the full
database, Keystore→KEK→DEK hierarchy, recoverable and fail-closed
plaintext→encrypted migration, no silent fallback to plaintext.

## Real library and hierarchy (no aspirations)

- **SQLCipher**: `expo-sqlite` with `useSQLCipher: true` (app.json). In the
  container, SQLCipher **4.12.0 community** was verified (via python/sqlcipher3).
- **DEK**: 32 CSPRNG bytes (`expo-crypto`), `x'hex'` format, stored in
  `expo-secure-store` (Android Keystore / iOS Keychain).
- **Honest hierarchy status**: today the DEK lives directly in the OS
  SecureStore. There is **no** yet explicit non-exportable KEK with
  `setUserAuthenticationRequired`, nor StrongBox vs TEE detection. The
  "StrongBox/TEE" comment in earlier code overstated what was
  implemented; the native Keystore module with reported protection class
  remains pending work (it does not block encryption at rest: the
  SecureStore already uses the OS Keystore).
- **Biometrics** (`src/security/biometricGate.ts`): UX access gate with
  5-min in-memory timeout and `lockNow()` on backgrounding. It is **not**
  cryptographic authorization of key use; it does not replace the DEK.

## Migration (`src/security/secureDatabase.ts`)

States: `MIGRATION_NOT_REQUIRED · REQUIRED · IN_PROGRESS · COMPLETE ·
RECOVERY_REQUIRED`.

Fail-closed order:
1. `PRAGMA wal_checkpoint(TRUNCATE)` on the original.
2. Schema fingerprint + counts from the original.
3. `ATTACH DATABASE … KEY "x'…'"` + `sqlcipher_export('nido_enc')` to
   `<db>.migtmp` (+ `DETACH`).
4. Reopening of the temp with the DEK → `PRAGMA key`, forced read of
   `sqlite_master`, `integrity_check`, fingerprint comparison.
5. `rename` temp→principal, deletion of plaintext sidecars
   (-wal/-shm/-journal), `.sqlcipher` marker, final reopen.

Guarantees: the original is **never** deleted before the encrypted one is
verified; no silent fallback to plaintext; no presenting an empty database
as success. `applyDatabaseKey` validates the key format and forces a real
read: wrong key, corrupt database, or still-cleartext database → fail-closed
close without including the key in the error.

Recovery: valid temp → completes the rename; invalid temp →
discarded and re-migrated from the principal; neither temp nor principal
readable → `RECOVERY_REQUIRED` (requires intervention, does not guess).

Integrated in `memoryStore` (`nido_memory.db`) and `rag/db`
(`aoair_knowledge.db`). The importer's sensitive cached JSON is deleted in
`finally`.

## H-8 (P2P sessions)

`completeHandshake` stores the derived session as a **candidate**
(`pendingSessions`); the live session is not replaced until `handleFrame`
receives a valid frame under the candidate's key (liveness). A repeated
HELLO no longer evicts the live session nor diverts the queue.

## Backups

`android:allowBackup=false` (all APIs) + `dataExtractionRules` with
**explicit exclusions** of the nine domains
(root/file/database/sharedpref/external/device_root/device_file/
device_database/device_sharedpref, `path="."`) in `<cloud-backup>` and
`<device-transfer>`. Verified with `expo prebuild --clean`: generated XML
and attributes present in the manifest. (Empty sections would have applied
the default policy —including data—; fixed.)

## Evidence (exact tests, 2026-09-27)

- `npx tsc --noEmit` → 0 errors.
- Full suite: **46 files, 460 tests, all green**.
- `src/security/secureDatabase.test.ts` (21): states, full migration,
  failure in export (original intact), differing fingerprint (aborts),
  partial/valid/invalid temp, `RECOVERY_REQUIRED`, wrong key
  fail-closed, end-to-end, SQL statement builders.
- `src/security/sqlcipherReal.test.ts` (1): runs **our exact statements**
  against real SQLCipher 4.12 — migration preserves data,
  `integrity_check` ok, standard sqlite3 won't open it, wrong/absent key
  fails, no cleartext strings in the file. (Skipped if no
  python3+sqlcipher3; not Android evidence.)
- `src/security/biometricGate.test.ts` (11): timeout, cancellation, failure,
  no enrollment (no bypass), `lockNow`.
- `src/p2p/messenger.test.ts`: H-8 test (handshake 2 doesn't break the live one;
  after liveness it promotes and the old one stops authenticating).
- Clean prebuild verified twice (backup rules + manifest).

## Residual risks and what's missing to close C-1

1. **No Android compilation or on-device test**: all of the above
   is TS logic + container SQLCipher. Pending: real build, `PRAGMA
   cipher_version` on Android, migration of a database with data on the
   phone, failure tests (kill, no space).
2. **Native Keystore**: missing the module with non-exportable KEK,
   StrongBox→TEE with fallback and protection-class reporting; biometrics
   as cryptographic authorization (`setUserAuthenticationRequired`).
3. **No external audit**.
4. `runStartupRoutines()` runs before biometric unlock: check whether it
   touches sensitive data.
5. `expo-file-system.moveAsync` assumed atomic/overwriting: confirm
   on-device.

C-1 is considered **implemented and tested in logic**, pending Android
validation for closure.
