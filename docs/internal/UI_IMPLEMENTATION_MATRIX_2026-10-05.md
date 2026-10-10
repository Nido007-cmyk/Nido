<!--
MIT License
Copyright (c) 2026 NIDO contributors
See LICENSE file for details.
-->

# NIDO UI Implementation Matrix — UI MASTER SPEC

**Fecha:** 2026-10-05
**Spec:** UI MASTER SPEC (27 secciones)

## Criterios por superficie

- **DESIGNED:** La composición/jerarquía fue realmente reconsiderada
- **IMPLEMENTED:** El diseño está en código
- **ACCESSIBLE:** Semántica y estados revisados
- **TESTED:** Comportamiento relevante cubierto
- **VISUALLY VERIFIED:** Revisado en render real (dispositivo/emulador)

**Regla:** Una superficie no está DONE hasta que las categorías aplicables estén verificadas.
Si no hay render real: `IMPLEMENTED — VISUAL VERIFICATION PENDING`. No UI PASS.

---

## Superficies

### 1. ChatScreen (principal)

| Criterio | Estado |
|----------|--------|
| DESIGNED | ✅ Layout asimétrico: usuario burbuja 75%, Nido full-width sin burbuja |
| IMPLEMENTED | ✅ |
| ACCESSIBLE | ⚠️ Parcial — labels existen, falta revisión de focus order |
| TESTED | ⚠️ Parcial — no hay component tests de comportamiento |
| VISUALLY VERIFIED | ❌ PENDING — sin render real |

**Cambios 2026-10-05:**
- Quitado `bg.terminal` del gradiente → superficies calm
- `typography.mono.xs` → `typography.ui.caption` (4 lugares)
- Colores neón → `text.secondary` en labels
- `tok/s` eliminado del header

### 2. ChatHeader

| Criterio | Estado |
|----------|--------|
| DESIGNED | ✅ Limpio, mascota, status offline en verde (no rojo) |
| IMPLEMENTED | ✅ |
| ACCESSIBLE | ✅ |
| TESTED | ❌ Sin tests |
| VISUALLY VERIFIED | ❌ PENDING |

### 3. ProcessingIndicator (estados del agente)

| Criterio | Estado |
|----------|--------|
| DESIGNED | ✅ 8 estados: retrieving/thinking/generating/working/waiting_approval/completed/failed/offline/stopped |
| IMPLEMENTED | ✅ Terminales sin animación, activos con pulso sutil |
| ACCESSIBLE | ✅ |
| TESTED | ❌ Sin tests |
| VISUALLY VERIFIED | ❌ PENDING |

### 4. ApprovalCard (nuevo)

| Criterio | Estado |
|----------|--------|
| DESIGNED | ✅ Qué → por qué → datos → aprobar/rechazar (§5) |
| IMPLEMENTED | ✅ Componente creado, no integrado al flujo del agente |
| ACCESSIBLE | ✅ role="alert", labels |
| TESTED | ❌ Sin tests |
| VISUALLY VERIFIED | ❌ PENDING |

**Nota:** La integración con el flujo ASK del Policy Engine queda pendiente.

### 5. EmptyState (nuevo)

| Criterio | Estado |
|----------|--------|
| DESIGNED | ✅ Título + descripción + acción + mascota (§17) |
| IMPLEMENTED | ✅ Componente reutilizable creado |
| ACCESSIBLE | ✅ |
| TESTED | ❌ Sin tests |
| VISUALLY VERIFIED | ❌ PENDING |

### 6. SetupWizardScreen

| Criterio | Estado |
|----------|--------|
| DESIGNED | ✅ Progressive disclosure real (§8) |
| IMPLEMENTED | ✅ |
| ACCESSIBLE | ⚠️ Parcial |
| TESTED | ❌ Sin tests |
| VISUALLY VERIFIED | ❌ PENDING |

### 7. ModelSetupScreen

