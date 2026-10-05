> **Idioma:** [English](../COMPLIANCE.md) · Español
# Bounty compliance

Cómo BOAR cumple cada requisito del
[poidh bounty 31](https://poidh.xyz/mainnet/bounty/31), con la evidencia detrás
de cada estado. Los estados son solo lo que se ha verificado:

- **PASS**: cumplido, con evidencia enlazada.
- **PARTIAL**: cumplido con una limitación declarada.
- **OPEN**: aún no hecho o no verificado.

Los archivos crudos de benchmark (JSONL, respuestas, reportes) están en
[evidence/](evidence/); los videos de demo y screenshots están en
[demo/](demo/README.md).

Última revisión: 2026-09-25. Dispositivo de prueba: Xiaomi 2311DRK48G,
MediaTek MT6897 (Dimensity 8300), 11.6 GB RAM, Android 16.

| # | Requisito | Estado |
|---|---|---|
| 1 | Corre en Android y hardware GrapheneOS compatible | PARTIAL |
| 2 | Opera dentro de 12 GB de RAM | PASS |
| 3 | Usa como máximo 50 GB para app, modelos, índices y assets | PASS |
| 4 | Funciona completamente offline una vez instalado | PASS |
| 5 | Sin llamadas API, inferencia remota, búsquedas web ni peticiones de red durante el uso | PASS |
| 6 | No requiere Google Play Services para la funcionalidad central | PASS |
| 7 | Maneja explicación, comparación, síntesis y razonamiento | PARTIAL |
| 8 | Responde a velocidades utilizables para consultas reales | PARTIAL |
| 9 | Publicado en un repositorio público de GitHub | PASS |
| 10 | Incluye todo el código, assets, dependencias e instrucciones para reproducir | PASS |
| 11 | Documenta los modelos, datasets, índices y otros recursos | PASS |
| 12 | Funciona en hardware Android real al momento del envío | PASS |
| 13 | Alguien puede hacerlo correr en pocos minutos | PARTIAL |
| 14 | Assets requeridos incluidos o con instrucciones claras de descarga | PASS |
| 15 | Demo pública en X o Farcaster | PASS |
| 16 | La demo muestra uso offline, consultas difíciles, enlace al repo y enfoque | PARTIAL |
| 17 | Screenshot y enlaces enviados a poidh | OPEN |
| 18 | El repositorio contiene la versión funcional enviada al momento del claim | PASS |
| 19 | No fraudulento, malicioso, plagiado ni en otra violación | PASS |
| 20 | ">50% tan bueno como internet + modelos frontera" | OPEN |

## Detalles

### 1. Android y GrapheneOS — PARTIAL
- Corre en un teléfono Android 16 físico (arriba), medido en 85 respuestas
  de benchmark en una sesión (ver 7 y 8).
- Aún no corrido en GrapheneOS. El diseño no depende de servicios de Google
  (ver 6), pero eso no sustituye una corrida real en GrapheneOS.

### 2. 12 GB RAM — PASS
- Pico de proceso más alto medido en el benchmark: 5.07 GB
  (Qwen2.5-7B Q4_K_M). El estado estable de Qwen2.5-1.5B es unos 1.6 GB,
  Phi-3.5-mini unos 3.1–3.8 GB.
- Solo un modelo de generación está cargado a la vez. Las cargas y
  descargas están serializadas para que el cambio rápido de modelo no
  pueda dejar un segundo modelo en memoria
  (`src/inference/LlamaEngine.ts`, testeado en `LlamaEngine.test.ts`).
- Antes de cargar, la app verifica el working set estimado del modelo
  contra la RAM libre y se niega con un mensaje claro en lugar de
  crashear (src/inference/ramBudget.ts — puro y con tests unitarios;
  también aplicado al motor de embeddings, que antes no tenía pre-flight).

### 3. 50 GB de almacenamiento — PASS
- Instalación por defecto: cerca de 1 GB de modelos (Qwen2.5-1.5B 0.99 GB,
  bge-small 0.04 GB) más unos MB de base de conocimiento.
- Cada modelo opcional del catálogo (Phi-3.5-mini, Qwen2.5-7B,
  LFM2.5-8B-A1B, Gemma 4 E4B) añade unos 17.4 GB, y el pack de
  conocimiento Wikipedia Vital Articles 0.16 GB, para unos 18.6 GB en
  total.
- Aplicado antes de cada descarga (`checkStorageForDownload`,
  `src/models/storageBudget.ts`, llamado desde
  `ModelManager.downloadCatalogModel`): lo que BOAR ya almacena
  (modelos, packs de conocimiento, base de datos) más descargas en
  progreso, una reserva de 1 GB para la propia app y el archivo nuevo
  deben mantenerse dentro de `STORAGE_BUDGET_BYTES` (50 GB), y el teléfono
  debe tener el espacio libre. Si no, la descarga se niega con un mensaje
  antes de obtener ningún dato.

### 4. Funciona offline una vez instalado — PASS
- Tras la descarga única del primer arranque, responder preguntas usa solo
  el modelo en dispositivo (llama.rn / llama.cpp) y la base de conocimiento
  SQLite local y packs.
- Grabado en el teléfono de prueba con modo avión encendido y Wi-Fi
  apagado: cuatro consultas, un follow-up y el pack de conocimiento
  respondiendo ([demo/](demo/README.md), 2026-09-24).

### 5. Sin peticiones de red durante el uso — PASS
El único código de red en la app (`src/`):
- `ModelManager.downloadCatalogModel` — descargas de modelos y packs de
  conocimiento, iniciadas por el asistente de setup o un tap explícito de
  Descargar.
- `src/services/modelBrowser.ts` — búsqueda de modelos de Hugging Face,
  solo cuando el usuario busca.

Inferencia, recuperación, historial de chat, telemetría y evaluación no
hacen llamadas de red. El APK tiene `INTERNET` y `ACCESS_NETWORK_STATE`
solo para esas descargas.

La entrada de voz opcional (`modules/voice-input`) usa el reconocedor de
voz del sistema Android con offline preferido (`EXTRA_PREFER_OFFLINE`). Si
reconoce offline depende del servicio de voz instalado del teléfono;
escribir siempre funciona.

### 6. Sin Google Play Services — PASS
- Las dependencias en runtime de la compilación release no contienen Play
  Services ni Firebase
  (`./gradlew :app:dependencies --configuration releaseRuntimeClasspath`).
- La compilación de desarrollo sí incluye `play-services-code-scanner`,
  traído por `expo-dev-launcher` (el escáner QR del dev client). Eso es
  solo tooling de desarrollo y está ausente de las compilaciones release.
- El código de la app nunca llama a servicios de Google.

### 7. Investigación más allá del recall — PARTIAL
- Un conjunto fijo de evaluación de 17 preguntas cubre saludo, factual,
  explicación, comparación, síntesis, razonamiento, preguntas basadas en
  recuperación y sin base de conocimiento
  ([docs/EVAL_QUERIES.md](EVAL_QUERIES.md)).
- Primera línea base en dispositivo real, 2026-09-24: las 68 respuestas de
  las cuatro configuraciones que cargaron se completaron. Phi-3.5-mini dio
  las comparaciones y síntesis más completas.
- Corrida del pack de conocimiento, 2026-09-24: con el pack Wikipedia
  Vital Articles (49,832 artículos), Qwen2.5-1.5B respondió 6 de 6
  preguntas factuales, basadas en recuperación y sin conocimiento
  built-in correctamente, cada una desde artículos recuperados (p. ej. las
  fechas de Napoleón, que no están en la base de conocimiento built-in).
- LFM2.5-8B-A1B (mixture of experts, ~1.5B activos), 2026-09-24: 17 de 17
  completadas a 14.8 tok/s mediana, el primer modelo en acertar la
  pregunta de presupuesto RAM, pero 4 respuestas se perdieron por
  razonamiento que consumió todo el presupuesto de tokens.
- Limitaciones vistas: errores aritméticos (todos los modelos fallaron la
  pregunta de presupuesto RAM), citas inventadas, y 9 respuestas truncadas
  por el timeout de 120 segundos por paso.

### 8. Velocidad utilizable — PARTIAL
Tiempo mediano por respuesta en la línea base (recuperación on, presupuesto
de 512 tokens):

| Configuración | Total mediana | TTFT mediana | tok/s mediana |
|---|---|---|---|
| Qwen2.5-1.5B | 21 s | 13.6 s | 11.4 |
| Enrutamiento adaptativo | 25 s | 14.1 s | 11.4 |
| Phi-3.5-mini | 73 s | 44.0 s | 4.0 |
| Qwen2.5-7B | 107 s | 70.5 s | 2.7 |

La mayor parte de la espera es procesar el contexto recuperado antes del
primer token. Desde entonces la recuperación envía 4 chunks en lugar de 6:
en la corrida del pack de conocimiento Qwen2.5-1.5B promedió 10.6 s por
respuesta (6.4 s a la primera palabra, 17.5 tok/s), en 6 preguntas en lugar
del conjunto completo.

### 9. Repositorio público — PASS
[github.com/rferrari/boar-app](https://github.com/rferrari/boar-app).
Confirmar que es público al momento del claim (18).

### 10. Código, assets, dependencias, instrucciones — PASS
- Compilación e instalación: [README.md](../../README.es.md) Quickstart,
  [AGENTS.md](../../AGENTS.es.md), `Makefile`, `eas.json`.
- Base de conocimiento: `assets/corpus/*.json`, commiteados. El pack
  Wikipedia Vital Articles es un [release asset](https://github.com/rferrari/boar-app/releases/tag/knowledge-pack-v1),
  construido reproduciblemente con `npm run pack:build`
  ([docs/KNOWLEDGE_PACKS.md](KNOWLEDGE_PACKS.md)).
- Modelos: descargados por el asistente de setup in-app desde las URLs en
  `src/models/manifest.ts`, que también registra el tamaño y SHA-256 de
  cada archivo. Las descargas se verifican por tamaño en el dispositivo;
  las URLs apuntan a la rama `main` de cada repositorio en lugar de una
  revisión fijada.

### 11. Modelos y datasets documentados — PASS
[docs/MODELS.md](MODELS.md) y `src/models/manifest.ts`: cada modelo y pack
de conocimiento con fuente, tamaño, checksum y licencia. La base de
conocimiento y packs son derivados de Wikipedia, CC BY-SA 4.0.

### 12. Hardware real al envío — PASS
Smoke test el 2026-09-25 con el APK v1.0.0 publicado en el teléfono de
prueba (el SHA-256 del APK instalado coincide con el release):
instalación limpia, setup de primer arranque, luego una respuesta correcta
a unos 7 tok/s con Qwen2.5-1.5B.

### 13. Corriendo en pocos minutos — PARTIAL
- Sin compilación necesaria: descarga el APK desde el
  [release](https://github.com/rferrari/boar-app/releases/tag/v1.0.0),
  verifica su checksum e instálalo (el "Download the app" del README), o
  deja que `make setup` haga las tres cosas por USB.
- La primera corrida descarga cerca de 1 GB, así el tiempo total depende
  de la conexión; el tiempo de instalación-a-primera-respuesta no se ha
  medido con cronómetro.

### 14. Assets o instrucciones de descarga — PASS
El asistente de setup del primer arranque descarga cada modelo requerido y
pack de conocimiento opcional en la app. `scripts/setup-models.sh` más
`plugins/withBundledModels.js` es una alternativa que empaqueta modelos en
el APK (ver [docs/MODELS.md](MODELS.md)).

### 15–17. Demo pública y envío a poidh — PASS / PARTIAL / OPEN
- Publicado en X: [x.com/arferrari/status/2103677576380387484](https://x.com/arferrari/status/2103677576380387484), con los clips de demo de
  [demo/](demo/README.md): modo avión, un prompt de síntesis, un follow-up
  y hechos del pack de conocimiento.
- Aún por hacer: enviar un screenshot y enlaces a poidh.

### 18. La versión enviada coincide con el repositorio — PASS
[v1.0.0](https://github.com/rferrari/boar-app/releases/tag/v1.0.0): el APK
(SHA-256 `de9e3156b4593c48e74a91a28931f044be8b64fd6d941e91b9a07a97eb4d3c01`)
y su archivo `.sha256`, compilado desde el commit etiquetado `8ae9d44`.

### 19. No fraudulento, malicioso ni plagiado — PASS
- Código original, licenciado MIT ([LICENSE](../../LICENSE)).
- Modelos y datos son de terceros, usados bajo sus licencias (Apache-2.0,
  MIT, CC BY-SA 4.0) y acreditados en [docs/MODELS.md](MODELS.md).

### 20. ">50% tan bueno como internet + modelos frontera" — OPEN
Aún no medido. El harness de evaluación en dispositivo y CLI de
dispositivo (`npm run eval:device`,
[docs/EVAL_QUERIES.md](EVAL_QUERIES.md)) producen el lado BOAR. Aún
necesario: respuestas de referencia de un modelo frontera con búsqueda
web, puntuación por rúbrica contra ellas, y verificaciones humanas ciegas,
con cada archivo crudo commiteado.

## Evidencia

| Corrida | Qué | Archivos |
|---|---|---|
| `eval-2026-09-24T03-12-53-754Z` | Línea base: 17 consultas × 5 configuraciones | [evidence/2026-09-24-baseline-5-configs](evidence/2026-09-24-baseline-5-configs/) |
| `eval-2026-09-24T05-42-38-163Z` | LFM2.5-8B-A1B, 17 consultas | [evidence/2026-09-24-lfm2.5-8b-a1b](evidence/2026-09-24-lfm2.5-8b-a1b/) |
| `eval-2026-09-24T20-41-45-071Z` | Qwen2.5-1.5B con el pack Vital Articles, 6 consultas | [evidence/2026-09-24-vital-articles-pack](evidence/2026-09-24-vital-articles-pack/) |

Los archivos `.jsonl` son los registros crudos por respuesta escritos en el
teléfono; los reportes y hojas de respuestas se generan desde ellos
(`npm run eval:summary`).
