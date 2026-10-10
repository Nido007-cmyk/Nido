# NIDO — Physical Device Test Checklist (next clean APK, Galaxy Tab A9+)

**Status:** PREPARED 2026-09-27. Not executed — awaiting the next testable APK.
**Rule:** Preserve the APK + its SHA-256 BEFORE any device testing.
**Labels:** CODE VERIFIED ≠ DEVICE VERIFIED ≠ UNVERIFIED. Never convert
unit/integration evidence into a physical-device claim.

## 0. Artifact preservation (before install)

- [ ] APK file name: ____________________
- [ ] APK SHA-256: ____________________
- [ ] Built from commit: ____________________
- [ ] CI run (if any): ____________________
- [ ] Copy preserved at: `docs/ci-evidence/artifacts/run-<id>/` + METADATA.md
- [ ] Do NOT uninstall the existing NIDO app or clear its data unless the test
      plan explicitly requires it.

## 1. Primary offline sequence

Record PASS/FAIL + evidence (photo/log hash) for each step.

| # | Step | Expected | Observed | Result |
|---|------|----------|----------|--------|
| 1 | Install/update NIDO | installs cleanly, no signature conflict | | |
| 2 | Launch normally | reaches setup/chat, no crash | | |
| 3 | Start model/corpus installation | download begins, progress honest | | |
| 4 | Progress reaches 100% | no indefinite stall (cf. ~96% class) | | |
| 5 | All assets pass SHA-256 | verification completes, no bypass | | |
| 6 | Initialization/indexing completes | engine ready | | |
| 7 | Enter chat | chat surface usable | | |
| 8 | Local inference response | real on-device response (note latency) | | |
| 9 | Force-close NIDO | process killed | | |
| 10 | Enable airplane mode | airplane ON | | |
| 11 | Confirm no network | Wi-Fi/cellular unavailable | | |
| 12 | Cold-launch NIDO | starts without network | | |
| 13 | Installed model recognized | no redownload requested | | |
| 14 | Offline inference again | real local response, airplane mode | | |

P2 STATUS after this section: PHYSICAL DEVICE VALIDATION = OPEN until all pass.

## 2. Physical recovery tests (after primary sequence)

- [ ] **A. INTERRUPTED DOWNLOAD** — interrupt a model download; verify honest
      recovery (resume or restart-from-zero as implemented; never a false 100%).
- [ ] **B. REAL RESUME** — for a stall/resumable condition, verify Android
      resume data actually resumes rather than silently restarting while
      claiming resume.
- [ ] **C. PROCESS KILL** — kill NIDO during download; reopen; verify journal
      reconciliation (failed/interrupted, never trusted).
- [ ] **D. LOW STORAGE** — only if practical and safe; validate
      insufficient-storage handling without endangering unrelated tablet data.
- [ ] **E. INTEGRITY REJECTION** — use a controlled test artifact/fixture to
      prove corrupt/wrong-hash content cannot be promoted to installed.
      Do NOT corrupt the production model manually; use a fixture/path.
- [ ] **F. RESTART RECOVERY** — after a failed attempt, restart NIDO; prove
      retry converges to exactly one valid verified installation.
- [ ] **G. EXISTING VALID MODEL** — prove retry/failure handling does not
      delete or damage an already valid installation.

## 3. Post-core offline groups (separate evidence)

- [ ] Memory persistence across restart
- [ ] Documents / RAG behavior
- [ ] App restart behavior (warm)
- [ ] Clear All Data behavior (strict semantics per master directive)
- [ ] P2P physical flows (when hardware-ready): pair, message, approval inbox

## 4. Security / hardware gates (stay UNVERIFIED until evidence)

- [ ] GATE-1 / SQLCipher effective encryption at rest (reproducible evidence)
- [ ] Biometric / device-gate behavior where applicable
- [ ] Native confirm dialog path (M-3)
- [ ] QR-scan → pair dialog flow (M-5)
- [ ] Inbound agent_task → approval → decision between two tablets (M-6)

## Evidence rules

- One evidence entry per step: timestamp, observed behavior, artifact/log ref.
- Screenshots/logs preserved under `docs/qa/` with date prefix.
- Any deviation from expected → file as a bug with reproduction, do not
  hand-wave it.
- A successful APK establishes COMPILED only — never upgrade
  INSTALLED/TESTED/VERIFIED without the evidence above.
