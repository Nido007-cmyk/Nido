> **Language:** English · [Español](../es/release/PRIVACY_SAFE_DIAGNOSTICS.md)

# NIDO Privacy-Safe Diagnostics

**Status:** design, NOT to be implemented yet.
**Principle:** observability to **verify, not assume** — without the
diagnostic becoming a backdoor, silent telemetry, or a new source of
sensitive information (NIDO_PRINCIPLES.md §8: *auditability
without creating a new sensitive leak*).

---

## 1. Structured logging system

### 1.1 Prohibited: free-text logs

There are no free-text logs with interpolation of arbitrary values. Every
log is a **structured record** with closed fields. The reason is simple:
a `log("decrypt failed for key " + key)` is written by someone once at
3am and the secret lives in the log forever.

### 1.2 Record shape

```json
{
  "ts": 1790000000000,
  "event": "db.open",
  "component": "storage.sqlcipher",
  "build": "validation/1.0.0+42",
  "code": "SQLCIPHER_OK",
  "transition": "closed -> open_encrypted",
  "meta": { "cipher_version": "4.x", "page_size": 4096 }
}
```

Fields:

| Field | Allowed content |
|---|---|
| `ts` | Timestamp ms epoch. No human dates with ambiguous timezone. |
| `event` | Closed enum (`db.open`, `keystore.get`, `bt.connect`, `policy.decide`, `model.load`, …). Never free text. |
| `component` | Closed enum of the emitting subsystem. |
| `build` | Channel + version + build number. Allows correlating without identifying the user. |
| `code` | **Sanitized** error code from a closed catalog (`SQLCIPHER_OK`, `KEYSTORE_UNAVAILABLE`, `BT_PEER_UNKNOWN`, …). Never raw exception messages. |
| `transition` | State transition `before -> after`, from a per-component closed set. |
| `meta` | Object with **per-event allow-listed keys**. Any unlisted key is discarded at emission, not at review. |

> **FROZEN PRINCIPLE.** Sanitization happens **at the emission point**: the
> component generating the log may only emit allow-listed keys. Reviewing
> logs "afterwards" to remove secrets is a losing strategy — the secret
> already traveled, already persisted, could already be exfiltrated.

### 1.3 Automatic redaction (what never leaves the device in a log)

The emitter applies redaction before building the record. Closed list of
redacted patterns — if a value matches, it is replaced with
`[REDACTED:<class>]` and the fact of redaction is logged (not the value):

- **tokens / keys / seeds:** private keys, seeds, session keys, API tokens,
  OAuth tokens, `Authorization:` headers. Pattern: length + entropy +
  field-name context (`*key*`, `*token*`, `*secret*`, `*seed*`, `*auth*`).
- **sensitive paths:** user file paths outside app directories → only the
  app's base directory name or `[REDACTED:path]` is logged, never the full
  `/storage/emulated/0/...` with personal names.
- **personal data:** names, emails, phones, contact/calendar identifiers.
- **message content:** NIDO↔NIDO message bodies, conversation text, file
  contents. `message_id` (hash) and size are logged, never content.
- **URLs with secrets:** query strings and fragments are stripped; only
  `scheme://host/path` without parameters is kept.
- **prompts and chain-of-thought:** the log records *which capability was
  invoked with which policy decision*, never the model's prompt or
  reasoning.

### 1.4 Local log storage

- Append-only, rotation by size (e.g. 5 MB) and by time (e.g. 7 days),
  encrypted at rest with the same DB key (never in plaintext next to an
  encrypted DB — that would be security theater).
- The user can view, export, and **delete** their logs from the app.
  Deleting is deleting: no hidden copies.
- In OFFLINE ONLY, logs never leave the device except by explicit manual
  export.

---

## 2. On-device security diagnostics

Screen / command the user can run to **verify** the device's real security
state. Each item reports exactly one of: **PASS / FAIL / UNVERIFIED**. No
"maybe", no reassuring prose.

### 2.1 Items

