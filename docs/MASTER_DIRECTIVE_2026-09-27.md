# NIDO — CURRENT MASTER DIRECTIVE / CONTINUATION CHECKPOINT

**Date:** 2026-09-27
**Status:** CURRENT — use as the project-level operating reference unless a later
explicit instruction supersedes part of it.

---

## PROJECT PRESERVATION

The GitHub suspension incident is formally closed from a project-loss perspective.

The authoritative emergency preservation snapshot is:

`~/workspace/backups/nido-20260927/`

This snapshot is **IMMUTABLE**.

Its SHA-256 hashes have been re-verified against MANIFEST.sha256 and passed.
The directory has been marked read-only. Never modify this snapshot in place.

Any future restoration test must be performed from a **COPY** of the snapshot,
never from the preserved snapshot itself.

The preservation state is documented in:

`docs/PRESERVATION_CHECKPOINT_2026-09-27.md`

The preserved material includes:

- complete Git repository and .git history
- 84 commits on master
- pushed GitHub history through f20bbb89
- branches:
  - master
  - ui/rebrand-nido-identity
  - licensing/compliance-notices
- tags:
  - conformance-v0
  - design-baseline-v0.1
- current working tree
- uncommitted changes
- untracked files
- roadmap
- specifications
- security reports
- BOAR deep-dive/audit documentation
- CI evidence
- preserved APKs and hashes
- 3D source files from v02 through v41
- v36 geometry freeze checkpoint
- v40 and v41 checkpoints
- approved v41 renders
- NIDO icon/assets
- corpus files
- corpus manifests
- model manifests and hashes
- licensing worktree
- NOTICE
- THIRD_PARTY_NOTICES.md
- TRADEMARK.md
- Android/CI workflows
- all material required to reconstruct and continue NIDO independently of GitHub

The .git backup has already been restoration-tested successfully.

Git history, branches and the documented graft survived restoration.

The only identified GitHub-only material is an artifact from Actions run 36372730264
that was never downloaded and associated web-hosted Actions logs. These are not
considered unique project source material and are regenerable from the preserved
sources.

Therefore:

**GITHUB IS INFRASTRUCTURE, NOT A NIDO PROJECT-RECOVERY DEPENDENCY.**

Do not create another GitHub account.

Do not migrate the project to another hosting provider yet.

Do not attempt to bypass the GitHub suspension.

Wait for the result of the existing GitHub appeal.

### If GitHub access is restored:

1. Do not immediately push.
2. Compare the restored remote against the preserved local Git history.
3. Verify branches, tags and relevant release state.
4. Confirm that no unexpected remote divergence exists.
5. Only then resume normal remote operations.

### If GitHub access is NOT restored:

Prepare a migration plan that preserves:

- full Git history
- commits
- branches
- tags
- release/build evidence
- APK provenance
- corpus distribution
- immutable corpus references
- CI
- documentation
- security reports
- licensing/provenance
- 3D assets
- NIDO visual assets

Do **NOT** execute that migration without explicit instruction.

Development continues from the **NORMAL WORKING REPOSITORY**, not from the
preservation snapshot.

---

## SECURITY BASELINE

Preserve the completed security work.

The recent audit confirmed and fixed real issues including:

- nido_pair previously allowed pairing without explicit user confirmation
- pairing now requires confirmation with identity fingerprint visibility
- Clear All Data now cancels scheduled notifications and verifies their removal
- P2P message IDs no longer use Math.random()
- message IDs now use a cryptographically secure RNG
- lock-screen notification exposure was addressed
- fuzzy-name pairing/resolution issues were addressed
- network documentation drift was addressed
- SecureStore failures must fail closed
- transient SecureStore failures must **NEVER** silently regenerate database encryption keys
- transient SecureStore failures must **NEVER** silently replace the P2P identity
- Clear All Data verification bugs found during the security work were corrected
- key-generation race conditions found during the security work were corrected

Current security/audit checkpoint includes local commit:

`1f1f65b`

Latest reported validation:

- 763/763 tests passing
- TypeScript clean
- eval unchanged

Do not weaken these protections for convenience.

Security behavior must fail honestly rather than silently pretending success.

---

## CLEAR ALL DATA

The intended semantics remain strict.

Clear All Data must destroy all user-owned local state covered by the
specification, including encrypted databases, keys, P2P identity, agent memory,
chats, models where specified, and scheduled notifications.

It must not claim success if part of the deletion fails.

P2P identity destruction must be treated as identity destruction, including the
consequences for existing pairings.

Future persistent stores must be explicitly registered with the wipe system so
new features cannot silently survive Clear All Data.

---

## CORPUS / BOAR INDEPENDENCE

NIDO runtime must not depend operationally on rferrari/boar-app.

The corpus migration has been completed and byte identity was verified by SHA-256.

Preserve provenance and licensing attribution where legally required, but do not
reintroduce BOAR as an operational runtime dependency.

The previous BOAR branding audit removed/replaced real BOAR identity references,
including system-prompt identity.

The assistant identity is **NIDO**.

Do not reintroduce BOAR branding except where legally/provenance documentation
requires historical attribution.

NIDO applicationId remains:

`team.nido.app`

---

## 3D / NIDO CHARACTER

The approved character state has progressed through v41.

Preserve the approved geometry.

Do not restart the model.

Do not remodel the character unless explicitly instructed.

The geometry freeze established at v36 remains an important checkpoint.

The later passes focused on materials, lighting and presentation.

Current design direction:

- soft premium NIDO character
- white plush-like body
- green felt/fabric mantle
- continuous white hood/head covering
- warm complete golden ring/core integrated into the mantle
- complete unobstructed ring
- face remains clear
- eyes, smile and proportions preserved
- leaves preserved
- mantle reads as broad layered fabric/felt rather than cords
- material contact between overlapping layers should feel physical
- character must remain readable at small size inside the app

v41 is currently the approved latest 3D state unless explicitly superseded.

Do not casually change geometry while performing material or lighting work.

---

## APP IDENTITY

NIDO icon is approved for the current direction.

Do not redesign the icon unless explicitly requested.

The visual identity should remain recognizably NIDO rather than reverting to
generic AI branding.

---

## CURRENT PRODUCT PRINCIPLE

NIDO should continue moving toward being an independently maintainable product.

External open-source components and properly licensed data may be used where
appropriate, but NIDO should avoid unnecessary operational dependence on another
project's infrastructure, branding, repositories or runtime services.

Offline capability remains central.

The app should remain functional without internet after required initial
model/data installation, subject to the capabilities actually implemented and
verified.

Do not make stronger offline, security, privacy or independence claims than the
build can prove.

---

## WORKING RULE

Continue useful development normally.

Do not let the GitHub appeal block local engineering.

However, do not perform infrastructure migration or create replacement GitHub
accounts while the appeal is unresolved.

Keep changes auditable.

For important changes:

- preserve checkpoints
- run relevant tests
- report exact test results
- distinguish verified behavior from planned behavior
- preserve hashes for important build artifacts
- do not claim success when verification is incomplete

Do not modify the immutable preservation snapshot.

The GitHub incident is now considered **CLOSED** for project-loss risk.

Primary focus returns to NIDO itself:

1. stable clean build
2. integration of completed security fixes
3. reliable model/corpus installation and integrity verification
4. polished SetupWizard/UI
5. approved NIDO v41 character integration
6. offline reliability
7. P2P reliability and security
8. remaining i18n/product polish
9. reproducible builds and evidence
10. continued reduction of unnecessary external dependencies

Use this as the current master continuation reference unless a later explicit
instruction supersedes part of it.
