# Clear All Data — semántica exacta de borrado

**Punto de entrada en la UI:** Ajustes → Zona de peligro → Borrar todos los datos
(`src/ui/ModelSetupScreen.tsx` → `handleExecuteReset` → `resetAllAppData()`
en `src/services/appReset.ts`).

**Estado:** bloqueador de privacidad TD-1 — CERRADO con el fix aquí descrito.
Antes, el borrado eliminaba la base de conocimiento, modelos, corpus y
ajustes, pero dejaba silenciosamente la base de memoria del agente
(`nido_memory.db`) y las tres claves del Keystore. Esa brecha ya está
cerrada y cubierta por tests de regresión (`src/services/appReset.test.ts`).

> **Idioma:** Español · [English](CLEAR_ALL_DATA.md)

## Qué se borra

`<doc>` = `FileSystem.documentDirectory`, `<cache>` = `FileSystem.cacheDirectory`.

### 1. Bases de datos (se cierran primero, luego se borran)

| Almacén | Fichero | Contenido destruido |
|---|---|---|
| Base de conocimiento (`src/rag/db.ts`) | `<doc>/SQLite/aoair_knowledge.db` | Sesiones y mensajes de chat, chunks y embeddings del corpus/colecciones, telemetría de ejecución |
| Base de memoria (`src/agent/memory/memoryStore.ts`) | `<doc>/SQLite/nido_memory.db` | Memoria del agente — hechos, preferencias, personas, registro diario, notas, recordatorios — **y** todas las tablas P2P: identidad del dispositivo, contactos emparejados, mensajes de entrada/salida |

Para cada base, el borrado elimina también sus ficheros auxiliares:
sidecars `-wal`, `-shm`, `-journal`, temporal de migración `.migtmp` y
marcador `.sqlcipher`. La eliminación usa la ruta real de
`deleteManagedDatabase()` en `src/security/secureDatabase.ts`.

### 2. Claves del Android Keystore (vía SecureStore)

| Alias | Propósito |
|---|---|
| `nido_db_key` | Clave de cifrado (DEK) de SQLCipher compartida por ambas bases. Se borra con el nuevo `deleteDatabaseKey()` (`src/privacy/keyManager.ts`); el borrado usa `deleteItemAsync` de SecureStore, que en Android elimina la entrada cifrada: es la ruta de borrado correcta, porque SecureStore gestiona internamente su propia clave maestra del Keystore (compartida, sin material de usuario) y no hay una entrada de Keystore por clave que borrar a mano. |
| `nido_p2p_sk` | Clave privada de identidad P2P (X25519). Se borra con el existente `deleteP2PPrivateKey()`. |
| `nido_p2p_sign_sk` | Clave privada de firma P2P (Ed25519). Se borra con el existente `deleteP2PSigningKey()`. |

Borrar la DEK es lo que hace el borrado robusto frente a recuperación
forense: aunque un fichero de base borrado se recuperara del flash, sin
`nido_db_key` es ilegible. Tras el borrado, el próximo arranque genera una
DEK **nueva** (`getDatabaseKeyHex()`); la caché de clave en memoria se
restablece (`resetMemoryKeyCache()`) para que la base nueva nunca se cifre
con la clave borrada.

### 3. Ficheros y directorios

| Ruta | Contenido |
|---|---|
| `<doc>/settings.json` | Todos los ajustes del usuario (borrado vía `clearSettings()`; la próxima lectura usa los valores por defecto) |
| `<doc>/models/` | Pesos de modelos descargados (GGUF del LLM + embedding) |
| `<doc>/corpus/` | Packs de conocimiento y colecciones importadas |
| `<doc>/eval/` | Ficheros de resultados de evaluación en dispositivo (pueden contener texto de consultas) |
| `<cache>/` | Ficheros temporales de exportación entregados al share sheet del SO |

El estado de descargas en memoria también se restablece
(`resetDownloadState()`); los contextos nativos de llama.cpp se liberan
**primero**, antes de tocar ningún fichero, para que ningún handle mmap
activo observe un fichero borrado.

## Orden de operaciones

1. Liberar contextos nativos de inferencia/embedding, cerrar packs de conocimiento.
2. Restablecer el estado de descargas en memoria.
3. Cerrar y borrar ambas bases (conocimiento, luego memoria).
4. Borrar las tres claves del Keystore; restablecer la caché de DEK en memoria.
5. Borrar los directorios models / corpus / eval / cache y `settings.json`.
6. **Verificar** — ver abajo.

## Semántica de fallo: nunca un borrado parcial silencioso

El borrado se **verifica, no se asume**. Tras borrar, `resetAllAppData()`
comprueba la no-supervivencia de cada elemento anterior:

- cada fichero de base, sidecar, temporal y marcador vía `getInfoAsync`;
- `settings.json` y los cuatro directorios vía `getInfoAsync`;
- los tres alias del Keystore vía lecturas no generadoras
  (`peekDatabaseKey()`, `loadP2PPrivateKey()`, `loadP2PSigningKey()` — los
  tres deben devolver `null`).

Si algo sobrevive — o ni siquiera se puede comprobar — la función lanza
`WipeVerificationError` listando cada superviviente. La UI de Ajustes lo
captura y muestra el fallo al usuario
(`modelSetupScreen.toasts.resetFailed`) en vez de fingir que el borrado
tuvo éxito. Tras un borrado exitoso, la app vuelve al asistente de
configuración (la comprobación de modelos requeridos falla sin modelos).

## Qué NO se borra intencionadamente

- **La app en sí ni sus assets empaquetados** — Clear All Data borra datos
  de usuario, no la instalación.
- **La clave maestra del Keystore que SecureStore gestiona internamente** —
  es compartida por todos los items de SecureStore, no contiene material de
  usuario, y borrarla rompería SecureStore para toda la app.
- **Ficheros que el usuario exportó explícitamente** vía el share sheet del
  SO (fuera de los directorios de la app) — una vez entregados a otra app,
  están fuera de alcance.

## Verificación

- `npm run typecheck` — limpio.
- `npx vitest run src/services/appReset.test.ts src/privacy/keyManager.test.ts` —
  8 tests de borrado + 13 de keyManager, todos en verde. Los tests de
  borrado ejecutan el `resetAllAppData()` real, `resetDatabase()`,
  `clearMemoryDb()`, `keyManager` y `clearSettings()` contra un filesystem
  en memoria y un backend SecureStore en memoria, y afirman la
  no-supervivencia post-borrado de cada almacén listado arriba, la rotación
  de la DEK, el fallo en voz alta (`WipeVerificationError`) ante
  supervivientes, y un test de caracterización que prueba que la secuencia
  previa al fix dejaba la base de memoria y las claves.
- **No verificado en dispositivo físico aún**: el flujo completo de UI
  (Zona de peligro → toast de fallo → asistente de configuración) sigue
  pendiente de validación en hardware cuando exista el primer APK (P1).

## Notas de seguridad

- Ningún cifrado, aislamiento de claves, uso del Keystore o código
  biométrico se debilitó para este fix. El borrado solo *elimina*; nunca
  degrada.
- El orden de borrado de claves (bases cerradas primero, claves después)
  garantiza que ningún handle de base abierto pueda recrear o releer
  material de claves a mitad del borrado.
- `peekDatabaseKey()` es deliberadamente no generador: la verificación
  nunca crea una clave como efecto secundario.
