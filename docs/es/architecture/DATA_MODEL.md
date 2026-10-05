> **Idioma:** [English](../../architecture/DATA_MODEL.md) · Español

# Modelo de datos — NIDO

**Estado:** ACTUAL (auditado el 2026-09-27) + PROPUESTO (diseño, sin implementación).
**Audiencia:** cualquiera que construya funcionalidades sobre el almacenamiento de NIDO.
**Línea base de cifrado:** las dos DBs SQLite de datos de usuario están cifradas
con SQLCipher con una DEK respaldada por Keystore y cableado fail-closed
(auditado; ver §1). Todo lo marcado **[EXISTS]** abajo fue verificado en código
con evidencia archivo:línea durante la auditoría. Todo lo marcado **[PROPOSED]**
es solo diseño.

Relacionado: `docs/architecture/TECH_DEBT.md` (huecos de almacenamiento),
`docs/C1_SQLCIPHER.md`, `src/security/secureDatabase.ts`, `src/privacy/keyManager.ts`.

---

## 1. ACTUAL — lo que la app realmente almacena (2026-09-27)

### 1.1 Bases de datos SQLite (ambas cifradas con SQLCipher en reposo) [EXISTS]

**DB A — `aoair_knowledge.db`** (propietaria `src/rag/db.ts`, vía
`ensureEncryptedDatabase` + `getDatabaseKeyHex()`):

| Tabla | Contenido |
|---|---|
| `chunks_fts` (FTS5) | Chunks RAG: `chunk_id`, `doc_id`, `title`, `body` |
| `chunks` | lo mismo + `source`, `collection_id` (añadido por migración ALTER) |
| `chunk_embeddings` | `chunk_id`, `embedding` BLOB float32, `dim` |
| `chat_sessions` | `id`, `title`, `summary`, `created_at`, `updated_at` |
| `chat_messages` | `id`, `session_id` FK, `role`, `text`, `created_at` (+ índice en sesión) |
| `answer_feedback` | `message_id` FK, `rating`, `created_at` |
| `execution_telemetry` | registro por inferencia: modelo, tiempos, tokens, tok/s, pico de RSS, resultado, error — **nunca texto de prompt/respuesta** (deliberado) |
| `custom_collections` | metadatos de colecciones de documentos importadas |

**DB B — `nido_memory.db`** (propietaria `src/agent/memory/memoryStore.ts`,
DDL refleja `src/agent/memory/schema.sql`):

| Tabla | Contenido | Estado de escritura |
|---|---|---|
| `facts` | hechos de memoria del agente: `content`, `category`, `confidence`, `source` | escritos por herramientas del agente |
| `preferences` | `key`/`value` | **el esquema existe, cero escritores fuera de tests** (muerta) |
| `people` | `name`, `relationship`, `notes` | **cero escritores fuera de tests** (muerta) |
| `daily_log` | `day`, `entry` | **cero escritores fuera de tests** (muerta) |
| `agent_notes` | `title`, `body` | escritos por herramientas del agente |
| `agent_reminders` | `text`, `due_at`, `done` (+ índice parcial en pendientes) | escritos por herramientas del agente + arranque |
| `meta` | `schema_version = 1` (escrito, nunca leído para migración) | — |
| `p2p_identity` | `pk_hex`, `name` (`sk_hex` queda `""`; clave privada en Keystore) | almacén de identidad |
| `p2p_contacts` | `pk_hex`, `name`, `verified`, `sig_pk` (Ed25519) | contactos verificados por QR |
| `p2p_messages` | `id`, `dir` (in/out), `peer_pk`, `type` (chat/agent_task/agent_result/receipt), `text`, `status` (queued→sent→delivered→read), `ts` | inbox/outbox a prueba de replay (`INSERT OR IGNORE`) |

**DB C — paquetes de conocimiento** (solo lectura, **texto plano por diseño**):
archivos SQLite de corpus público bajo `documentDirectory/corpus/*.sqlite`, sin
datos de usuario.

### 1.2 SecureStore (Android Keystore) [EXISTS]

