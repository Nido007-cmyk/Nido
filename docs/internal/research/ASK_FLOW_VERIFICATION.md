# Verificación del flujo ASK — P2P Negotiation (FASE 3, cierre UI)

## Fecha
2026-10-09

## Qué sucede cuando el usuario acepta una propuesta P2P (caso ASK)

### Paso 1: Aceptación de la propuesta
- El usuario pulsa "Aceptar" en `NegotiationCard` (NegotiationsTab).
- Se invoca `negotiationService.acceptSession(negotiationId)`.
- Esto construye un mensaje ACCEPT firmado y lo envía al peer.
- La sesión pasa a estado `ACCEPTED` (terminal).
- **Esto es un acuerdo a nivel protocolo, NO una ejecución.**

### Paso 2: Autorización de herramientas
- **No ocurre.** Aceptar una propuesta no autoriza ninguna herramienta.
- La autorización de herramientas vive en `src/agent/delegation/`
  (approvalGate, executor) y requiere el flag `delegation.enabled`.

### Paso 3: Persistencia de la tarea
- **No ocurre.** El `queueFn` en `negotiationService.ts` retorna un ID
  sintético (`p2p-<proposalId>`) y descarta el `QueuedProposalTask`.
- No se crea registro en ningún Approval Inbox.
- La sesión ACCEPTED persiste en memoria del negotiationService.

### Paso 4: Ejecución real
- **No ocurre.** Ningún código se ejecuta automáticamente tras ACCEPT.
- `delegationService` verifica `isFeatureEnabled("delegation.enabled")`
  en cada entry point (líneas 169, 271, 443, 542).
- Con el flag OFF (default), toda ejecución está bloqueada.

### Paso 5: Notificación de resultado
- La UI muestra la sesión como ACCEPTED en NegotiationsTab.
- **No se muestra ninguna tarea como "ejecutada" o "completada"** porque
  ninguna tarea existe.

## Distinción clara

| Acción | Efecto real |
|--------|-------------|
| Pulsar ACCEPT | Envía mensaje ACCEPT firmado; sesión → ACCEPTED |
| Autorizar herramientas | No ocurre (requiere delegation.enabled) |
| Persistir tarea | No ocurre (queueFn descarta) |
| Ejecutar | No ocurre (flag OFF bloquea) |
| Mostrar como ejecutada | No ocurre (UI solo muestra estado de sesión) |

## Limitación exacta documentada

El caso ASK de propuestas P2P **no tiene integración con Approval Inbox**.
El comentario en `negotiationService.ts` (UI-FASE-3) lo declara explícitamente:
la sesión queda PROPOSED para decisión humana vía NegotiationCard, y la
ceremonia extendida (toApprovalRequest/ApprovalCard con risk levels) es
trabajo pendiente, no simulado.

**No implementar el bridge en esta fase** (restricción explícita del usuario).
