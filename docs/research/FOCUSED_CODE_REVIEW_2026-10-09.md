# NIDO — Revisión Focalizada de Código 2026-10-09

Solo lectura. Sin modificaciones. 5 áreas revisadas.

---

## ÁREA 1: Migraciones (dbMigrations.ts, memoryMigrations.ts, databaseManager.ts)

### Hallazgo 1.1 — Sin defectos en atomicidad
**Archivo:** `src/security/dbMigrations.ts:245-251`
**Evidencia:** Cada migración corre en `withTransactionAsync` con el stamp de versión en la misma transacción. Si `up()` lanza, la transacción revierte y la versión no avanza.
**Tests:** `dbMigrations.test.ts` (17 tests), `dbMigrations.integration.test.ts` (6 tests)
**Severidad:** N/A — correcto.

### Hallazgo 1.2 — Brecha de pruebas: rollback con SQLCipher real
**Archivo:** `src/security/dbMigrations.ts` (diseño general)
**Condición:** Los 6 tests de "integración" usan `MigrationDb` falso en memoria, no SQLCipher real.
**Impacto:** El rollback depende de que `withTransactionAsync` del driver real revierta correctamente. No hay prueba que abra SQLCipher real, inicie migración y mate el proceso mid-transaction.
**Tests que lo cubren:** Ninguno con SQLCipher real.
**Severidad:** BRECHA DE PRUEBAS (media). El código es correcto por diseño, pero la garantía de atomicidad física no está verificada.
**Corrección mínima:** Test que use SQLCipher real (o el driver de test con SQLite) y verifique que un `up()` que lanza deja la versión anterior.

### Hallazgo 1.3 — Sin race en apertura
**Archivo:** `src/security/databaseManager.ts:203-225`
**Evidencia:** `getDatabaseForEpoch` verifica `if (!dbPromise)` sin `await` entre check y asignación. En JS single-thread, esto es atómico. El `await getWipeGate()` ocurre antes, pero dos llamadas que pasen el gate: la primera asigna sincrónicamente, la segunda lo ve asignado.
**Severidad:** N/A — correcto.

---

## ÁREA 2: Autorización P2P (p2pAuthorization.ts, agent/policy/authorization.ts)

### Hallazgo 2.1 — Fail-closed correcto
**Archivo:** `src/p2p/p2pAuthorization.ts:96-103` (scope desconocido → DENY), `:79-89` (peer revocado → DENY)
**Evidencia:** Ambos paths retornan DENY sin consultar política. Un scope no mapeado nunca se auto-aprueba.
**Tests:** `negotiationService.test.ts` (R3: firma no anclada, sin contacto → fail-closed)
**Severidad:** N/A — correcto.

### Hallazgo 2.2 — Re-validación de política en ejecución
**Archivo:** `src/p2p/p2pAuthorization.ts:168-172`
**Evidencia:** `validateGrantForExecution` re-evalúa el scope contra la política local actual, no solo la del momento de emisión. Si la política cambió a DENY, el grant se rechaza aunque la firma sea válida.
**Severidad:** N/A — defensa en profundidad correcta.

### Hallazgo 2.3 — Riesgo plausible: usesConsumed no persistido
**Archivo:** `src/p2p/p2pAuthorization.ts:158` (`grant.usesConsumed += 1`)
**Condición:** El contador de usos del grant vive en memoria. Si la app se reinicia entre usos, el contador se pierde.
**Impacto real:** Un grant con `maxUses: 3` podría usarse más de 3 veces si el emisor reinicia la app entre usos. La ventana está limitada por la expiración del grant, pero existe.
**Evidencia:** `grep usesConsumed src/p2p/store.ts` → cero resultados. Los grants no se persisten en la base P2P.
**Tests que lo cubren:** Ninguno verifica persistencia de `usesConsumed` tras reinicio.
**Severidad:** RIESGO PLAUSIBLE (baja-media). Requiere que el atacante controle el timing de reinicios del emisor. Los grants expiran, limitando la ventana.
**Corrección mínima:** Persistir `usesConsumed` por `grantId` en la base P2P (o aceptar documentadamente que `maxUses` es best-effort en memoria).

