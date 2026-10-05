> **Idioma:** [English](../../architecture/TECH_DEBT.md) · Español

# Deuda técnica — NIDO

**Estado:** REGISTRO (2026-09-27, auditoría de solo lectura). Sin arreglos
aplicados — esta línea es solo documentación.
**Severidad:** HIGH = riesgo de pérdida de datos/seguridad/corrección · MEDIUM =
bloquea funcionalidades próximas o degrada la calidad · LOW = pulido/inconsistencia.

---

## HIGH

### TD-1 — "Borrar todos los datos" omite la DB de memoria y todas las claves de Keystore
`resetAllAppData()` (`src/services/appReset.ts:27-35`) borra
`aoair_knowledge.db`, `models/`, `corpus/`, `settings.json` — pero nunca llama a
`clearMemoryDb()` (`src/agent/memory/memoryStore.ts:295`, existe pero sin
referencias desde ninguna UI/ruta de reset) y nunca borra las claves de
SecureStore. Tras "Danger Zone > Clear All Data": los hechos/notas/recordatorios
del agente, la identidad P2P + contactos + historial de mensajes, y las tres
claves de Keystore **sobreviven**. Para una app privacy-first, un reset de
fábrica que deja atrás identidad y memoria es un bug de corrección, no pulido.
El comentario de cabecera del propio archivo (`appReset.ts:12-17`) está
obsoleto — es anterior a `nido_memory.db`.

### TD-2 — El transporte Bluetooth de NidoScreen es un stub de fallo explícito
`createPlatformTransport()` recurre a `NativeP2PTransport`, que lanza
`"Transporte P2P nativo no disponible: compila el módulo nido-p2p…"`
(`src/p2p/nativeTransport.ts:189-193`). El módulo Kotlin existe en
`modules/nido-p2p/` pero no está compilado en la ruta de build actual, así que
el descubrimiento/conexión/envío P2P fallan ruidosamente en tiempo de ejecución.
Las capas de cripto, emparejamiento, cola e inbox por encima son reales — el
transporte es el hueco. Rastreado hasta que el primer APK real incluya el módulo
compilado (C-1).

### TD-3 — Fallback a texto plano en modo dev para ambas DBs cifradas
`getDatabaseKeyHex()` devuelve `null` en `__DEV__` sin SecureStore → ambas DBs
abren **sin cifrar** con solo una advertencia en consola
(`src/agent/memory/memoryStore.ts:110-115`). Producción es fail-closed (lanza),
pero cualquier build release que aún defina `__DEV__` guardaría en texto plano
en silencio. `src/diagnostics/security.ts` existe para verificar
SQLCipher/Keystore en el dispositivo — CONFIGURED ≠ VERIFIED aplica aquí.

## MEDIUM

### TD-4 — `settings.json` está en texto plano
Los 17 campos de ajustes (`src/models/settings.ts:44`) — incluyendo
`customSystemPrompt`, `modelRoleAssignments`, `activeModelId` — son legibles por
cualquiera con acceso a archivos. Inconsistente con el listón de DB cifrada.
Propuesto: cifrar todo el archivo con la DEK de SQLCipher o mover las claves
sensibles a la DB cifrada (`DATA_MODEL.md` §2.5, §3).

### TD-5 — Sin framework de migración de esquema
`meta.schema_version = 1` se escribe pero nunca se lee para migración
(`memoryStore.ts:142-148`). La evolución es ad-hoc `CREATE TABLE IF NOT EXISTS`
más ALTERs puntuales (`src/rag/db.ts:180`, `src/p2p/store.ts:38-42`). Cualquier
cambio futuro de columna/tipo riesga romper instalaciones existentes sin ruta de
upgrade/downgrade. Arreglar antes del primer release público: migraciones
`up()` versionadas, nunca saltadas (`DATA_MODEL.md` §3).

### TD-6 — Tablas de memoria muertas: `people`, `daily_log`, `preferences`
Existe CRUD completo en `memoryStore.ts` pero `savePerson`/`logDay`/`setPreference`
tienen **cero llamadores fuera de tests** — las lecturas siempre devuelven vacío.
O conectarlas (el perfil de usuario necesita `preferences`) o eliminarlas antes
de v1; el esquema muerto invita a suposiciones erróneas (`DATA_MODEL.md` §2.1).

### TD-7 — Claves foráneas no aplicadas
`chat_messages.session_id` / `answer_feedback.message_id` declaran
`REFERENCES` pero no hay `PRAGMA foreign_keys = ON` en ningún lado. Los borrados
son manuales (`chatHistory.ts:deleteSession`). Funciona hoy; un escritor futuro
que evite el helper deja filas huérfanas.

### TD-8 — Dos pantallas implementadas son inalcanzables (UI muerta)
`UsageStatsScreen.tsx` y `SystemMonitor.tsx` tienen cero referencias en ningún
lado — lógica real, nunca renderizada. Decidir: conectarlas a la navegación (el
drawer ya tiene una entrada de Telemetría que apunta a UsageStatsContent) o
eliminarlas.

### TD-9 — NidoScreen evita i18n por completo + no tiene escáner QR
20 cadenas en español codificadas, cero llamadas `t()` — el mayor hueco i18n
(`I18N_ARCHITECTURE.md` §3). Por separado: la *muestra* de QR es JS puro y real,
pero el *escaneo* de QR no está construido ("Sin cámara todavía",
`NidoScreen.tsx:412`) — el emparejamiento requiere pegar el código como texto.

