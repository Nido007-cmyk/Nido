# NIDO — Preservation Checkpoint (approved 2026-09-27)

**Status:** APPROVED by owner. This is the recovery baseline for the NIDO project.

## The snapshot

Location: `~/workspace/backups/nido-20260927/` — **IMMUTABLE. Do not modify in place.**
`MANIFEST.sha256` travels with the snapshot. Any future restoration test must be
performed from a **copy**, never from the preserved snapshot itself.

| File | SHA-256 | Size | Contents |
|---|---|---|---|
| nido-app-tree.tar.gz | 03610c448de478a496f7a2323aeda80894a5c7066cff9e61cf1f5e846d1e5707 | 1.69 GB | Full working tree of nido-app (excludes .git, node_modules): source, docs/, staging/3d-package-v2 (v02–v41 blends, checkpoints, renders), docs/ci-evidence (6 preserved CI runs + APK 9cd3c53b…b3ae57), assets/ (icon-nido, corpus), .github/workflows. |
| nido-gitdir.tar.gz | 43f70b9adf7477fcd16463e048ab72e5e193fb84ec8d5a192c32890f0f5e8340 | 24 MB | Complete .git: 84 commits on master, branches master / ui/rebrand-nido-identity / licensing/compliance-notices, tags conformance-v0 / design-baseline-v0.1, refs/replace graft (12ff5712 → 2a9c4c4, tree-identical to missing a4b55a07). **Test-restored OK**: log, all branches, graft intact. |
| nido-licensing-tree.tar.gz | 60bd5353fbe0d5acb678bee42d97acf27af505f7ea82f91ccd3346896c002bcc | 19 MB | Licensing worktree @ 855128b: NOTICE, THIRD_PARTY_NOTICES.md, TRADEMARK.md. |

**Known GitHub-only material (no unique source code):** run-36372730264 APK artifact
(never downloaded; build likely cancelled) and GitHub Actions web logs. Both
regenerable from local sources.

## Directives (owner, 2026-09-27)

1. Continue development from the normal working repository (`~/workspace/nido-app`).
2. **GitHub account recovery is an infrastructure issue, not a project-recovery
   dependency.** NIDO no longer "lives" on GitHub; GitHub was one infrastructure
   used for hosting and builds.
3. Do NOT create a replacement GitHub account or migrate infrastructure until the
   appeal decision arrives. Awaiting appeal submitted 2026-09-27 ~20:42 MST.
4. **If GitHub access is restored:** verify the remote against this preserved local
   history before pushing anything (remote tip f20bbb89 is a verified ancestor of
   local master; confirm still true, then consolidate local commits into a few
   spaced pushes).
5. **If access is not restored:** prepare — but DO NOT EXECUTE — a migration plan
   preserving: full Git history, tags, branches, releases/build evidence, corpus
   distribution, CI configuration, licensing provenance. Awaiting explicit instruction.

## Project status at checkpoint

- Local master: 84 commits incl. 3ddf487 (eval harness), 3066273 (economic research),
  baec94a (RAM pre-check), 1f1f65b (audit + 7 hardening fixes). 763/763 tests green, tsc clean.
- Rebrand lane: `ui/rebrand-nido-identity` @ 13ccb5c (726/726 tests). Unmerged, no CI yet.
- Licensing lane: `licensing/compliance-notices` @ 855128b. Isolated.
- 3D: v40 approved baseline; v41 approved + checkpointed (1970d0c5…), geometry frozen;
  v42 = materials/lighting refinement only (in progress at checkpoint time).
- Gates: T-008/T-009/P2P/GATE-1 all UNVERIFIED on device. No pushes, merges, builds,
  or distribution without owner authorization.
