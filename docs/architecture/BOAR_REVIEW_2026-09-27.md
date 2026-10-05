> **Language:** English · [Español](../es/architecture/BOAR_REVIEW_2026-09-27.md)

# BOAR Review — 2026-09-27

**Status:** RESEARCH ONLY. No code changed.
**Method:** local clone `~/workspace/boar-app` re-fetched from
`https://github.com/rferrari/boar-app` on 2026-09-27 — remote HEAD is
`9898b35`, identical to the clone used for `~/workspace/offline-muse/BOAR_DEEP_DIVE.md`
(2026-09-26). **BOAR has not changed since the deep-dive**; nothing in that
document needs revision. This review is a *delta review*: file-level diff of
BOAR vs NIDO (`~/workspace/nido-app`) to find concrete adoptions.
**Discipline:** EXISTS (verified in code) vs PROPOSED (design) is strict
throughout. Nothing BOAR does is presented as something NIDO does.

## Headline result

NIDO's `src/` is a **strict superset** of BOAR's `src/` minus exactly 4
files, all deliberately discarded network features:

| In BOAR, not in NIDO | Why absent (correct) |
|---|---|
| `src/models/discoveredModels.ts` | HF-browser persistence — network |
| `src/services/modelBrowser.ts` | Hugging Face API search — network |
| `src/ui/ModelBrowser.tsx` | HF browser UI — network |
| `src/ui/ModelCatalogScreen.tsx` | dead/legacy in BOAR itself (zero references) |

NIDO adds 30 files BOAR lacks (agent loop, skills, tools, P2P crypto/stack,
privacy, security, notifications, routines, TTS, diagnostics) and 11
dependencies (incl. `expo-secure-store`, `expo-local-authentication`,
`expo-notifications`, `expo-speech`, `tweetnacl`, `qrcode`). Test files:
**43 vs 19**. All BOAR modules, scripts, and docs are present in NIDO
(most byte-identical). The review therefore finds **process/doc gaps and
pattern adoptions, not missing features**.

---

## Findings (ranked by value/effort)

### R1 — Rewrite AGENTS.md for NIDO (ADOPT pattern, REWRITE content)
- **WHAT (BOAR does):** BOAR's `AGENTS.md` is an agent-oriented build/run
  guide: exact commands from clean checkout to device, plus non-obvious
  constraints (`expo prebuild --clean` after touching `app.json`, Metro
  Wi-Fi-isolation fix via `adb reverse`, the `SplashScreenManager` red
  herring, "don't nuke `android/` to fix builds"). It is the single best
  onboarding artifact in the repo.
- **WHERE:** `boar-app/AGENTS.md` (full file).
- **GAP (NIDO today):** `nido-app/AGENTS.md` is **byte-identical to BOAR's** —
  still titled *"compiling & installing BOAR from source"*. It documents the
  EAS cloud-build path (parked by user decision — do not use), `make` targets,
  and says nothing about NIDO's actual build path (GitHub CI, 180-min
  timeout, the `llama.rn` native long pole), the `nido-p2p` native module,
  SQLCipher/Keystore on-device verification, or the "don't weaken security
  to get green builds" rule.
- **RECOMMENDATION:** ADOPT. Rewrite as a NIDO-specific build guide keeping
  BOAR's structure (prereqs → clean-checkout commands → release APK →
  no-device verification → device eval → pitfalls). Effort: small. Value:
  high — a stale AGENTS.md will eventually instruct an agent to do the wrong
  thing (EAS, `rm -rf android`, Expo Go).

### R2 — Extend COMPLIANCE.md with NIDO's privacy claims (ADAPT)
- **WHAT:** BOAR's `docs/COMPLIANCE.md` is a compliance matrix with a
  verified network-audit section (§5 PASS).
- **WHERE:** `boar-app/docs/COMPLIANCE.md`.
- **GAP:** `nido-app/docs/COMPLIANCE.md` is **byte-identical (0 diff lines)**.
  It documents none of NIDO's new guarantees: SQLCipher on both DBs,
  Keystore-backed DEK + fail-closed wiring, biometric/PIN gate,
  `allowBackup=false`, P2P E2E crypto, the network-audit module, zero
  analytics SDKs.
