> **Idioma:** [English](ARCHITECTURE.md) · Español

# el proyecto original — Inteligencia Local Adaptativa (Android)

Un sistema móvil de IA offline-first para Android que explora el enrutamiento
adaptativo de modelos, la recuperación local, la verificación selectiva y la
inferencia consciente de recursos. Construido originalmente para el bounty
"Best Offline AI Research App" (inspirado por la publicación de
@VitalikButerin). Restricciones duras a las que apunta este diseño:

- ≤ 12 GB de RAM pico durante la inferencia
- ≤ 50 GB totales en disco (app + pesos + índices)
- App pequeña, rápida de compilar/instalar; un paso obligatorio de
  configuración única descarga los modelos por defecto en el primer arranque
  (el único uso de red requerido por la app). A partir de entonces funciona
  completamente offline — cumpliendo "work completely offline once installed"
  (instalado = app + configuración única de modelos hecha).
- Sin dependencia de Google Play Services (funciona en GrapheneOS)
- Dispositivo Android real, no solo emulador

## Stack

- **App shell**: Expo (React Native) + `expo-dev-client` (build de desarrollo
  personalizado, no Expo Go — necesitamos módulos nativos que Expo Go no puede
  cargar).
- **Motor de inferencia**: [`llama.rn`](https://github.com/mybigday/llama.rn) —
  bindings de React Native para llama.cpp, soporta GGUF, streaming de pesos por
  mmap, build con Android NDK, sin GMS.
- **Modelo por defecto**: Qwen2.5-1.5B-Instruct (Apache-2.0, 1.5B, Q4_K_M,
  ~0.99 GB), el rol `fast` de la capa de enrutamiento (`src/routing/`).
  Descargado una vez en el primer arranque junto con el modelo de embeddings
  (ver "Configuración de modelos en el primer arranque" más abajo), alrededor
  de 1 GB en total, así que la configuración toma minutos. Modelos sugeridos en
  el mismo catálogo dentro de la app, todos probados en un teléfono real:
  Phi-3.5-mini-instruct (MIT, 3.8B), Qwen2.5-7B-Instruct, LFM2.5-8B-A1B
  (mixture of experts, ~1.5B activos) y Gemma 4 E4B (ver
  `docs/es/MODELS.md`).
- **Recuperación**: `expo-sqlite` con FTS5 para búsqueda léxica sobre una base
  de conocimiento offline local, más bge-small-en-v1.5 (MIT, 33M) para un
  índice vectorial local (coseno por fuerza bruta) — RAG híbrido BM25 +
  vectorial, totalmente local en el momento de la consulta.
- **Almacenamiento**: los pesos de los modelos + la DB FTS5 + el índice
  vectorial viven en `FileSystem.documentDirectory`, verificados por
  checksum/tamaño contra un manifiesto.

## Configuración de modelos en el primer arranque

La propia app sigue siendo pequeña y rápida de compilar (sin assets de varios
GB embebidos en el APK), y obtiene sus modelos por defecto la primera vez que
se abre:

1. `App.tsx` comprueba `ModelManager.requiredModelsPresent()` al arrancar. Si
   el LLM por defecto + el modelo de embeddings aún no están en disco, muestra
   `ModelSetupScreen` en `mode="required"` en lugar de la UI de chat.
2. Esa pantalla inicia automáticamente la descarga de ambas entradas del
   catálogo marcadas `required: true` (`src/models/manifest.ts`) vía
   `ModelManager.downloadCatalogModel`, con una barra de progreso por modelo, y
   verifica el tamaño de cada descarga contra el catálogo antes de aceptarla.
3. Una vez que ambos están presentes, "Continue" se desbloquea y la app pasa a
   la UI normal de chat. A partir de este punto no se necesita más acceso a la
   red — verificado: desactivar la red (modo avión) no afecta al chat, la
   recuperación ni la generación, que son todos rutas de código puramente
   on-device.
4. La misma pantalla, en `mode="optional"` (accesible luego vía el botón
   "Models" de la pantalla de chat), permite al usuario explorar/descargar
   modelos adicionales o alternativos, o eliminar los que ya no quiera — sigue
   siendo opt-in, sigue siendo el único punto de llamada a red de la app.

**Ruta de build alternativa (no usada por defecto):** `modules/bundled-assets` +
`plugins/withBundledModels.js` pueden embeber los modelos por defecto
directamente en el APK en tiempo de build (verificado funcionando vía una
ejecución real de `expo prebuild` — ver el historial de git), para un build que
no necesita red nunca, al costo de un APK mucho más grande y builds/subidas más
lentos. Vuelve a añadir `"./plugins/withBundledModels"` al array `plugins` de
`app.json` para usarla.

## Estructura de directorios

```
boar-app/
  App.tsx                  # checks required models -> setup screen or chat
  src/
    inference/              # llama.rn wrapper, streaming token bridge
    rag/                    # FTS5 setup, embedding, retrieval + prompt assembly
    models/                 # model catalog, checksum/size verify, download
    ui/                     # chat UI, model setup/catalog UI, system monitor bar
  modules/
    ram-monitor/             # native module: real process RSS via /proc/self/status
    bundled-assets/           # native module: copy APK-bundled models to disk (alt path)
  plugins/
    withBundledModels.js      # config plugin for the alternate bundled-build path
  android/                   # generated by `expo prebuild` (gitignored, regenerable)
  assets/
    models/                   # (gitignored) verified GGUF files, populated by setup-models.sh
    corpus/corpus.json         # bundled Wikipedia-derived bootstrap knowledge base
  docs/
    MODELS.md                 # documented model/dataset/index choices
    EVAL_QUERIES.md             # example queries for the bounty demo
  scripts/
    setup-models.sh            # dev-machine: fetches + verifies model weights
    build-corpus.mjs            # dev-machine: builds the bundled knowledge base
  eas.json / .easignore         # EAS Build config (cloud builds w/o local Android SDK)
```

## No negociables aplicados en código

1. Sin librerías de Firebase / GMS / Play Services en
   `android/app/build.gradle`.
2. El **único** punto de llamada a red en `src/` es
   `ModelManager.downloadCatalogModel`, invocado exclusivamente desde
   `ModelSetupScreen` (tanto en su modo obligatorio de primer arranque como en
   su modo opcional posterior) — chat, inferencia y recuperación son rutas de
   código totalmente locales sin llamadas `fetch`/de red en ningún lugar.
3. Una barra visible de monitor del sistema (RAM + almacenamiento) para que los
   límites de RAM/almacenamiento sean auditables en vivo en el dispositivo, no
   solo declarados.

## Estado

- [x] Scaffold Expo TS, `expo-dev-client`, `expo-sqlite`, `expo-file-system`,
      `llama.rn` instalados
- [x] ModelManager (descarga + verificación de checksum/tamaño; ruta opcional
      de instalación embebida)
- [x] Esquema FTS5 + recuperación híbrida (léxica+semántica) + ensamblado de
      prompts
- [x] Wrappers LlamaEngine/EmbeddingEngine sobre `llama.rn`, liberan el
      contexto previo antes de cargar uno nuevo (sin fuga de memoria nativa al
      cambiar de modelo)
- [x] Asistente obligatorio de configuración en el primer arranque (selector de
      nivel + descargas) + pantalla opcional de Ajustes (catálogo de modelos,
      cambio de modelo activo, packs de corpus, monitor de
      almacenamiento/RAM) — `ModelSetupScreen`, el único punto de llamada a
      red de la app
- [x] UI de chat: streaming de tokens, citas, carrusel de onboarding con ideas
      de prompts, botón de entrada de voz offline
- [x] **Verificado de extremo a extremo en hardware Android real**
      (Xiaomi/Redmi, Snapdragon/Adreno): `expo prebuild` + `expo run:android`
      compilan e instalan de verdad; el asistente de primer arranque descarga
      los modelos en el dispositivo; la app funciona
- [x] Modelos primario (MIT) + secundario (Apache-2.0, rol `fast` de
      enrutamiento) + de embeddings requeridos en la configuración de primer
      arranque, + una alternativa LLM Apache-2.0 opcional adicional
      (Qwen2.5-7B-Instruct), todos verificados por sha256, cabeceras GGUF
      validadas
- [x] Tres niveles de configuración (Minimum/Standard/Full) con packs de
      corpus descargables (300/1.300/5.300 temas), alojados vía
      `raw.githubusercontent.com` desde este repo público, verificados por
      sha256 como cualquier otro asset del catálogo
- [x] Módulos nativos: `ram-monitor` (RSS real del proceso),
      `bundled-assets` + `withBundledModels` (ruta alternativa de build
      totalmente embebido, no por defecto), `voice-input` (wrapper offline de
      `SpeechRecognizer`) — todos confirmados descubiertos por el autolinking
      de Android de Expo, todos compilados con éxito en una compilación real
      de `expo run:android`
- [x] EAS Build configurado (`eas.json`) y proyecto enlazado (`boar-app`, antes
      `ao-air` previo al rebrand — puede necesitar re-enlace en expo.dev si los
      builds en la nube se quejan de un slug distinto) para builds en la nube
      sin Android SDK local
- [x] Repo público de GitHub: https://github.com/rferrari/boar-app
- [x] Tests unitarios (vitest, 22 tests) para la lógica pura de
      recuperación/manifiesto/niveles + CI
- [x] `Makefile` con atajos `setup`/`start`/`run-android`/`build-eas`/`test`/`clean`
      para los comandos anteriores
- [ ] Medir el rendimiento de los modelos elegidos en hardware real
      (tokens/seg, RSS) — aún no medido
- [ ] Binding de whisper.cpp para entrada de voz en dispositivos sin servicio
      de voz del sistema (GrapheneOS) — documentado como trabajo futuro, no
      intentado
- [ ] Post público de demo (X/Farcaster) + envío a poidh
