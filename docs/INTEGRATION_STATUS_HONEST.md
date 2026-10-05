# Clasificación Honesta: Implementado vs Integrado

**Fecha:** 2026-10-05
**Principio:** No confundir "implementado" con "integrado".

## Definiciones

- **Implementado:** El código existe y tiene tests.
- **Integrado:** Tiene flujo real UI → runtime/domain → persistence → reload/recovery → UI.
- **Diferido:** Implementado pero deliberadamente no conectado (requiere decisión futura).

## Clasificación por Módulo

### Scheduled Tasks

| Aspecto | Estado |
|---------|--------|
| Lógica pura (validación, cron) | ✅ Implementado + tests |
| Persistencia (taskStore) | ✅ Implementado + migrado a DatabaseManager |
| Runtime (ejecutor) | ❌ No existe scheduler activo |
| UI | ❌ No hay pantalla de tareas programadas |
| **Clasificación** | **Implementado pero NO runtime-integrated** |

**Evidencia:** `grep -rln "getDueTasks\|runScheduledTask" src --include="*.ts"` → solo definiciones y tests, ningún caller en runtime.

### Learned Skills

| Aspecto | Estado |
|---------|--------|
| Lógica pura (CRUD en memoria) | ✅ Implementado + tests |
| Persistencia (learnedSkillStore) | ✅ Implementado + migrado a DatabaseManager |
| Registry (built-in + learned) | ✅ Implementado (`registry.ts` usa `loadSkillAsync`) |
| System prompt | ⚠️ Parcial: `describeAllSkillsForPrompt()` existe pero `agentLoop.ts` usa `describeSkillsForPrompt()` (solo built-ins) |
| UI | ❌ No hay pantalla de skills aprendidas |
| **Clasificación** | **Parcialmente integrado** (persistencia sí, prompt no) |

**Evidencia:** `src/agent/loop/agentLoop.ts:28` importa `describeSkillsForPrompt` (síncrono). El async `describeAllSkillsForPrompt` no tiene callers.

### Knowledge Graph

| Aspecto | Estado |
|---------|--------|
| Lógica pura (entidades, relaciones, decay) | ✅ Implementado + tests |
| Persistencia (knowledgeGraphStore) | ✅ Implementado + migrado a DatabaseManager |
| Runtime (hidratación al inicio) | ❌ Nadie llama a `listEntities()` al iniciar |
| UI | ❌ No hay visualización del grafo |
| **Clasificación** | **Implementado pero NO runtime-integrated** |

**Evidencia:** `grep -rln "knowledgeGraphStore" src` → solo el propio archivo. Cero importadores.

### Dual Model Router

| Aspecto | Estado |
|---------|--------|
| Lógica pura (routing por tokens) | ✅ Implementado + tests |
| Integración (`dualModelIntegration.ts`) | ✅ Existe `runDualModelLoop` |
| Caller de producción | ❌ Ningún código llama a `runDualModelLoop` |
| **Clasificación** | **Implementado pero NO runtime-integrated** |

### P2P Pack Sharing

| Aspecto | Estado |
|---------|--------|
| Protocolo (advertise, chunks, verify) | ✅ Implementado + tests (294) |
| SHA-256 real | ✅ Corregido (BLOCKER) |
| UI de aprobación | ❌ Usa diálogo nativo, no integrado al chat |
| **Clasificación** | **Implementado, parcialmente integrado** |

### Calm UI Components (AgentMessage, AgencyReceipt, etc.)

| Aspecto | Estado |
|---------|--------|
| Componentes | ✅ Implementados |
| i18n | ❌ Strings hardcoded en inglés (H-15) |
| Integración a ChatScreen | ❌ No renderizados (staged por orden del usuario) |
| **Clasificación** | **Implementado pero NO integrado** |
| **Prerrequisito** | i18n obligatorio antes de integrar (H-15) |

## Resumen

| Módulo | Implementado | Integrado | Diferido |
|--------|--------------|-----------|----------|
| Scheduled Tasks | ✅ | ❌ | ✅ (deliberado) |
| Learned Skills (persistencia) | ✅ | ✅ | — |
| Learned Skills (prompt) | ✅ | ❌ | ✅ (deliberado) |
| Knowledge Graph | ✅ | ❌ | ✅ (deliberado) |
| Dual Model | ✅ | ❌ | ✅ (deliberado) |
| P2P Packs | ✅ | ⚠️ | — |

**Ningún módulo se presenta como "integrado" si no tiene flujo UI→runtime→persistence→UI verificable.**
