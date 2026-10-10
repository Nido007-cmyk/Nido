> **Language:** English · [Español](../es/internal/PRE_ALPHA_PLAN.md)

# NEXT PHASE — NIDO PRE-ALPHA FOUNDATION

**Status:** APPROVED PLAN (2026-09-27, user). Execute only after the current
Android CI run finishes.

The architecture audit is accepted as baseline. Keep the 6 documents and their
strict distinction between EXISTS / PROPOSED / SPECIFICATION ONLY. Never
present something designed as if already implemented.

PRIORITY 1 remains ANDROID COMPILED. Continue monitoring the 180-minute build.
Do not declare success until GitHub produces a real app-debug.apk as artifact.

While that build runs, prepare the next phase, but do not make changes that
interfere with the current build.

When the current run finishes, execute PRE-ALPHA CORRECTIONS in small,
auditable changes:

1. PRIVACY BLOCKER — Clear All Data
   Fix TD-1. A factory reset must truly delete memory, P2P history/data and the
   corresponding sensitive data, including correct handling of Keystore keys.
   Define first the exact semantics of what is destroyed and the consequences
   of destroying the NIDO identity. Add tests proving data does not survive the
   reset. No silent partial wipe accepted.
2. ENGLISH-FIRST
   English becomes NIDO's native/default/fallback language. Keep EN/ES/PT and
   persistent user selection. Migrate remaining hard-coded strings to i18n,
   starting with NidoScreen and notifications. All new UI must be written in
   English first and must not introduce hard-coded user-facing strings.
3. P2P VALIDATION
   When we have an APK, verify whether modules/nido-p2p is actually
   compiled/linked. Do not mark Bluetooth P2P as functional until
   discovery/connect/send are tested on a real device.
4. DEAD UI
   Investigate UsageStatsScreen and SystemMonitor. Do not wire or delete them
   automatically. Determine their original intent, whether they duplicate
   existing UI, and recommend KEEP/WIRE/REMOVE with evidence.
5. 3D
   Keep visual work fully separate. Do not integrate V1. BASE_MASTER V1 was
   useful as technical pipeline validation but was NOT visually approved.
   The visual source of truth is now NIDO_3D_Character_Design_System_v2.pdf +
   NIDO_BASE_MASTER_V2_REFERENCE.jpg.
   Work first ONLY on BASE_MASTER V2 to faithfully approach the reference:
   plush/felt cream body, organic sprout, cloth mantle with real soft folds,
   large dark expressive eyes, subtle blush, and luminous golden ring core
   integrated in the chest/mantle.
   Before redoing variants, states or LODs, deliver Front / 3/4 / Side / Back
   of the same BASE_MASTER V2 and STOP for visual approval.
6. NO ECONOMY IMPLEMENTATION YET
   ECONOMY_ARCHITECTURE.md remains SPECIFICATION ONLY. Do not implement
   Spark/Core, balances, inventory, ledger, monetization, payments, tokens or
   blockchain yet.
7. NO SCOPE DRIFT
   No general refactors, dependency upgrades or unsolicited new features. Do
   not change security to make it compile.

Execution order:
current Android CI → APK/causal error → PRE-ALPHA corrections → regression
tests → new Android CI → device validation.

Keep 3D as an independent parallel line.

After each block always report:
STATE BEFORE → WORK PERFORMED → BUGS FOUND → FIXES → TESTS →
SECURITY/PRIVACY IMPACT → STATE AFTER → REMAINING UNVERIFIED → NEXT BLOCKER.

The goal is not for the project to "look finished". The goal is for every
thing marked as functional to have real evidence behind it.

## AMENDMENTS FROM BOAR REVIEW (2026-09-27)

Source: `docs/architecture/BOAR_REVIEW_2026-09-27.md`. BOAR repo unchanged
since the 2026-09-26 deep-dive; NIDO `src/` is a strict superset of BOAR's
minus 4 deliberately discarded network files. No priority changes.

1. TD-1 (Clear All Data) implementation must follow BOAR's ordered-deletion
   template (`appReset.ts`: unload native → resetDatabase → files → settings,
   best-effort) extended to the new surfaces (memory DB, Keystore keys, P2P
   identity). Extend the sequence, don't reinvent it.
2. Add two zero-code doc tasks alongside the corrections, before the next CI
   run: rewrite `AGENTS.md` for NIDO (currently byte-identical to BOAR's;
   still documents the parked EAS path, says nothing about GitHub CI,
   nido-p2p, or SQLCipher verification) and extend `COMPLIANCE.md` (also
   byte-identical to BOAR's; documents none of NIDO's new guarantees:
   SQLCipher, Keystore, biometric gate, allowBackup=false, P2P E2E).
3. Name `scripts/eval-device.mjs` + `DEVICE_EVALUATION.md` as the
   device-validation procedure in the plan's device-validation step.
4. Adopt the `.pure.ts` naming convention for new code going forward
   (no retrofit of existing code).
5. Confirmed NIDO improvements over BOAR — do not regress: SQLCipher on both
   DBs + Keystore DEK + fail-closed, allowBackup=false, biometric/PIN gate,
   HF browser removed, network-audit module, P2P E2E stack, agent loop +
   21 tools, notifications, offline TTS, locale infra (326 keys × 3).
6. Two unfixed BOAR privacy gaps remain tracked: settings.json plaintext
   (TD-4) and model-URL pinning.