- **RECOMMENDATION:** ADAPT. Add NIDO-specific rows with evidence pointers
  (`docs/C1_SQLCIPHER.md`, `docs/NETWORK_AUDIT.md`,
  `docs/C1_CONFORMANCE_REPORT.md`, `src/diagnostics/security.ts`). Effort:
  small–medium. Value: high — this is the evidentiary basis for every
  "privacy-first" claim; the PRE_ALPHA_PLAN's goal ("every thing marked
  functional has real evidence") needs this document to be true, not inherited.

### R3 — TD-1 fix: extend BOAR's ordered-deletion pattern (ADAPT)
- **WHAT:** BOAR's `appReset.ts` implements *ordered* deletion: unload native
  modules → `resetDatabase()` (rag) → delete files/models/corpus → settings →
  clear discovered models. `resetDatabase()` itself does best-effort
  `.sqlcipher`-marker cleanup.
- **WHERE:** `boar-app/src/services/appReset.ts`,
  `boar-app/src/rag/db.ts` (`resetDatabase`).
- **GAP:** NIDO inherited the pattern nearly verbatim (diff = only the
  discovered-models removal, which is correct) — but it does not cover NIDO's
  new surfaces: `nido_memory.db` (`clearMemoryDb()` exists at
  `src/agent/memory/memoryStore.ts:295`, unreferenced), the 3 SecureStore
  keys, P2P identity/contacts/history, `eval/` artifacts. This is TD-1
  (HIGH), already item 1 of PRE_ALPHA_PLAN.