### TD-10 — El texto de recordatorios filtra al tray de notificaciones del SO
Los *cuerpos* de recordatorios están cifrados en `agent_reminders`, pero
`src/routines/startup.ts:48-52` los dispara como notificaciones del SO — el
texto plano vive entonces en el tray/pantalla de bloqueo. Necesita una regla de
"nunca poner secretos en recordatorios" e, idealmente, una opción de redacción.

### TD-11 — El default i18n es español-primero, la directiva dice inglés
`deviceDefaultLanguage()` (`src/models/settings.ts:222`) y el comentario de
cabecera de `src/i18n/index.ts` consagran un default español-primero;
`NIDO_LANGUAGE_REQUIREMENT.md` exige inglés nativo/por defecto/de respaldo.
Arreglo pequeño, pero toca el comportamiento de primer arranque — necesita la
decisión de producto en `I18N_ARCHITECTURE.md` §5.1.

### TD-12 — El copy de notificaciones está en español codificado
`src/notify/notifications.ts`: nombres de canal ("Recordatorios de NIDO",
"Resumen diario de NIDO") y títulos ("NIDO · Recordatorio", "NIDO · Tu día")
son literales. Deben pasar a claves de locale.

## LOW

### TD-13 — Restos de marca "BOAR"
`AboutScreen.tsx`, `ChatHeader.tsx`, `Drawer.tsx` (×"BOAR"), `SetupWizardScreen.tsx`
(título héroe), URL del repo `github.com/rferrari/boar-app` en About. Rebrand a
NIDO incompleto — visible para los usuarios.

### TD-14 — Cadenas en inglés codificadas en pantallas por lo demás localizadas
`UsageStatsContent.tsx` (16 encabezados), `PromptIdeasCarousel.tsx` (12),
`ThemeSelector.tsx` (8+), `VoiceInputButton.tsx` (2 cadenas de alert),
`MarkdownMessage.tsx` (2), singletons varios ("LANGUAGE", "ERR_LOCAL_INIT",
"🧭 adaptive", "tok/s"). Lista completa en `FEATURE_MAP.md` §9.

### TD-15 — ThemeSelector incluye telemetría decorativa falsa + typo
`"18.4 tok/s • 0ms Cloud Latency • 100% Offline"` es texto de vista previa
inventado (`components/ThemeSelector.tsx:264`) y l.142 dice "for dad & bright
glare". Cosmético, pero números falsos en un contexto de telemetría erosionan la
confianza — reemplazar con datos de muestra claramente etiquetados o eliminar.

### TD-16 — Los paquetes de conocimiento son SQLite en texto plano (por diseño, LOW)
`src/rag/packs.ts:76` abre los paquetes de corpus sin clave. Solo datos públicos —
sin contenido de usuario — así que es aceptable; registrado para que nadie lo
"arregle" a un formato incompatible después.

### TD-17 — Artefactos de eval/dev fuera de la ruta de reset
`documentDirectory/eval/` (JSONL, archivos pending/status) está en texto plano y
`resetAllAppData()` no lo limpia. Superficie solo de desarrollo; incluir en el
reset por completitud.

### TD-18 — Las sesiones P2P son solo en memoria (trade-off deliberado)
Las sesiones cifradas + reensambladores de tramas (`src/p2p/messenger.ts:54-63`)
mueren al reiniciar; el outbox persiste así que nada se pierde, pero cada
reinicio fuerza re-handshake. Aceptable; registrar `last_handshake_at` por
contacto cuando aterrice el modelo de estado (`DATA_MODEL.md` §2.4).

---

## Dependencias riesgosas (lista de vigilancia)

| Dependencia | Riesgo |
|---|---|
| `llama.rn@0.13.0-rc.4` | **Release candidate**, no estable — riesgo de rotura del build nativo (ya el polo largo en CI); fijar y reevaluar antes de cualquier upgrade |
| `expo-sqlite` + SQLCipher | El cifrado está cableado en código pero **sin verificar en un dispositivo físico** (C-1 abierto); el chequeo `PRAGMA cipher_version` existe precisamente para esto |
| `expo@57` / `react-native@0.86.3` / `react@19.2.3` | Versiones major de bleeding-edge; esperar churn en la línea 57/0.86 |
| `modules/nido-p2p`, `modules/voice-input` | Módulos nativos propios; la aridad de `promise.reject()` de Kotlin ya rompió una vez en SDK 57 (arreglado) — tratar los upgrades de módulos nativos como alto riesgo |
| Sin React Navigation | Navegación manual por máquina de estados (deliberada, superficie pequeña) — bien ahora, pero deep-linking o flujos complejos querrán un router real después |

## Funciones sin implementación real (recapitulación)

- `savePerson` / `logDay` / `setPreference` — CRUD completo, cero llamadores fuera de tests (TD-6)
- `clearMemoryDb()` — existe, sin referencias desde UI/reset (TD-1)
- `NativeP2PTransport` — stub de fallo explícito hasta que el módulo Kotlin compile (TD-2)
- Escáner QR — ausente; solo pegar-como-texto (TD-9)

## Lo que NO es deuda técnica (deliberado, mantener)

- La telemetría nunca guarda texto de prompt/respuesta — privacidad por diseño.
- Las claves privadas P2P solo en SecureStore, nunca en la DB — correcto.
- `chunks_fts`/`chunk_embeddings` adyacentes a texto plano en paquetes — corpus público.
- Navegación manual en vez de React Navigation — aceptable a este tamaño.
