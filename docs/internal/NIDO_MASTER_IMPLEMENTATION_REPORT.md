# NIDO Master Implementation Report

**Date:** 2026-10-05
**Branch:** master (local) → main (Nido007-cmyk/Nido)
**Baseline:** d9e85bf (1452 tests)
**Final:** 2086758 (1562 tests, 20 commits)

## Summary

Implemented all technically executable items from the NIDO master directive.
20 commits, 110 new tests, all green. Typecheck clean. Audit complete.

## What Was Built

### the upstream project Adoptions (5 items)
- Item 2: Chit-chat retrieval bypass - skips RAG for greetings
- Item 4: Storage budget enforcement - caps at 500MB
- Item 5: Gemma reasoning parser - extracts <think> blocks
- Item 6: Embedding serialization - Float32Array to base64
- Item 20: Cross-library dedupe - removes duplicate chunks

### Deep Research Integrations

**DR-2: Citations in UI**
- AgentMessage component supports citations with titles and sources
- ChatScreen renders SourceFootnotes for assistant messages

**DR-3: Scheduled Tasks**
- Pure logic: create, validate, getNextRunTime, cron parsing (11 tests)
- Persistence: taskStore.ts with SQLCipher (save/get/list/getDue/delete)
- Run history tracking

**DR-4: Learned Skills**
- Pure logic: LearnedSkillStore in-memory (8 tests)
- Persistence: learnedSkillStore.ts with SQLCipher
- Registry integration: listAllSkills, loadSkillAsync, describeAllSkillsForPrompt

**DR-5: Policy Engine**
- Foundation: evaluateAction with injection detection (14 tests)
- Integration: dispatcher.dispatchToolCall accepts policyContext and onConfirm
- Agent loop: tracks untrusted content from tool results, passes to dispatcher
- System prompt: rule to not follow instructions in <untrusted> blocks
- IRREVERSIBLE_TOOLS aligned with real manifest (send_sms, nido_send_message, place_call)

**DR-6: Knowledge Graph**
- Foundation: entities, relations, decay, neighbors (10 tests)
- Persistence: knowledgeGraphStore.ts with SQLCipher

**DR-7: P2P Pack Sharing**
- Protocol: advertise, chunk, verify, reassemble (8 tests)
- SHA-256 verification; transport layer pending

**DR-8: Dual-Model Router**
- Foundation: selectModelTier routes tiny vs reasoner (6 tests)
- Integration: runDualModelLoop with agent loop
- Tiny for greetings/chat, reasoner for code/complex tasks

### UI: Calm Agent
- Design tokens: calm.ts (spacing, radii, typography)
- Components: AgentMessage, MemoryChip, AgencyReceipt
- ChatScreen: applied calmSpacing, calmRadii for professional look
- AgentMessage supports markdown via children prop

### Offline Proof
- scripts/offline-proof/audit-apk.py: static APK audit (permissions, trackers, network APIs, native symbols, signature)
- scripts/offline-proof/netstats-uid.sh: per-UID traffic counters via adb
- Methodology adapted from BOAR (MIT)

### Eval Resume
- evalResume.pure.ts: restore points with validation (10 tests)
- Supports resuming interrupted eval runs
- Detects config mismatch and corruption

### Collaboration Infrastructure
- CONTRIBUTING.md (bilingual)
- GitHub PR template
- Issue templates (bug report, feature request)

## Verification

- **Tests:** 1562 passed (was 1452, +110 new)
- **Typecheck:** `npx tsc --noEmit` clean
- **Test files:** 125 passed

## Security Audit (2026-10-05)

- **Secrets:** None found in 20 commits (no passwords, tokens, API keys)
- **Em-dashes:** Removed from all new TypeScript code (human tone compliance)
- **TODOs:** 2 in new code, both documented limitations (not blockers)
- **Typecheck:** Clean
- **Tests:** 1562/1562 passing
- **BOAR attribution:** Preserved (MIT), public framing approved
- **Untracked files:** Excluded from commits (docs/build/, docs/ci-evidence/, etc. per directive)

## Commits

20 commits from d9e85bf to 2086758 (local master).
Full list in `git log d9e85bf..HEAD`.

## What Was NOT Done (Blocked)

**GATE-1: Physical Device Verification**
- Requires Samsung Galaxy Tab A9+ with `nido_memory.db` dump
- SQLCipher encryption at rest unverified on hardware
- Status: BLOCKED (no device access)

