> **Idioma:** [English](../../demo/README.md) · Español

# Demo de BOAR

Publicado en X: [el hilo de BOAR](https://x.com/arferrari/status/2103677576380387484).

Grabado en un teléfono Xiaomi (MediaTek Dimensity, 12 GB de RAM) en modo avión,
con el modelo por defecto, Qwen2.5-1.5B-Instruct (alrededor de 1 GB). Nada sale
del teléfono.

## Videos

<video src="https://github.com/rferrari/boar-app/raw/refs/heads/main/docs/demo/boar_demo_small.mp4" controls width="360">
  <a href="https://github.com/rferrari/boar-app/raw/refs/heads/main/docs/demo/boar_demo_small.mp4">Reproducir la demo de BOAR (4:01)</a>
</video>

Toca una vista previa para reproducir el clip completo.

<table>
<tr>
<td width="25%"><a href="1-offline-first-question.mp4"><img src="previews/1.gif" alt="Offline, primera pregunta"></a></td>
<td width="25%"><a href="2-prompt-idea.mp4"><img src="previews/2.gif" alt="Un prompt de investigación"></a></td>
<td width="25%"><a href="3-follow-up-context.mp4"><img src="previews/3.gif" alt="Seguimiento"></a></td>
<td width="25%"><a href="4-facts-and-math.mp4"><img src="previews/4.gif" alt="Datos y matemáticas"></a></td>
</tr>
<tr>
<td><b>1. Offline, primera pregunta</b> (0:35). Modo avión activado, una pregunta respondida con fuentes de la biblioteca offline.</td>
<td><b>2. Un prompt de investigación</b> (1:17). Un prompt listo de Prompt Ideas: una pregunta de síntesis entre temas.</td>
<td><b>3. Seguimiento</b> (1:21). "interesting, continue": la respuesta retoma la conversación hasta el momento.</td>
<td><b>4. Datos y matemáticas</b> (0:38). La capital de Australia desde el paquete Wikipedia Vital Articles, y luego 7×8.</td>
</tr>
</table>

El recorrido completo en un archivo: [boar_demo_small.mp4](boar_demo_small.mp4) (4:01).

## Capturas de pantalla

<table>
<tr>
<td width="33%"><img src="screenshots/01-offline-answer-sources.png" alt="Respuesta con fuentes offline"></td>
<td width="33%"><img src="screenshots/03-prompt-ideas.png" alt="Prompt Ideas"></td>
<td width="33%"><img src="screenshots/02-menu.png" alt="Menú"></td>
</tr>
<tr>
<td><b>Respuestas con fuentes.</b> Cada respuesta lista los artículos offline que usó y qué tan bien coincidió cada uno. La insignia OFFLINE y el icono de avión son reales.</td>
<td><b>Prompt Ideas.</b> Preguntas de investigación listas para probar la app.</td>
<td><b>Menú.</b> Sesiones pasadas, tus propios documentos, ajustes y telemetría. El uso de RAM y disco siempre visible abajo.</td>
</tr>
<tr>
<td><img src="screenshots/04-models.png" alt="Modelos instalados"></td>
<td><img src="screenshots/05-more-models.png" alt="Más modelos y búsqueda en Hugging Face"></td>
<td><img src="screenshots/06-telemetry.png" alt="Telemetría de ejecución"></td>
</tr>
<tr>
<td><b>Modelos.</b> El modelo por defecto y el modelo de embeddings, más opcionales a los que puedes cambiar con un toque.</td>
<td><b>Trae tu propio modelo.</b> Modelos mixture-of-experts y Gemma probados en este teléfono, y una búsqueda de cualquier modelo GGUF en Hugging Face.</td>
<td><b>Telemetría de ejecución.</b> Cada respuesta se mide: tokens por segundo, tiempo hasta el primer token, pico de memoria. Exporta como JSON o CSV.</td>
</tr>
<tr>
<td><img src="screenshots/07-memory-storage.png" alt="Memoria y almacenamiento"></td>
<td><img src="screenshots/08-benchmark-engine.png" alt="Último benchmark y motor"></td>
<td></td>
</tr>
<tr>
<td><b>Memoria y almacenamiento.</b> El uso de RAM de la app contra el límite de 12 GB, y su almacenamiento contra el presupuesto de 50 GB.</td>
<td><b>Motor.</b> Los números de la última respuesta y el modelo, tamaño de contexto, hilos y licencia en uso (llama.cpp vía llama.rn).</td>
<td></td>
</tr>
</table>

## Medido en el teléfono

Seis preguntas de conocimiento con el modelo por defecto de 1.5B y el paquete
Vital Articles (`npm run eval:device`, 2026-09-24): 6 de 6 respondidas
correctamente, todas desde artículos recuperados, alrededor de 10.6 s por
respuesta (6.4 s hasta la primera palabra, 17.5 tokens/s), 1.76 GB de pico de
memoria. Ver [DEVICE_EVALUATION.md](../DEVICE_EVALUATION.md) para ejecutarlo tú mismo.