| # | Check | PASS means | FAIL means |
|---|---|---|---|
| 1 | SQLCipher loaded | The native SQLCipher library is loaded in this process | Not loaded |
| 2 | cipher_version | `PRAGMA cipher_version` returns SQLCipher 4.x | Unexpected or missing version |
| 3 | Encrypted DB opened | The app's DB opened with a key and `PRAGMA cipher_integrity_check` OK | Could not open encrypted |
| 4 | Plaintext DB rejected | A test copy in standard SQLite **cannot** open the real DB (active negative verification) | The real DB opens without a key → critical FAIL |
| 5 | Keystore available | Android Keystore accessible on this device | Not accessible |
| 6 | Hardware-backed key | The key is marked `isInsideSecureHardware()=true` | Software key (declared degradation, not silent) |
| 7 | StrongBox | StrongBox available and in use when the device supports it | Not available → UNVERIFIED if the hardware doesn't support it; FAIL if policy requires it and it isn't used |
| 8 | Biometric capability | Enrolled biometrics and functional gate | Unavailable / non-functional gate |
| 9 | Backup configuration | `allowBackup=false` and backup rules verified post-prebuild | Backup allowed or rules unverified |
| 10 | App build mode | Build channel (DEVELOPMENT/VALIDATION/RELEASE) shown explicitly | Unknown |
| 11 | Network mode | Current mode (OFFLINE ONLY / LOCAL-FIRST / ONLINE ENHANCED) and connections observed this session | Declared mode ≠ observed behavior |

### 2.2 Hard rules

- **Never show or log:** keys, seed material, raw private identity, memory
  contents, plaintext DB contents, hashes correlatable with identity off
  the device.
- **UNVERIFIED ≠ PASS.** A check that couldn't run (e.g. StrongBox on
  hardware that doesn't support it) is shown as UNVERIFIED, never as silent
  PASS. Absence of evidence is not evidence of security.
- **FAIL in VALIDATION BUILD = FAIL CLOSED.** If check 3 or 5 fails in a
  validation build, the app doesn't boot into "degraded mode": it doesn't
  boot.
- **Diagnostics are not telemetry.** Running them sends nothing. The result
  lives on the device until the user decides to include it in a report
  (see BUG_REPORTING.md) — and even then, only as PASS/FAIL/UNVERIFIED per
  item, never with raw values.
- **Diagnostics are not a backdoor.** No item exposes material that would
  let a reader of the diagnostic impersonate, decrypt, or track the user.
  If a future item needed to expose something sensitive to be useful, that
  item is not added: it's redesigned.

### 2.3 Output example (shape, not real values)

```json
{
  "build": "validation/1.0.0+42",
  "network_mode_declared": "LOCAL-FIRST",
  "checks": [
    { "id": "sqlcipher.loaded", "status": "PASS" },
    { "id": "sqlcipher.cipher_version", "status": "PASS", "meta": { "version": "4.x" } },
    { "id": "db.encrypted_open", "status": "PASS" },
    { "id": "db.plaintext_rejected", "status": "PASS" },
    { "id": "keystore.available", "status": "PASS" },
    { "id": "keystore.hardware_backed", "status": "UNVERIFIED" },
    { "id": "strongbox.used", "status": "UNVERIFIED" },
    { "id": "biometric.gate", "status": "PASS" },
    { "id": "backup.config", "status": "PASS" },
    { "id": "build.mode", "status": "PASS", "meta": { "mode": "VALIDATION" } },
    { "id": "network.mode", "status": "PASS" }
  ]
}
```

Note: `meta` only carries non-sensitive data (versions, modes). Never keys,
paths, identifiers.

---

## 3. Decision classification

- **FROZEN PRINCIPLES:** (a) no free-text logs — only structured records
  with enums and allow-listed keys; (b) sanitization happens at emission,
  not at review; (c) UNVERIFIED ≠ PASS; (d) diagnostics never expose secrets
  or leave the device without explicit approval; (e) FAIL in validation
  build = fail closed.
- **PROVISIONAL:** the rotation thresholds (5 MB / 7 days), the initial
  event and code catalog, and the 11-check list — a reasonable starting
  point, adjustable with experience.
- **EXPERIMENTAL:** the active negative verification of check 4 (attempting
  to open the real DB with standard SQLite as a test) — powerful, but must
  be designed not to corrupt or lock the real DB.
- **OPEN QUESTIONS:** (1) How to detect "declared mode ≠ observed
  behavior" in check 11 without turning the detector into a permanent
  sniffer? (2) Should structured logs be locally signed to detect
  tampering, and with which key? (3) What granularity of
  `disclosure_summary` is useful in auditing without becoming an
  aggregation leak?
