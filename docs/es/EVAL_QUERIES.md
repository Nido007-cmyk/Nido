> **Idioma:** [English](../EVAL_QUERIES.md) · Español

# Evaluación

El listón del bounty es la calidad de respuesta en preguntas reales de
investigación, incluyendo las que un modelo denso de 1B típicamente falla
(razonamiento multi-hop, síntesis, comparación). Este documento define un
conjunto fijo de evaluación y una forma reproducible de ejecutarlo en un
dispositivo Android contra distintos modelos y configuraciones de enrutado,
para comparar sus respuestas y costes lado a lado.

No hay juez automatizado. El harness produce resultados estructurados
(JSONL/CSV) que calificas a mano, usando las notas de calificación siguientes.

## El conjunto de evaluación (v1)

Fuente de verdad: [`src/eval/evalSet.ts`](../../src/eval/evalSet.ts). Aumenta
`EVAL_SET_VERSION` ahí cuando cambie una query; cada fila de resultado registra
la versión con la que se produjo.

"Expected KB article" significa que el corpus empaquetado tiene un artículo sobre
el tema, así que una recuperación correcta debería traerlo (registrado como
`expectedKbHit`). Las queries `no-kb-content` no tienen artículo relevante a propósito.

| id | category | query | expected KB article(s) |
|---|---|---|---|
| greeting-1 | greeting | hey, what's up? | — |
| factual-1 | factual | What is the capital of Australia? | — |
| factual-2 | factual | Who proposed the theory of evolution by natural selection? | Evolution |
| explanation-1 | explanation | How do vaccines work? | Vaccine |
| explanation-2 | explanation | Explain photosynthesis in simple terms. | Photosynthesis |
| comparison-1 | comparison | Compare the French Revolution and the Industrial Revolution. | French Revolution, Industrial Revolution |
| comparison-2 | comparison | Contrast how supply and demand explains price changes with how behavioral economics complicates that picture — where does the simple model break down? | Supply and demand, Behavioral economics |
| synthesis-1 | synthesis | What do the Agricultural Revolution and the Industrial Revolution have in common as turning points in human history, and how did they differ in how quickly they changed daily life? | Agricultural revolution, Industrial Revolution |
| synthesis-2 | synthesis | How does the immune system's response to a pathogen relate to how a vaccine works — walk through the mechanism. | Immune system, Vaccine |
| synthesis-3 | synthesis | Why is the Amazon rainforest considered important for global climate, and what does biodiversity loss there actually threaten beyond the obvious loss of species? | Amazon rainforest |
| reasoning-1 | reasoning | A train leaves at 3:40 pm and the trip takes 2 hours and 35 minutes. What time does it arrive? | — |
| reasoning-2 | reasoning | A device has a 12GB RAM budget. The OS and app overhead take 2GB, the embedding model needs 200MB, and the LLM's KV cache needs 1.5GB. How much is left for the LLM's weights, and would a 9GB model fit if loaded fully into RAM? | — |
| reasoning-3 | reasoning | If a Mixture-of-Experts model has 100B total parameters but only activates 8B per token, and each parameter needs 1 byte at Q8, what's the minimum disk footprint, and why doesn't RAM usage scale with the 100B figure? | — |
| grounded-1 | retrieval-grounded | Why did the Western Roman Empire fall? | Fall of the Western Roman Empire |
| grounded-2 | retrieval-grounded | What is a black hole and how does one form? | Black hole |
| no-kb-1 | no-kb-content | Who was Napoleon Bonaparte? | — (the corpus only has "Randy Napoleon", which must not be cited) |
| no-kb-2 | no-kb-content | How do antibiotics work, and why does antibiotic resistance develop? | — |

Los `gradingNotes` de cada query en `evalSet.ts` dicen qué contiene una buena respuesta.

## Configuraciones

El harness ejecuta el conjunto completo una vez por configuración seleccionada:

- **Uno por LLM instalado** (`model:<id>`), incluyendo modelos añadidos a través de la
  búsqueda de Hugging Face. Cada query va a ese modelo. La recuperación sigue la misma
  regla que la ruta de chat con modelo fijo: se omite para saludos, cálculos,
  traducciones y código, y se ejecuta en el resto. La generación pasa por el ejecutor
  de enrutado en el propio formato de instrucción del modelo: la plantilla de chat
  embebida en su GGUF (`tokenizer.chat_template`, aplicada por llama.cpp), así Qwen recibe
  ChatML, Phi recibe `<|system|>…<|end|>`, y cualquier otro modelo recibe lo que
  su archivo defina. Solo un archivo sin plantilla embebida usa el prompt plano
  `Question:/Answer:` de la app. Cada fila registra cuál se usó (`promptFormat`).
  Los ajustes de generación son por lo demás idénticos en ambos casos (512 tokens,
  temperatura 0.7); una plantilla termina en el token de fin de turno del propio
  modelo, el prompt plano en las stop strings de la app. Los tres GGUF curados
  (Phi-3.5-mini, Qwen2.5-1.5B, Qwen2.5-7B) traen plantilla.