| Clave | Contiene |
|---|---|
| `nido_db_key` | DEK SQLCipher de 32 bytes (hex), una DEK para ambas DBs, generada una vez con CSPRNG |
| `nido_p2p_sk` | clave privada de identidad P2P X25519 (filas DB legadas automigran aquí al leerse) |
| `nido_p2p_sign_sk` | semilla de firma Ed25519, generada perezosamente |
| `__nido_diag_canary__` | canario de diagnósticos transitorio (escrito, verificado, borrado) |

Sin tokens, contraseñas ni PINs. `getDatabaseKeyHex()` **lanza en producción**
si SecureStore no está disponible (fail-closed); los builds de desarrollo
recurren a texto plano con una advertencia en consola.

### 1.3 Archivos [EXISTS]

| Ruta (bajo `documentDirectory`) | Contenido |
|---|---|
| `SQLite/` | las dos DBs cifradas + sidecars WAL + marcadores `.sqlcipher` |
| `settings.json` | **todos los ajustes en JSON texto plano** — 17 campos (ver §1.4) |
| `models/` | pesos GGUF, verificados por checksum contra `src/models/manifest.ts` |
| `corpus/` | JSON de corpus + archivos SQLite de paquetes de conocimiento |
| `eval/` | artefactos de eval de desarrollo (JSONL, archivos pending/status) |

`cacheDirectory`: exportaciones transitorias (CSV/JSON de telemetría,
exportaciones de colecciones — borradas tras compartir), copias del selector
de documentos.

### 1.4 Ajustes (actuales) [EXISTS]

Un único `settings.json`, lectura-modificación-escritura del archivo completo
por cambio, texto plano:

`activeModelId`, `hidePromptIdeas`, `personalityId`, `customSystemPrompt`,
`maxTokens`, `hapticsEnabled`, `voiceInputEnabled`, `readAloudEnabled`,
`autoSummarize`, `historyTurnThreshold`, `maxSavedSessions`, `autoGenerateTitles`,
`deepResearchMode`, `themeId` (midnight/amber/frontier), `fontScale`
(compact/standard/large), `languageId` (en/pt/es), `routingPreset`,
`modelRoleAssignments`, `adaptiveRoutingEnabled`.

`ThemeId`, `FontScale`, `LanguageId` son uniones cerradas en
`src/models/settings.ts`. Los presets de personalidad están codificados en
`src/constants/personalities.ts` (`succinct`/`detailed`/`summary`/`custom` —
presets de estilo de respuesta, no visuales).

### 1.5 Solo en memoria (se pierde al reiniciar) [EXISTS]

Muestreador de estadísticas/telemetría de consultas, sesiones P2P cifradas +
reensambladores de tramas (la cola de outbox persiste, así que los mensajes
sobreviven; las sesiones re-hacen handshake), mapas de progreso de descargas,
contextos llama.cpp cargados, conexiones DB cacheadas, estado de ejecución del
bucle del agente. Las notificaciones programadas por el SO
(`expo-notifications`) sobreviven a nivel de SO.

### 1.6 Veredictos de dominio — actual

| Dominio | Veredicto |
|---|---|
| Perfil de usuario | **FALTANTE** — sin almacén de perfil; las tablas `preferences`/`people` existen pero no se escriben |
| Identidad / claves de NIDO | **EXISTS** — `p2p_identity` + claves de Keystore |
| Configuración de personalidad | **EXISTS** (ajustes en texto plano + presets codificados) |
| Conversación / memoria | **EXISTS** (cifrada; hechos/notas/recordatorios escritos, people/log/preferences muertas) |
| Preferencias / ajustes | **EXISTS** (`settings.json` en texto plano) |
| Emparejamiento / inbox P2P | **EXISTS** (cifrado, a prueba de replay) |
| Telemetría | **EXISTS** (en memoria + persistente cifrada, sin texto de mensajes) |
| Inventario / progresión / economía | **FALTANTE** — no existe nada |

---

## 2. PROPUESTO — modelo de datos objetivo (solo diseño, sin implementación)

