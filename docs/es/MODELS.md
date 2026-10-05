> **Idioma:** [English](../MODELS.md) · Español

# Modelos, índices y datasets

Este archivo documenta cada asset offline que la app incluye o del que depende,
según el requisito del bounty de "documentar claramente los modelos, datasets,
índices y otros recursos usados".

## Phi-3.5-mini — opcional (el default hasta 2026-09-24)

**[Phi-3.5-mini-instruct](https://huggingface.co/microsoft/Phi-3.5-mini-instruct)**
(Microsoft, **licencia MIT**), GGUF cuantizado de
**[bartowski/Phi-3.5-mini-instruct-GGUF](https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF)**,
archivo `Phi-3.5-mini-instruct-Q4_K_M.gguf` (~2.23GB, sha256 abajo).

- 3.8B parámetros, denso, cuantización Q4_K_M
- Elegido sobre Qwen2.5-3B-Instruct porque el GGUF de 3B de Qwen se distribuye con la
  restrictiva licencia `qwen-research` (no comercial/solo investigación), un mal encaje
  para una presentación pública open-source del bounty; la licencia MIT de Phi-3.5-mini
  no tiene tal restricción.
- Buen razonamiento por parámetro para su tamaño (supera a la mayoría de modelos densos
  de 1–3B en benchmarks estilo MMLU/GSM8K según su model card), apuntando directamente
  al listón de razonamiento del bounty para "modelos densos >1B".
- Corre vía `llama.cpp`/`llama.rn` en CPU Android, mmap-streamable para que los pesos no
  queden totalmente fijados en RAM.
- **Ruta de mejora (no implementada aún)**: un modelo MoE de verdad (p. ej. una variante
  con licencia Apache/MIT de la familia Qwen1.5-MoE / OLMoE, ~2–3B parámetros activos)
  para más conocimiento del mundo con coste RAM/velocidad similar en parámetros activos,
  una vez bencheado en el dispositivo contra esta línea base.

## Modelo de embeddings — elegido

**[bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5)** (BAAI, **licencia
MIT**), GGUF cuantizado de
**[CompendiumLabs/bge-small-en-v1.5-gguf](https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf)**,
archivo `bge-small-en-v1.5-q8_0.gguf` (~35MB, sha256 abajo).

- 33M parámetros, muy por debajo del sub-presupuesto de 300MB, lo bastante rápido para
  quedarse residente junto al LLM principal sin afectar de forma significativa el
  presupuesto de 12GB de RAM.

## Base de conocimiento local / índice de recuperación

- **Léxico**: tabla virtual FTS5 de SQLite (`chunks_fts`), construida del mismo corpus
  fuente que el índice vectorial. Ver `src/rag/db.ts`.
- **Semántico**: búsqueda coseno por fuerza bruta sobre embeddings float32 almacenados
  (tabla `chunk_embeddings`). Suficiente a la escala de corpus que un teléfono puede
  sostener dentro del presupuesto de almacenamiento; reconsiderar con un índice ANN
  de verdad (p. ej. HNSW cuantizado) solo si el tamaño del corpus hace la fuerza bruta
  demasiado lenta en el dispositivo.
- **Fuente del corpus**: `assets/corpus/corpus.json` — 300 docs: ~58 resúmenes de
  artículos curados sobre temas de IA/sistemas relevantes para las propias preguntas
  de eval del bounty (MoE, cuantización, RAG, BM25, mmap, transformers) más temas
  generales de investigación en ciencia, historia, geografía, biología y economía,
  completados con artículos aleatorios de **Wikipedia** (CC BY-SA 4.0) hasta 300.
  Construido por `scripts/build-corpus.mjs` + `scripts/build-corpus-tier.mjs`
  (solo máquina de desarrollo, online, se ejecuta una vez para curar/actualizar el
  corpus — no lo ejecuta la app distribuida). ~188KB de texto; los embeddings se
  calculan en el dispositivo en el primer arranque vía `src/rag/seedCorpus.ts`,
  no precomputados, así que siempre coinciden con el modelo de embeddings distribuido.
- **Atribución**: según la licencia CC BY-SA 4.0 de Wikipedia, cada fragmento guardado
  conserva un campo `source` que enlaza a su artículo de origen
  (`https://en.wikipedia.org/wiki/<Title>`), mostrado al usuario como cita.
- **Limitación conocida**: siguen siendo solo resúmenes de párrafos introductorios de
  Wikipedia, no texto completo de artículos ni fuentes no-Wikipedia — suficiente para
  demostrar el pipeline RAG y responder las preguntas de eval en `docs/EVAL_QUERIES.md`,
  pero crecerlo (texto de artículo más completo, otras fuentes) mejoraría
  significativamente la utilidad real.

## Alcance de idioma: solo inglés en esta versión

bge-small-en-v1.5 es un modelo de embeddings solo-inglés, y el corpus bootstrap es
solo-inglés. Fue una elección deliberada, no un descuido: cambiar a un modelo de
embeddings por locale también exigiría una base de conocimiento por locale y pruebas
separadas de calidad de recuperación por idioma, y el LLM principal
(Phi-3.5-mini-instruct) está a su vez afinado principalmente para inglés — un modelo
de embeddings multilingüe no ayudaría de forma significativa sin un LLM y corpus
multilingües a juego. Vale la pena reconsiderarlo (p. ej. un modelo de embeddings
multilingüe emparejado con el locale del dispositivo, junto a un candidato LLM
multilingüe y corpus) como trabajo futuro, no en esta versión.

## Modelo de generación por defecto: Qwen2.5-1.5B (requerido, descargado en la configuración inicial)

**[Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct)**
(Alibaba, **licencia Apache-2.0**), GGUF cuantizado de
**[bartowski/Qwen2.5-1.5B-Instruct-GGUF](https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF)**,
archivo `Qwen2.5-1.5B-Instruct-Q4_K_M.gguf` (~0.92GB, sha256 en `src/models/manifest.ts`).

Descargado junto a Phi-3.5-mini y el modelo de embeddings durante la configuración
inicial obligatoria — `required: true`, igual que los otros dos — en lugar de dejarlo
como descarga opcional en la pantalla de Ajustes. Es deliberado: el trabajo de enrutado
adaptativo (`src/routing/`, ver `docs/ADAPTIVE_ROUTING.md`) necesita al menos
dos modelos reales, de tamaños verdaderamente distintos, entre los que enrutar (un rol
`fast` y un rol `general`/`reasoning`) desde el momento en que la app es usable, no solo
después de que un usuario obtenga manualmente un segundo modelo más tarde. Curado como
`fast` en `ModelCapabilities` (`src/models/manifest.ts`) — el más pequeño/rápido de los
tres LLM del catálogo.

## Catálogo LLM opcional (elige tu modelo)

Además del default requerido, Ajustes ofrece estos modelos, cada uno probado en un
teléfono real (Xiaomi 2311DRK48G, Dimensity 8300, 11.6 GB RAM; ver
[DEVICE_EVALUATION.md](DEVICE_EVALUATION.md)):

| Candidate | Params | Quant | Size | License | Measured on the phone |
|---|---|---|---|---|---|
| Phi-3.5-mini-instruct | 3.8B dense | Q4_K_M | 2.39GB | MIT | ~4 tok/s; most complete comparisons and syntheses |
| Qwen2.5-7B-Instruct | 7B dense | Q4_K_M | 4.68GB | Apache-2.0 | ~2.7 tok/s; accurate, often too slow for the 120s step limit |
| LFM2.5-8B-A1B | 8B MoE, ~1.5B active | Q4_K_M | 5.16GB | LFM Open License v1.0 | ~15 tok/s; best reasoning, but it thinks first and needs a larger answer budget |
| Gemma 4 E4B | ~4B effective | QAT Q4_0 | 5.15GB | Apache-2.0 | loads and answers; not benchmarked yet |

Tamaños y checksums SHA-256 en `src/models/manifest.ts`. Cambiar de modelo recarga el
motor de inferencia (`LlamaEngine`/`EmbeddingEngine` ahora liberan su contexto
previo antes de cargar uno nuevo, evitando una fuga de memoria nativa al cambiar).

## Tiers de configuración y packs de corpus

La primera ejecución ofrece tres tiers (`src/models/manifest.ts` `TIERS`, elegidos en
el wizard de `ModelSetupScreen`) — todos descargan los mismos modelos requeridos, solo
la base de conocimiento difiere, y los tiers superiores son superconjuntos estrictos:

| Tier | Knowledge base | Extra download |
|---|---|---|
| Minimum | 300 bundled topics (in the JS bundle, no download) | none |
| Standard | + 1,000 more Wikipedia-derived topics | ~600KB |
| Full | + 4,000 more on top of Standard (5,300 total) | ~3MB total |

Los packs de corpus (`corpus-standard`, `corpus-full`) los construye
`scripts/build-corpus-tier.mjs`, que usa la API `generator=random` por lotes de
MediaWiki (20 artículos/petición) en lugar de llamadas de resumen una por una —
muchos menos round-trips HTTP para una cantidad dada. Están commiteados en
este repo y se descargan vía URL `raw.githubusercontent.com` (sin hosting
separado necesario) por la misma ruta `ModelManager.downloadCatalogModel` que
todo lo demás, verificados por sha256.

**Nota honesta de alcance**: "Full" no es literalmente toda la Wikipedia en inglés —
esa es una escala de ingeniería distinta (procesado de dumps, compresión, un índice
ANN de verdad) no intentada aquí. La arquitectura está diseñada para que más packs
puedan añadirse después dentro del presupuesto de 50GB de almacenamiento sin cambiar
cómo funciona nada de esto — `MODEL_CATALOG`/`TIERS` están pensados para crecer.

## "Deep Research Mode" — nota honesta de alcance

Ajustes tiene un toggle "🔬 Deep Research Mode" (`src/services/orchestrator.ts`)
que descompone una pregunta en 2-3 sub-preguntas, recupera + responde cada una
por separado, y luego sintetiza una respuesta final. Esto **no** son múltiples modelos
de IA/agentes corriendo concurrentemente — ejecutar 3 modelos a la vez, o un
modelo planificador/crítico dedicado, genuinamente no cabe en el presupuesto de
12GB de RAM junto a todo lo demás. Son varias llamadas secuenciales a
`llamaEngine.generate()` sobre el *mismo* modelo cargado, interpretando distintos
roles por turnos. Notablemente más lento que una respuesta normal (múltiples pasadas
LLM en lugar de una) — el badge de la UI dice "Deep Research", no "multi-agent", y la
descripción en la app lo explica, para no sobredimensionar lo que realmente ocurre.

`modules/ram-monitor` también expone `getDeviceTotalRamBytes()` (RAM física del
dispositivo, no solo el uso de esta app) para que el catálogo de modelos pueda mostrar
una pista aproximada de compatibilidad 🟢/🟡/🔴 antes de descargar un modelo grande —
estimada como pesos + KV cache calculada + buffers de cómputo
(src/inference/ramBudget.ts, la misma fórmula que usa el pre-flight en
tiempo de carga), que es una aproximación, no una garantía. Se consideró un navegador de modelos en vivo de Hugging
Face (búsqueda, repos GGUF arbitrarios) y se descartó deliberadamente — alcance real
más allá del catálogo estático curado y verificado por sha256 ya en su lugar, por
beneficio incierto.

## Historial de chat multi-sesión y memoria de conversación

Las sesiones/mensajes de chat persisten localmente en la misma base SQLite que la
base de conocimiento (tablas `chat_sessions`/`chat_messages` de `src/rag/db.ts`) —
`src/services/chatHistory.ts` es la capa CRUD, expuesta como lista "Recent
Chats" en el drawer con títulos autogenerados y borrado por sesión.

Para conversaciones largas, `src/services/summarize.ts` condensa los turnos antiguos
en un resumen continuo (antepuesto al prompt junto a los últimos 3 intercambios
conservados verbatim — ver el parámetro `history` de `assemblePrompt` en
`src/rag/pure.ts`), en lugar de enviar toda la transcripción cada vez.

**Restricción de concurrencia que vale la pena explicitar**: la generación de títulos
y la resumización son llamadas LLM a través del *mismo* contexto `llamaEngine` que
el chat principal — los contextos de `llama.cpp` solo ejecutan una completion a la
vez. Corren como tareas background fire-and-forget tras terminar una respuesta (sin
bloquear literalmente el hilo UI), pero si el usuario envía un mensaje nuevo mientras
una sigue en vuelo, `ChatScreen` llama a `llamaEngine.stop()` y lo espera antes de
empezar la siguiente generación (`cancelBackgroundTask`) — si no, el mensaje nuevo
quedaría silenciosamente en cola detrás de la tarea background en el mismo contexto.

## Decisiones de dependencias de UI

Las animaciones de la UI de chat (pulso del mic/aura rings, indicador de procesado,
slide del drawer) usan la API `Animated` integrada de React Native en lugar de
`react-native-reanimated`, y el drawer lateral es artesanal en lugar de
`@react-navigation/drawer`. Ambos funcionarían, pero ambos son cadenas de dependencias
nativas más pesadas (worklets + plugin Babel; gesture-handler + screens + un
navigator completo) para efectos que `Animated` y un simple componente de panel
deslizante ya entregan aquí — dado que esta app es una máquina de estados de una
sola pantalla, no un navigator multi-ruta, traer una librería de enrutado se sintió
como resolver un problema que esta app no tiene. `expo-linear-gradient` es la única
dependencia nativa nueva añadida para el look de fondo degradado/glassmorphism.

## Entrada de voz (speech-to-text offline)

`modules/voice-input` envuelve el `SpeechRecognizer` integrado de Android con
`EXTRA_PREFER_OFFLINE`, expuesto vía `src/voice/VoiceInput.ts` y el botón de mic
en `ChatScreen`. No se llama a ninguna API STT en la nube.

**Nota honesta de alcance**: esto depende de que haya un servicio de reconocimiento
provisto por el sistema (el de Google, o el de un OEM) instalado en el dispositivo.
La mayoría de builds stock de Android/OEM traen uno; **GrapheneOS y otras builds
de-Googled típicamente no**, así que la entrada de voz no funcionará ahí de serie —
`isAvailable()` lo detecta y la UI muestra un mensaje claro de "no disponible"
en lugar de fingir que escucha. Una garantía verdadera multi-dispositivo implicaría
empaquetar un modelo `whisper.cpp` con un binding personalizado, que es un proyecto
de la escala de la propia integración `llama.rn` — documentado como trabajo futuro,
no intentado en esta versión. Escribir siempre funciona en todas partes.

## Entrega: descarga única en la primera ejecución

Los dos assets requeridos (Qwen2.5-1.5B y el modelo de embeddings) se declaran con
`required: true` en `src/models/manifest.ts` (alrededor de 1 GB en total). Phi-3.5-mini,
Qwen2.5-7B, LFM2.5-8B-A1B y Gemma 4 E4B son sugerencias opcionales en el mismo
catálogo. La
app en sí se distribuye pequeña (sin assets multi-GB embebidos, para builds/instalaciones
rápidas); en el primer arranque muestra una pantalla de configuración obligatoria que
los descarga — ver `ARCHITECTURE.md` "First-run model setup". Una vez hecho, la app
funciona completamente offline desde entonces, cumpliendo "funciona completamente
offline una vez instalada".

Cada descarga tiene un timeout de *inactividad* de 60 segundos (`ModelManager.
downloadCatalogModel`, no un deadline plano — una descarga lenta pero progresando
no se penaliza, solo cero progreso durante 60s se trata como estancada) y, en el
asistente de configuración, un error visible + botón Retry por asset fallido. Antes
de esto, una descarga estancada (p. ej. un host limitando la conexión) se quedaba en 0%
para siempre sin error y sin forma de reintentar — la pantalla obligatoria de primera
ejecución no tenía ninguna vía de escape.

La misma pantalla, accesible después vía el botón "Models" de la UI de chat, permite
además al usuario obtener modelos **opcionales, no por defecto** por la red — solo cuando
toca explícitamente "Download" en una entrada concreta. `ModelManager.downloadCatalogModel`
es la única ruta de código en la app distribuida que realiza una petición de red;
`android.permission.INTERNET` está presente en el build por esa razón, pero por lo
demás no se usa (en particular, nunca durante chat/inferencia/recuperación).

Una ruta de build alternativa (`modules/bundled-assets` + `plugins/withBundledModels.js`,
verificada funcionando pero no usada por defecto) puede embeber los modelos por defecto
directamente en el APK, para un build que no necesite red jamás — ver
`ARCHITECTURE.md`.

### Pre-cargar modelos que ya tienes en local

Dos situaciones distintas, dos mecanismos distintos:

- **Compilando tu propio APK** y ya tienes los archivos GGUF en tu máquina de
  desarrollo: suéltalos en `assets/models/` con los nombres exactos que
  `scripts/setup-models.sh` espera (`primary-llm.gguf`,
  `qwen2.5-1.5b-instruct-q4km.gguf`, `embedding.gguf`) antes de ejecutar el
  script — verifica por sha256 lo que ya haya y omite re-descargar lo que
  ya coincida, antes de que `expo prebuild` los embeba en el APK (ver párrafo
  anterior). No hace nada para una app ya instalada en un dispositivo.
- **Un build dev-client ya instalado**, saltándose la descarga en la app por
  completo: empuja los archivos directo al almacenamiento privado de la app con
  `adb`. El almacenamiento de la app no es escribible directamente por `adb push`,
  así que prepara en `/sdcard` primero y usa `run-as` (solo funciona en un build
  **debuggable**, p. ej. `expo-dev-client` — un build release firmado lo rechazará):

  ```bash
  adb push primary-llm.gguf /sdcard/Download/
  adb shell run-as team.sopa.aoair mkdir -p files/models
  adb shell run-as team.sopa.aoair cp /sdcard/Download/primary-llm.gguf files/models/primary-llm.gguf
  ```

  Repite por asset. Dos cosas deben coincidir exactamente o `ModelManager.statusOf`
  trata el archivo como corrupto/ausente y lo borra: el **nombre de archivo**
  (`models/<name>.gguf`, según el campo `filename` de `src/models/manifest.ts`)
  y el **tamaño en bytes** (`sizeBytes` en el mismo archivo — esta es la única
  comprobación que la app hace en runtime; sha256 solo se comprueba bajo demanda,
  nada lo llama automáticamente). Vale la pena confirmarlo con `ls -la` contra el
  manifest antes de empujar, ya que un archivo re-subido o cuantizado de forma
  distinta desde Hugging Face puede diferir en tamaño silenciosamente.

## Verificación

Cada entrada del catálogo se declara en `src/models/manifest.ts` con un `sha256` y
`sizeBytes`. `ModelManager` verifica instalaciones empaquetadas por tamaño exacto en
bytes (barato, seguro para archivos multi-GB) y puede verificar sha256 completo bajo
demanda (usado para el modelo de embeddings pequeño; un sha256 completo en JS de un
archivo multi-GB es una limitación conocida y documentada — ver `ARCHITECTURE.md`
Status). `scripts/setup-models.sh` hace la verificación sha256 autoritativa, una vez,
en la máquina de desarrollo, antes de que `expo prebuild` embeba los archivos en el
build.
