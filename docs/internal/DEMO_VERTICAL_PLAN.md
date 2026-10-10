> **Language:** English · [Español](../es/internal/DEMO_VERTICAL_PLAN.md)
# NIDO — First Vertical Demo Plan: `calendar.availability.query/v1` (PREP ONLY)

**Status: NOT IMPLEMENTED. DO NOT RUN until the GO gates below are green.**
This document is the operator script and evidence plan, so the demo can be
executed the day C-1 is verified on hardware. Preparing the script now does
not authorize building the demo UI/flows early.

## What the demo proves (and what it does not)

Proves: two NIDOs negotiate a calendar-availability query phone-to-phone,
offline, with the Policy Engine deciding, the Privacy Budget accounting, and
only the allowed interval crossing the wire. Zero server, zero Internet.

Does NOT prove: production readiness, security audit, or that the demo UI is
final. The demo exercises `calendar.availability.query/v1` ONLY — the
capability stays BLOCKED for general use until the conformance DoD completes
(second full implementation + differential tests + C-1 Android verification).

## GO / NO-GO gates (all must be GO)

1. **C-1 hardware-verified**: `docs/ANDROID_VALIDATION.md` §1–§7 all PASS
   with evidence. NO-GO otherwise — no exceptions.
2. **Pairing works**: both phones paired via the QR flow over Bluetooth
   (requires the `CAMERA` permission work flagged in `docs/ANDROID_BUILD.md`).
3. **Capability unblocked**: explicit decision recorded unblocking
   `calendar.availability.query/v1` for this demo (currently BLOCKED pending
   conformance DoD).
4. **Models present**: both phones have required models pre-seeded or
   downloaded BEFORE airplane mode (the app gates on
   `ModelManager.requiredModelsPresent()`).
5. **Policy**: phone B has an explicit user rule/permit for
   `calendar.availability.query/v1` from phone A's identity (or the demo uses
   the ASK_USER path with the user approving on-device — record which).

## Preconditions (setup, with network still allowed)

- [ ] Both phones: APK installed, onboarding complete, biometric gate working.
- [ ] Both phones: models present (verify the setup wizard is done).
- [ ] Phone B: calendar contains a KNOWN fixture — e.g. busy 18:00–19:30,
  free otherwise on the demo day. Record the fixture; it is the ground truth
  for the evidence checks.
- [ ] Phone B: policy for A's NIDO recorded (allow availability query, or
  ASK_USER — decide beforehand and write it down).
- [ ] Phone A: knows B's identity (paired). Note B's NIDO identity string.
- [ ] Both phones: logcat capture running to files
  (`adb logcat -v time > demo-A.log` / `demo-B.log`).

## Operator script (airplane mode ON, Bluetooth ON, Wi-Fi OFF — both phones)

T+0 — **Isolate.** Both phones: airplane mode ON, then Bluetooth ON manually.
Wi-Fi stays OFF. Operator verifies the airplane icon on both screens (photo).

T+1 — **A asks.** On phone A, operator triggers the availability query for
phone B ("Is B free 18:00–20:00 today?"). Record the exact time and the exact
query parameters entered.

T+2 — **Transport.** A→B: NIDO handshake + `TASK_REQUEST` over Bluetooth
RFCOMM. Evidence to capture: logcat on both phones showing connect,
handshake completion, and frame events (no Wi-Fi, no IP addresses anywhere
in the logs — grep the logs for `192.168`, `10.`, `wlan` afterwards and
expect nothing).

T+3 — **B decides locally.** Phone B's Policy Engine evaluates the request
against the local rule recorded in preconditions. Evidence: B's log showing
the policy decision (`ALLOW` with constraints, or the ASK_USER prompt the
operator approved — screenshot the prompt if so).

T+4 — **B queries locally.** B reads its OWN calendar database on-device.
Evidence: B's log showing the local query; no network calls during this
window (logcat shows no HTTP/DNS — record the absence).

T+5 — **Budget accounts.** B's Privacy Budget consumes the disclosure units
for this response. Evidence: B's log/state showing budget before → after
(record both numbers).

T+6 — **B responds with ONLY the allowed interval.** Expected, given the
fixture: busy 18:00–19:30 → B returns free/busy for the ASKED window only,
e.g. "busy 18:00–19:30, free 19:30–20:00". What must NOT cross: event titles,
attendees, locations, or any time outside the queried window. Evidence:
screenshot of A's received result + B's log of the exact payload sent.

T+7 — **A receives.** Phone A displays the interval. Evidence: screenshot of
A's screen; A's log showing receipt.

T+8 — **Negative control (same session).** A asks for a WIDER window
("free all day?") or B's full calendar. Expected: Policy Engine denies or
the budget refuses — A receives a denial, not data. Evidence: screenshot +
logs of the denial. THIS is the minimum-disclosure proof; without it the
demo is incomplete.

## Evidence checklist (all required for a PASS)

1. Photos: airplane-mode icon visible on both phones during the demo.
2. `demo-A.log`, `demo-B.log` with timestamps covering T+0–T+8.
3. Screenshot: B's policy prompt/decision (T+3).
4. Screenshot: A's received interval (T+7).
5. Screenshot: denial on the over-broad query (T+8).
6. Grep over both logs for IP/Wi-Fi indicators → empty (record command+output).
7. Budget before/after numbers from B (T+5).
8. The exact payload B sent (from B's log) — verify by hand it contains no
   titles/attendees/locations/out-of-window times.

## Explicit NO-GO during the run

- If any step needs Wi-Fi or mobile data → STOP, record, NO-GO.
- If B's full calendar (or any event detail) appears on A → STOP, record, NO-GO.
- If the policy prompt never appears and data flows anyway → STOP (possible
  bypass), record, NO-GO.
- If Bluetooth drops and the app silently retries over another transport →
  STOP, record, NO-GO (transport switch must never be silent).

## After the demo

File all evidence under `docs/evidence/<date>-vertical-demo/`, write the
one-page outcome (PASS/FAIL per evidence item), and link it from the C-1
tracking. A PASS here does not unblock the capability for general use — that
decision stays with the conformance DoD.