- **Enrutado adaptativo** (`adaptive`). Cada query pasa por `runAdaptiveChat`,
  exactamente como en el chat con el Enrutado Adaptativo activado, usando el preset
  de enrutado guardado en ajustes (por defecto `balanced`; aún no hay selector en la UI).
  Esto se ejecuta tenga o no el toggle de Enrutado Adaptativo activado.
  `routingPreset` en cada fila registra qué preset se usó. Mantiene el formato
  de prompt del chat en vivo, que hoy significa que Qwen2.5-1.5B usa su
  plantilla y todos los demás modelos (Phi incluido) el prompt plano, así que
  mide el producto tal como lo reciben los usuarios; `promptFormat` muestra la diferencia.

Constante en cada ejecución y registrado en cada fila: el system prompt (la
personalidad `succinct` por defecto), `maxTokens` = 512, sin historial de
conversación (cada query se responde por separado). La temperatura de muestreo es la
normal de la app, 0.7, así que las respuestas varían un poco entre ejecuciones;
compara varias ejecuciones antes de sacar conclusiones de diferencias pequeñas.

Las configs se ejecutan una tras otra, cada una sobre el conjunto completo, así cada
modelo se carga una vez por config. La primera query de cada config carga por tanto
el coste de carga del modelo (`modelResidency: "cold"` o `"switched"`, `modelLoadMs` > 0)
y el resto son `"resident"`. Al terminar la ejecución, el modelo cargado antes se
recarga, para que el chat siga como antes.

## Ejecutarlo desde el ordenador (recomendado)

Un tutorial con ejemplo de salida, cómo funciona y consejos está en
[DEVICE_EVALUATION.md](DEVICE_EVALUATION.md).

`npm run eval:device` ejecuta la evaluación en un teléfono conectado por USB y trae
los resultados de vuelta, sin tocar nada. Es solo transporte: escribe una solicitud
en el almacenamiento privado de la app por adb, la app la ejecuta con el mismo
servicio de evaluación que la pantalla de Evaluación (que se abre en el teléfono y muestra
el progreso), y el script sondea hasta completar y descarga el resultado.

### Prerrequisitos

- `adb` en tu `PATH` (Android SDK platform-tools), y Node/npm con
  `npm install` hecho en el repo.
- El teléfono conectado por USB con la **depuración USB** activada y este ordenador
  **autorizado** (acepta el aviso "Allow USB debugging"). `adb devices` debe
  listarlo como `device`, no como `unauthorized` ni `offline`.
- Un **build de desarrollo debuggable** de la app (paquete `team.sopa.aoair`),
  p. ej. de `npx expo run:android`. Los builds de release/EAS no sirven: leer los
  resultados necesita `run-as`, y la recogida de solicitudes solo existe en builds
  de desarrollo. Con `--install` (o si falta la app) el script compila e instala uno
  con `npx expo run:android --no-bundler`.
- **Metro corriendo** en otra terminal: `make start` (o
  `npx expo start --localhost`). El script configura `adb reverse tcp:8081` y
  recarga la app desde Metro, así el teléfono siempre ejecuta el código actual.
- Configuración de primer arranque terminada en el teléfono, y cada modelo que
  quieras comparar ya descargado. El script nunca descarga modelos.
- Teléfono enchufado con la pantalla encendida (p. ej. Opciones de desarrollador → Stay awake).

### Comandos

```bash
npm run eval:device                                   # every installed model + adaptive, all 17 queries
npm run eval:device -- --models qwen2.5-1.5b,phi-3.5  # only these models (id or a fragment of it)
npm run eval:device -- --adaptive                     # only adaptive routing
npm run eval:device -- --models instella --adaptive   # a model and adaptive
npm run eval:device -- --queries greeting-1,reasoning # a subset, by query id or category
npm run eval:device -- --dry-run                      # print every adb command, run nothing
npm run eval:device -- --help                         # all options (--serial, --timeout-min, --no-reload, …)
```

El selector de modelo debe coincidir exactamente con un modelo instalado; un typo o un
fragmento ambiguo (`qwen2.5` con ambos modelos Qwen instalados) detiene la ejecución
y lista lo instalado.

### Qué hace

1. Comprueba con `adb devices` que haya exactamente un dispositivo autorizado (o `--serial`).
2. Comprueba que `team.sopa.aoair` esté instalada y sea debuggable, instalándola si
   falta.
3. Comprueba Metro y ejecuta `adb reverse tcp:8081 tcp:8081`.
4. Escribe `files/eval/requests/pending.json` mediante `run-as` y recarga la
   app a través del enlace dev-client.
5. Cuando los modelos están cargados, la app reclama la solicitud y abre la pantalla
   de Evaluación. Escribe el progreso en `files/eval/requests/<requestId>.status.json`,
   que el script sondea cada 5 segundos.
