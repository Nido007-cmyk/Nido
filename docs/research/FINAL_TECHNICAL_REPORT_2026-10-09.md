# NIDO — Reporte Técnico Final 2026-10-09

## 1. RISK-1: Riesgo aceptado (no refactorizar)

**Estado:** CERRADO administrativamente como RIESGO ACEPTADO.

**Justificación:**
- P2P no importa nada relacionado con modelos (`llama.rn`, `ModelManager`, `modelInvoke`): cero resultados en `src/p2p/`
- Cambio de modelo (Qwen 0.5B → más avanzado) no requiere modificar P2P
- Los 3 sitios de acoplamiento son estables y conocidos:
  1. `src/p2p/store.ts:14` → `../agent/memory/memoryStore` (wrapper deprecado)
  2. `src/p2p/p2pAuthorization.ts:24-25` → `../agent/policy/authorization`
  3. `src/p2p/messenger.ts:1260` → `../agent/delegation/delegationService` (dynamic, flag OFF)
- No hay vulnerabilidad activa demostrada
- El refactor intentó rompió 73 tests; beneficio no justifica riesgo

**Documentado en:** `docs/research/ARCHITECTURE_AUDIT_2026-10-09.md` (addendum 2026-10-09)

## 2. Revisión de autorizaciones P2P (solo lectura)

**Cobertura existente:**
- `src/agent/policy/authorization.test.ts`: decisiones AUTO/ASK/DENY, consistencia, invariantes
- `src/p2p/negotiationService.test.ts`: PROPOSE/ACCEPT/DECLINE, firmas, replay, fail-closed
- `src/p2p/negotiation.e2e.test.ts`: flujo completo con aprobación humana

**Brechas identificadas (para futura tarea):**
- No hay test específico que verifique el contrato de `authorize()` cuando `policyEngine` cambia su firma
- La agregación DENY > ASK > AUTO en `p2pAuthorization.ts:111-125` no tiene test dedicado de la lógica de agregación
- Prioridad: MEDIA (el código funciona, pero un cambio en policy podría romper P2P silenciosamente)

## 3. Compatibilidad con modelos avanzados

**Interfaz:** NIDO usa `llama.rn` 0.13.0-rc.6 (binding de llama.cpp para React Native).

**Selección:** `src/models/defaultModel.ts` elige según RAM del dispositivo:
- ≥3.8 GiB → Qwen2.5-1.5B
- <3.8 GiB → Qwen2.5-0.5B

**Formatos:** GGUF (vía llama.cpp). Cualquier modelo GGUF compatible con la versión de llama.cpp empaquetada.

**Independencia:** P2P, memoria cifrada, herramientas locales y políticas NO dependen del modelo específico. Solo `src/agent/loop/` y `src/models/` tocan el modelo.

**Limitaciones:**
- RAM: modelo + KV cache + 2 GiB headroom del sistema
- 16KB pages: pendiente fix de llama.rn (issue #411)
- Tool calling: depende de capacidad del modelo, no de NIDO

**Para un modelo más avanzado se necesitaría:**
1. Verificar que llama.rn lo soporta (arquitectura del modelo)
2. Pruebas de RAM en Tab A9+ (Snapdragon 695, 8GB)
3. Validar tool calling con el nuevo modelo
4. Medir latencia y calidad en dispositivo real

**Distinción:**
- ✅ Compatibilidad arquitectónica: SÍ (diseño modular)
- ⚠️ Compatibilidad runtime: Depende de llama.rn y formato GGUF
- ⚠️ Compatibilidad hardware: Depende de RAM y 16KB fix
- ❌ Funcionalidades verificadas: NINGUNA con modelo nuevo (requiere gate físico)

## 4. RISK-3: Completado

**Checkpoint:** `df4b77e0`

**Evidencia:**
- Framework en `src/security/dbMigrations.ts` (259 líneas)
- Wiring en `src/security/databaseManager.ts` (usa `applyMigrations`)
- Registro vacío: `MEMORY_MIGRATIONS = []`
- 17 tests del framework + 6 tests de integración
- **2172/2172 tests**, tsc limpio

**Comportamiento:**
- Registro vacío = idéntico al código anterior (verificado)
- Migración que falla → versión no se estampa, reintento limpio
- Versión futura → `MemoryDbVersionError` (fail-closed)

## 5. CI y APK

**Build:** `df4b77e0` — Run ID 37965228692
**Estado:** EN PROGRESO (al momento del reporte)

**Baselines:**
- `1f532ba4` (tag: `audit9-baseline`): baseline de auditoría #9, reservado para gate físico
- `df4b77e0`: con RISK-3, pendiente de build

**APK para gate físico:** El de `1f532ba4` (no sustituir hasta validación)

## 6. Riesgos residuales

1. **RISK-1**: Deuda técnica aceptada. Si `agent/policy` cambia incompatiblemente, P2P podría romperse.
2. **16KB llama.rn**: Issue #411 abierto, sin fix de upstream. Afecta Pixel y futuros flagships.
3. **RISK-3**: Framework no probado con SQLCipher real bajo fallos de escritura (solo mocks).
4. **`src/rag/db.ts`**: Aún usa `checkFormatVersion` inline, no migrado al framework.

## 7. Checklist validación física (Tab A9+)

- [ ] Instalación limpia del APK de `1f532ba4`
- [ ] Onboarding completo
- [ ] Descarga del modelo Qwen2.5-0.5B
- [ ] Chat simple y conversación larga
- [ ] Tool calling (recordatorios, notas)
- [ ] Memoria persistente tras reinicio
- [ ] Español e inglés
- [ ] P2P: pairing QR entre 2 tablets
- [ ] P2P: chat cifrado
- [ ] P2P: revocación de contacto
- [ ] P2P: reconexión tras suspensión
- [ ] Modo avión prolongado
- [ ] Integridad de DBs tras uso intensivo

## 8. Recomendación

**GO para pruebas físicas** con el APK de `1f532ba4`.

**NO-GO para lanzamiento público:** Falta validación física, auditoría criptográfica externa, y fix de 16KB.

---

**STOP.** No más código sin autorización específica.
