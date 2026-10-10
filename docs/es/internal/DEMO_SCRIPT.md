> **Idioma:** [English](../../internal/DEMO_SCRIPT.md) · Español
# Guion de demo

Para el post de demo pública que pide el bounty: la app corriendo offline,
varias preguntas incluyendo unas que un modelo 1B fallaría, el enlace al
repo, y una explicación corta del enfoque. Cada pregunta aquí viene de la
[evaluación en dispositivo](../DEVICE_EVALUATION.md), así el resultado
mostrado en cámara coincide con un resultado medido.

## Antes de filmar

1. Instala la compilación release exacta que enviarás (ver
   `SUBMISSION_CHECKLIST.md`).
2. Ten **Qwen2.5-1.5B** y **LFM2.5-8B-A1B** descargados (Configuración →
   Modelos de Razonamiento).
3. Configuración → Tono del Asistente y Estilo de Respuesta:
   - **Max Output Tokens: 1024.** LFM2.5 razona antes de responder, y con
     512 tokens se quedó sin presupuesto antes de la respuesta en 4 de 17
     preguntas del benchmark.
   - **Adaptive Routing: off**, para que el modelo que elijas con "Select
     & Use" sea el que responde.
   - Tono: Succinct & Direct.
4. Carga el teléfono y déjalo enfriar; la velocidad cae cuando se calienta.
5. Haz un ensayo completo de cada pregunta de abajo con la misma
   compilación y configuración. Filma solo preguntas que respondieron
   correctamente en el ensayo.

## Grabación

Graba la pantalla del teléfono (o fílmalo) en una toma, con la barra de
estado visible.

### 1. Prueba que está offline (10 s)

Desliza los ajustes rápidos: modo avión encendido, Wi-Fi apagado, datos
móviles apagados. Mantén la barra de estado visible todo el video.

### 2. La pregunta que un modelo pequeño falla (60 s)

Con **Qwen2.5-1.5B** activo, pregunta:

> A device has a 12GB RAM budget. The OS and app overhead take 2GB, the embedding
> model needs 200MB, and the LLM's KV cache needs 1.5GB. How much is left for the
> LLM's weights, and would a 9GB model fit if loaded fully into RAM?

En el benchmark respondió "5GB … a 9GB model would fit": ambas mal.

Cambia a **LFM2.5-8B-A1B** (Configuración → Modelos de Razonamiento →
Select & Use), mantén presionada tu pregunta para devolverla al input, y
envíala de nuevo. Mientras razona, el indicador 💭 muestra que está
pensando. En el benchmark respondió: "About 8.3 GB remains, and a 9 GB
model would not fit." (correcto, unos 30 s).

Dilo: este es un modelo mixture-of-experts, 8B parámetros en total, unos
1.5B activos por token.

### 3. Una comparación (60 s)

> Compare the French Revolution and the Industrial Revolution.

Señala las fuentes citadas bajo la respuesta: ambos artículos vienen de la
base de conocimiento offline en el teléfono.

### 4. Una síntesis (60 s)

> What do the Agricultural Revolution and the Industrial Revolution have in common
> as turning points in human history, and how did they differ in how quickly they
> changed daily life?

### 5. Una pregunta práctica de viajero (opcional, 45 s)

> How do vaccines work?

o algo que un viajero realmente preguntaría offline. Ensáyalo primero.

### 6. Muestra las mediciones (20 s)

Drawer → Execution Telemetry: cada respuesta que acabas de pedir, con el
modelo, tiempo de carga, tiempo al primer token, tokens/seg y memoria
pico. Luego About → "Benchmark it yourself".

## Borrador del post

> el proyecto original: an offline AI research app for Android. No signal needed after a 1 GB
> first-run setup.
>
> Airplane mode on, and it still answers explanations, comparisons and multi-step
> questions from a local knowledge base, with sources.
>
> It runs a mixture-of-experts model on the phone (LFM2.5, 8B total, ~1.5B active
> per token) at ~15 tok/s on a Dimensity 8300, and it measures itself: every
> model is benchmarked on the device, results in the repo.
>
> [video]
>
> Repo: https://github.com/rferrari/boar-app
> Bounty: https://poidh.xyz/mainnet/bounty/31

Ajusta los números a lo que muestre la corrida final del benchmark.
