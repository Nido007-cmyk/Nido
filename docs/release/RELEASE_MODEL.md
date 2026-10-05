> **Language:** English · [Español](../es/release/RELEASE_MODEL.md)

# NIDO Release Model — INTERNAL → ALPHA → BETA → STABLE

**Status:** design, NOT to be implemented yet.
**Guiding principle:** the goal is not to wait until NIDO is perfect; it is
to bring it to a state solid and safe enough to learn from real users
without turning them into the security boundary.

---

## 1. The four channels

```
INTERNAL ──gate──▶ ALPHA ──gate──▶ BETA ──gate──▶ STABLE
   ▲                  │                 │               │
   │                  │                 │               └── hotfix (reduced gate)
   └── rollback / declared downgrade (see UPDATE_AND_ROLLBACK.md)
```

Each channel is a **set of guarantees**, not a version number. A build
may carry the same `versionCode` on two channels and not offer the same
guarantees: what changes is what was verified, on which devices, and what
it is allowed to do.

### 1.1 Definitions

| Channel | Audience | Purpose |
|---|---|---|
| **INTERNAL** | The team/developer and their own lab devices | Fast iteration; breaking things is acceptable; test data, never real user data |
| **ALPHA** | A small circle of trusted testers, explicitly invited | Validate real end-to-end flows with real data under supervision; discover device incompatibilities |
| **BETA** | Volunteer users who accept known, documented risk | Discover crashes, Bluetooth edge cases, performance, UI, model compatibility, battery, and unexpected workflows **at scale** |
| **STABLE** | General public | The product. No known risk of the blocking classes (BETA_SECURITY_GATE.md §4) |

> **FROZEN PRINCIPLE.** An experimental feature may exist in Beta **without**
> automatically becoming Stable. Promotion between channels is always an
> **explicit decision** with its own gate; never automatic by time,
> number of builds, or "it's been X weeks without complaints".

### 1.2 Build distinction: DEVELOPMENT / VALIDATION / RELEASE

Three build types with distinct purposes. Confusing them is a classic source
of false confidence.

| | DEVELOPMENT | VALIDATION | RELEASE |
|---|---|---|---|
| Purpose | Iterate on code | **Demonstrate security properties** | What the user runs |
| Plaintext DB | Allowed only with explicit insecure backend + visible warning (`__DEV__` plaintext fallback) | **PROHIBITED. SQLCipher failure = FAIL CLOSED** | Prohibited |
| Keystore missing | May degrade with a warning | **FAIL CLOSED** | Fail closed |
| Diagnostics | Verbose | Only PASS/FAIL/UNVERIFIED, no secrets | Minimal |
| Telemetry | Local | None | Only explicit opt-in |

> **FROZEN PRINCIPLE.** The `__DEV__` plaintext fallback can **never**
> make a test look secure when it isn't. A VALIDATION BUILD that opens the
> DB without SQLCipher or without Keystore **fails closed** and reports it
> as FAIL, not as "degraded mode". No security result obtained in a
> DEVELOPMENT BUILD counts as evidence for a channel gate.

---

## 2. Requirements per channel

### 2.1 INTERNAL

- **Security requirements:** none enforceable; the code may be half-written.
  *Prohibited* from using real user data (conversations,
  calendar, contacts) in this channel.
- **Test requirements:** compiles (`ANDROID COMPILED` as minimum aspiration);
  unit tests green if they exist.
- **Device coverage:** 1 developer device.
- **Rollback strategy:** reinstall; loss of test data acceptable.
- **Data migration requirements:** none; the DB may be destroyed between builds.
- **Known-risk policy:** all risk is acceptable except risk affecting third
  parties (e.g. accidentally sending real data to a server).

### 2.2 ALPHA

- **Security requirements:** VALIDATION BUILD available; SQLCipher verified
  loaded on the device (`cipher_version` reported); Keystore available;
  biometric gate functional; no secrets in logs.
- **Test requirements:** full suite green (unit + TS/Rust conformance +
  differential); `nido release-check` (see BETA_SECURITY_GATE.md) with no
  FAILs in the BUILD/TESTS/CONFORMANCE sections.
- **Device coverage:** ≥2 distinct physical Android devices (different
  manufacturer or Android version); NIDO↔NIDO over Bluetooth between them
  at least once.
- **Rollback strategy:** declared downgrade possible or impossible, but
  **documented**; the user's identity survives the rollback.
- **Data migration requirements:** forward DB migrations tested;
  backward only if declared supported.
