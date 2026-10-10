# Release Verification Protocol

**Status:** active process doc.
**Applies to:** every APK built for any channel (INTERNAL → ALPHA → BETA → STABLE,
see `../release/RELEASE_MODEL.md`).
**Principle:** BUILD LESS. VERIFY MORE. A release is not "done" when CI is green;
it is done when the gates below pass **on a physical device** with archived evidence.

---

## 1. Gate order (stop on first hard failure)

```
G0 provenance → G1 install & cold launch → G2 setup & downloads →
G3 offline inference → G4 privacy & security → G5 quality eval
```

No gate may be skipped. A gate that cannot be evaluated is marked **UNVERIFIED**,
never "pass". UNVERIFIED blocks channel promotion but does not block INTERNAL use.

## 2. G0 — Provenance (no device needed)

| Check | Evidence |
|---|---|
| CI run succeeded on the exact commit being released | run id, workflow, head SHA |
| Artifact preserved under `docs/ci-evidence/artifacts/run-<id>/` | `METADATA.md` present |
| APK SHA-256 recorded and independently re-verified after download | `sha256sum` output |
| Commit ↔ tree provenance clean (no unpushed local drift) | `git status`, bridge push log |
| Static standalone checks pass (embedded bundle, no Metro refs, `debuggable=false`, `usesCleartextTraffic=false`) | check script output |

## 3. G1 — Install & cold launch (physical device)

- Install as **update** over the previous release when one exists (signature continuity matters).
- Cold launch in **airplane mode**. Record: time to interactive, any crash/ANR.
- Reach the lock screen ("NIDO locked") without a crash.
- Evidence: photo or screen recording of the cold launch + lock screen.

## 4. G2 — Setup & downloads (physical device)

- Complete the setup wizard end to end (all model tiers offered; at least one fully downloaded).
- Every downloaded asset must pass SHA-256 verification (see T-005: verification
  hashes raw bytes, never an encoding of them).
- Evidence: wizard completion screenshots, download manager final state.

## 5. G3 — Offline inference (physical device, airplane mode)

- Chat works with zero network: send ≥5 messages, including one knowledge question.
- Record per-message: time-to-first-token and tokens/sec (see `../DEVICE_EVALUATION.md`).
- No crash, no ANR, no silent fallback to any network path.
- Evidence: eval run JSONL (`docs/eval/`), screen recording optional.

## 6. G4 — Privacy & security (physical device)

- Lock screen engages (biometric/PIN) and actually gates access to chat/history.
- `Clear All Data` destroys memory, P2P data, and keys (per PRE_ALPHA semantics);
  verify nothing sensitive survives a relaunch.
- `allowBackup=false` confirmed in the manifest of the shipped APK.
- No unexpected network connections during an airplane-mode-off soak test
  (see `../NETWORK_AUDIT.md`).
- **GATE-1 (SQLCipher at rest):** encrypted-at-rest must be demonstrated with
  reproducible on-device evidence before any public-facing claim is made.
  Compiled/linked ≠ verified.

## 7. G5 — Quality eval

- Run the fixed eval set (`src/eval/evalSet.ts`, version recorded) on-device.
- Grade answers by hand per `../EVAL_QUERIES.md`; record scores in
  `../eval/RESULTS_LEDGER.md`.
- A release must not regress the previous release's scores without a documented reason.

## 8. Evidence archival

For every release, create `docs/ci-evidence/releases/<version>/` containing:

```
RELEASE.md        # version, versionCode, commit, CI run, APK SHA-256, channel
G0-provenance.md  # checks + outputs
G1/ ... G5/       # per-gate evidence (photos, logs, JSONL, screenshots)
DECISION.md       # pass/fail per gate, who signed off, date, known UNVERIFIED items
```

## 9. Fail policy

- A hard failure in any gate **stops the release**. File it in `docs/qa/TRIAGE.md`
  (new T-number), fix forward, rebuild, restart at G0.
- Never downgrade a gate to "pass" because the failure is inconvenient.
- Never promote a channel on UNVERIFIED gates; record them as known gaps in DECISION.md.

## 10. Cadence

- INTERNAL: G0–G3 minimum.
- ALPHA: all gates; G4 security items per `../release/BETA_SECURITY_GATE.md` §4 blocking classes.
- BETA/STABLE: all gates + counsel review of naming/licensing deltas since last release.