**Android APK Build**
- No Android SDK in environment (ANDROID_HOME empty)
- Cannot build release/Hermes APK or compute SHA-256
- Status: BLOCKED (no build environment)

**DR-9, DR-10**
- Marked as VIGILAR (research stage) in register
- Not implemented per directive

## Next Steps (Require User)

1. **Push:** Single consolidated push to Nido007-cmyk/Nido main (awaiting user order)
2. **Physical device:** Run GATE-1 SQLCipher verification
3. **Android SDK:** Build release APK, run offline proof

---

## Segunda Auditoría Profesional + UI/UX (2026-10-05)

**Directiva:** HOLD de push. Auditoría completa, UI profesional, regresión total.
**Metodología:** 6 auditores independientes en paralelo (seguridad, arquitectura,
persistencia, colaboración, calidad de tests, higiene de código).

### Hallazgo BLOCKER Corregido

**validateTask** usaba nombres de herramientas obsoletos (`send_message`),
dejando sin bloquear las herramientas irreversibles reales:
- `send_sms`
- `nido_send_message`
- `place_call`

**Corrección:** Lista DANGEROUS actualizada con nombres reales del manifest.
**Regresión:** 7 tests nuevos en `validateTask.blocker.test.ts` verifican el
bloqueo y previenen bypasses.

### Infraestructura Dual de Testing

**Decisión:** Vitest (lógica) + Jest (componentes React Native).
**Razón:** Vitest/Vite no puede parsear `react-native/index.js` (sintaxis Flow).
Jest con `@react-native/jest-preset` es el path estándar.

**Configuración:**
- `jest.config.js`: preset `@react-native/jest-preset`, solo `*.component.test.*`
- `babel.config.js`: `@react-native/babel-preset` (solo para Jest)
- `vitest.config.mts`: excluye `*.component.test.*`
- Scripts: `test` (vitest), `test:components` (jest), `test:all` (ambos)

**Versiones pineadas (exactas, requeridas por depPins):**
- jest 29.7.0, @types/jest 29.5.14, babel-jest 29.7.0
- @testing-library/react-native 14.0.1
- @react-native/babel-preset 0.87.1, @react-native/jest-preset 0.86.3

### Tests Nuevos

**Jest (7 tests):**
- `smoke.component.test.tsx` (3): render, interacción, a11y
- `ChatScreen.component.test.tsx` (4): diseño asimétrico verificado
  - Usuario: burbuja 18pt, 75% max, accesible
  - Asistente: full-width sin burbuja, accesible

**Vitest (7 nuevos, total 1569):**
- `validateTask.blocker.test.ts` (7): regresión del BLOCKER

### UI Profesional

**ChatScreen:** Diseño asimétrico implementado.
- Asistente: texto full-width sin burbuja (convención ChatGPT/Claude)
- Usuario: burbuja squircle 18pt (`calmRadii.bubble`), 75% max, padding 12×8pt
- Sin sombras decorativas, hairlines 1px

**Design system extendido:**
- `calmRadii.bubble`: 18pt
- `calmType.micro`: 9px (metadata densa)
- `calmType.small`: 10px (labels compactos)

**Onboarding accesible:**
- SetupWizardScreen: 8 botones con accessibilityLabel/Role
- ModelSetupScreen: 5 elementos con roles, estados, hints
- Botón destructivo con accessibilityHint explicando consecuencias

### Verificación

- Vitest: 1569/1569 PASS (126 archivos)
- Jest: 7/7 PASS (2 suites)
- Typecheck: limpio
- Dep pins: 38 verificados
- Sin `.only`, sin tests ocultos
- Working tree: limpio (sin secretos, sin archivos accidentales)

### Commits Locales (8 nuevos)

- 9bbf2c1: BLOCKER validateTask
- f96ad7f: Infraestructura dual + tests
- a8017ed: Gate Fase 3
- 73c9428, f00ab76, f360f06: Accesibilidad onboarding
- 3616a0a: Design system extendido
- b234abd: Pin dependencias

### Riesgos Residuales

- Widget tests cubren harness, no ChatScreen completo (mocking extensivo requerido)
- 8 superficies UI pendientes de auditoría profunda
- GATE-1 físico pendiente (requiere dispositivo)
- Evidencia visual pendiente (requiere render en dispositivo/emulador)

**Estado:** Fases 1-5, 11 completas. Fases 6-10, 12 pendientes.
**Push:** HOLD por directiva del usuario.