- **RECOMMENDATION:** ADAPT. When fixing TD-1, keep BOAR's ordered,
  best-effort-with-logging structure and extend the sequence: unload native →
  close both DBs → delete both DBs → delete SecureStore keys (explicit key
  list, incl. P2P keys) → delete models/corpus/eval → settings → reseed
  state. No new pattern needed — the template is proven. (Does not change
  PRE_ALPHA_PLAN priority; it is already #1.)

### R4 — Route device validation through BOAR's eval-device flow (ADOPT)
- **WHAT:** `scripts/eval-device.mjs` + `docs/DEVICE_EVALUATION.md` define an
  unattended adb device-eval flow with safety rules (never run during model
  downloads, keep screen on, `--dry-run` first, JSONL as source of truth,
  failures recorded not skipped).
- **WHERE:** `boar-app/scripts/eval-device.mjs`, `boar-app/docs/DEVICE_EVALUATION.md`.
- **GAP:** NIDO kept both byte-identical and `EvaluationScreen` is BUILT —
  nothing is missing. The gap is *procedural*: PRE_ALPHA_PLAN's "device
  validation" step doesn't name the procedure.
- **RECOMMENDATION:** ADOPT as the named procedure for the plan's device
  validation step. Effort: zero (already in repo). Value: medium — prevents
  reinventing device-test discipline under time pressure.

### R5 — Extend the `.pure.ts` testability convention to new code (ADOPT, ongoing)
- **WHAT:** BOAR isolates pure logic in `.pure.ts` twins (`rag/pure.ts`,
  `eval/*.pure.ts`, `executionTelemetry.pure.ts`); anything touching
  `expo-sqlite`/`llama.rn`/`expo-file-system` is explicitly *not* unit-tested.
  The contract is documented in AGENTS.md.
- **WHERE:** `boar-app/src/rag/pure.ts`, `boar-app/src/eval/*.pure.ts`, etc.
- **GAP:** NIDO kept the 3 inherited `.pure.ts` files and grew from 19 → 43
  test files (new coverage: `agent/loop` ×2, `agent/tools` ×6, `p2p` ×7,
  `privacy` ×2, `security` ×3, `diagnostics`, `notify`) — the *spirit* of the
  deep-dive recommendation ("new agent layer born with testable pure twins")
  is substantially met. But the new code doesn't use the `.pure.ts` *naming*,
  so the "what is unit-tested and why" contract is implicit rather than
  visible.
- **RECOMMENDATION:** ADOPT the naming convention for new pure logic going
  forward; no retrofit of existing tests. Effort: negligible. Value:
  low–medium (readability of the test contract).

### R6 — Knowledge-pack pipeline: keep as-is (KEEP, no action)
- **WHAT:** `build-knowledge-pack.mjs` + `src/rag/packs.ts` (keyword-first
  FTS5→int8-cosine, read-only packs, SHA discipline).
- **WHERE:** `boar-app/scripts/build-knowledge-pack.mjs`, `boar-app/src/rag/packs.ts`.
- **GAP:** NIDO kept scripts identical; `packs.ts` cleaned of BOAR URLs
  (zero `rferrari`/`boar-app` references). Packs open plaintext by design
  (public data) — already recorded as TD-16 (LOW, deliberate).
- **RECOMMENDATION:** SKIP action. Keep the pipeline for future corpus work.

---

## Where NIDO already improved on BOAR (confirmed — do not regress)

| BOAR weakness (deep-dive §10) | NIDO status (EXISTS, verified) |
|---|---|
| `settings.json` plaintext | Still plaintext (TD-4, planned) — **not yet fixed** |
| SQLite plaintext | **FIXED:** both DBs SQLCipher-encrypted, Keystore DEK, fail-closed (`src/security/secureDatabase.ts`, `src/privacy/keyManager.ts`) |
| No `allowBackup=false` | **FIXED:** `app.json` has `allowBackup: false` |
| System SpeechRecognizer may use network | Still system STT (honest unavailable path); `docs/WHISPER_PLAN.md` tracks on-device replacement |
| Model Browser leaks interests to HF | **REMOVED:** 4 network files gone |
| Permanent INTERNET permission | Kept for setup/P2P; **network-audit module added** (`src/privacy/networkAudit.ts`, `docs/NETWORK_AUDIT.md`) — the deep-dive's recommended mitigation, implemented |
| URLs not pinned (`resolve/main`) | Manifest kept; pinning still open (noted in deep-dive §5) |
| No biometric lock | **FIXED:** biometric/PIN gate (`src/security/biometricGate.ts`, `lockScreen` i18n namespace) |
| Persistent `execution_telemetry` | Kept; still local-only, no message text (deliberate) |
| `discovered_models.json` plaintext | **REMOVED** with the feature |

NIDO-only capabilities with no BOAR equivalent: P2P E2E stack
(X25519/Ed25519 via `tweetnacl`, pairing, queue, inbox — 8 files + 7 test
files), agent loop + 21 tools + skills registry, encrypted agent memory
(facts/notes/reminders), OS notifications (`expo-notifications`), offline
TTS (`expo-speech`), `expo-calendar`/`expo-contacts` agent capabilities,
security diagnostics (`src/diagnostics/security.ts`), Spanish locale
(`es.json`; BOAR had en/pt only — NIDO: 326 leaf keys × 3 locales, zero
missing), Bluetooth permissions + `nido-p2p` native module scaffold.

## Explicit skips (correctly discarded — do not reintroduce)

- **Model Browser / discoveredModels / ModelCatalogScreen** — network to
  Hugging Face; incompatible with the zero-network principle.
- **Adaptive routing** (`src/routing/`) — deferred per deep-dive; NIDO kept
  the files, no action now.
- **`bundled-assets` / `ram-monitor` / `download-wake-lock` modules** —
  already ported; `downloadManager`/`chatHistory`/`personalities` are
  byte-identical to BOAR's (0 diff). No divergence to fix.

## Impact on PRE_ALPHA_PLAN

**No priority changes.** The plan's order stands. Concrete amendments:

1. **TD-1 (item 1):** implement using BOAR's ordered-deletion template (R3
   above) — sequence and best-effort discipline are proven; only the new
   surfaces (memory DB, Keystore keys, P2P identity, `eval/`) need adding.
2. **New small docs task (fits "no scope drift" — zero code):** rewrite
   `AGENTS.md` for NIDO (R1) and extend `COMPLIANCE.md` (R2). Both support
   the plan's goal that every functional claim has real evidence. Suggest
   doing them alongside the corrections, before the next CI run.
3. **Device validation step:** name `scripts/eval-device.mjs` +
   `docs/DEVICE_EVALUATION.md` as the procedure (R4).
4. **Not yet fixed from BOAR's privacy gaps:** `settings.json` plaintext
   (TD-4) and model-URL pinning — both already tracked; no new items.

---

*Review completed 2026-09-27. All file comparisons done via diff on local
clones; BOAR remote verified unchanged since 2026-09-26.*