- **Known-risk policy:** known risks listed in writing and each tester
  accepts them explicitly; no risk from the 8 blocking classes.

### 2.3 BETA

- **Security requirements:** all ALPHA ones **plus**: complete on-device
  security diagnostics (see PRIVACY_SAFE_DIAGNOSTICS.md) with zero FAIL in
  the 8 blocking classes; release red-team review (see
  BETA_SECURITY_GATE.md §5); published `security.txt` and an active
  reporting path.
- **Test requirements:** all ALPHA ones **plus**: device matrix
  (§2.4); update tests from the previous Stable and the previous Beta;
  tests of the declared rollback.
- **Device coverage:** minimum matrix: 3+ Android models (low/mid/high-end,
  Android 12/13/14+), and when an iOS build exists, 2+ iPhones. Crossed
  Bluetooth between at least 2 different combinations.
- **Rollback strategy:** tested on the matrix; if any migration is
  one-way, declared in the release notes.
- **Data migration requirements:** tested automatic migration from the two
  previous releases; encrypted backup before migrating; migration failure =
  don't boot with half-migrated data (fail closed), offer restore.
- **Known-risk policy:** known risks published in the Beta notes; the user
  sees them **before** installing; no blocking risk may be on the list
  (those block the release — they aren't "documented").

### 2.4 STABLE

- **Security requirements:** all BETA ones **plus**: zero open critical/
  high-severity issues (see BETA_SECURITY_GATE.md); minimum 2-week window
  in BETA with no security regressions; review of authority changes since
  the previous Stable (permissions/autonomy/disclosure/spend/network) with
  no silent expansions.
- **Test requirements:** `nido release-check` → `RELEASE CANDIDATE: YES`
  (deterministic, no model opinion); checklist signed by a human.
- **Device coverage:** full matrix including the weakest supported
  low-end; verified Android↔Android; iPhone when available.
- **Rollback strategy:** same as BETA, with the additional requirement that
  rollback must not break existing pairings unless explicitly declared.
- **Data migration requirements:** same as BETA; additionally, migration
  must be resumable if interrupted (a power cut mid-migration must not
  leave the DB in an undefined state).
- **Known-risk policy:** only documented acceptable risks (performance,
  UI, minor compatibility). No known security risk.

---

## 3. Promotion gates (explicit decision)

| Transition | Gate |
|---|---|
| INTERNAL → ALPHA | ALPHA checklist complete; a human signs it; VALIDATION build produced |
| ALPHA → BETA | `nido release-check` green except sections marked "beta-tolerable"; release red-team; written risk notes |
| BETA → STABLE | `RELEASE CANDIDATE: YES`; 0 criticals/highs; 2 weeks in BETA; authority review (permissions/autonomy/disclosure/spend/network) with no silent expansions |
| Any → hotfix | Documented reduced gate: only the fix + minimal regression + the 8 blocking classes re-verified; the hotfix may not smuggle in features |

> **FROZEN PRINCIPLE.** No gate may be passed on "the model says it's
> fine". Every gate is signed by a human or verified by a deterministic
> check.

---

## 4. Decision classification

- **FROZEN PRINCIPLES:** (a) promotion between channels is always explicit,
  never automatic; (b) the `__DEV__` plaintext fallback never counts as
  security evidence; (c) VALIDATION BUILD fails closed without SQLCipher or
  Keystore; (d) no gate is passed on model opinion.
- **PROVISIONAL:** the concrete device-coverage thresholds (device counts,
  Android versions) and the 2-week BETA window —
  reasonable today, revisable with real data.
- **EXPERIMENTAL:** the exact format of `nido release-check` as an
  executable command (today it is a conceptual checklist; see
  BETA_SECURITY_GATE.md §4).
- **OPEN QUESTIONS:** (1) Who signs the gates when there is more than one
  person — individual signature, quorum, or role? (2) How are VALIDATION
  BUILDs versioned and distributed without turning them into a confusing
  parallel channel? (3) What evidence of "2 weeks in BETA" counts if the
  tester base is small — calendar time or number of active sessions?

---

## 5. What this model does NOT do

- It does not replace the first APK: **ANDROID COMPILED remains the
  immediate goal**. This document prepares the architecture for when there
  are users, not delays the build.
- It does not define the reporting backend (see BUG_REPORTING.md —
  design, not implementation).
- It does not turn metrics (bug counts, crashes) into a promotion
  criterion: classification is by **impact** (see BETA_SECURITY_GATE.md).
