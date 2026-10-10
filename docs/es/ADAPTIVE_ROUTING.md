> **Idioma:** [English](../ADAPTIVE_ROUTING.md) · Español
# Inteligencia offline adaptativa — Auditoría de arquitectura de Fase 0

Rama: `adaptive-offline-ai`. Esta auditoría es el entregable obligatorio de
la Fase 0 antes de escribir código del motor de enrutamiento/ejecución,
según el plan de construcción. Todo lo siguiente refleja el código actual
real (verificado directamente, no recordado), no aspiraciones.

## 1. Catálogo de modelos y manifiesto

`src/models/manifest.ts` — `CatalogModel` (id, kind: `llm`/`embedding`/`corpus`,
filename, sizeBytes, sha256, sourceUrl, license, description, required,
bundled?). `MODEL_CATALOG` es la lista curada; `TIERS` (Minimum/Standard/Full)
agrupan un conjunto de modelos requeridos + paquetes de corpus para la
configuración inicial. `src/models/discoveredModels.ts` persiste los modelos
encontrados vía la búsqueda de Hugging Face (`src/services/modelBrowser.ts`)
— la misma forma `CatalogModel`, mantenida en un archivo JSON separado en
lugar de fusionarse con `MODEL_CATALOG` ya que no están verificados de la
misma forma.

**No existe hoy ningún metadato de capability/rol de modelo.** `CatalogModel`
no tiene noción de "este modelo es bueno razonando" ni "este modelo soporta
el rol X" — esa es exactamente la brecha que llena el `ModelCapabilities`
de la Fase 1. Habrá que añadirlo como una nueva anotación opcional,
almacenada por separado (curada para entradas de `MODEL_CATALOG`,
ausente/por defecto para los descubiertos/personalizados), no como campo
requerido de `CatalogModel` — los modelos descubiertos no tienen quién
verifique sus capabilities.

## 2. Ciclo de vida de descarga/instalación

`src/models/ModelManager.ts` — `statusOf()` (verifica que el tamaño del
archivo en disco coincida con el catálogo, autocura archivos truncados
tratándolos como ausentes), `downloadCatalogModel()` (descarga por red +
verificación de tamaño post-descarga, sin verificación sha256 por
descarga — leer un archivo de varios GB en memoria para un hash no se hace
rutinariamente, ver los comentarios doc de la propia clase),
`installBundled()` (ruta alternativa de APK empaquetado, no la compilación
por defecto).

`src/services/downloadManager.ts` — singleton a nivel de módulo (sobrevive
desmontar/remontar pantallas), rastrea progreso/velocidad/ETA por asset,
protege contra descargas concurrentes duplicadas al mismo asset id.

## 3. Carga/descarga de modelos y el wrapper de inferencia

**Dos singletons independientes, cada uno envolviendo un `LlamaContext`
de `llama.rn`:**

- `src/inference/LlamaEngine.ts` (`llamaEngine`) — generación. `load()`
  primero llama a `unload()` (libera cualquier contexto previo) antes de
  crear uno nuevo — esta es una restricción dura: **solo un modelo capaz
  de generar puede estar cargado a la vez.** `load()` ahora es no-op si el
  mismo archivo ya está cargado (corregido antes en esta sesión — remontar
  una pantalla solía forzar una recarga nativa innecesaria de varios
  segundos). Incluye una estimación RAM pre-vuelo
  (src/inference/ramBudget.ts: pesos + KV cache calculada + buffers de
  cómputo) que lanza un error claro antes de intentar una carga que
  probablemente haga OOM. `generate()` pasa `DEFAULT_STOP_SEQUENCES` fijas que coinciden con
  la plantilla de prompt hecha a mano de la app (no una API de
  chat-template — ver §9). `stop()` llama a `context.stopCompletion()`,
  que resuelve la promesa `completion()` en vuelo normalmente con texto
  parcial (el comportamiento de parada limpia de llama.cpp) — **no**
  lanza/rechaza.

- `src/rag/embed.ts` (`embeddingEngine`) — embeddings, mismo patrón de
  guarda de carga.

**Implicación para enrutamiento/roles:** los dos motores pueden correr
concurrentemente entre sí (generación + embedding coexisten hoy, así es
como RAG ya funciona), pero **no hay soporte para dos modelos de
generación distintos cargados a la vez**. Un plan de enrutamiento que
quiera, digamos, un modelo `fast` y otro `reasoning` separados solo puede
ejecutarlos **secuencialmente**, pagando un costo de cambio de modelo
(unload + load, que hace un pre-vuelo RAM y puede ser una operación nativa
de varios segundos para un modelo de varios GB) entre ellos. Esto confirma
directamente la guía del propio plan de construcción: solo ejecución
secuencial en la primera implementación, sin ejecución concurrente
multi-modelo.

## 4. Estado del chat y persistencia de mensajes

`src/services/chatHistory.ts` sobre el SQLite de `src/rag/db.ts` (tablas
`chat_sessions`, `chat_messages`: `id`, `session_id`, `role`, `text`,
`created_at`). `ChatScreen.tsx` mantiene el estado de mensajes vivos en
estado React; la persistencia ocurre vía llamadas explícitas
`createSession`/`addMessage`, no automáticamente.

Esta es la clave de unión natural para los registros de feedback (Fase 6):
`messageId` = `chat_messages.id`, `conversationId` =
`chat_sessions.id`, ambos identificadores ya estables y persistidos — no
se necesita un nuevo esquema de IDs.

## 5. Servicios RAG / recuperación

`src/rag/retrieve.ts` — BM25 híbrido (FTS5) + coseno (fuerza bruta sobre
embeddings float32 almacenados) con fusión de suma ponderada.
`semanticSearch` ahora aplica un piso mínimo de similitud coseno
(`MIN_SEMANTIC_SIMILARITY = 0.45`, añadido en esta sesión) para que una
consulta irrelevante no reciba "contexto" forzado no relacionado —
precedente relevante para el "evitar presentar citas no respaldadas como
hechos verificados" de la Fase 5.

`src/services/orchestrator.ts` — el existente "Modo Deep Research": un
**pipeline secuencial multi-pase sobre el único modelo de generación
cargado** (descomponer → retrieve+generate por sub-pregunta →
sintetizar), documentado explícitamente como no-realmente-multi-agente.
Esto es arquitectónicamente lo más cercano existente a un "ejecutor de
RoutingPlan" — el motor de ejecución de la Fase 4 debería generalizar este
patrón (pasos tipados, ejecución secuencial sobre un contexto) en lugar de
reemplazarlo. `runDeepResearch` ya acepta un callback `shouldStop`
verificado entre etapas (añadido en esta sesión, tras descubrir que el
botón Stop no detenía realmente el research multi-etapa) — la misma forma
que necesita el soporte de cancelación de la Fase 4.

## 6. Pipeline de embeddings

`src/rag/embed.ts` (arriba) + `src/rag/seedCorpus.ts` (seeding masivo
idempotente: verifica `chunk_id` existentes antes de embeber, así
re-ejecutar solo embebe docs nuevos). Los embeddings siempre se calculan
en el dispositivo al sembrar/importar, nunca precomputados/enviados —
esto es deliberado (ver `ARCHITECTURE.md`), así siempre coinciden con el
modelo de embedding realmente cargado.

## 7. Configuración y localización

`src/models/settings.ts` — un único archivo JSON
(`FileSystem.documentDirectory + "settings.json"`), read-modify-write en
cada cambio, sin sistema de migración de esquema (los campos nuevos son
simplemente opcionales con un fallback por defecto en cada getter). Todo
desde el tema hasta la personalidad hasta los límites de memoria vive aquí.
**Este es el patrón que los presets/asignaciones de rol-modelo de la Fase 2
deberían seguir** para configuración clave-valor simple (p. ej.
`routingPreset: RoutingPreset`, `modelRoleAssignments: Record<ModelRole,
string>`) — pequeña, escrita con poca frecuencia, sin necesidades de
consulta.

`src/i18n/` — i18next/react-i18next, inglés + portugués, solo selector
manual (sin auto-detección de locale del dispositivo), 261 claves a la
fecha de esta sesión de localización. Cualquier cadena nueva visible al
usuario (nombres de presets, texto de estado de enrutamiento, UI de
feedback) necesita entradas tanto en `src/i18n/locales/en.json` como en
`pt.json` para mantenerse consistente con el resto de la app — el pase
i18n anterior tuvo brechas específicamente donde las cadenas vivían en
literales de objeto a nivel de módulo en lugar de texto JSX, algo que vale
recordar cuando la UI de enrutamiento añada sus propios mapas de
etiquetas de estado.

