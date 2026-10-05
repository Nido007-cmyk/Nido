> **Language:** English · [Español](../es/release/BETA_SECURITY_GATE.md)

# NIDO Beta Security Gate

**Status:** design, NOT to be implemented yet.
**Principle:** a beta can discover bugs. It can never discover
basic security failures. Those **block the release**.

---

## 1. Impact-based classification (not bug counting)

Four classes. The question is not "how many bugs are there?" but "what can
this bug break?".

### 1.1 MUST FIX BEFORE ALPHA

Any failure in the 8 blocking classes (§2) detected in INTERNAL.
Nothing with real user data leaves the lab with one of these open. Also:
secrets in logs, DB opening without a key, Keystore not required in
validation build.

### 1.2 MUST FIX BEFORE BETA

Everything from ALPHA, plus: any known consent bypass
(`ASK_USER` that doesn't ask), any disclosure above the declared
`minimum_disclosure`, any crash that irreversibly corrupts DB/memory/
identity, any migration untested in the declared directions.

### 1.3 MUST FIX BEFORE STABLE

Everything from BETA, plus: zero open critical/high-severity issues;
minimum window in BETA (provisional: 2 weeks) with no security regressions;
full diff-of-authority review since the previous Stable
(permissions, autonomy, disclosure, spend, network) with no silent
expansions.

### 1.4 ACCEPTABLE BETA BUG

What users **can** help us discover:

- crashes (that don't corrupt data — see §2)
- device compatibility (models, Android versions, manufacturer skins)
- Bluetooth edge cases (reconnects, interference, odd BT stacks)
- performance problems (jank, memory, model load times)
- UI problems (layouts, text, accessibility)
- model compatibility (a GGUF that won't load on a certain SoC)
- battery issues (background drain, wakelocks)
- unexpected workflows (the user does something the design didn't foresee)

> **FROZEN PRINCIPLE.** The line between "acceptable beta bug" and
> "blocking" is defined by **impact**, and when in doubt it is classified
> upward. A crash that *also* leaves the DB half-written is not "a crash":
> it is potential data loss → blocking.

---

## 2. The 8 release-BLOCKING classes

These must **never** be discovered via users. If they show up in
ALPHA/BETA, the release stops.

1. **Silent data loss** — data that disappears with no visible error and
   no way to recover (messages, memory, corrupt DB that "self-repairs" by
   deleting).
2. **Plaintext of private information** — user information in the clear
   where it should be encrypted: DB without SQLCipher, logs with content,
   unencrypted backups, accidental exports.
3. **Key leakage** — private keys, seeds, session keys, or identity
   material leaving the device or sitting in logs, dumps, backups, or
   reports.
4. **Policy Engine bypass** — any path executing a capability without going
   through policy evaluation: remote content → model → tool, flags that
   pre-authorize, versions that inherit approvals.
5. **Unauthorized execution** — a tool/capability running without the
   required consent (`ASK_USER`/`human_approval: always` skipped).
6. **Unauthorized payments** — (future economic layer) any value movement
   without explicit authorization; today: any silent expansion of spending
   authority in the design.
7. **Irreversible identity corruption** — loss or corruption of the NIDO
   identity with no declared, tested recovery path.
8. **Silent cryptographic downgrade** — negotiating or accepting a weaker
   suite without the user knowing and approving; rollback restoring
   retired crypto.

Each class must have at least one **deterministic test or check** covering
it before every gate (conformance vectors, validation build checks,
authority-diff review). "We eyeballed it" is not coverage.

---

## 3. Device matrix

NIDO must eventually be tested on:

- **Android** (first: it's the initial platform)
- **iPhone** (later)
- and in pairs: **Android ↔ Android**, **iPhone ↔ iPhone**, **Android ↔
  iPhone**

> **FROZEN PRINCIPLE.** Transport ≠ Protocol. The NIDO protocol **never**
> depends on a platform-exclusive API. If a feature only works with an
> Android (or iOS) API, it's a platform feature, not a protocol one, and is
> designed as such — with a declared fallback or explicit unavailability,
> never as a silent protocol dependency.

Minimum coverage per channel (provisional, see RELEASE_MODEL.md §2):
ALPHA ≥2 distinct physical Androids with NIDO↔NIDO over Bluetooth; BETA
matrix of 3+ Android models (low/mid/high-end) + iPhones when available;
STABLE full matrix including the weakest supported low-end.

---

## 4. RELEASE GATE: `nido release-check` (conceptual)

A **deterministic** checklist. Each line is verified by a script/test or a
human with evidence — **never by the model's opinion**.

```
BUILD:        PASS   # the artifact was built from the declared source, valid signature
TESTS:        PASS   # full suite green (existing unit + integration)
CONFORMANCE:  PASS   # official vectors + TS/Rust differential green
MIGRATIONS:   PASS   # migrations tested in declared directions + declared rollback
SECURITY:      PASS   # 0 failures in the 8 blocking classes; release red-team done
PRIVACY:       PASS   # minimum-disclosure review; no PII in build logs/diagnostics
ANDROID:       PASS   # channel's Android matrix, on physical devices
IOS:           PASS   # channel's iOS matrix, or declared N/A with justification
KNOWN CRITICALS: 0
KNOWN HIGHS:     0

RELEASE CANDIDATE: YES / NO
```

What evidence each check requires:

| Check | Evidence |
|---|---|
| BUILD | reproducible build log, artifact hash, verified signature |
| TESTS | suite report with 0 failures (not "almost green") |
| CONFORMANCE | `passed=N failed=0` from the harness + archived differential results |
| MIGRATIONS | automated migration test from the 2 previous releases + test of the declared rollback |
| SECURITY | checklist of the 8 classes with its test/evidence each + red-team notes |
| PRIVACY | automated sweep of logs/diagnostics against the redaction list + human review of new log fields |
| ANDROID / IOS | per-device matrix results (model, OS, PASS/FAIL per area) |
| KNOWN CRITICALS/HIGHS | count from the issue tracker with impact-based severity (§1) |

`RELEASE CANDIDATE: YES` requires **everything** PASS and zeros on
criticals/highs. A single FAIL → NO, with no weighting or "it's just a
warning".

> **FROZEN PRINCIPLE.** No PASS depends on the model's opinion. The model
> may *help generate* the evidence; the evidence is verified by
> deterministic code or a human.

---

## 5. RELEASE RED-TEAM

For each threat: **THREAT → EXPLOIT → MITIGATION → FUTURE TEST**.
The red-team runs per release (BETA onward) and its findings feed the 8
blocking classes.

### RT-1 · Logs leaking secrets

- **THREAT.** A structured log or stack trace includes a key, token, seed,
  or private content.
- **EXPLOIT.** A crash in `keystore.get` dumps the raw exception with the
  key alias and material; the "Report a Problem" report attaches it; the
  secret travels to the backend and lives in backups.
- **MITIGATION.** Emission-time sanitization (PRIVACY_SAFE_DIAGNOSTICS.md
  §1): only enums and allow-listed keys; automatic redaction of
  `*key*/*token*/*secret*/*seed*/*auth*`; stack traces without variable
  values; automated pre-release sweep against the redaction list.
- **FUTURE TEST.** Test injecting canary secret-shaped values at every log
  point and verifying the output contains `[REDACTED:*]` and never the
  value.

### RT-2 · Crash reports leaking conversations

- **THREAT.** The heap or UI state at crash time contains conversation
  text, memory, or message content.
- **EXPLOIT.** Crash during chat render: the report includes an automatic
  screenshot or state dump with the latest messages; the user sends it
  without looking (or with a "look" that doesn't show the binary
  attachment).
- **MITIGATION.** Crash reports never include screenshots or state dumps by
  default; the user inspects the complete package before sending
  (BUG_REPORTING.md §1); message content is on the closed exclusion list.
- **FUTURE TEST.** Crash fuzzing on screens with sensitive data: generate N
  crashes and automatically verify no report contains strings from the
  private-data fixture.

### RT-3 · Updates expanding authority

- **THREAT.** An update turns `ASK → AUTO`, adds a capability with relaxed
  `human_approval`, or requests a new OS permission without presenting it
  as a decision.
- **EXPLOIT.** Release 1.5 changes `location.request/v1` from
  `human_approval: always` to `conditional` "for UX"; peers with the old
  rule get location without the user re-consenting.
- **MITIGATION.** Update rule (UPDATE_AND_ROLLBACK.md §1.1): the effective
  post-update allowed set must be a subset of the previous one absent
  explicit consent; capability/permission diff presented to the user before
  install; new capability = DENY.
- **FUTURE TEST.** "Authority diff" test: compare the effective
  `(capability, peer, decision)` set between releases; any expansion without
  an explicit-consent flag = gate FAIL.

### RT-4 · Rollback breaking crypto

- **THREAT.** Returning to a previous version restores a cryptographically
  retired suite, or invalidates pairings/identity.
- **EXPLOIT.** After a weakness announcement in `nido-crypto/1`, a user
  rolls back to 1.2 which only speaks `nido-crypto/1`; their sessions
  become vulnerable again without warning.
- **MITIGATION.** Rollback never restores retired crypto
  (UPDATE_AND_ROLLBACK.md §3.2): blocked with explanation; one-way
  migrations declared before updating; identity and pairings in an
  independently versioned store.
- **FUTURE TEST.** Rollback matrix: for each (new_version, old_version)
  pair, verify the crypto downgrade is blocked and the identity survives.

### RT-5 · Feature flags evading policy

- **THREAT.** A flag (corrupt local or malicious remote) pre-authorizes
  what policy would deny, or turns `DENY → ASK`.
- **EXPLOIT.** A manipulated flag manifest on disk sets
  `policy.strict_mode: off`; the Policy Engine reads it before evaluating
  and relaxes decisions.
- **MITIGATION.** Flags are evaluated **after** the Policy Engine and can
  only reduce (UPDATE_AND_ROLLBACK.md §2.2); remote flags = UNTRUSTED,
  turn-off-only; flag state is visible to the user.
- **FUTURE TEST.** Evaluation-order test: with adversarial flags (all
  "on/permissive"), verify policy decisions don't change vs. absent flags.

### RT-6 · Diagnostics becoming telemetry

- **THREAT.** The security diagnostics, designed as local, start being sent
  "to improve the product" without new consent.
- **EXPLOIT.** 1.6 adds "auto-send diagnostics in ONLINE ENHANCED" with
  the old crash-reporting consent; per-item PASS/FAIL enables device
  fingerprinting and user correlation.
- **MITIGATION.** Running diagnostics never sends anything
  (PRIVACY_SAFE_DIAGNOSTICS.md §2.2); any send is a separate act with its
  own informed consent; report IDs not correlatable with identity.
- **FUTURE TEST.** Per-release lab network audit: run all diagnostics with
  the mode at every value and verify zero outbound packets; test that
  enabling crash reporting doesn't enable diagnostics sending.

### RT-7 · Attacker forging reports

- **THREAT.** A third party sends fake reports ("I'm user X, my app does
  Y") to pollute triage, extract information from the response process, or
  dox via "contact me".
- **EXPLOIT.** Mass spam of fake "security issues" to bury a real report;
  or a report with a description containing a prompt-injection payload
  against the triage system (if triage uses a model).
- **MITIGATION.** Separate security path with acknowledgement but no
  self-trust; triage never executes instructions contained in a report
  (reports are UNTRUSTED DATA, like any external content); per-origin rate
  limiting; no automatic correlation with identity.
- **FUTURE TEST.** Per-release adversarial triage exercise: N fake reports
  + 1 real; measure that the real one is identified and that no payload in
  reports gets executed.

### RT-8 · Malicious user abusing the reporting backend

- **THREAT.** Using the reporting backend as an exfiltration channel, free
  storage, or attack (uploading illegal content as an "attachment", DoS by
  volume).
- **EXPLOIT.** Opt-in attachments used to upload gigabytes; the free-text
  description field used to harass the team; automated reports as a
  low-intensity botnet.
- **MITIGATION.** Size/count limits per attachment and per origin; channel
  moderation; attachments kept with TTL and effective deletion; the backend
  never executes or renders attachments as code; the free description is
  shown as quoted text, never interpreted.
- **FUTURE TEST.** Per-release abuse tests: uploading giant/malformed files,
  anomalous volume from one origin, malicious content in description —
  verify limits, rejection, and that nothing executes.

---

## 6. Decision classification

- **FROZEN PRINCIPLES:** (a) impact-based classification, not counting;
  when in doubt classify upward; (b) the 8 blocking classes are never
  discovered via users; (c) Transport ≠ Protocol — no platform-exclusive
  API dependency in the protocol; (d) `release-check` is deterministic: no
  PASS on model opinion; (e) a single FAIL → `RELEASE CANDIDATE: NO`.
- **PROVISIONAL:** the 2-week BETA window, the device-matrix numbers, the
  48h acknowledgement SLA (in BUG_REPORTING.md).
- **EXPERIMENTAL:** the `nido release-check` as a real executable command;
  the log secret-canary test (RT-1); the authority-diff test (RT-3).
- **OPEN QUESTIONS:** (1) How is "2 weeks in BETA" measured with few
  testers — calendar time or active sessions? (2) Who runs the per-release
  red-team when the team is one person — self-applied checklist, external
  peers, or both? (3) At what installed-base size does an "acceptable beta
  bug" in Bluetooth get reclassified as blocking by aggregate impact?

---

## 7. Final principle

**SHIP EARLY ENOUGH TO LEARN. NOT EARLY ENOUGH TO BET USER SECURITY ON LUCK.**

Users can help us find bugs. They should not be our security boundary.