| Criterio | Estado |
|----------|--------|
| DESIGNED | ⚠️ Parcial — títulos cálidos ✅, descripciones humanas ✅, pero estructura sigue siendo lista |
| IMPLEMENTED | ✅ |
| ACCESSIBLE | ⚠️ Parcial |
| TESTED | ❌ Sin tests |
| VISUALLY VERIFIED | ❌ PENDING |

**Cambios 2026-10-05:**
- Descripciones: "3.8B dense, slow (~4 tok/s)" → "Powerful. Best for complex reasoning..."
- Embeddings separados de LLMs (bge-small ya no aparece como seleccionable)
- Emojis 🎭⚡ → iconos vectoriales (chat, activity)
- Títulos: "Cómo te hablo", "Tu biblioteca", "Lo que recuerdo"

### 8. KeyLossRecoveryScreen

| Criterio | Estado |
|----------|--------|
| DESIGNED | ✅ Doble confirmación, explica qué pasó (§10) |
| IMPLEMENTED | ✅ |
| ACCESSIBLE | ⚠️ Parcial |
| TESTED | ❌ Sin tests |
| VISUALLY VERIFIED | ❌ PENDING |

**Cambios 2026-10-05:** `bg.terminal` → `bg.surface`

### 9. NidoScreen (P2P)

| Criterio | Estado |
|----------|--------|
| DESIGNED | ❌ Es pantalla P2P, no dashboard del agente (§16) |
| IMPLEMENTED | ✅ (como P2P) |
| ACCESSIBLE | ⚠️ Parcial |
| TESTED | ❌ Sin tests |
| VISUALLY VERIFIED | ❌ PENDING |

**Nota:** Falta definir qué es esta superficie en el producto.

### 10. Componentes calm (AgentMessage/MemoryChip/AgencyReceipt)

| Criterio | Estado |
|----------|--------|
| DESIGNED | ✅ Como componentes aislados |
| IMPLEMENTED | ❌ Código muerto — cero imports en la app |
| ACCESSIBLE | N/A |
| TESTED | N/A |
| VISUALLY VERIFIED | N/A |

**Decisión pendiente:** integrarlos donde haya datos reales o eliminarlos (§7: "no los integres ciegamente").

---

## Módulos no integrados (honesto)

- **Scheduled Tasks** — implemented, not runtime-integrated
- **Knowledge Graph** — implemented, not runtime-integrated
- **Dual Model** — implemented, not runtime-integrated
- **UsageStatsScreen** — dead-code candidate (0 callers), no tocar

---

## Verificación física pendiente (GATE-1)

Todas las superficies requieren inspección en dispositivo/emulador:

- [ ] clipping / overflow
- [ ] typography / spacing
- [ ] keyboard + safe areas
- [ ] scroll / touch targets
- [ ] contrast / text scaling
- [ ] contenido largo
- [ ] empty / error / loading states
- [ ] approvals / STOP
- [ ] consistencia entre superficies

**Ninguna superficie tiene UI PASS hasta verificación visual real.**

---

## Seguridad (no negociable)

Verificado que la UI no debilita:
- ✅ validateTask / Policy Engine / AUTO/ASK/DENY
- ✅ human approval (ApprovalCard creado)
- ✅ STOP fail-closed (botón prominente)
- ✅ DatabaseManager / SQLCipher / fail-closed key handling
- ✅ P2P SHA-256

---

## Resumen

**Completado 2026-10-05:**
1. Auditoría real contra spec (no asumida de reportes)
2. Remanentes hacker-terminal eliminados
3. ModelSetup en lenguaje humano
4. 8 estados visuales del agente
5. ApprovalCard UI creada
6. EmptyState reutilizable creado
7. 1607/1607 tests Vitest pasando
8. TypeScript limpio

**Pendiente:**
- Integración de ApprovalCard con flujo ASK del agente
- Decisión sobre componentes calm muertos
- Redefinir NidoScreen como dashboard o mantener como P2P
- Component tests de comportamiento (§22)
- **Verificación visual en dispositivo real (todas las superficies)**
