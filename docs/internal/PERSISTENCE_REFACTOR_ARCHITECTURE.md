# Arquitectura de Persistencia: Actual → Objetivo

**Fecha:** 2026-10-05
**Decisión:** Refactoring mayor autorizado por el usuario. NO PUSH.

## Arquitectura Actual (problemática)

### Cuatro stores, cuatro conexiones no coordinadas

Todos abren `nido_memory.db` independientemente:

| Store | Archivo | Usa wipe gate | Usa epoch | close() real | Schema version |
|-------|---------|---------------|-----------|--------------|----------------|
| memoryStore | `src/agent/memory/memoryStore.ts` | ✅ | ✅ | ✅ | ✅ |
| taskStore | `src/agent/scheduled/taskStore.ts` | ❌ | ❌ | ❌ | ❌ |
| learnedSkillStore | `src/agent/skills/learnedSkillStore.ts` | ❌ | ❌ | ❌ | ❌ |
| knowledgeGraphStore | `src/agent/memory/knowledgeGraphStore.ts` | ❌ | ❌ | ❌ | ❌ |

### Problemas específicos

**H-1: Race en apertura perezosa**
Cada `getDb()` hace:
```ts
if (db) return db;  // race: dos llamadas concurrentes → dos conexiones
const keyHex = await getDatabaseKeyHex();
const handle = await ensureEncryptedDatabase(...);
db = sqliteDb;
```
Dos llamadas concurrentes antes de que `db` se asigne crean dos handles. Handles filtrados.

**H-2: Sin participación en Clear All Data**
`taskStore`, `learnedSkillStore`, `knowledgeGraphStore` no llaman `getWipeGate()`.
Durante un wipe, pueden escribir datos del ciclo N+1 con la DEK vieja → base inabrible.

**H-3: Cuatro conexiones sobre el mismo fichero**
SQLite permite múltiples conexiones, pero:
- Cada una tiene su propio `writeQueue` (no coordinadas entre sí)
- WAL no centralizado
- `close*Store()` nulifica la variable sin cerrar el handle → file descriptors filtrados

**H-4: Sin versionado de esquema**
Solo `memoryStore` verifica `MEMORY_DB_SCHEMA_VERSION`. Los otros tres aplican `CREATE TABLE IF NOT EXISTS` sin versionar. No hay migración controlada.

**H-5: JSON.parse sin protección**
`rowToTask`, `rowToSkill`, etc. hacen `JSON.parse(row.allowed_tools)` sin try/catch. Dato corrupto → crash.

## Arquitectura Objetivo

### Un solo DatabaseManager coordinado

```
┌─────────────────────────────────────────────────┐
│           DatabaseManager (singleton)           │
│                                                 │
│  - Una sola conexión a nido_memory.db           │
│  - Un solo writeQueue global                    │
│  - Wipe gate centralizado                       │
│  - Epoch para invalidar handles viejos          │
│  - Schema version unificada                     │
│  - close() real que cierra el handle            │
└─────────────────────────────────────────────────┘
         │                │                │
         ▼                ▼                ▼
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │  tasks   │    │  skills  │    │  graph   │
   │  (tablas)│    │ (tablas) │    │ (tablas) │
   └──────────┘    └──────────┘    └──────────┘
         │                │                │
         └────────────────┴────────────────┘
                          │
                    ┌──────────┐
                    │  memory  │
                    │ (tablas) │
                    └──────────┘
```

### Garantías

1. **SQLCipher siempre**: `ensureEncryptedDatabase` con fail-closed. Sin clave = sin acceso.
2. **Cero fallback plaintext**: eliminado el `.catch(() => null)` (ya corregido en commit ad1f82c).
3. **Conexiones coordinadas**: un solo handle, un solo writeQueue.
4. **Lifecycle consistente**: todos los stores usan `getWipeGate()`, epoch, `DbLifecycleEndedError`.
5. **Migrations**: versión de esquema unificada, migración controlada.
6. **Close/reopen seguro**: `close()` cierra el handle real, `getDb()` reabre limpiamente.
7. **Wipe/crypto-shred**: `deleteManagedDatabase` + rotación de DEK. Después del wipe, ningún store recupera datos viejos.
8. **Sin conexiones huérfanas**: el manager rastrea el handle, close lo libera.
9. **Fallos parciales seguros**: si el wipe falla a mitad, la puerta se envenena (fail-closed).

### Plan de implementación

**Fase A:** Crear `src/security/databaseManager.ts`
- Singleton con `getConnection()`, `close()`, `getEpoch()`
- Integra `getWipeGate()`, `ensureEncryptedDatabase`, version check
- Un solo `writeQueue`

**Fase B:** Migrar los 4 stores
- Reemplazar `getDb()` local por `DatabaseManager.getConnection()`
- Reemplazar `enqueueWrite` local por el global
- Añadir wipe gate checks
- Añadir try/catch en JSON.parse

**Fase C:** Tests de persistencia
- key retrieval failure
- SecureStore failure  
- CRUD en todos los stores
- concurrent access
- wipe → verify no data recovery
- reopen after wipe
- failure during wipe

**Fase D:** Verificación de invariantes
- validateTask sigue bloqueando
- fail-closed encryption intacto
- SHA-256 P2P intacto
- wrapUntrusted intacto
- Policy Engine intacto
