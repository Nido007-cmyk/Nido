# L2 fixture corpus — `src/models/__fixtures__` (JSON formats)

Canonical v1 artifacts + negative fixtures for the two JSON format
versioning contracts (L1: `src/security/formatVersion.ts`).

## settings.json — `format_version` (SETTINGS_FORMAT_VERSION = 1)

`settings.v1.json` is byte-faithful: captured from the REAL writer
(`writeSettings` via `setThemeId("daylight")` on a cleared store):

```json
{"activeModelId":{},"themeId":"daylight","format_version":1}
```

| file | mutation / meaning |
|---|---|
| `settings.v99.json` | `format_version: 99` → must REJECT `SettingsVersionError` |
| `settings.v2.json` | `format_version: 2` → must REJECT (newer than reader) |
| `settings.corrupt-version.json` | `format_version: "banana"` → must REJECT |
| `settings.pre-l1.json` | no `format_version` field → ACCEPT as v1 (deliberate L1 grandfathering deviation, documented not fixed) |
| `settings.unknown-keys.v1.json` | v1 + unknown keys → ACCEPT (forward tolerance preserved) |

## nido-install-state.json — `version` (INSTALL_JOURNAL_VERSION = 1)

`install-journal.v1.json` is byte-faithful: captured from the REAL writer
(`saveInstallState`) with one `installed` record and fixed timestamps
(deterministic).

| file | mutation / meaning |
|---|---|
| `install-journal.v99.json` | `version: 99` → must REJECT `InstallJournalVersionError` |
| `install-journal.v2.json` | `version: 2` → must REJECT (newer than reader) |
| `install-journal.corrupt-version.json` | `version: "banana"` → must REJECT |
| `install-journal.missing-version.json` | no `version` field → must REJECT (missing is fail-closed here) |
| `install-journal.corrupt-json.json` | truncated JSON → ACCEPT-as-empty (degrade to "re-verify what's on disk", NOT a version error) |
| `install-journal.v99-no-records.json` | `{"version": 99}` → must REJECT `InstallJournalVersionError` (F1 fix: version is validated before the `records`-shape guard, so a missing `records` object cannot mask an unknown version) |

The harnesses (`src/models/settings.fixture.test.ts`,
`src/models/installState.fixture.test.ts`) seed the mocked FS with the
exact fixture FILE bytes and run the real read paths.
