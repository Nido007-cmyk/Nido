> **Idioma:** [English](../DEVICE_EVALUATION.md) · Español
# Benchmark de modelos en un teléfono real

BOAR puede hacer benchmark de cualquier modelo instalado en un teléfono
Android real, dirigido desde tu computadora con un comando. El teléfono
corre las preguntas y muestra progreso en vivo en su pantalla de
Evaluación, y la computadora recoge los resultados.

```bash
npm run eval:device -- --models lfm2.5
```

```
✓ device SSYLAQFILNBEKBEQ
✓ team.sopa.aoair installed (debuggable)
✓ Metro running, adb reverse tcp:8081 set
✓ request req-20260924t054219-safr written: {"requestId":"req-20260924t054219-safr","models":["lfm2.5"]}
✓ app reloading from Metro
  [00:00] waiting for the app to pick up the request…
  [00:20] 0/17 — model:hf-liquidai-lfm2-5-8b-a1b-… / greeting-1
  [01:52] 3/17 — model:hf-liquidai-lfm2-5-8b-a1b-… / explanation-1
  …
BOAR Device Evaluation — eval-2026-09-24T… (set v1, 17 queries)
  Queries:         17 ok · 0 failed · 0 cancelled (of 17)
  TTFT:            avg … · p50 …
  Tokens/sec:      avg … · p50 …
  Peak RSS:        … GB
  …
Raw results (authoritative): eval-results/2026-09-24/eval-….jsonl
Answers for grading:         eval-results/2026-09-24/eval-….answers.md
```

Cada respuesta recibe las mismas mediciones, directo del teléfono: tiempo
de carga del modelo, cold/switched/resident, tiempo al primer token,
tiempo de generación, tokens/seg, tiempo total, memoria pico, qué
artículos se recuperaron, y qué formato de prompt recibió el modelo (su
propio chat template, o el fallback plano).

## Dos formas de correrlo

**Desde la computadora (recomendado).** `npm run eval:device` verifica el
teléfono, envía la petición, recarga la app para que corra tu código
actual, espera, extrae los resultados e imprime el reporte. Nada que
tocar.

**En el teléfono.** Drawer → Execution Telemetry → 🧪 Evaluate. Marca los
modelos y el enrutamiento adaptativo, toca ▶ Run, y exporta JSONL o CSV
por el share sheet cuando termine.

Ambos corren el mismo código de evaluación (`src/eval/`), así los
resultados son idénticos en forma y comparables.

## Setup, una vez

1. **En la computadora:** Node/npm con `npm install` hecho, y `adb`
   (Android SDK platform-tools) en tu `PATH`.
2. **En el teléfono:** Opciones de desarrollador → depuración USB on.
   Conecta el cable y acepta "Allow USB debugging". `adb devices` debe
   mostrarlo como `device`.
3. **Una compilación de desarrollo de BOAR** instalada (`npx expo
   run:android`, o `npm run eval:device -- --install` compila e instala
   una). Las compilaciones release no pueden dirigirse así a propósito: la
   recogida de peticiones solo existe en compilaciones de desarrollo, y
   leer resultados necesita una app debuggable.
4. **Metro corriendo** en otra terminal: `make start` (o
   `npx expo start --localhost`).
5. **Modelos descargados** en la app (Configuración → Modelos). La
   herramienta nunca descarga modelos.

## Comandos

```bash
npm run eval:device                                   # every installed model + adaptive routing, all 17 questions
npm run eval:device -- --models qwen2.5-1.5b,phi-3.5  # specific models (id or a fragment of it)
npm run eval:device -- --adaptive                     # adaptive routing only
npm run eval:device -- --queries greeting-1,reasoning # some questions, by id or category
npm run eval:device -- --dry-run                      # print every adb command, run nothing
npm run eval:device -- --help                         # all options (--serial, --timeout-min, --no-reload, …)
npm run eval:summary -- --report <file.jsonl>         # re-print a report
npm run eval:summary -- --answers <file.jsonl>        # answers side by side, for grading
```

Un nombre de modelo debe coincidir con exactamente un modelo instalado.
Un typo o un nombre ambiguo (`qwen2.5` con dos modelos Qwen instalados)
detiene la corrida y lista lo instalado.

## Resultados

Guardados bajo `eval-results/<fecha>/` (gitignored; commitea una corrida a
propósito cuando quieras que quede en registro):

- `<runId>.jsonl` — una fila por respuesta, el resultado autoritativo
- `<runId>.answers.md` — la respuesta de cada modelo a cada pregunta, lado
  a lado
- `<runId>.status.json` — el estado final reportado por el teléfono

Las preguntas y cada campo de resultado están descritos en
[EVAL_QUERIES.md](EVAL_QUERIES.md).

## Cómo funciona

La computadora nunca habla con el modelo. Solo escribe un pequeño archivo
de petición en el almacenamiento privado de la app (vía `adb run-as`) y
lee los resultados de vuelta igual. Dentro de la app, un watcher solo de
desarrollo recoge la petición, abre la pantalla de Evaluación y la corre;
la app nunca llama a adb.

```
computer                                    phone (BOAR, development build)
─────────                                   ───────────────────────────────
adb devices, checks install and Metro
write files/eval/requests/pending.json ───▶ picks up the request once models are loaded
reload the app from Metro                   runs every question on the selected models
poll …/<requestId>.status.json ◀─────────── writes progress after each answer
pull files/eval/<runId>.jsonl ◀──────────── saves the results
print the report
```

## Tips

- **Mantén la pantalla encendida y la app abierta.** Bloquear el teléfono
  mueve BOAR al background, y algunos teléfonos cortan su conexión o lo
  limitan. Algunos teléfonos, como Xiaomi/HyperOS, bloquean cambiar "Stay
  awake" sobre adb. Si la pantalla se apagaría durante una corrida larga,
  envía una pulsación de tecla de vez en cuando:
  `while true; do adb shell input keyevent KEYCODE_WAKEUP; sleep 30; done`.
- **El calor importa.** Los tokens/seg cayeron cerca de un tercio en una
  corrida de 66 minutos conforme el teléfono se calentaba. Compara modelos
  de corridas en condiciones similares, y anota la temperatura de batería
  (`adb shell dumpsys battery`).
- **No inicies una corrida durante una descarga de modelo.** La corrida
  recarga la app, y una descarga no puede reanudarse tras una recarga.
- **Un modelo que falla al cargar no se salta silenciosamente.** Cada
  pregunta se registra como fallo con la razón, y la corrida sigue con el
  siguiente modelo.
- **Las respuestas varían ligeramente entre corridas** (temperature 0.7).
  Los timings comparan bien; para calidad, mira más de una corrida.
