# Clear All Data — exact deletion semantics

**UI entry point:** Settings → Danger Zone → Clear All Data
(`src/ui/ModelSetupScreen.tsx` → `handleExecuteReset` → `resetAllAppData()`
in `src/services/appReset.ts`).

**Status:** privacy blocker TD-1 — CLOSED by the fix described here.
Previously the wipe deleted the knowledge DB, models, corpus and settings,
but silently left behind the agent memory DB (`nido_memory.db`) and all
three Keystore keys. That gap is now closed and covered by regression tests
(`src/services/appReset.test.ts`).

> **Language:** English · [Español](CLEAR_ALL_DATA.es.md)

## What is deleted

`<doc>` = `FileSystem.documentDirectory`, `<cache>` = `FileSystem.cacheDirectory`.

### 1. Databases (closed first, then deleted)

| Store | File | Content destroyed |
|---|---|---|
| Knowledge DB (`src/rag/db.ts`) | `<doc>/SQLite/aoair_knowledge.db` | Chat sessions and messages, corpus/collection chunks and embeddings, execution telemetry |
| Memory DB (`src/agent/memory/memoryStore.ts`) | `<doc>/SQLite/nido_memory.db` | Agent memory — facts, preferences, people, daily log, notes, reminders — **and** all P2P tables: device identity, paired contacts, inbox/outbox messages |

For each database the wipe also removes its sidecars and management
files: `-wal`, `-shm`, `-journal`, `.migtmp` (interrupted-migration temp)
and `.sqlcipher` (migration marker). Deletion goes through the real
`deleteManagedDatabase()` path in `src/security/secureDatabase.ts`.

### 2. Android Keystore keys (via SecureStore)

| Alias | Purpose |
|---|---|
| `nido_db_key` | SQLCipher data-encryption key shared by both databases. Deleted with the new `deleteDatabaseKey()` (`src/privacy/keyManager.ts`); deletion uses SecureStore's `deleteItemAsync`, which on Android removes the encrypted entry — the correct delete path, since SecureStore manages its own shared Keystore master key internally and there is no per-item Keystore entry to delete by hand. |
| `nido_p2p_sk` | P2P identity private key (X25519). Deleted with the existing `deleteP2PPrivateKey()`. |
| `nido_p2p_sign_sk` | P2P signing private key (Ed25519). Deleted with the existing `deleteP2PSigningKey()`. |

Deleting the DEK is what makes the wipe robust against forensic recovery:
even if a deleted database file were undeleted from flash, without
`nido_db_key` it is unreadable. After the wipe the next launch generates a
**new** DEK (`getDatabaseKeyHex()`); the in-memory key cache is reset
(`resetMemoryKeyCache()`) so the fresh database is never encrypted with the
deleted key.

### 3. Files and directories

| Path | Content |
|---|---|
| `<doc>/settings.json` | All user settings (deleted via `clearSettings()`; next read falls back to defaults) |
| `<doc>/models/` | Downloaded model weights (LLM + embedding GGUF files) |
| `<doc>/corpus/` | Knowledge packs and imported collections |
| `<doc>/eval/` | Device evaluation result files (may contain query text) |
| `<cache>/` | Transient export files handed to the OS share sheet |

In-memory download state is also reset (`resetDownloadState()`); native
llama.cpp contexts are unloaded **first**, before any file is touched, so no
live mmap'd handle can observe a deleted file.

## Order of operations

1. Unload native inference/embedding contexts, close knowledge packs.
2. Reset in-memory download state.
3. Close and delete both databases (knowledge, then memory).
4. Delete the three Keystore keys; reset the in-memory DEK cache.
5. Delete models / corpus / eval / cache directories and `settings.json`.
6. **Verify** — see below.

## Failure semantics: never a silent partial wipe

The wipe is **verified, not assumed**. After deletion, `resetAllAppData()`
checks every item above for non-survival:

- every database file, sidecar, temp file and marker via `getInfoAsync`;
- `settings.json` and the four directories via `getInfoAsync`;
- the three Keystore aliases via non-generating reads (`peekDatabaseKey()`,
  `loadP2PPrivateKey()`, `loadP2PSigningKey()` — all must return `null`).

If anything survives — or cannot even be checked — the function throws
`WipeVerificationError` listing every survivor. The Settings UI catches it
and shows the failure to the user (`modelSetupScreen.toasts.resetFailed`)
instead of pretending the wipe succeeded. After a successful wipe the app
returns to the setup wizard (required-models check fails with no models).

## What is intentionally NOT deleted

- **The app itself and its bundled assets** — Clear All Data removes user
  data, not the installation.
- **The Android Keystore master key managed internally by SecureStore** —
  it is shared across all SecureStore items, contains no user key material,
  and deleting it would break SecureStore for the whole app.
- **Files the user explicitly exported** via the OS share sheet (outside the
  app's directories) — once handed to another app, they are out of scope.

## Verification

- `npm run typecheck` — clean.
- `npx vitest run src/services/appReset.test.ts src/privacy/keyManager.test.ts` —
  8 wipe tests + 13 keyManager tests, all green. The wipe tests run the real
  `resetAllAppData()`, `resetDatabase()`, `clearMemoryDb()`, `keyManager`
  and `clearSettings()` against an in-memory filesystem and SecureStore
  backend, and assert post-wipe non-survival of every store listed above,
  DEK rotation, loud failure (`WipeVerificationError`) on survivors, and a
  characterization test proving the pre-fix sequence left the memory DB and
  keys behind.
- **Not verified on a physical device yet**: the full UI flow (Danger Zone →
  toast on failure → setup wizard) still needs on-device validation once the
  first APK exists (P1).

## Security notes

- No encryption, key isolation, Keystore usage or biometric code was
  weakened for this fix. The wipe only *deletes*; it never downgrades.
- Key deletion order (databases closed first, keys deleted after) ensures
  no open database handle can recreate or re-read key material mid-wipe.
- `peekDatabaseKey()` is deliberately non-generating: verification never
  creates a key as a side effect.
