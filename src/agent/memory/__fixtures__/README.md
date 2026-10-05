# L2 fixture corpus — `src/agent/memory/__fixtures__` (nido_memory.db)

Canonical v1 artifacts + negative fixtures for the memory-DB format
versioning contract (L1: `src/security/formatVersion.ts`,
`MEMORY_DB_SCHEMA_VERSION = 1`, stamp in `meta.schema_version`). The P2P
tables live in this same database, so the corpus covers them too.

## Provenance — how the v1 fixture was produced

`memory.v1.db` is byte-faithful to what the current writer emits: it was
created by executing the REAL `getMemoryDb()` → `openAndMigrate()` code
path (`src/agent/memory/memoryStore.ts`) against a node:sqlite-backed fake
driver injected via `setSecureDbTestDriver`, with the test key `ab…ab`
(32 bytes). Statements verbatim, in order:

1. `PRAGMA key = "x'ab…ab'";`
2. `PRAGMA cipher_version;` → mocked `4.9.0-fake`
3. `SELECT count(*) AS n FROM sqlite_master;`
4. `PRAGMA journal_mode = WAL;`
5. DDL: `facts`, `preferences`, `people`, `daily_log`, `agent_notes`,
   `agent_reminders`, `meta`
6. `SELECT value FROM meta WHERE key = 'schema_version';` → no row
7. `INSERT INTO meta (key, value) VALUES ('schema_version', '1');`

## Caveat

SQLCipher is unavailable in Node, so the fixture is a plaintext SQLite file.
The versioning contract operates on the `meta` table content, which IS
byte-faithful. On device the same bytes live inside the SQLCipher container.

## Negative fixtures (minimal mutation of the version stamp only)

| file | mutation |
|---|---|
| `memory.v99.db` | `meta.schema_version = '99'` → must REJECT `MemoryDbVersionError` |
| `memory.v2.db` | `meta.schema_version = '2'` → must REJECT (newer than reader) |
| `memory.corrupt-version.db` | `meta.schema_version = 'banana'` → must REJECT |
| `memory.no-meta.db` | meta row deleted → ACCEPT + stamp v1 (L1 first-open semantics) |

Regeneration: same procedure as the knowledge-DB corpus (see
`src/rag/__fixtures__/README.md`). The harness
(`src/agent/memory/memoryStore.fixture.test.ts`) opens temp copies of these
files with the real `getMemoryDb()` path — the committed files are never
mutated by tests.
