# L2 fixture corpus — `src/rag/__fixtures__` (nido_knowledge.db)

Canonical v1 artifacts + negative fixtures for the knowledge-DB format
versioning contract (L1: `src/security/formatVersion.ts`,
`KNOWLEDGE_DB_SCHEMA_VERSION = 1`, stamp in `meta.schema_version`).

## Provenance — how the v1 fixture was produced

`knowledge.v1.db` is byte-faithful to what the current writer emits: it was
created by executing the REAL `getDb()` → `openAndMigrate()` code path
(`src/rag/db.ts`) against a node:sqlite-backed fake driver injected via
`setSecureDbTestDriver`, with the test key `ab…ab` (32 bytes). Every SQL
statement below is verbatim what the writer executed, in order:

1. `PRAGMA key = "x'ab…ab'"` (no-op under node:sqlite; the keyManager mock
   performs the same handshake as production)
2. `PRAGMA cipher_version;` → mocked `4.9.0-fake`
3. `SELECT count(*) AS n FROM sqlite_master;` (key verification)
4. `PRAGMA journal_mode = WAL;` + full DDL:
   `chunks_fts` (FTS5), `chunks`, `chunk_embeddings`, `chat_sessions`,
   `chat_messages`, `answer_feedback`, `execution_telemetry`,
   `custom_collections`, `meta`
5. `PRAGMA table_info(chunks)` → `ALTER TABLE chunks ADD COLUMN
   collection_id TEXT REFERENCES custom_collections(id)` (fires on fresh
   DBs — the DDL does not declare `collection_id`)
6. `SELECT value FROM meta WHERE key = 'schema_version';` → no row
7. `INSERT INTO meta (key, value) VALUES ('schema_version', '1');`

Resulting tables: `answer_feedback, chat_messages, chat_sessions,
chunk_embeddings, chunks, chunks_fts (+ fts5 aux), custom_collections,
execution_telemetry, meta`, with `meta.schema_version = '1'`.

## Caveat

SQLCipher is unavailable in Node, so the fixture is a plaintext SQLite file.
The versioning contract operates on the `meta` table content, which IS
byte-faithful. On device the same bytes live inside the SQLCipher container.

## Negative fixtures (minimal mutation of the version stamp only)

| file | mutation |
|---|---|
| `knowledge.v99.db` | `meta.schema_version = '99'` → must REJECT `KnowledgeDbVersionError` |
| `knowledge.v2.db` | `meta.schema_version = '2'` → must REJECT (newer than reader) |
| `knowledge.corrupt-version.db` | `meta.schema_version = 'banana'` → must REJECT |
| `knowledge.no-meta.db` | meta row deleted → ACCEPT + stamp v1 (L1 first-open semantics) |

Regeneration: re-run the (deleted after use) generator
`src/security/l2-fixture-gen.tmp.test.ts` procedure documented in the L2
report, then `/tmp/l2-negatives.mjs` for negatives. The harness
(`src/rag/db.fixture.test.ts`) opens temp copies of these files with the
real `getDb()` path — the committed files are never mutated by tests.