## 8. UI de selección de modelo

`ModelSetupScreen.tsx` (Configuración) y `SetupWizardScreen.tsx`
(primer arranque) ya tienen UI de gestión de modelos (descargar, activar,
eliminar). `ModelBrowser.tsx` + `ModelCatalogScreen.tsx` manejan la
búsqueda de Hugging Face. **La capa de enrutamiento debería leer/escribir
este estado de gestión de modelos existente, no introducir un segundo** —
p. ej. "asignar este modelo ya descargado al rol `reasoning`" es una nueva
relación sobre los datos existentes de `CatalogModel`/`discoveredModels`,
no un nuevo registro de modelos.

## 9. Manejo de errores y reseteo

`src/ui/components/ModelLoadErrorCard.tsx` clasifica errores de carga
crudos en unos pocos buckets (descarga corrupta, archivo faltante,
probable OOM, genérico) con acciones de reintentar/Configuración/
Asistente-de-inicio. `src/services/appReset.ts` hace un borrado total de
datos (descarga ambos motores primero, ya que mantienen los archivos de
modelo abiertos vía mmap — borrar bajo un contexto vivo es un patrón malo
conocido en la historia de este codebase). Cualquier almacenamiento local
nuevo (config de enrutamiento, telemetría, feedback) debe incluirse en la
lista de borrado de `resetAllAppData()`.

## 10. Carga concurrente de modelos — ver §3

Confirmado: **no.** Un contexto de generación, un contexto de embedding,
ambos singletons. Los planes de enrutamiento multi-modelo se ejecutan
secuencialmente.

## 11. Disponibilidad de métricas de memoria/runtime

`modules/ram-monitor` (módulo nativo) expone `getMemoryInfo()` (RSS del
proceso) y `getDeviceTotalRamBytes()`. `src/services/telemetry.ts` ya
rastrea pico RSS por consulta (`trackPeakRss`) y pico RSS de vida de la
app (`startAppMemoryTracking`), además de stats por consulta (tokens
generados, duración, tiempo al primer token, tokens/seg) vía
`recordQueryStats`/`getLastQueryStats`. **Esta es infraestructura real
sobre la que el `ExecutionTelemetry` de la Fase 7 debería construir, no
duplicar** — tokens/seg y TTFT ya se miden por generación en el `send()`
de `ChatScreen.tsx`.

