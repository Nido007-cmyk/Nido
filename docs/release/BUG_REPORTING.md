> **Language:** English · [Español](../es/release/BUG_REPORTING.md)

# NIDO Bug Reporting — "Report a Problem"

**Status:** design, NOT to be implemented yet (neither the platform/backend).
**Principle:** the user sees **exactly** what leaves their device
**before** it leaves. No silent telemetry. No "trust us".

---

## 1. "Report a Problem" flow

```
1. The user taps "Report a Problem"
2. The app generates the diagnostic LOCALLY (on the device, no network)
3. The app shows the COMPLETE package to the user: every field, every value
4. The user picks a category + writes their description (separate from the diagnostic)
5. The user chooses which optional attachments to include (explicit opt-in, one by one)
6. Only then: send / save locally / discard
```

> **FROZEN PRINCIPLE.** Step 3 is not optional or "advanced": it's the normal
> flow. A report the user couldn't inspect before sending is a design
> defect, not a UX simplification.

### 1.1 Default content (always included, visible at step 3)

- app version, build number, channel (INTERNAL/ALPHA/BETA/STABLE)
- OS version, device model, architecture (arm64-v8a, etc.)
- feature state: which features/flags were active (names, no sensitive
  values)
- sanitized error codes (from PRIVACY_SAFE_DIAGNOSTICS.md's closed catalog)
- crash metadata: crash type, **sanitized** stack trace (no user paths, no
  variable values), thread, timestamp
- performance metrics: memory, aggregated response times — no content
- transport state: which transports were used (names), error counters per
  transport — no peer identifiers
- security diagnostics: the PASS/FAIL/UNVERIFIED list per item (see
  PRIVACY_SAFE_DIAGNOSTICS.md §2) — **states, not values**

### 1.2 Excluded by default (NEVER without explicit opt-in)

Conversations · memory contents · files · calendar contents · contacts ·
location · private keys · session keys · identity secrets · raw prompts ·
NIDO↔NIDO message contents · model chain-of-thought.

> **FROZEN PRINCIPLE.** The exclusion list is closed by default and only
> opens through **explicit, granular, revocable opt-in**: the user enables
> each additional attachment separately, sees its content before sending,
> and can revoke afterwards (the backend must be able to delete it — see
> §5).

### 1.3 Explicit opt-in for additional information

Each optional attachment shows: what it is, why it would help, how long it
is kept, who can see it. Examples: "include the last 50 structured log
events (already sanitized)", "include a screenshot". No opt-in may be an
"accept all".

### 1.4 Description/diagnostic separation

The user's free-text description travels in a field separate from the
structured diagnostic. Reasons: (a) the user may unknowingly write sensitive
data — the field is marked "unsanitized, review it"; (b) the structured
diagnostic stays machine-parseable without mixing free text; (c) if the
user pastes a key by accident, the damage is contained in a visible,
deletable field.

---

## 2. Crash reporting per NIDO mode

| Mode | Behavior |
|---|---|
| **OFFLINE ONLY** | The crash report **stays local**. It is stored encrypted on the device and is manually exportable (a file the user can inspect and share through whatever medium they choose). Zero network. |
| **LOCAL-FIRST** | The user decides **per report**: send, save locally, or discard. No automatic sending. The default is to ask. |
| **ONLINE ENHANCED** | Automatic sending may exist **only if** the user explicitly enabled it **and** saw and understood what is shared (the §1.1 package, shown once when enabling, re-shown if it changes). Revocable at any time; revoking stops future sends. |

> **FROZEN PRINCIPLE.** There is no mode, flag, or update that enables
> automatic crash report sending without explicit, informed consent.
> "Improving the product" is not consent.

### 2.1 Technical options (to evaluate, not choose yet)

- **OFFLINE ONLY:** local exportable file; the user attaches it wherever
  they want.
- **LOCAL-FIRST / ONLINE ENHANCED:** local queue of pending reports with
  retry; each report carries a random ID not correlatable with the NIDO
  identity (reports must not allow profiling users across multiple sends).
- The choice of library/service remains **open**; any option must be
  evaluated against: what leaves the device by default? can it be fully
  disabled? does the SDK make its own undeclared network calls?

---

## 3. User feedback categories

Simple, in the user's language, chosen **before** writing:

1. Something crashed
2. NIDO did something unexpected
3. NIDO couldn't complete a task
4. Bluetooth / NIDO connection problem
5. Voice problem
6. Model problem
7. Battery / performance
8. Privacy / security concern
9. Other

Category 8 (privacy/security concern) is **not** the vulnerability path
(see §4): it's for "I'm worried X left my phone", handled as sensitive
feedback with priority handling but not as a formal security report.

---

## 4. Separate path: REPORT SECURITY ISSUE

Vulnerabilities are **never** mixed with normal feedback. Reasons:
different sensitivity level, different SLA, different handling (a vuln
report in the "the app looks slow" queue is an ignored vulnerability).

### 4.1 Conceptual design (prepare, don't operate yet)

- **security.txt:** published on the official domain/channels when a public
  presence exists; indicates security contact, policy, and scope. Not
  published until someone can respond within the defined SLA.
- **Responsible disclosure policy:** what counts as a valid report, what is
  expected of the reporter (don't exploit beyond what's needed to
  demonstrate, don't exfiltrate user data), what they can expect from the
  project (acknowledgement, timeline, credit if desired).
- **Severity classification:** Critical / High / Medium / Low, defined by
  **impact** (see BETA_SECURITY_GATE.md §1): does it allow silent data
  loss, plaintext of private information, key leakage, Policy Engine
  bypass, unauthorized execution/payments, identity corruption, crypto
  downgrade? → Critical/High. No mandatory CVSS at the start; a human does
  the classification with the project's impact taxonomy.
- **Acknowledgement process:** acknowledgement within ≤48h (provisional);
  the reporter gets a case identifier and a private channel.
- **Fix/release process:** the fix is developed privately, verified against
  the 8 blocking classes, published as a hotfix with a reduced gate (see
  RELEASE_MODEL.md §3), and the reporter is credited per their preference.

> **FROZEN PRINCIPLE.** No economic bug bounty yet. A poorly designed bounty
> attracts low-value reports and creates perverse incentives; it will be
> evaluated once the disclosure program works without money involved.

---

## 5. Backend requirements (when it exists; don't implement now)

Design, not implementation — but the client design assumes this contract:

- Reports are stored separated by category; security ones, under even more
  restricted access.
- Every opt-in attachment has TTL and effective deletion (user revocation =
  real deletion, not "marked as deleted").
- Reports are not correlated with NIDO identity unless the user explicitly
  asks (e.g. "contact me about this report" with a channel the user
  provides).
- The backend never asks the client for more data than the client chose to
  send: no server-side "extended automatic diagnostic".

---

## 6. Decision classification

- **FROZEN PRINCIPLES:** (a) the user inspects the complete package
  before sending — normal flow, not advanced; (b) exclusion list closed
  by default, granular opt-in only; (c) security path separate from
  feedback; (d) zero silent telemetry in any mode; (e) no economic bug
  bounty for now.
- **PROVISIONAL:** the 9 feedback categories and the 48h acknowledgement
  SLA.
- **EXPERIMENTAL:** report IDs not correlatable with identity — the
  property is desirable but the concrete mechanism is yet to be designed.
- **OPEN QUESTIONS:** (1) How is a third-party crash-reporting SDK verified
  not to make undeclared network calls of its own — per-release lab
  traffic audit? (2) Should the diagnostic package be locally signed to
  detect in-transit tampering, and with which key without creating a
  correlatable identifier? (3) What security contact channel is credible
  before having a domain/public presence?