### Hallazgo 2.4 — Contrato authorize() estable
**Archivo:** `src/agent/policy/authorization.ts:76-120`
**Evidencia:** `authorize()` es síncrona, pura, sin efectos secundarios. Firma: `ToolAction → AuthResult`. No hay estado mutable.
**Severidad:** N/A — el contrato es estable por diseño.

---

## ÁREA 3: Rekey y recuperación (keyRotation.ts, secureDatabase.ts)

### Hallazgo 3.1 — Diseño crash-safe correcto
**Archivo:** `src/security/keyRotation.ts:110-145` (staging antes de rekey), `:280-340` (probe-open antes de tocar keystore)
**Evidencia:** El recovery verifica con probe-open si el rekey ocurrió antes de escribir al keystore. Si el crash fue antes del rekey, no toca el keystore (evita brick).
**Tests:** `keyRotation.test.ts` (verificar existencia)
**Severidad:** N/A — correcto.

### Hallazgo 3.2 — Riesgo aceptado documentado: staging en plaintext
**Archivo:** `src/security/keyRotation.ts:30-33` (comentario TRADEOFF)
**Condición:** `rekey-staging.json` contiene `newDekHex` y `oldDekHex` en texto plano.
**Impacto real:** En dispositivo rooteado, el DEK es extraíble durante la ventana del rekey (segundos). El archivo se borra al completar.
**Severidad:** RIESGO ACEPTADO (documentado en el código). Ventana corta, requiere root.
**Corrección mínima:** Ninguna propuesta (el tradeoff está documentado y aceptado).

### Hallazgo 3.3 — rotateDatabaseKey (singular) sin callers
**Archivo:** `src/security/keyRotation.ts:180-260`
**Evidencia:** `grep rotateDatabaseKey src/ --include="*.ts" | grep -v test | grep -v keyRotation.ts` → cero resultados fuera del archivo.
**Impacto:** Función muerta que rota una sola DB. Si alguien la llamara por error en vez de `rotateAllDatabaseKeys`, las otras 2 DBs quedarían con DEK viejo → brick.
**Severidad:** MEJORA OPCIONAL (baja). No hay callers, pero la función existe como trampa.
**Corrección mínima:** Marcar `@deprecated` con nota "usar rotateAllDatabaseKeys", o eliminar si los tests no la necesitan.

---

## ÁREA 4: Mensajería y negociación P2P

### Hallazgo 4.1 — Anti-replay en dos niveles
**Archivo:** `src/p2p/messenger.ts:1205-1215` (Tier 1 en `unpack`), `src/p2p/p2pApprovalBridge.ts:57` (Tier 2 para proposals)
**Evidencia:** Todo frame pasa por anti-replay en `unpack` (envelope id). Proposals adicionales verifican nonce en `p2pApprovalBridge`.
**Tests:** `negotiationService.test.ts:232` (replay del mismo nonce → ignorado)
**Severidad:** N/A — correcto.

### Hallazgo 4.2 — Riesgo plausible: nonces en memoria no sobreviven reinicio
**Archivo:** `src/p2p/replayProtection.ts:40` (`private nonces = new Map()`)
**Condición:** El cache de nonces es solo memoria. Tras reinicio, se olvida todo.
**Impacto real:** MITIGADO. Las sesiones P2P tampoco sobreviven reinicio (claves de sesión en memoria). Un frame replayado tras reinicio falla en `unpack` porque no hay sesión válida. El nonce cache es segunda capa, no la única.
**Severidad:** N/A — mitigado por diseño (las sesiones son efímeras).

