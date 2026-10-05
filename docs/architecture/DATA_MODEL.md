> **Language:** English · [Español](../es/architecture/DATA_MODEL.md)

# Data Model — NIDO

**Status:** CURRENT (audited 2026-09-27) + PROPOSED (design, no implementation).
**Audience:** anyone building features on top of NIDO's storage.
**Encryption baseline:** the two user-data SQLite DBs are SQLCipher-encrypted
with a Keystore-backed DEK and fail-closed wiring (audited; see §1). Everything
marked **[EXISTS]** below was verified in code with file:line evidence during
the audit. Everything marked **[PROPOSED]** is design only.

Related: `docs/architecture/TECH_DEBT.md` (storage gaps), `docs/C1_SQLCIPHER.md`,
`src/security/secureDatabase.ts`, `src/privacy/keyManager.ts`.

---

## 1. CURRENT — what the app actually stores (2026-09-27)

### 1.1 SQLite databases (both SQLCipher-encrypted at rest) [EXISTS]

**DB A — `aoair_knowledge.db`** (owner `src/rag/db.ts`, via
`ensureEncryptedDatabase` + `getDatabaseKeyHex()`):

| Table | Contents |
|---|---|
| `chunks_fts` (FTS5) | RAG chunks: `chunk_id`, `doc_id`, `title`, `body` |
| `chunks` | same + `source`, `collection_id` (added by ALTER migration) |
| `chunk_embeddings` | `chunk_id`, float32 `embedding` BLOB, `dim` |
| `chat_sessions` | `id`, `title`, `summary`, `created_at`, `updated_at` |
| `chat_messages` | `id`, `session_id` FK, `role`, `text`, `created_at` (+ index on session) |
| `answer_feedback` | `message_id` FK, `rating`, `created_at` |
| `execution_telemetry` | per-inference record: model, timings, tokens, tok/s, peak RSS, outcome, error — **never prompt/response text** (deliberate) |
| `custom_collections` | imported document collections metadata |

**DB B — `nido_memory.db`** (owner `src/agent/memory/memoryStore.ts`,
DDL mirrors `src/agent/memory/schema.sql`):

| Table | Contents | Write status |
|---|---|---|
| `facts` | agent memory facts: `content`, `category`, `confidence`, `source` | written by agent tools |
| `preferences` | `key`/`value` | **schema exists, zero non-test writers** (dead) |
| `people` | `name`, `relationship`, `notes` | **zero non-test writers** (dead) |
| `daily_log` | `day`, `entry` | **zero non-test writers** (dead) |
| `agent_notes` | `title`, `body` | written by agent tools |
| `agent_reminders` | `text`, `due_at`, `done` (+ partial index on pending) | written by agent tools + startup |
| `meta` | `schema_version = 1` (written, never read for migration) | — |
| `p2p_identity` | `pk_hex`, `name` (`sk_hex` kept `""`; private key in Keystore) | identity store |
| `p2p_contacts` | `pk_hex`, `name`, `verified`, `sig_pk` (Ed25519) | QR-verified contacts |
| `p2p_messages` | `id`, `dir` (in/out), `peer_pk`, `type` (chat/agent_task/agent_result/receipt), `text`, `status` (queued→sent→delivered→read), `ts` | replay-safe inbox/outbox (`INSERT OR IGNORE`) |

**DB C — knowledge packs** (read-only, **plaintext by design**): public corpus
SQLite files under `documentDirectory/corpus/*.sqlite`, no user data.

### 1.2 SecureStore (Android Keystore) [EXISTS]

| Key | Holds |
|---|---|
| `nido_db_key` | 32-byte SQLCipher DEK (hex), one DEK for both DBs, CSPRNG-generated once |
| `nido_p2p_sk` | P2P X25519 identity private key (legacy DB rows auto-migrate here on read) |
| `nido_p2p_sign_sk` | Ed25519 signing seed, generated lazily |
| `__nido_diag_canary__` | transient diagnostics canary (written, verified, deleted) |

No tokens, passwords, or PINs. `getDatabaseKeyHex()` **throws in production**
if SecureStore is unavailable (fail-closed); dev builds fall back to plaintext
with a console warning.

### 1.3 Files [EXISTS]

| Path (under `documentDirectory`) | Contents |
|---|---|
| `SQLite/` | the two encrypted DBs + WAL sidecars + `.sqlcipher` markers |
| `settings.json` | **all settings in plaintext JSON** — 17 fields (see §1.4) |
| `models/` | GGUF weights, checksum-verified against `src/models/manifest.ts` |
| `corpus/` | corpus JSON + knowledge-pack SQLite files |
| `eval/` | dev eval artifacts (JSONL, pending/status files) |

