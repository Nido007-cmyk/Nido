> **Language:** English · [Español](es/PLAY_STORE_READINESS.md)

# Play Store Readiness Checklist — NIDO

**Status:** PREPARATION (not submitted)
**Last review:** 2026-10-09
**Target SDK at review time:** 36 (meets Play's target API requirement)

This document tracks everything needed before NIDO can be submitted to
Google Play. Nothing here changes the app's architecture — it is a
submission-preparation checklist.

## Verdict at last review

No structural blocker. NIDO's privacy-first architecture (zero data
collection, no analytics, no ads, no tracking) is a strong asset for Play
review. The items below are preparation work, not redesigns.

## Pre-submission checklist

### 1. Exact alarm declaration (RISK: review rejection)

- **Permission:** `SCHEDULE_EXACT_ALARM` (via `modules/exact-alarm`)
- **Use:** user-created reminders that must fire at a precise time.
- **Play policy:** exact alarms are restricted to apps where precise timing
  is core user-facing functionality (alarm clocks, calendars, timers).
  Reminders plausibly qualify, but Play requires a formal declaration in
  Play Console and reviewers may disagree.
- **Action:** prepare the declaration text now (see § Permission
  justifications). If rejected, fallback is inexact alarms via
  `WorkManager` (less precise, no policy risk).

### 2. SYSTEM_ALERT_WINDOW — trace or remove (RISK: extra review)

- **Finding (2026-10-09):** `SYSTEM_ALERT_WINDOW` appears in the generated
  `android/app/src/main/AndroidManifest.xml` but its source could not be
  traced to `app.json`, `plugins/`, or any `node_modules` manifest.
- **Play policy:** "draw over other apps" is a highly sensitive permission
  that triggers additional review and requires a prominent in-app
  disclosure.
- **Action:** trace the origin (likely an Expo config plugin default or
  manifest merger). If unused, remove it before submission. Do NOT submit
  with an unexplained sensitive permission.

### 3. Location permission justification

- **Permission:** `ACCESS_FINE_LOCATION`
- **Use:** required for Bluetooth classic discovery on API < 31. On API 31+
  the app uses `BLUETOOTH_SCAN` with `neverForLocation`.
- **Play policy:** location access is heavily scrutinized; the Data Safety
  section must explain it precisely.
- **Action:** document the API-level split in the Data Safety answers and
  the store listing. Consider dropping classic discovery (API < 31) if the
  minSdk allows it, which would remove the location need entirely.

### 4. Privacy policy (REQUIRED)

- **Play policy:** every app that handles personal data must link a privacy
  policy in Play Console and in the app.
- **Status:** does not exist yet.
- **Action:** write and host a privacy policy. NIDO's story is simple and
  strong: all data stays on the device, encrypted; no accounts; no servers;
  no analytics; the only network use is the one-time model download. The
  policy should say exactly that, in plain language.

### 5. Data Safety section (REQUIRED)

- **Play policy:** must be completed in Play Console before release.
- **Draft answers (verify at submission time):**
  - Data collected: **none** (no data leaves the device).
  - Data shared with third parties: **none**.
  - The one-time model download (~1 GB) contacts a file host; no personal
    data is transmitted. Disclose the download clearly.
  - Encryption in transit: N/A (no app data transmitted). Data at rest:
    SQLCipher + Android Keystore.
- **Action:** complete the questionnaire in Play Console; keep these answers
  as the source of truth.

### 6. First-run model download disclosure

- **Status:** first launch downloads ~1 GB (LLM + embedding model) before
  the app is usable.
- **Play policy:** large downloads are allowed but should be disclosed; the
  app must handle metered connections gracefully (it already warns).
- **Action:** mention the download size in the store listing description.
  Long-term option: Play Asset Delivery.

### 7. Store listing assets (STANDARD)

- App icon (512×512), feature graphic (1024×500), screenshots (phone +
  7-inch and 10-inch tablet), short + full description, content rating
  questionnaire, category, contact email.
- **Action:** produce when submission is decided. Screenshots must show the
  real app, not mockups.

## Permission justifications (for Play Console declarations)

| Permission | Used for | Justification |
|---|---|---|
| `BLUETOOTH`, `BLUETOOTH_ADMIN`, `BLUETOOTH_CONNECT` | Nido-to-Nido P2P messaging | Core feature: encrypted phone-to-phone chat |
| `BLUETOOTH_SCAN` (neverForLocation) | Discovering nearby paired devices | Core feature; explicitly not used for location |
| `ACCESS_FINE_LOCATION` | BT classic discovery on API < 31 | Legacy API requirement; see item 3 |
| `RECORD_AUDIO` | Voice input (on-device STT) | User-initiated voice messages |
| `READ_CONTACTS` / `WRITE_CONTACTS` | P2P contact pairing | User-initiated pairing only |
| `READ_CALENDAR` / `WRITE_CALENDAR` | Reminder integration | User-created reminders |
| `POST_NOTIFICATIONS` | Reminder + P2P message alerts | Core feature alerts (Android 13+) |
| `SCHEDULE_EXACT_ALARM` | Precise reminders | See item 1 |
| `USE_BIOMETRIC` / `USE_FINGERPRINT` | App lock | User-enabled security |
| `FOREGROUND_SERVICE` + `connectedDevice` type | P2P connection service | Declared type matches use |
| `INTERNET` | One-time model download | No other network use (see network audit) |
| `VIBRATE` | Notification haptics | Standard |
| `SYSTEM_ALERT_WINDOW` | **Unknown — trace or remove** | See item 2 |

## Notes

- The app's `src/privacy/networkAudit.ts` (every connection logged and
  visible in Settings) is strong evidence for review if questions arise
  about network behavior.
- Do not submit while physical two-device validation is still pending —
  Play review is not a substitute for the device gate.
- Re-run this checklist before submission; Play policies change.