6. Descarga `files/eval/<runId>.jsonl`, lo guarda e imprime el informe.

### Salida

```
eval-results/<YYYY-MM-DD>/
  <runId>.jsonl        raw results, one row per answer (authoritative)
  <runId>.answers.md   every config's answer grouped by query, for grading
  <runId>.status.json  the final request status from the phone
```

El informe de terminal muestra, por configuración: queries con éxito/fallo,
TTFT, tiempo de carga del modelo (sobre las queries que cargaron un modelo), latencia
de generación, tokens/seg (media y p50), tiempo total por query, pico de RSS,
conteos de residency, cambios de modelo y uso de recuperación (con cuántos artículos
esperados del corpus se encontraron). Reimprímelo cuando quieras con
`npm run eval:summary -- --report eval-results/<date>/<runId>.jsonl`.

## Ejecutarlo en el dispositivo a mano

1. Compila e instala la app como se describe en [AGENTS.md](../../AGENTS.es.md), termina
   la configuración de primer arranque, y descarga los modelos extra que quieras comparar
   (Ajustes → Modelos).
2. Mantén el teléfono enchufado con la pantalla encendida (por ejemplo, Opciones de
   desarrollador → Stay awake). Poner la app en segundo plano o bloquear el teléfono
   puede interrumpir una ejecución.
3. Abre el drawer → **Execution Telemetry** → **🧪 Evaluate**.
4. Marca las configuraciones a comparar (por defecto, cada modelo instalado más
   el enrutado adaptativo) y pulsa **▶ Run**. El progreso muestra la config y la
   query actuales. **■ Stop** termina la ejecución tras la respuesta actual y conserva
   los resultados parciales.
5. Al terminar, los resultados se guardan en el dispositivo como
   `files/eval/<runId>.jsonl`. **⬇ JSONL** y **⬇ CSV** abren el share
   sheet para enviarlos a tu ordenador.

Espera unas 17 respuestas × (segundos a un minuto cada una) por config, según
el modelo y el teléfono.

### Llevar los resultados a tu ordenador

Cualquiera de estas sirve:

- **Share sheet**: los botones de exportar (gestor de archivos, email, Nearby Share, …).
- **Terminal de Metro**: con el dev client conectado, cada respuesta se imprime como
  una línea `[EVAL] {...}`. Guarda la salida del terminal en un archivo; el script
  de resumen lee esas líneas directamente.
- **adb** (builds debuggable/dev-client):

  ```bash
  adb exec-out run-as team.sopa.aoair ls files/eval
  adb exec-out run-as team.sopa.aoair cat files/eval/<runId>.jsonl > <runId>.jsonl
  ```

Cada fila también se escribe en la telemetría de ejecución normal, así las ejecuciones
de eval aparecen en la pantalla de Execution Telemetry y sus exports como cualquier
otro mensaje.

## Comparar resultados

```bash
node scripts/eval-summary.mjs results/*.jsonl            # one line per run + config
node scripts/eval-summary.mjs --report results/*.jsonl   # detailed per-config report (as printed by eval:device)
node scripts/eval-summary.mjs --answers results/*.jsonl  # answers side by side, per query (markdown)
```

El resumen lista, por config, éxitos, fallos, cuántos artículos KB esperados
se recuperaron, TTFT mediano, tokens/seg medianos, tiempo total mediano,
tiempo máximo de carga de modelo y pico de RSS. `--answers` agrupa la respuesta
de cada config bajo cada query, para calificar contra las notas anteriores.

### Campos de resultado

Cada fila JSONL (y línea CSV) contiene:

- **Run:** `runId`, `evalSetVersion`, `configId`, `configLabel`,
  `routingPreset` (solo adaptive), `personalityId`, `maxTokens`, `createdAt`.
- **Query:** `queryId`, `category`, `query`, `expectedKbTitles`.
- **Answer:** `answer`, `promptFormat` (`chat-template`/`plain`), `outcome` (`success`/`failure`/`cancelled`),
  `errorMessage`, `timedOut`.
- **Routing:** `modelId` (el modelo que generó la respuesta), `taskType`,
  `adaptiveRoutingUsed`, `reasonCodes`.
- **Retrieval:** `retrievalUsed`, `retrievedTitles`, `expectedKbHit`.
- **Model:** `modelSwitches` (dentro del plan), `crossMessageModelSwitch`,
  `modelResidency`, `modelLoadMs`.
- **Timing and resources:** `ttftMs` (de la llamada de generación al primer
  token, carga excluida), `generationLatencyMs` (del primer token al final),
  `totalLatencyMs` (la query completa), `tokensGenerated`, `tokPerSec`,
  `peakRssBytes`.

Los campos de métricas significan exactamente lo que significan en la telemetría de
ejecución (ver `src/services/executionTelemetry.pure.ts` y `src/routing/executor.ts`).