`cacheDirectory`: transient exports (telemetry CSV/JSON, collection exports —
deleted after share), document-picker copies.

### 1.4 Settings (current) [EXISTS]

Single `settings.json`, read-modify-write whole file per change, plaintext:

`activeModelId`, `hidePromptIdeas`, `personalityId`, `customSystemPrompt`,
`maxTokens`, `hapticsEnabled`, `voiceInputEnabled`, `readAloudEnabled`,
`autoSummarize`, `historyTurnThreshold`, `maxSavedSessions`, `autoGenerateTitles`,
`deepResearchMode`, `themeId` (midnight/amber/frontier), `fontScale`
(compact/standard/large), `languageId` (en/pt/es), `routingPreset`,
`modelRoleAssignments`, `adaptiveRoutingEnabled`.

`ThemeId`, `FontScale`, `LanguageId` are closed unions in `src/models/settings.ts`.
Personality presets are hard-coded in `src/constants/personalities.ts`
(`succinct`/`detailed`/`summary`/`custom` — response-style presets, not visual).

### 1.5 In-memory only (lost on restart) [EXISTS]

Query stats/telemetry sampler, P2P encrypted sessions + frame reassemblers
(outbox queue persists, so messages survive; sessions re-handshake), download
progress maps, loaded llama.cpp contexts, cached DB connections, agent-loop
run state. OS-scheduled notifications (`expo-notifications`) survive at OS level.

### 1.6 Domain verdicts — current

| Domain | Verdict |
|---|---|
| User profile | **MISSING** — no profile store; `preferences`/`people` tables exist but are unwritten |
| NIDO identity / keys | **EXISTS** — `p2p_identity` + Keystore keys |
| Personality config | **EXISTS** (plaintext settings + hard-coded presets) |
| Conversation / memory | **EXISTS** (encrypted; facts/notes/reminders written, people/log/preferences dead) |
| Preferences / settings | **EXISTS** (plaintext `settings.json`) |
| P2P pairing / inbox | **EXISTS** (encrypted, replay-safe) |
| Telemetry | **EXISTS** (in-memory + encrypted persistent, no message text) |
| Inventory / progression / economy | **MISSING** — nothing exists |

---

## 2. PROPOSED — target data model (design only, no implementation)

Principles: everything user-owned stays local-first and encrypted at rest;
identity/authority/memory belong to the local NIDO (`NIDO_PRINCIPLES.md` §3);
new tables get real migrations (the current ad-hoc ALTER approach must be
replaced — see TECH_DEBT.md).

### 2.1 User profile [PROPOSED]

New table in `nido_memory.db` (encrypted):