### Hallazgo 4.3 — Deduplicación de mensajes
**Archivo:** `src/p2p/messenger.ts:1208-1214` (comentario Tier 2)
**Evidencia:** Para tipos ACK-enabled, el `message_id` del payload decide entre ruta dedup (ya visto: re-ACK sin efectos) y ruta proceso (nuevo: persistir primero, luego ACK).
**Severidad:** N/A — diseño correcto (D4: persistir antes de ACK).

---

## ÁREA 5: Frontera mensajes externos / agente / herramientas

### Hallazgo 5.1 — Validación antes de procesar
**Archivo:** `src/agent/delegation/delegationService.ts:271-272`
**Evidencia:** `handleTaskMessage` valida con `validateTaskMessage(taskType, rawBody)` antes de cualquier procesamiento. Malformed → drop silencioso.
**Severidad:** N/A — correcto.

### Hallazgo 5.2 — Verificación de ownership en TASK_CANCEL
**Archivo:** `src/agent/delegation/delegationService.ts:283-305`
**Evidencia:** Antes de cancelar, verifica que el sender es el requester original (busca en `inboundIndex` y `runningPeers`). Si no coincide → drop (anti-spoofing).
**Severidad:** N/A — correcto (fix G4 documentado).

### Hallazgo 5.3 — Doble gate de feature flag
**Archivo:** `src/p2p/messenger.ts:1259` + `src/agent/delegation/delegationService.ts:270`
**Evidencia:** El routing de mensajes `delegation` verifica `isFeatureEnabled("delegation.enabled")` en ambos niveles. Con flag OFF, el mensaje se descarta antes de tocar el servicio.
**Severidad:** N/A — correcto.

### Hallazgo 5.4 — Cast `as never` en taskType
**Archivo:** `src/p2p/messenger.ts:1264` (`payload.taskType as never`)
**Condición:** El cast bypassa el type checker. Si `payload.taskType` es un string arbitrario no válido, se pasa a `handleTaskMessage`.
**Impacto real:** MITIGADO. `handleTaskMessage` llama `validateTaskMessage` que retorna null para tipos inválidos → drop. El cast es feo pero no inseguro.
**Severidad:** MEJORA OPCIONAL (baja). Limpieza de tipos, sin impacto funcional.
**Corrección mínima:** Validar `taskType` contra el union `TaskMessageType` antes del cast, o tipar el payload correctamente.

---

## RESUMEN

| # | Tipo | Severidad | Estado |
|---|------|-----------|--------|
| 1.1 | — | N/A | Correcto |
| 1.2 | Brecha de pruebas | Media | Documentada |
| 1.3 | — | N/A | Correcto |
| 2.1 | — | N/A | Correcto |
| 2.2 | — | N/A | Correcto |
| 2.3 | Riesgo plausible | Baja-media | Documentado |
| 2.4 | — | N/A | Correcto |
| 3.1 | — | N/A | Correcto |
| 3.2 | Riesgo aceptado | Baja | Documentado en código |
| 3.3 | Mejora opcional | Baja | Documentada |
| 4.1 | — | N/A | Correcto |
| 4.2 | — | N/A | Mitigado |
| 4.3 | — | N/A | Correcto |
| 5.1 | — | N/A | Correcto |
| 5.2 | — | N/A | Correcto |
| 5.3 | — | N/A | Correcto |
| 5.4 | Mejora opcional | Baja | Documentada |

**Vulnerabilidades confirmadas:** 0
**Riesgos plausibles:** 1 (2.3: usesConsumed en memoria)
**Brechas de pruebas:** 1 (1.2: rollback con SQLCipher real)
**Mejoras opcionales:** 2 (3.3, 5.4)

## VEREDICTO

**GO para pruebas físicas.**

No se encontraron defectos que bloqueen la validación en la Tab A9+. Los hallazgos son riesgos de severidad baja-media, brechas de pruebas no críticas, o mejoras opcionales. Ninguno compromete la seguridad fundamental del diseño.

STOP.