Principios: todo lo del usuario sigue local-first y cifrado en reposo; la
identidad/autoridad/memoria pertenecen al NIDO local (`NIDO_PRINCIPLES.md` §3);
las tablas nuevas obtienen migraciones reales (el enfoque ad-hoc de ALTER
actual debe reemplazarse — ver TECH_DEBT.md).

### 2.1 Perfil de usuario [PROPOSED]

Nueva tabla en `nido_memory.db` (cifrada):

```sql
-- spec sketch
CREATE TABLE user_profile (
  id            TEXT PRIMARY KEY CHECK (id = 'me'),  -- singleton row
  display_name  TEXT,                                 -- user-chosen, optional
  locale        TEXT,                                 -- mirrors settings.languageId
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

- Fila singleton (`id='me'`); sin alcance multiusuario en v1.
- Activa las tablas actualmente muertas `people`/`preferences`/`daily_log` o
  las reemplaza — decidir: conectarlas vs. eliminarlas. (Recomendación: conectar
  `preferences` para las claves adyacentes al perfil, mantener `people`/`daily_log`
  solo si las herramientas del agente realmente las escribirán; si no, eliminar
  para evitar esquema muerto.)

### 2.2 Identidad de NIDO [PROPOSED — extiende EXISTS]

Actual: claves de identidad P2P + nombre. Adiciones propuestas:

- Tabla `nido_identity` (o extender `p2p_identity`): `identity_id` (estable,
  sobrevive a la rotación de claves), `created_at`, `rotated_at`,
  `crypto_version` (cripto-agilidad: ids de algoritmos versionados desde el
  inicio, según principios §8), `rotation_chain` (cadena verificable de
  rotaciones, sin puerta trasera central).
- Vinculación de dispositivo: registros de clave por dispositivo (`device_id`,
  `device_name`, `added_at`, `revoked_at`) — principio multi-dispositivo: el
  compromiso de un dispositivo ≠ compromiso de todos.
- **Fuera del alcance de este doc:** el protocolo real de rotación (línea de
  diseño de protocolo).

### 2.3 Personalidad [PROPOSED — extiende EXISTS]

Dos conceptos distintos que el código actual mezcla — separarlos:

| Concepto | Hoy | Propuesto |
|---|---|---|
| **Estilo de respuesta** | `personalityId` en settings.json (`succinct`/`detailed`/`summary`/`custom`) | mantener, renombrar a `responseStyleId` eventualmente; los presets pasan a ser datos no código |
| **Personalidad visual** | 12 presets del sistema de diseño, no en la app | `avatar_preset_id` + overrides de capa → `AvatarDescriptor` (ver `3D_INTEGRATION_CONTRACT.md` §2.1); presets enumerados desde el manifiesto de assets, almacenados por usuario |

Tabla `nido_persona` propuesta: `id`, `name`, `response_style_id`,
`custom_system_prompt` (movido del settings.json en texto plano a la DB
cifrada), `avatar_descriptor_json` (versionado), `is_active`, timestamps.
Soporta múltiples personas nombradas más adelante; v1 = una sola fila activa.

### 2.4 Estado [PROPOSED]

Estado operativo de app/agente que debería sobrevivir al reinicio (actualmente
parcialmente en memoria):

- `agent_state`: `last_run_id`, `last_run_status`, `pending_approvals`
  (cola de aprobación humana — ¿actualmente dónde? verificar; si está en
  memoria, persistirla), `updated_at`.
- Reanudación de sesiones P2P: mantener solo en memoria (trade-off deliberado),
  pero registrar `last_handshake_at` por contacto para que el re-handshake sea
  barato y auditable.
- Intents de notificación: las notificaciones programadas por el SO referencian
  ids estables que resuelven contra `agent_reminders` (ya es el caso vía startup.ts).

### 2.5 Preferencias [PROPOSED — consolida EXISTS]

- Mover las preferencias relevantes para la privacidad del `settings.json` en
  texto plano a la DB cifrada (tabla `preferences` — dándole por fin escritores),
  o cifrar `settings.json` con la DEK de SQLCipher. (Recomendación: cifrar todo
  el archivo de ajustes; la historia más simple y consistente. Ver TECH_DEBT.md.)
- Patrón de registro de ajustes: cada ajuste declarado una vez con
  `{ key, type, default, scope: "device"|"user", sensitive: bool, ui: {...} }`
  — la UI de Ajustes se renderiza desde el registro (sin código de UI por
  ajuste), que es lo que hace estructuralmente verdadero "añadir idiomas sin
  rediseñar la UI" (mismo patrón que el manifiesto de avatar en
  `3D_INTEGRATION_CONTRACT.md`).

### 2.6 Inventario / progresión [PROPOSED]

Según `docs/architecture/ECONOMY_ARCHITECTURE.md` §5:

```sql
-- spec sketch (encrypted DB)
CREATE TABLE inventory_items (
  id          TEXT PRIMARY KEY,          -- e.g. "mantle.olive"
  kind        TEXT NOT NULL,             -- avatar-layer | avatar-preset | theme | convenience | title
  acquired_at INTEGER NOT NULL,
  source      TEXT NOT NULL,             -- purchase | milestone | reward | default
  cost_json   TEXT,                      -- { currency, amount } if purchased
  asset_ref   TEXT                       -- 3D asset manifest id, when applicable
);
CREATE TABLE economy_ledger (
  id          TEXT PRIMARY KEY,          -- unique grant/spend id (idempotency)
  ts          INTEGER NOT NULL,
  kind        TEXT NOT NULL,             -- grant | spend
  currency    TEXT NOT NULL,             -- spark | core
  amount      INTEGER NOT NULL CHECK (amount >= 0),
  reason      TEXT NOT NULL,
  policy_ref  TEXT,                      -- policy decision id, when applicable
  prev_hash   TEXT NOT NULL,             -- hash chain (tamper-evidence)
  hash        TEXT NOT NULL
);
CREATE TABLE milestones (
  id          TEXT PRIMARY KEY,
  completed_at INTEGER,                  -- NULL = not yet completed
  reward_json TEXT NOT NULL
);
```

- Todo solo local, por dispositivo, no transferible (economy spec §2).
- El ledger no contiene contenido de mensajes ni chain-of-thought.

### 2.7 Ganchos futuros de economía [PROPOSED]

- Columna `payment_id` (128 bits, generada por el pagador) lista en cualquier
  futura tabla de liquidación — liquidación idempotente según
  `docs/economic/SETTLEMENT_ABSTRACTION.md`.
- La separación `budget_vault` (presupuesto operativo vs. fondos principales)
  es primero un concepto de *política*; sin tabla hasta que exista un rail.
- **Sin columnas fiat/token/blockchain.** Si los rieles llegan alguna vez,
  llegan vía la abstracción `SettlementAdapter`, no como columnas en estas tablas.

---

## 3. Estrategia de migración (propuesta)

1. Introducir un corredor de migraciones real: `meta.schema_version` pasa a ser
   autoritativo; cada versión tiene un `up()` explícito; ninguna versión se
   salta; downgrade = restaurar desde backup, nunca automático.
2. Reemplazar los bloques ad-hoc de `ALTER TABLE` con try/catch por migraciones
   versionadas.
3. `settings.json` → cifrado: migración única que re-cifra bajo la DEK de
   SQLCipher (o mueve las claves sensibles a la DB), y luego borra el archivo
   en texto plano.
4. Tablas muertas (`people`, `daily_log`, `preferences` sin conectar): decisión
   explícita por tabla — conectar o eliminar — antes de v1, no después.

## 4. Preguntas abiertas

1. ¿Cifrar todo `settings.json` vs. mover claves sensibles a la DB cifrada?
2. ¿Conectar o eliminar las tablas de memoria muertas?
3. ¿`user_profile` singleton vs. anticipar multi-perfil más adelante?
4. ¿Algoritmo de hash del ledger (versionado desde el día uno por cripto-agilidad)?
5. ¿Balances por dispositivo: aceptable a largo plazo, o planear semántica de fusión ahora?