```sql
-- spec sketch
CREATE TABLE user_profile (
  id            TEXT PRIMARY KEY CHECK (id = 'me'),  -- singleton row
  display_name  TEXT,                                 -- user-chosen, optional
  locale        TEXT,                                 -- mirrors settings.languageId
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

- Singleton row (`id='me'`); no multi-user scope in v1.
- Activates the currently-dead `people`/`preferences`/`daily_log` tables or
  replaces them — decide: wire them up vs. remove. (Recommendation: wire
  `preferences` for the profile-adjacent keys, keep `people`/`daily_log`
  only if agent tools will actually write them; otherwise drop to avoid
  dead schema.)

### 2.2 NIDO identity [PROPOSED — extends EXISTS]

Current: P2P identity keys + name. Proposed additions:

- `nido_identity` table (or extend `p2p_identity`): `identity_id` (stable,
  survives key rotation), `created_at`, `rotated_at`, `crypto_version`
  (crypto-agility: algorithm ids versioned from the start, per principles §8),
  `rotation_chain` (verifiable chain of rotations, no central backdoor).
- Device binding: per-device key records (`device_id`, `device_name`,
  `added_at`, `revoked_at`) — multi-device principle: compromise of one
  device ≠ compromise of all.
- **Out of scope for this doc:** the actual rotation protocol (protocol
  design track).

### 2.3 Personality [PROPOSED — extends EXISTS]

Two distinct concepts that the current code conflates — separate them:

| Concept | Today | Proposed |
|---|---|---|
| **Response style** | `personalityId` in settings.json (`succinct`/`detailed`/`summary`/`custom`) | keep, rename to `responseStyleId` eventually; presets become data not code |
| **Visual personality** | 12 design-system presets, not in app | `avatar_preset_id` + layer overrides → `AvatarDescriptor` (see `3D_INTEGRATION_CONTRACT.md` §2.1); presets enumerated from the asset manifest, stored per-user |

Proposed `nido_persona` table: `id`, `name`, `response_style_id`,
`custom_system_prompt` (moved out of plaintext settings.json into the
encrypted DB), `avatar_descriptor_json` (versioned), `is_active`, timestamps.
Supports multiple named personas later; v1 = single active row.

### 2.4 State [PROPOSED]

App/agent operational state that should survive restart (currently
partially in-memory):

- `agent_state`: `last_run_id`, `last_run_status`, `pending_approvals`
  (human-approval queue — currently where? verify; if in-memory, persist it),
  `updated_at`.
- P2P session resumption: keep memory-only (deliberate trade-off), but record
  `last_handshake_at` per contact to make re-handshake cheap and auditable.
- Notification intents: OS-scheduled notifications reference stable ids that
  resolve against `agent_reminders` (already the case via startup.ts).

### 2.5 Preferences [PROPOSED — consolidates EXISTS]

- Move privacy-relevant preferences out of plaintext `settings.json` into
  the encrypted DB (`preferences` table — finally giving it writers), or
  encrypt `settings.json` with the SQLCipher DEK. (Recommendation: encrypt
  the whole settings file; simplest consistent story. See TECH_DEBT.md.)
- Settings registry pattern: each setting declared once with
  `{ key, type, default, scope: "device"|"user", sensitive: bool, ui: {...} }`
  — the Settings UI renders from the registry (no per-setting UI code),
  which is what makes "add languages without UI redesign" structurally true
  (same pattern as the avatar manifest in `3D_INTEGRATION_CONTRACT.md`).

### 2.6 Inventory / progression [PROPOSED]

Per `docs/architecture/ECONOMY_ARCHITECTURE.md` §5:

```sql
-- spec sketch (encrypted DB)
CREATE TABLE inventory_items (
  id          TEXT PRIMARY KEY,          -- e.g. "mantle.olive"
  kind        TEXT NOT NULL,             -- avatar-layer | avatar-preset | theme | convenience | title
  acquired_at INTEGER NOT NULL,
  source      TEXT NOT NULL,             -- purchase | milestone | reward | default
  cost_json   TEXT,                      -- { currency, amount } if purchased
  asset_ref   TEXT                       -- 3D asset manifest id, when applicable
);
CREATE TABLE economy_ledger (
  id          TEXT PRIMARY KEY,          -- unique grant/spend id (idempotency)
  ts          INTEGER NOT NULL,
  kind        TEXT NOT NULL,             -- grant | spend
  currency    TEXT NOT NULL,             -- spark | core
  amount      INTEGER NOT NULL CHECK (amount >= 0),
  reason      TEXT NOT NULL,
  policy_ref  TEXT,                      -- policy decision id, when applicable
  prev_hash   TEXT NOT NULL,             -- hash chain (tamper-evidence)
  hash        TEXT NOT NULL
);
CREATE TABLE milestones (
  id          TEXT PRIMARY KEY,
  completed_at INTEGER,                  -- NULL = not yet completed
  reward_json TEXT NOT NULL
);
```

- All local-only, per-device, non-transferable (economy spec §2).
- Ledger contains no message content, no chain-of-thought.

### 2.7 Future economy hooks [PROPOSED]

- `payment_id` (128-bit, payer-generated) column ready on any future
  settlement table — idempotent settlement per `docs/economic/SETTLEMENT_ABSTRACTION.md`.
- `budget_vault` separation (operational budget vs. main funds) is a
  *policy* concept first; no table until a rail exists.
- **No fiat/token/blockchain columns.** If rails ever come, they arrive via
  the `SettlementAdapter` abstraction, not as columns in these tables.

---

## 3. Migration strategy (proposed)

1. Introduce a real migration runner: `meta.schema_version` becomes
   authoritative; each version has an explicit `up()`; no version is
   skipped; downgrade = restore from backup, never automatic.
2. Replace ad-hoc `ALTER TABLE` try/catch blocks with versioned migrations.
3. `settings.json` → encrypted: one-time migration that re-encrypts under
   the SQLCipher DEK (or moves sensitive keys into the DB), then deletes
   the plaintext file.
4. Dead tables (`people`, `daily_log`, unwired `preferences`): explicit
   decision per table — wire or drop — before v1, not after.

## 4. Open questions

1. Encrypt whole `settings.json` vs. move sensitive keys into encrypted DB?
2. Wire up or drop the dead memory tables?
3. Singleton `user_profile` vs. anticipating multi-profile later?
4. Ledger hash algorithm (versioned from day one for crypto-agility)?
5. Per-device balances: acceptable long-term, or plan merge semantics now?
