> **Language:** English · [Español](../es/visual/NIDO_3D_QA_CHECKLIST.md)

# NIDO 3D QA Checklist — v2.0

**Date:** 2026-09-27
**Normative:** `NIDO_3D_Character_Design_System_v2.pdf` (§13) + this v2.0
system.
**Use:** each 3D asset needs its QA sheet with PASS/FAIL per point before
acceptance. Nothing enters the app without all 12 points at PASS.

---

## 1. Character acceptance checklist (12 points, from the PDF)

- [ ] Recognizable as the same NIDO species without reading text.
- [ ] It's 3D soft/plush, not flat vector.
- [ ] Keeps compact body, minimal face, organic sprout, mantle, and core.
- [ ] Accessories don't cover face or core.
- [ ] The core stays legible in light/dark and at avatar size.
- [ ] The pose works front and 3/4.
- [ ] Materials don't look like hard plastic.
- [ ] The state is understood without relying on color alone.
- [ ] Reduced Motion has an alternative.
- [ ] It introduces no authority or permissions by appearance.
- [ ] Works at 64 px and a 24 px fallback exists.
- [ ] Passes originality review before integration.

## 2. Automatic QA (pipeline, §7 of the PDF)

- [ ] Names per `nido_<layer>_<variant>_<version>`.
- [ ] Correct pivots.
- [ ] Materials assigned and within the PBR sheet.
- [ ] Dimensions within proportion (1.00H / 0.70–0.78H unless approved
      variant).
- [ ] Correct LOD (hero / app / compact / icon).
- [ ] No missing files or broken references.

## 3. Human visual QA

- [ ] Compared against the Source of Truth (the PDF v2.0), not against
      memory or intermediate renders.
- [ ] The back resolves the mantle and the sprout's birth.
- [ ] The species holds with accessories and special color hidden.
- [ ] Reviewed by Arsrs or a designated reviewer before acceptance.

## 4. Motion QA (per clip)

- [ ] Timings within norm (idle 2–5 s; transitions 180–450 ms; expressive
      500–1200 ms; core anticipation 80–150 ms).
- [ ] Reduced Motion has an approved static alternative.
- [ ] No restless loops; no terror/guilt in Error; no hyperrealistic
      lip-sync.
- [ ] Never represents internal reasoning.

## 5. Visual migration audit v0.3 → v2 (this migration)

- [x] v0.3 vs PDF comparison classified (KEEP / REPLACE / MERGE / DEPRECATE)
      — `VISUAL_MIGRATION_REPORT.md`.
- [x] Official v2 documents created: `NIDO_3D_VISUAL_SYSTEM.md`,
      `NIDO_3D_ASSET_SPEC.md`, `NIDO_3D_MOTION_SPEC.md`,
      `NIDO_3D_QA_CHECKLIST.md`.
- [x] v0.3 marked as SUPERSEDED FOR CHARACTER DESIGN; history preserved.
- [x] PDF archived as source of truth in `docs/visual/`.
- [x] Non-negotiable rule recorded: flat character illustration prohibited,
      even for diagrams.
- [x] Scope verified: no changes to protocol, security, cryptographic
      identity, Policy Engine, or architecture.
- [ ] Visual approval of the v2 direction by Arsrs.
- [ ] Audit closure (only when the §3 assets of the asset spec exist and
      pass QA). **Until then: no app implementation.**

## 6. Per-asset QA sheet template

```text
Asset: nido_<layer>_<variant>_<version>
Date:
Reviewer:
12 acceptance points:  [ ]x12  →  PASS / FAIL
Automatic QA:          PASS / FAIL (detail)
Human visual QA:       PASS / FAIL (detail)
Motion QA (if applies): PASS / FAIL (detail)
Originality:           PASS / FAIL
Decision:              ACCEPTED / REJECTED (reason)
```