Aún no existen datos benchmark de "tokens/seg estimados" o "memoria
estimada" por modelo — `ModelCapabilities.estimatedMemoryMb`/
`estimatedTokensPerSecond` tendrían que ser curados a mano por entrada del
catálogo (aproximados, mismo espíritu que la heurística existente de
insignia de compatibilidad RAM en `CatalogItemCard.tsx`) o derivados del
historial registrado de `telemetry.ts` una vez haya suficientes
ejecuciones reales — la guía de la propia Fase 8 del plan ("no inventar
mediciones de memoria") aboga por empezar con lo segundo, diferido, en
lugar de fabricar números.

## 12. Mecanismo de almacenamiento más seguro para config de enrutamiento / telemetría / feedback

Existen dos mecanismos, cada uno para una necesidad distinta:

- **`settings.ts` (archivo JSON)** — config pequeña, singular, con forma
  editable por humanos: preset activo, asignación de modelo por rol,
  toggle de telemetría habilitada. Coincide con las necesidades de Fase 2/9.
- **SQLite (`src/rag/db.ts`)** — registros estructurados, consultables,
  crecientes con claves foráneas naturales hacia `chat_messages`/
  `chat_sessions`. Coincide con las necesidades de Fase 6
  (`AnswerFeedback`) y Fase 7 (`ExecutionTelemetry`) — nuevas tablas
  (`answer_feedback`, `execution_telemetry`) siguiendo el patrón exacto
  ya usado para `custom_collections`, con la misma estructura
  abrir-una-vez-perezoso/migrar-al-abrir de `db.ts` (verificación
  `PRAGMA table_info` antes de `ALTER TABLE`, como ya se hace para
  `chunks.collection_id`).

Ambos mecanismos ya están cableados en la ruta de borrado de
`appReset.ts` (eliminación de archivo JSON, `resetDatabase()`) — las
nuevas tablas/campos necesitan añadirse a esa lista, no una nueva ruta de
eliminación.

## 13. Cambio de modelo — ¿recrea los contextos de inferencia?

Sí, siempre, por diseño: `load()` llama incondicionalmente a `unload()`
(salvo que el mismo archivo ya esté cargado, por la guarda no-op añadida
en esta sesión). Esto es correcto/necesario dado §3 — no hay forma de tener
dos contextos de generación residentes, así que cambiar de modelo siempre
significa liberar memoria nativa del anterior y hacer mmap del nuevo
desde disco. Un plan de enrutamiento que alterne entre dos modelos
mapeados a roles en la misma consulta pagará este costo cada vez que
cambie — vale la pena exponerlo en `ExecutionTelemetry` como una métrica
distinta de "model-switch-ms" para que sea visible en lugar de inflar
silenciosamente los números de latencia por paso.

## 14. Cancelación, timeouts y backgrounding

- **Cancelación**: `ChatScreen.tsx` rastrea la promesa `send()` en vuelo
  (`sendTaskRef`) y una bandera `stopRequestedRef`;
  `stopAndAwaitGeneration()` fija la bandera, llama a
  `llamaEngine.stop()`, y espera la promesa real — añadido en esta sesión
  tras descubrir que cambiar de sesión antes no esperaba a que la
  generación realmente se detuviera, causando bugs de estado obsoleto.
  El `runDeepResearch` de Deep Research verifica `shouldStop()` entre
  etapas (también en esta sesión) ya que `llamaEngine.stop()` por sí solo
  solo detiene la *única* completion actual, no un pipeline multi-paso.
- **Timeouts**: **no existen en ningún lugar del codebase.** Ningún
  presupuesto de timeout por generación o por paso.
  `InferenceBudget`/`RoutingStep.timeoutMs` (Fase 3) es completamente
  nuevo — necesita un `Promise.race` contra un temporizador envolviendo
  `llamaEngine.generate()`, más una decisión sobre qué hace el "timeout"
  a una completion en streaming ya emitiendo tokens (llamar a `stop()`
  a mitad de stream es el único mecanismo existente; un timeout limpio
  probablemente debería hacer solo eso, reutilizando la ruta de parada en
  lugar de inventar un segundo mecanismo de cancelación).
- **Backgrounding**: **no se maneja en absoluto.** Ningún listener
  `AppState` en ningún lugar de la app. Los propios comentarios doc de
  `ModelManager` citan "app en background... a mitad de transferencia"
  como causa conocida de descargas truncadas, pero nada detecta ni reacciona
  actualmente al backgrounding para la generación de chat, la ejecución de
  enrutamiento, o nada más. Esta es una brecha real preexistente que la
  restricción del plan de construcción ("cancelable y consciente de
  recursos... no implementar... inferencia en background inesperada")
  implícitamente asume manejada — aún no lo está. Vale una decisión: ¿el
  backgrounding debería auto-detener una generación/pipeline en vuelo (lo
  más seguro, coincide con "sin inferencia en background inesperada"), o
  simplemente dejarla seguir (más simple, pero con riesgo de que el OS
  mate el proceso a mitad de generación por presión de memoria sin estado
  limpio)? Recomiendo auto-detener, igualando la ruta existente de
  `stopAndAwaitGeneration` — diferido a la fase que añada el motor de
  ejecución, ya que es el primer lugar donde una parada en background
  realmente tiene estado multi-paso que proteger.

## Resumen: sobre qué construye la Fase 1+, sin cambios

- Un único contexto de generación + un único contexto de embedding
  (ejecución solo secuencial, confirmado necesario, no solo recomendado).
- El pipeline Deep Research de `orchestrator.ts` es el precursor existente
  más cercano al motor de ejecución — generalizar su forma, no reemplazarlo
  directamente.
- `telemetry.ts` ya mide las métricas centrales por generación que la Fase
  7 necesita; extender, no duplicar.
- `settings.ts` (JSON) para config de enrutamiento, SQLite para
  feedback/telemetría — coincide exactamente con las convenciones de
  elección de almacenamiento existentes en este codebase.
- Aún no existen mecanismo de timeout ni manejo de backgrounding — ambos
  son trabajo nuevo, no brechas de esta auditoría.

## Estado

**Fase 0 (este documento) y Fase 1 (`src/routing/types.ts`): hechas.**

**Fase 2 — perfiles de modelo y presets: hecha**, solo capa de config, sin
UI aún (según el propio phaseado del plan — la Fase 9 añade la UI):

- `src/models/compatibility.ts` — la heurística de ajuste RAM extraída de
  `CatalogItemCard.tsx` para que la UI del catálogo y la resolución de
  enrutamiento compartan una fórmula en lugar de divergir.
- `CatalogModel.capabilities?: ModelCapabilities`
  (`src/models/manifest.ts`) — curado a mano según §1: Phi-3.5-mini →
  `general`+`reasoning`, Qwen2.5-1.5B → `fast`, Qwen2.5-7B →
  `reasoning`+`verifier`, bge-small → `embedding`. Ausente para modelos
  descubiertos/de búsqueda de Hugging Face — no verificados igual.
- `src/routing/profiles.ts` — `ModelProfile`, `PRESET_DEFINITIONS`
  (Simple/Balanced/Research/Custom, como datos, no lógica de ejecución),
  `resolveModelForRole()`/`buildModelProfiles()`. Orden de resolución:
  override del usuario (si está presente en disco) → coincidencia curada
  del catálogo (si está presente) → fallback al modelo por defecto activo
  → perfil explícitamente deshabilitado, nunca una ruta silenciosa a un
  modelo no disponible. `simple` solo necesita el rol `general` —
  deliberadamente casi idéntico al chat de un solo modelo existente hoy,
  así un usuario que nunca toque la configuración de enrutamiento no ve
  ningún cambio de comportamiento.
- `src/models/settings.ts` — `routingPreset` (por defecto `"simple"`) y
  `modelRoleAssignments`, mismo patrón de archivo JSON que
  tema/personalidad/idioma.
- Tests: `src/routing/profiles.test.ts`, 10 casos. Detectó un bug real
  durante la escritura: `resolveModelForRole` buscaba en el import global
  de `MODEL_CATALOG` en lugar de la lista inyectada `available` —
  corregido antes de que saliera.

**Prerrequisito de seguridad de runtime (solicitado antes de la Fase 3):
hecho.**

- **Timeout**: `LlamaEngine.generate()` ganó `timeoutMs`/`onTimeout`
  (`src/inference/LlamaEngine.ts`) — reutiliza la ruta exacta de parada
  limpia existente (`context.stopCompletion()`), sin segundo mecanismo de
  cancelación. No aplicado al chat regular de un solo pase (ya acotado
  indirectamente por `nPredict`, y un timeout arbitrario ahí arriesga
  cortar una generación legítima lenta-pero-funcionando en un teléfono
  débil). Aplicado a las tres etapas de Deep Research de `orchestrator.ts`
  como red de seguridad de 2 minutos, no como objetivo de rendimiento
  (`STAGE_TIMEOUT_MS`) — ese pipeline antes tenía cero techo de tiempo en
  sus varias llamadas secuenciales. `ResearchResult.timedOut` expone si
  alguna etapa lo alcanzó; `ChatScreen.tsx` muestra una insignia en el
  mensaje afectado ("⏱ stage timed out") en lugar de dejar una respuesta
  silenciosamente truncada sin explicación.
- **Backgrounding**: `ChatScreen.tsx` ahora se suscribe a `AppState` —
  pasar a `"background"` mientras una generación/pipeline está en vuelo
  llama al mismo `stopAndAwaitGeneration()` que ya usa el botón Stop (sin
  nueva ruta de cancelación), luego marca el mensaje interrumpido con una
  insignia distinta ("⏸ paused, app was backgrounded") para que se lea
  como explicado-y-reintentable, no roto. Este es el primer manejo de
  AppState en cualquier lugar de la app.

**Sin resolver / diferido, a propósito:**

- No se aplica timeout a la generación de chat regular (no Deep Research)
  — revisar una vez que el `InferenceBudget` de la Fase 3 dé un valor por
  tarea con fundamento en lugar de una constante arbitraria.
- La política de backgrounding es "siempre cancelar", según la
  recomendación explícita del compañero. Aún no configurable — no hay
  ajuste para cambiar este comportamiento.
- `estimatedTokensPerSecond`/`estimatedMemoryMb` en `ModelCapabilities`
  siguen sin fijar para todos los modelos curados — aún no existen datos
  benchmarkeados (ver §11); sigue correctamente diferido en lugar de
  inventado.

El typecheck y la suite completa de tests (32 tests) pasan. Aún no probado
en un dispositivo real — el comportamiento de cancelación en background en
particular debería verificarse a mano (poner la app en background a mitad
de generación, confirmar que aparece la insignia y que el contexto del
modelo realmente se libera, no solo que la promesa se resuelve).

**Fase 3 — política de enrutamiento determinista: hecha.**

- `src/routing/classify.ts` — `classifyTask()` basado en reglas,
  deliberadamente no una llamada LLM según el plan ("no pedir inicialmente
  a un LLM que invente libremente un pipeline"). Lista ordenada de
  patrones (compare/summarize/translate/code/calculate/extract verificados
  antes que los fallbacks más amplios de lookup/research/chat) — una
  consulta que coincida con dos patrones toma el más específico, p. ej.
  "research the tradeoffs of X versus Y" clasifica como `compare`, no
  `research`. 11 tests.
- `src/routing/router.ts` — `planRoute(context): RoutingPlan`, puro y
  determinista (sin I/O, la misma entrada siempre produce la misma salida
  — afirmado directamente en los tests). Implementa cada regla explícita
  del plan: tarea simple → rol fast/general; recuperación omitida para
  calculate/translate/code; tarea compleja o tipo research/compare → rol
  reasoning sin importar el preset; verificación solo para tareas
  research/compare del preset research con evidencia recuperada *y* un
  modelo verifier distinto del generador (pedir a un modelo que califique
  su propia respuesta no es verificación); modelo preferido faltante →
  cadena de fallback elegante por rol, nunca un plan vacío/roto;
  dispositivo en estado de bajo consumo → fuerza el rol `fast` y limita el
  presupuesto de tokens, prevaleciendo sobre tarea/preset. `reasonCodes`
  en cada plan explican cada decisión tomada (recuperación omitida y por
  qué, qué rol se resolvió a qué modelo, por qué la verificación corrió o
  no) — esta es la superficie de "explicar decisiones de enrutamiento"
  de la Fase 9, llegando antes porque el router ya necesitaba justificar
  sus propias decisiones para ser testeable. 15 tests, incluyendo uno que
  afirma que dos llamadas `planRoute()` con entrada idéntica producen un
  plan deep-equal.

**Fase 4 — motor de ejecución: hecha.**

- `src/routing/executor.ts` — `executeRoutingPlan(plan, input, resolveModel,
  callbacks)` ejecuta los pasos de un RoutingPlan en orden contra el
  `llamaEngine`/`retrieve()` real. Generaliza la forma de bucle de pasos
  existente de orchestrator.ts (shouldStop verificado entre cada paso,
  timeout por paso reutilizando el mismo `timeoutMs`/`onTimeout` que
  LlamaEngine ganó para el trabajo de seguridad de runtime) en lugar de
  inventar un patrón distinto — orchestrator.ts en sí no se toca, el Modo
  Deep Research sigue funcionando exactamente como antes; esto es
  infraestructura nueva y separada junto a él, no un reemplazo.
  - La carga de modelos es secuencial y consciente de cambios:
    `ensureModelLoaded` solo llama a `llamaEngine.load()` cuando el modelo
    del paso realmente difiere del residente, y cuenta los cambios
    genuinos en `modelSwitches` del resultado — el costo real que el
    compañero pidió hacer parte del presupuesto de enrutamiento, ahora
    visible por ejecución en lugar de implícito.
  - `resolveModel` se inyecta (un callback `(modelId) => ExecutableModel |
    undefined`), no importado de `MODEL_CATALOG` directamente — la misma
    lección del bug de la Fase 2 (un global hardcodeado en lugar de datos
    inyectados rompe tanto la testabilidad como la corrección para
    modelos descubiertos/personalizados).
  - La verificación está basada en evidencia, no es "preguntar si es
    correcto": el prompt del paso de verificación pregunta
    específicamente si las afirmaciones de la respuesta están respaldadas
    por los chunks recuperados, parseado desde un formato de respuesta
    restringido SUPPORTED/PARTIAL/UNSUPPORTED a
    `passed`/`uncertain`/`failed`; una respuesta fuera de formato es
    `uncertain` (un resultado real y honesto — no un bug), y ninguna
    evidencia recuperada es `not_applicable` en lugar de una verificación
    sin sentido.
  - 9 tests, corridos contra un `llamaEngine`/`retrieve()` **mockeado**
    (`vi.mock`) — `assemblePrompt`/`ConversationHistory` se importan
    directamente del `rag/pure.ts` libre de módulos nativos en lugar de
    `rag/retrieve.ts`, así solo `retrieve()` necesita mock. Esto prueba
    que la lógica de orquestación (modelo correcto cargado por paso,
    cambios de modelo contados correctamente, fallo de paso requerido
    aborta limpio, fallo de paso opcional solo salta, parseo de
    verificación) es correcta — **no** prueba que la inferencia real de
    Phi/Qwen funcione end-to-end, lo cual este sandbox no puede correr (sin
    dispositivo Android conectado aquí).

**Límite de alcance — leer antes de asumir que esto está en vivo:** la Fase
3 y la 4 existen como infraestructura completa, testeada e independiente.
**Nada en `ChatScreen.tsx` llama aún a `planRoute`/`executeRoutingPlan`**
— el flujo de envío de chat existente y el Modo Deep Research están ambos
completamente sin cambios. Conectarlo a la UI de chat en vivo es una
decisión real y separada (toca la ruta principal de chat que recorre cada
usuario) que aún no se tomó — eso es territorio de la Fase 9 (UI/UX), y
según todo el patrón de esta rama hasta ahora, vale la pena hacerlo
deliberadamente con verificación en dispositivo real de la ruta de
enrutamiento/ejecución primero, no plegarlo en "construir el motor".

El typecheck y la suite completa de tests (68 tests en total, desde 32)
pasan.

**Fix de backgrounding de descargas (no relacionado con Fases 3/4, mismo
tema de seguridad de runtime): hecho.**

El fix de bloqueo de descarga obligatoria (timeout de inactividad + UI de
reintento, commiteado antes) tenía una brecha detectada por pruebas a
mano: poner la app en background durante una descarga se veía idéntico a
un bloqueo real desde el punto de vista de `ModelManager` (los propios
docs de expo-file-system: los callbacks de progreso "no se dispararán
hasta que vuelva a foreground"), así que el temporizador de inactividad
se disparaba — pero entonces **cancelaba y borraba** el archivo parcial,
así que volver a la app significaba reiniciar una descarga de varios GB
desde 0%.

- `ModelManager.downloadCatalogModel` ahora **pausa** en timeout en lugar
  de cancelar+borrar, manteniendo el handle `DownloadResumable` en un mapa
  `pausedDownloads` con clave asset id. Una llamada posterior para el mismo
  asset reutiliza ese handle y llama a `resumeAsync()` en lugar de empezar
  de cero — los fallos genuinos (no timeout) siguen tratándose como
  irrecuperables y limpian el archivo parcial como antes.
- `SetupWizardScreen.tsx` ahora auto-reintenta (`retryFailedDownloads()`)
  cuando `AppState` vuelve a `"active"` y existe un asset fallido/pausado,
  así el usuario no tiene que notar la tarjeta de error y tocar Reintentar
  manualmente tras volver a la app — se reanuda solo.
- Aviso explícito de "mantén NIDO abierto" añadido al Paso 3 mientras una
  descarga está activa, ya que la descarga verdadera en background
  necesitaría un Foreground Service nativo de Android — un costo
  desproporcionado para una descarga de configuración única — así que el
  fix honesto es pausa/reanudación elegante, no prometer silenciosamente
  progreso en background que no ocurre.

El typecheck y la suite completa de tests (68 tests) siguen pasando. Aún
no verificado a mano: si `resumeAsync()` en un dispositivo real continúa
realmente desde el offset de bytes pausado como se espera (el código trata
defensivamente tanto un error de timeout lanzado como un `resumeAsync()`
resolviendo a `undefined` como el mismo resultado de pausa, ya que la
propia firma de tipos de expo-file-system solo documenta `undefined` para
"cancelado" — la forma exacta de resolución de pausa no se confirmó contra
un dispositivo real en este sandbox).

**Nuevo `TaskType`: `"greeting"`, y un estrecho salto de recuperación en
la ruta viva (primer cruce real del límite de alcance ChatScreen ↔
enrutamiento): hecho.**

Las pruebas a mano de "wake up!" detectaron una brecha real en ambos
lados: la ruta de chat en vivo (`ChatScreen.tsx` `send()`) llama a
`retrieve(query)` incondicionalmente para *cada* mensaje, con cero
clasificación — nunca llamaba a `classifyTask`/`planRoute`, así las
propias reglas del router nunca se aplicaban. Pero trazar lo que
`planRoute` *habría* hecho reveló que el router tenía la misma brecha:
`retrievalIrrelevant` solo excluía `calculate`/`translate`/`code` — un
saludo simple clasificado `"chat"` seguía recuperando también en el módulo
no cableado.

- Añadido un `TaskType` `"greeting"` (`src/routing/types.ts`),
  deliberadamente **no** plegado en el fallback existente `"chat"` —
  `"chat"` es un bucket amplio que también atrapa peticiones informativas
  reales fraseadas como comandos ("Tell me about black holes"), que deben
  seguir recuperando. Solo la charla social pura (una regex anclada que
  coincida con la consulta recortada *completa* — "hi, can you compare X
  and Y" no debe coincidir) clasifica como `"greeting"`.
- `classify.ts` ganó `isRetrievalIrrelevant(taskType)` — la regla de
  omisión para calculate/translate/code/greeting, ahora definida en
  exactamente un lugar en lugar de inlineada en `router.ts`.
- El `retrievalIrrelevant` y `preferredRole` de `router.ts` (greeting →
  siempre rol `"fast"`, incluso bajo el preset `"research"`) ahora la
  usan.
- **El `send()` vivo de `ChatScreen.tsx` también la usa ahora** — un
  cambio estrecho y aditivo, no el router completo: `classifyTask(query)`
  regula la llamada incondicional existente a `retrieve()`, nada más
  cambia (selección de modelo, conteo de pasos, verificación siguen
  intactos — esos aún requieren la decisión deliberada de cableado de
  `planRoute`/`executeRoutingPlan` descrita arriba, que sigue diferida).
  Este es el primer lugar donde código del módulo de enrutamiento corre
  contra tráfico de chat real, pero es un único `if` alrededor de una
  llamada existente, no la decisión de cruce del límite de alcance en sí.
- Tests de regresión: `classify.test.ts` (detección de greeting, el caso
  de desambiguación chat-vs-greeting, `isRetrievalIrrelevant`) y
  `router.test.ts` (greeting omite recuperación, prefiere rol `"fast"`
  bajo cada preset, produce un único paso generate sin verificación —
  modelando directamente la traza de "wake up!"). 73 tests en total,
  desde 68.

**Seguimiento: arreglar la recuperación no arregló la respuesta real —
acciones alucinadas rastreadas y corregidas (`assemblePrompt` de
`rag/pure.ts`): hecho.**

Con la recuperación correctamente omitida, las pruebas en dispositivo real
detectaron el problema más profundo: "wake up" → *"morning alarm set to
standard wake up / room temperature adjusted."* — una acción fabricada;
NIDO no tiene ninguna capacidad de alarma ni smart-home. Rastreados el
prompt final exacto enviado a Phi para esta entrada (sin chat template en
uso en ningún lado — ver el comentario `DEFAULT_STOP_SEQUENCES` de
`LlamaEngine.ts`, `assemblePrompt` construye a mano una forma genérica de
completion `"...Question: <query>\n\nAnswer:"`, no la plantilla real
fine-tuneada de Phi-3.5 `<|system|>/<|user|>/<|assistant|>`). Causa raíz:
combinación de (a) la forma de prompt fuera de plantilla, que deja a un
modelo pequeño asociar libremente hacia una continuación narrativa en
lugar de una respuesta de chat aterrizada ante entradas cortas,
ambiguas, con forma de comando, y (b) ninguna instrucción en ningún lado
diciendo al modelo que no tiene capacidades en el mundo real o que la
charla casual debería recibir una respuesta conversacional en lugar de
una respuesta de "tarea".

Fix: una `GROUNDING_INSTRUCTION` universal en `assemblePrompt`, siempre
añadida sin importar persona/contenido — **no** una respuesta hardcodeada
a ninguna frase específica. Declara que NIDO no puede controlar
dispositivos del mundo real ni tomar acciones físicas, que la charla
casual debería recibir una respuesta conversacional breve, y que nunca
debe afirmar haber hecho algo que realmente no puede hacer.
`assemblePrompt` es compartido con la etapa `researchSubQuestion` de Deep
Research (`orchestrator.ts`) — deliberadamente no duplicado en dos
versiones, ya que la instrucción es no-op para preguntas genuinas (las
sub-preguntas descompuestas de Deep Research nunca son peticiones de
acción), así el comportamiento real de Deep Research no se ve afectado.

Cambiar a la plantilla de chat real de Phi-3.5 probablemente ayudaría más
pero es un cambio mayor y separado (toca la forma exacta del prompt de
Deep Research y el comportamiento de stop-tokens también) — identificado
como factor contribuyente y deliberadamente diferido, no intentado en este
pase.

Tests de regresión: `rag/pure.test.ts` (instrucción de grounding presente
sin importar persona/contexto/historial) y `classify.test.ts` (las tres
entradas de dispositivo real — "hey!", "what's up?!", "wake up" — todas
clasifican como `"greeting"`; "turn on the lights" NO, ya que es una
petición de acción genuina, no charla, y debe seguir por la ruta normal
donde la instrucción de grounding — no la clasificación — es lo que
detiene una afirmación de éxito falsa; "tell me about black holes" sigue
siendo "chat", no "greeting"). 78 tests en total, desde 73.

**Seguimiento: el salto de recuperación fue insuficiente para saludos
compuestos, y una sección de contexto vacía-pero-presente filtraba
enmarcado incluso cuando no lo había: hecho.**

Las pruebas en dispositivo real de "hey, what's up?" detectaron dos
brechas compuestas:

1. La detección de greeting de `classifyTask` era una única regex anclada
   que coincidía con UNA frase literal de extremo a extremo — "hey, what's
   up?" (dos frases unidas por coma) nunca coincidía con ninguna
   alternativa individual, así que clasificaba como `"chat"`, no
   `"greeting"`. `retrieve()` por tanto seguía corriendo, y como no tiene
   piso de relevancia (siempre devuelve sus top-K híbridos, nunca cero),
   detectaba chunks de corpus esencialmente aleatorios (Pikachu,
   Deadmau5, Weezer — temas de relleno de Wikipedia) que terminaban
   citados en la respuesta.
2. Por separado, incluso con `chunks = []`, `assemblePrompt` seguía
   emitiendo una sección `"Context:\n\n"` vacía-pero-presente más la
   instrucción "cite sources as [n]" — enmarcado colgante que le dice a un
   modelo pequeño que se supone que hay algo ahí.

Fixes, ambos en `src/routing/classify.ts` / `src/rag/pure.ts`:

- `classifyTask` ahora divide la consulta por coma/punto y coma/`"and"` y
  requiere que cada segmento resultante coincida independientemente con una
  frase de saludo conocida (`isGreeting`, no exportada — un detalle de
  implementación de `classifyTask`) — generaliza a cualquier combinación de
  las frases conocidas ("hey, what's up?", "hi, how are you?") sin
  hardcodear cada combinación como su propia cadena literal, y sigue
  rechazando correctamente un saludo con una petición real añadida ("hi,
  can you compare X and Y?", "hey, turn on the lights").
- `assemblePrompt` ahora omite toda la sección de contexto/citación (no
  solo la lista de chunks) cuando `chunks` está vacío, para cualquier tipo
  de tarea — no específico de greeting, así también limpia prompts para
  calculate/translate/code y cualquier consulta clasificada `"chat"` para
  la que `retrieve()` genuinamente no encontró nada relevante.
- Confirmado (y grepeado) que no hay un pipeline de contexto de memoria
  separado/incondicional en ningún lado de `ChatScreen.tsx` — `retrieve()`
  es el único call site, ya regulado. El historial de conversación
  (parámetros `summary`/`turns` de `assemblePrompt`) es un mecanismo
  completamente separado e incondicional, intacto por todo esto — "what
  did I just tell you?" sigue funcionando exactamente como antes.

Tests de regresión: `classify.test.ts` (los saludos compuestos clasifican
correctamente; una petición real añadida a un saludo aún lo descalifica)
y `rag/pure.test.ts` (un test end-to-end que refleja la lógica de decisión
exacta del `send()` de `ChatScreen` para "hey, what's up?" — afirma que el
prompt final no tiene sección `"Context:"`, ni instrucción de citación, ni
contenido de chunk filtrado, mientras el historial de conversación pasado
junto a él aún aparece). 82 tests en total, desde 78. El Modo Deep
Research (`orchestrator.ts`) no se tocó.

**Seguimiento: validada la propia capa de relevancia de recuperación,
antes de la integración completa del router adaptativo: hecho.**

Inspeccionado el scoring real de `src/rag/retrieve.ts` (no asumido) antes
de cambiar nada. Hallazgos:

- **La búsqueda semántica ya tenía un piso de score crudo**:
  `MIN_SEMANTIC_SIMILARITY = 0.45`, aplicado a la similitud coseno antes de
  que cualquier chunk sea devuelto por `semanticSearch`. Dejado sin cambios
  — no hay un runtime real de bge-small-en-v1.5 disponible en este sandbox
  para medir la distribución real de scores de este corpus, y mover un
  umbral existente previamente justificado sin evidencia real sería
  exactamente el error contra el que advertía esta tarea.
- **La búsqueda léxica ya tenía su propia puerta, solo que no numérica**:
  la consulta se pasa al `MATCH` de FTS5 envuelta en comillas dobles, que
  es una consulta PHRASE — las palabras deben aparecer consecutivas, en ese
  orden, en el texto indexado. El galimatías o un fraseo no coincidente
  devuelve cero filas, no una coincidencia débil; cada fila que *sí* vuelve
  ya superó esa barra. No se añadió umbral adicional de magnitud bm25
  encima — la escala cruda de bm25 depende de corpus/consulta y no está
  medida aquí, y añadir un cutoff inventado arriesga descartar
  coincidencias genuinas de frase exacta (viola "no descartar agresivamente
  resultados potencialmente útiles") sin beneficio evidenciado.
- **La brecha real**: nada de esto estaba testeado, y el score *fusionado*
  (híbrido) que devolvía `retrieve()` era un número relativo
  max-normalizado — significativo como ranking dentro de los resultados de
  una consulta, sin sentido como señal de confianza absoluta (normalizar
  al propio máximo de cada fuente significa que el top hit de CUALQUIER
  consulta, incluido galimatías puro, siempre se ve "confiado" respecto a
  sí mismo). Un piso tiene que aplicarse a scores crudos, antes de la
  normalización — lo cual las puertas semántica/léxica ya hacen; la fusión
  nunca fue el lugar donde un piso pudiera vivir con sentido.

**Fix, no un nuevo umbral — extracción + tests**: `MIN_SEMANTIC_SIMILARITY`,
`filterByMinScore()` y `fuseRetrievalResults()` movidos a `rag/pure.ts`
(libres de módulos nativos, mismo patrón que `assemblePrompt`), así la
mecánica de fusión y piso es unit-testeable independientemente sin un
dispositivo real. `retrieve.ts` ahora los llama en lugar de duplicar la
lógica inline — el comportamiento externo (la firma de `retrieve()` y lo
que devuelve) no cambia, esto es un refactor para testabilidad, no un
cambio de política.

Nuevo `src/rag/retrieve.relevance.test.ts` (9 tests, scores sintéticos —
sin embeddings/bm25 reales disponibles aquí, así que estos validan la
mecánica de política del CÓDIGO, no el comportamiento real del corpus para
consultas específicas): un piso excluye correctamente por debajo/mantiene
en-o-sobre; todo-bajo-el-piso produce vacío (la forma de consulta de
galimatías); una coincidencia de una sola fuente sobrevive la fusión sin
corroborar (el requisito de fraseo débil/parcial); un acuerdo de dos
fuentes promueve a `"hybrid"` y supera a coincidencias de una sola fuente;
topK se respeta; pesos configurables funcionan; la fusión es determinista.

91 tests en total, desde 82 (la línea base solicitada). Modo Deep Research
intacto. **No verificado en este pase**: las consultas de ejemplo
específicas ("what is a black hole?", "explain photosynthesis",
"asdfghjkl qwerty", "tell me something") contra el modelo bge-small real
y este corpus en un dispositivo real — no existe runtime en dispositivo en
este sandbox para calcularlo. Vale la pena hacerlo a mano en un dispositivo
real como seguimiento, idealmente con logging de scores añadido
temporalmente para capturar distribuciones reales antes de considerar si
el propio `MIN_SEMANTIC_SIMILARITY` debería moverse.

**Fase 9 (+ instrumentación mínima de telemetría) — conectar `planRoute`/
`executeRoutingPlan` al chat ordinario: hecha, tras feature flag, apagada
por defecto.** Ver el reporte completo en la conversación para archivos/
flujo exactos — resumen aquí:

- Nuevo `src/services/adaptiveChat.ts` (`runAdaptiveChat`) es el ÚNICO
  punto nuevo de integración: resuelve presencia de modelos en
  dispositivo, preset de enrutamiento/overrides y RAM del dispositivo,
  luego corre classify → planRoute → executeRoutingPlan, reutilizando las
  Fases 3/4 completamente sin modificar.
- El `send()` de `ChatScreen.tsx` (rama no-Deep-Research) lo llama tras
  un nuevo ajuste `getAdaptiveRoutingEnabled()` (por defecto `false`). La
  rama del Modo Deep Research no se toca — ruta de código separada, nunca
  llama a `runAdaptiveChat`.
- Fail-safe por construcción: una excepción lanzada O una respuesta vacía
  sin cancelación ambas hacen fallback a la ruta fija de modelo activo
  preexistente exacta (`runFixedModelChat`, extraída verbatim del código
  previo, no reescrita) — un fallo de enrutamiento o "nada disponible"
  nunca deja al usuario sin respuesta.
- Restricción de un solo modelo residente sin cambios — los cambios de
  enrutamiento siguen pasando por el mismo `LlamaEngine.load()`/
  `ensureModelLoaded` de `executor.ts` que ya gobierna esto en todos lados;
  nada aquí permite dos modelos residentes a la vez.
- Telemetría mínima, solo en memoria (los `QueryStats` de `telemetry.ts`,
  nuevos campos opcionales — no el `execution_telemetry` persistido en
  SQLite que describe la Fase 7): `adaptiveRoutingUsed`, `modelId`,
  `taskType`, `reasonCodes`, `modelSwitches`, `retrievalUsed`,
  `generationLatencyMs`, `totalLatencyMs` (ahora registrado para cada ruta,
  no solo adaptativa), `outcome`. Deliberadamente no la Fase 7 en sí —
  sin persistencia, sin nueva tabla DB, según la instrucción explícita de
  "detenerse tras la Fase 9".
- UI de Configuración: nuevo toggle "Adaptive Routing (Experimental)" en
  `PersonalitySettings.tsx`, mismo patrón/estilo que el toggle existente
  de Deep Research.
- Tests: `src/services/adaptiveChat.test.ts`, 8 casos (greeting → sin
  recuperación + modelo fast; chat → modelo fast + recuperación; research
  → modelo reasoning, bajo el preset "research" específicamente —
  "balanced"/"simple" ni siquiera declaran un slot de rol reasoning; rol
  preferido no disponible → fallback elegante, sin respuesta vacía; cambio
  de modelo entre dos peticiones → llamadas reales a
  `LlamaEngine.load()`; `shouldStop` ya true → el modelo nunca se carga;
  nada instalado en absoluto → respuesta vacía con `reasonCodes`
  explicando por qué, no un throw; propagación de callbacks). 99 tests en
  total, desde 91.
- **Brecha de alcance conocida y divulgada**: `routingPreset` por defecto
  es `"simple"` (default preexistente, sin cambios) y aún no hay UI para
  cambiarlo — solo el preset "research" declara siquiera un slot de rol
  `reasoning`, y "balanced" es necesario para desbloquear el rol `fast`.
  Encender solo el nuevo toggle, con el preset dejado en `"simple"`, solo
  resuelve al rol `general` (efectivamente el mismo modelo único de hoy)
  — el cambio real de modelos requiere fijar manualmente `routingPreset`
  vía `settings.ts` por ahora (sin UI de selector construida en este
  pase, fuera de alcance según la instrucción de "mantenerlo mínimo").
- **No hecho, deliberadamente**: Fase 7 (`ExecutionTelemetry`
  persistente/etiquetado por modelo), Fase 8 (mejora de enrutamiento
  basada en feedback), cualquier display UI de los nuevos campos de
  telemetría (no tocado — se evitó `UsageStatsContent.tsx`, editado
  concurrentemente por otra sesión), una UI de selector de
  `routingPreset`, verificación en dispositivo real.

**Seguimiento (0c19812): las decisiones de enrutamiento adaptativo ahora
salen en Usage Stats** — nueva tarjeta "LAST ADAPTIVE ROUTING DECISION"
(modelo usado, tipo de tarea, recuperación usada, cambios, latencia,
resultado), mostrada solo cuando el último mensaje realmente pasó por
`runAdaptiveChat`. La brecha de arriba ahora está cerrada.

**Seguimiento: las pruebas en dispositivo real detectaron un bug de
calidad de generación, corregido estrechamente (las decisiones de
enrutamiento en sí sin cambios).** Primera prueba en dispositivo de
enrutamiento adaptativo — `"whats up?"` — produjo un divague largo de
asociación libre y multi-pregunta de Qwen2.5-1.5B (preguntas de
seguimiento inventadas no relacionadas, emoji, ~4 "turnos" falsos).
Causa raíz en dos causas compuestas y divulgadas, ambas corregidas:

1. **Sin chat template real.** `assemblePrompt` construye a mano una forma
   genérica de completion `"Question: ...\n\nAnswer:"` en lugar de la
   plantilla fine-tuneada real de un modelo — señalada como riesgo
   conocido cuando se corrigió la alucinación anterior de "wake up", ahora
   confirmada como issue en dispositivo real con Qwen específicamente
   (probablemente la primera vez que Qwen-1.5B genera una respuesta de
   chat real en este proyecto — Phi siempre fue el único generador antes
   de la Fase 9). Corregido vía el nuevo `assembleChatMessages()` de
   `src/rag/pure.ts` (mensajes separados por rol, mismo contenido/
   grounding que `assemblePrompt`) más el nuevo parámetro `messages` de
   `LlamaEngine.generate()`, que pasa directo al `completion({messages,
   jinja: true, ...})` de llama.rn — llama.cpp entonces aplica el
   chat_template embebido del propio GGUF cargado. Ninguna cadena de
   plantilla se escribe adivina a mano en ningún lado de esta app; el
   propio motor de plantillas de llama.cpp decide la sintaxis exacta desde
   el archivo del modelo. Consciente de modelo, no global: solo los
   `CatalogModel` con la nueva bandera
   `ModelCapabilities.usesChatTemplate` (actualmente solo
   Qwen2.5-1.5B-Instruct — `MODEL_CATALOG`) usan esta ruta; el paso
   generate de `executor.ts` ramifica en ella por paso. Phi (sin bandera)
   no se ve afectado byte por byte — confirmado por un test dedicado que
   afirma que su llamada `generate()` aún recibe un string `prompt`
   plano, no `messages`. Qwen2.5-7B tiene el mismo riesgo subyacente pero
   se dejó deliberadamente intacto (alcance más estrecho que lo
   solicitado).
2. **Sin presupuesto de tokens apropiado a la tarea.** El
   `effectiveMaxTokens` de `router.ts` solo escalaba hacia abajo para
   modo de bajo consumo — un greeting recibía exactamente el mismo
   presupuesto (512 por defecto) que una pregunta de research, sin nada
   que dijera al modelo "esto debería ser corto". Nuevo `GREETING_MAX_TOKENS
   = 128` limita (nunca eleva) el presupuesto específicamente para
   `taskType === "greeting"`, viviendo en la propia lógica de
   configuración de tarea de router.ts según petición explícita, no un
   hack de truncado del lado UI. `reasonCodes` gana
   `"budget:greeting-caps-tokens"` cuando aplica, misma convención que el
   reason code existente de modo de bajo consumo.

Explícitamente NO tocado: `classifyTask()`, reglas de selección de
modelo/roles, umbrales de recuperación, las declaraciones de rol del
preset "balanced", Deep Research (`orchestrator.ts`) — las *decisiones* de
enrutamiento no cambiaron, esto fue acotado como fix de calidad de
generación.

12 nuevos tests de regresión en `router.test.ts` (límite de presupuesto,
el límite nunca eleva un ajuste de usuario menor, no-greeting no afectado),
`executor.test.ts` (Phi aún recibe un string de prompt plano; Qwen recibe
un array de messages separado por rol con estructura
system/history/user), `pure.test.ts` (tests unitarios de
`assembleChatMessages`: instrucción de grounding presente, enmarcado de
contexto/citación incluido solo con chunks, historial hilado como mensajes
separados, resumen incluido), y `classify.test.ts` (la entrada exacta de
dispositivo real `"whats up?"`, sin apóstrofo, clasifica como `"greeting"`).
111 tests en total, desde 99. Typecheck limpio.

**No verificable en este sandbox**: si `getFormattedChat`/`jinja: true`
aplica realmente el chat_template embebido real de
Qwen2.5-1.5B-Instruct-GGUF como se espera en un dispositivo real — no
existe runtime nativo de llama.cpp aquí para ejecutarlo. Usar la propia
API pública y documentada de formateo de chat de llama.rn (en lugar de
escribir a mano una cadena ChatML adivinada) es el enfoque más defendible
disponible sin ese runtime, pero la confirmación en dispositivo real es el
siguiente paso.

**Seguimiento: brecha de telemetría corregida — `modelSwitches` vs. cambio
de modelo entre mensajes.** Prueba en dispositivo real: "compare Linux and
Windows" cambió correctamente de Qwen a Phi (confirmado vía "Model Used:
Phi" y calidad de respuesta), pero Usage Stats mostraba `modelSwitches:
0`, lo que se leía como bug. No era un bug de enrutamiento —
`modelSwitches` es local al plan por diseño (un solo plan necesitando
múltiples roles, p. ej. retrieve+generate+verify con un verifier distinto)
y cada llamada a `executeRoutingPlan()` empieza a contar desde un
`loadedModelId = null` fresco, así un plan de un solo paso generate
siempre reporta 0 sin importar qué estaba residente antes de que esa
llamada empezara. No había ningún campo que respondiera "¿el modelo
realmente cambió desde la petición separada anterior" en absoluto.

Añadido `PipelineResult.crossMessageModelSwitch: boolean` (`executor.ts`),
calculado desde la lectura real del filename residente de
`llamaEngine.getModelInfo()` antes y después de la ejecución — nunca una
suposición sobre lo que una petición anterior supuestamente dejó cargado.
Falso para un arranque en frío (nada residente antes — nada de lo que
haber cambiado) y falso cuando una carga falla o se omite (la residencia
genuinamente sin cambios, así sin falso positivo); verdadero para una
transición genuina Qwen<->Phi, ocurra dentro de un plan o arrastrada de
una petición separada anterior. El significado local-al-plan existente de
`modelSwitches` no cambia — ambos campos ahora coexisten, respondiendo
preguntas distintas, y están documentados como tales en el propio
`PipelineResult`. Fluye a través de `AdaptiveChatResult`
(`adaptiveChat.ts`, vía su `...result` spread existente — sin cambio
necesario ahí) hacia `QueryStats.crossMessageModelSwitch`
(`telemetry.ts`) y una nueva fila "Switched Since Last Message" en Usage
Stats (`UsageStatsContent.tsx`).

5 nuevos tests en `executor.test.ts` (el `llamaEngine.getModelInfo()`
mockeado ahora muta realmente en `load()`, reflejando el motor real, así
refleja correctamente lo que una llamada *anterior* a
`executeRoutingPlan()` dejó residente): arranque en frío -> false; Qwen
luego Phi -> true; Phi luego Phi -> false; Phi luego Qwen -> true; una
carga de modelo fallida/irresoluble deja la residencia (y por tanto el
campo) correctamente sin cambios. El test existente de `modelSwitches`
local al plan extendido para afirmar también
`crossMessageModelSwitch: false` para ese escenario (arranque en frío,
aunque el plan mismo cambie modelos internamente) — la independencia de
los dos campos está testeada en sí misma, no solo cada campo por separado.
116 tests en total, desde 111. Reglas de enrutamiento/clasificación/
selección de modelo/umbrales de recuperación/prompts de generación/Deep
Research: intactos.

**Fase 7 — telemetría de ejecución persistente, etiquetada por modelo:
hecha.** Números reales de un dispositivo real (Qwen: 13 tok/s, TTFT
reportado como 18.71s) argumentaron esto directamente — con el viejo
`ttftMs` indiferenciado (inicio de envío de mensaje a primer token), esos
18.71s podrían haber sido mayormente tiempo de carga de modelo,
mayormente procesamiento de prompt, o generación genuinamente lenta; no
había forma de saberlo, ni de comparar corridas tras una recarga ya que
`telemetry.ts` siempre fue solo en memoria.

- **Semántica de tiempos, hecha explícita y precisamente acotada**
  (`executor.ts`, `PipelineResult`): `modelLoadMs` (tiempo en
  `llamaEngine.load()` para el modelo del paso generate — 0 cuando nada
  necesitó cargarse), `ttftMs` (desde el momento en que `generate()` fue
  realmente llamado, modelo ya listo, hasta el primer token streameado —
  el tiempo de carga del modelo NO incluido), `generationLatencyMs`
  (primer token hasta que `generate()` resuelve — i.e. la duración total
  de la llamada MENOS `ttftMs`, igualando la convención `tokPerSec`
  existente de esta app). `totalLatencyMs` (sin cambios, nivel
  `ChatScreen.tsx`, el span completo de la petición). **No un renombre del
  viejo `ttftMs`/`generationLatencyMs`** — el viejo `generationLatencyMs`
  (`adaptiveChat.ts`) medía TODA la llamada `executeRoutingPlan()`
  (retrieve+generate+verify combinados) y fue eliminado por completo,
  reemplazado por el nuevo campo correctamente acotado.
- **Residencia del modelo**, capturada una vez por ejecución para el paso
  generate primario: `"cold"` (nada residente en `LlamaEngine` antes de
  esta petición), `"switched"` (otra cosa estaba residente), `"resident"`
  (ya el modelo correcto — ni siquiera se hizo llamada `load()`). También
  corrigió una ineficiencia real que esto detectó: `ensureModelLoaded`
  antes llamaba a `llamaEngine.load()` en el primer paso de cada plan
  incondicionalmente (su propio tracker `loadedModelId` por ejecución
  empieza `null` cada vez), incluso cuando el modelo objetivo ya estaba
  genuinamente residente de una petición separada anterior — ahora se
  verifica contra el estado real de `llamaEngine.getModelInfo()` primero.
  `LlamaEngine.load()` ya era no-op internamente en ese caso, así esto no
  cambia el comportamiento observable del motor, solo lo que se
  mide/llama.
- **Nuevo `src/services/executionTelemetry.ts` + `.pure.ts`** (la división
  iguala el patrón establecido de `rag/pure.ts` — `.pure.ts` tiene cero
  imports de módulos nativos, así es unit-testeable bajo vitest plano;
  `.ts` es el pegamento delgado de SQLite/sistema de archivos/sharing
  alrededor). Nueva tabla SQLite `execution_telemetry` (`rag/db.ts`,
  mismo patrón de migración que `answer_feedback`) — solo local/offline,
  **nunca almacena el prompt del usuario ni el texto de respuesta
  generado**, solo metadata de timing/modelo/tarea. El `QueryStats` en
  memoria de `src/services/telemetry.ts` queda como capa de
  compatibilidad sin modificar para el display vivo existente de Usage
  Stats (su semántica `ttftMs`/`generationLatencyMs` se corrigió igual
  para la ruta adaptativa específicamente, vía `ChatScreen.tsx`
  sobrescribiendo la medición genérica de envío-de-mensaje-a-primer-token
  con la medida precisa del executor — con cuidado de no sobrescribir el
  campo requerido `ttftMs` con `undefined` cuando no corrió ningún paso
  generate). `ChatScreen.tsx` llama tanto a `recordQueryStats` (sin
  cambios) como al nuevo `recordExecution` (fire-and-forget, incluyendo un
  registro mínimo de fallo en el bloque catch externo) tras cada mensaje —
  adaptativo, modelo fijo y Deep Research por igual.
- **Nueva pantalla dedicada** (`ExecutionTelemetryScreen.tsx`, abierta vía
  un nuevo ítem del drawer — **no** Configuración): explora corridas
  recientes (modelo, tarea, tok/s, tiempo de carga, TTFT, tiempo total,
  memoria pico, resultado, ícono de residencia), una acción "Clear", y
  exportación JSON/CSV vía `expo-sharing` (ya una dependencia, mismo
  patrón que el `exportCollection` existente de `documentImporter.ts` —
  sin nueva dependencia nativa añadida).
- **No hecho, deliberadamente**: ninguna decisión de enrutamiento/
  optimización tomada desde ninguno de estos datos aún, según instrucción
  explícita; Fase 8 no iniciada.
- Tests: 8 nuevos en `executor.test.ts` (residencia
  cold/warm/switched, timing de cambio Qwen→Phi y Phi→Qwen, ttftMs
  verificado NO inflado por un `load()` mockeado deliberadamente lento,
  generationLatencyMs verificado como la porción post-primer-token
  específicamente, timing indefinido-no-fabricado cuando no corrió ningún
  paso generate o el plan se canceló antes de uno) y 7 nuevos en
  `executionTelemetry.test.ts` (JSON hace round-trip de cada campo y
  confirma que no se filtran claves con forma de prompt/respuesta; forma
  de header/fila CSV, `reasonCodes` unidos por pipe para no dividirse en
  columnas, escape correcto de comas/comillas, celdas vacías-no-
  "undefined", manejo de lista vacía). 131 tests en total, desde 116.
  **No testeable en este sandbox** (SQLite/sistema de archivos/sharing
  nativos): round-trips reales de insert/read, persistencia tras una
  recarga/reinicio real, y el flujo real de export vía share-sheet — estos
  necesitan verificación en dispositivo real.

**Actualización 2026-09-24: el enrutamiento adaptativo está encendido por
defecto** (`getAdaptiveRoutingEnabled()` por defecto `true`; Configuración
→ Tone & Reasoning lo conmuta, ya no etiquetado experimental). Aún solo
enruta entre modelos `MODEL_CATALOG` con roles, usando el preset
`balanced`, así un modelo de Hugging Face elegido con "Select & Use" solo
se usa cuando el enrutamiento adaptativo está apagado. Deep Research ahora
se conmuta solo en Configuración; el header del chat muestra una insignia
de solo lectura mientras está encendido.

---

## Roadmap: escalado verificable para consultas difíciles (2026-09-27)

**Fuente:** la prueba pública de Vitalik Buterin de apps móviles offline de
conocimiento (2026-09-26, 269K vistas): los modelos locales "definitivamente
están mejorando mucho" pero siguen siendo "mucho más lentos y menos
efectivos en preguntas difíciles". Su tesis: *"local será suficiente para
las preguntas comunes pero se quedará atrás en las difíciles, lo que
significa que necesitaremos formas de enviar (¿verificablemente?) las
consultas más duras a una red global."* Una de las tres apps que probó es
el proyecto original — el codebase sobre el que se construye NIDO.

**Estado: SOLO ROADMAP — no diseñado en detalle, no implementado.** Esta
sección registra dirección de diseño para que el trabajo futuro no la
contradiga.

### R-1. Ruta de escalado explícita y verificable (la respuesta al "(¿verificablemente?)")

La pregunta abierta de Vitalik es nuestro requisito de diseño. Esto mapea
directamente a los tres modos en `NIDO_PRINCIPLES.md` (OFFLINE ONLY /
LOCAL-FIRST / ONLINE ENHANCED, seleccionables globalmente y por
capability). El diseño futuro debe satisfacer:

- **Nunca silencioso.** El escalado a cualquier red externa ocurre solo
  por iniciación explícita del usuario (o pre-autorización explícita por
  capability), nunca como fallback automático que el usuario no pidió.
- **Verificable por el usuario.** Antes de que algo salga del
  dispositivo, el usuario ve exactamente qué se enviará (el texto de la
  consulta, nada más — sin memoria, sin identidad, sin historial salvo
  incluido explícitamente). Después de que vuelve la respuesta, se marca
  como obtenida externamente, con su fuente.
- **Sin dependencia progresiva.** OFFLINE ONLY debe seguir siendo un
  producto completo y funcional. El escalado es una mejora para consultas
  difíciles, no una muleta de la que la ruta local dependa en secreto.
- **No confiable por defecto.** Un modelo/red remoto es una parte no
  confiable hasta autenticarse + autorizarse (según la separación de
  autoridad de `NIDO_PRINCIPLES.md`: Modelo = razonamiento, nunca
  autoridad). Su salida es información, no instrucción.

### R-2. Señalización honesta de capabilities + respuestas con fuente verificada

- El router debería saber — y la UI debería mostrar — que la ruta local
  tiene límites en preguntas difíciles. Nunca presentar una respuesta de
  modelo local como equivalente a frontera; decir lo que es.
- Cada respuesta de conocimiento debería llevar sus fuentes offline
  visibles (citas inline, display de "offline verified sources"), para que
  el usuario pueda verificar la respuesta él mismo — el patrón que las
  apps probadas ya usan, que NIDO debe igualar o superar.

### R-3. Datos de enrutamiento basados en benchmarks

- `ModelCapabilities.estimatedTokensPerSecond` / `estimatedMemoryMb`
  siguen deliberadamente sin fijar (ver §11) hasta que existan números
  reales de dispositivo — sin datos inventados, nunca.
- Cuando las evals en dispositivo de `DEVICE_EVALUATION.md` produzcan
  números reales, se convierten en la fuente de datos de enrutamiento
  (tok/s, TTFT, memoria pico por modelo) y la base para tablas públicas
  honestas de benchmark (modelo, tok/s, primer token, memoria pico,
  resultados crudos enlazados) — el formato que NIDO ahora publica en
  boarapp.com, que es la barra de transparencia correcta.
- La velocidad es la otra mitad de la crítica de Vitalik ("mucho más
  lento" — una consulta difícil tomó ~5 min en las apps probadas). La ruta
  de preguntas comunes debe ser rápida; el timing por consulta (TTFT,
  tok/s) ya lo mide `telemetry.ts` — mostrarlo honestamente al usuario es
  trabajo futuro de UI.

### R-4. E2E por defecto + metadata mínima (principio citado)

Vitalik dejó Telegram por Signal por un argumento que adoptamos como
principio: **cifrado end-to-end por defecto en todo, y metadata mínima** —
Telegram solo cifra en chats secretos opcionales y guarda
mensajes/metadata en sus servidores; Signal cifra todo y retiene el
mínimo. Para NIDO esto significa:

- El P2P NIDO↔NIDO es E2E siempre, sin "modo no cifrado" disponible.
- La metadata (quién habla con quién, cuándo, cuánto) se minimiza por
  diseño: sin servidor central no hay a quién entregársela, y el protocolo
  no debe crear registros innecesarios ni siquiera localmente.
- Cualquier futura ruta de escalado (R-1) hereda este principio: si algo
  sale del dispositivo, sale cifrado con la metadata mínima posible, y el
  usuario lo sabe de antemano.

### R-5. Lo local debe sentirse sin fricción (directiva de producto)

Vitalik: para que los modelos locales se vuelvan "el default sin
fricción", lo que falta no son solo mejores modelos sino **mejores
interfaces de usuario, integraciones y eficiencia** — con "progreso enorme"
ya visible versus hace un año. Y su concepto CROPS AI: la IA genuinamente
descentralizada debe correr en más de un fabricante de chips, no depender
de un solo ecosistema.

Directiva para NIDO:

- La barra de calidad no es "corre localmente", es "corre localmente y se
  siente natural": tiempos de respuesta, TTFT y fluidez medidos en un
  dispositivo real (ver R-3) como métricas de producto, no solo de
  ingeniería.
- Integraciones que eviten salir del dispositivo: conocimiento offline,
  memoria local y tools locales primero; la red es la excepción explícita
  (R-1), no el camino fácil.
- Portabilidad de hardware: NIDO debe correr en Android genérico (arm64
  hoy), atado a ningún chip, ningún fabricante, ningún proveedor cloud.

**Explícitamente fuera de alcance por ahora:** cualquier implementación de
escalado por red, cualquier integración de API externa, cualquier cambio
al default offline. La prioridad inmediata sigue sin cambios: primer APK
real, verificación en dispositivo, correcciones pre-alpha.
