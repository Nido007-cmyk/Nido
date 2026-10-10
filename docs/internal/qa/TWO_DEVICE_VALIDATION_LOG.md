# Two-Device Validation Log — NIDO P2P

> **Status:** DRAFT template. Fill during the physical test; when complete and
> signed, this document becomes the release evidence for the build below.
> Related: the step-by-step test list lives in
> `docs/qa/PHYSICAL_CHECKLIST_UI_CIERRE.md`; this log is the *recorded
> evidence*, not the instructions.

## Environment (pre-filled, verified at build time)

| Item | Value |
|---|---|
| Build commit | `a85dc90` (UI-CIERRE) |
| CI run | [37974629670](https://github.com/Nido007-cmyk/Nido/actions/runs/37974629670) — success |
| APK | `app-release.apk`, 66.2 MB (129 MB unzipped) |
| SHA-256 | `b09a9df4935ab1c1bf65429bc0d4729e0db383b12a1fe9bd38fbf39cde18d9ef` |
| Signature | release, NIDO keystore (consistent with previous builds) |
| Unit tests in build | 2314/2314 green, TypeScript clean |
| Device A | Samsung Galaxy Tab A9+ 5G (SM-X218U) — "Aldo's Tab A9+" |
| Device B | _[FILL: model, e.g. second tablet]_ |
| Airplane mode | ON for the P2P tests below (offline-first claim under test) |
| Date / tester | _[FILL]_ |

## Test log

Mark each row: **PASS** / **FAIL** / **N/A**, with a one-line note of what was
observed. A FAIL stops nothing here; it is recorded honestly and investigated
after.

| # | Test | Expected | Result | Observed |
|---|---|---|---|---|
| 1 | APK hash check | `sha256sum` of the installed APK matches the SHA-256 above | _[FILL]_ | _[FILL]_ |
| 2 | QR pairing (in person) | A and B pair by scanning each other's QR; both list the contact | _[FILL]_ | _[FILL]_ |
| 3 | Encrypted message A → B → A | Message sent from A arrives on B; reply arrives on A; content matches | _[FILL]_ | _[FILL]_ |
| 4 | Screen-off reconnection | Screen off 60 s on one device; on wake, P2P reconnects without re-pairing | _[FILL]_ | _[FILL]_ |
| 5 | Non-paired peer rejection | A third device (or unpaired identity) attempts to connect; connection is refused, no session, no route change | _[FILL]_ | _[FILL]_ |
| 6 | Revocation | Revoke the contact on A; B disappears from A's list; reconnect attempt is blocked | _[FILL]_ | _[FILL]_ |
| 7 | Local chat in airplane mode | With airplane mode ON, local chat, memory and knowledge work on both devices | _[FILL]_ | _[FILL]_ |
| 8 | Restart persistence | Force-close and reopen the app on both devices; identity, contacts and settings survive | _[FILL]_ | _[FILL]_ |

## Verdict

_Evidence-graded. Only what was observed above counts._

- **P2P core (tests 2–6):** _[GO / NO-GO + one line]_
- **Offline behavior (test 7):** _[GO / NO-GO + one line]_
- **Integrity (test 1):** _[VERIFIED / NOT VERIFIED]_
- **Public release:** _[NO-GO until this log is complete and signed — the log IS the release]_

## Notes

_[Anything unexpected: error messages, timings, screenshots referenced by filename.]_

---
_Tester signature / date:_ _[FILL]_
