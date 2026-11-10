# Estudio de la calidad de las respuestas generales · 0.1.92

Continúa el anexo F del paquete de la 0.1.91 (familia 7: «las respuestas
están flojas»). Aquel anexo cerró sin tocar ninguna palanca porque no
había instrumento que generara con el modelo real. Este estudio monta
ese instrumento y mide.

## El instrumento

- **Modelo:** el archivo exacto del catálogo, `Qwen3-0.6B-Q4_K_M.gguf`
  en la revisión fijada `50968a44…a56b`. Tamaño 396.705.472 bytes y
  sha256 `ac2d9771…d524a`: los dos coinciden con el catálogo.
- **Motor:** llama.cpp vía `llama-cpp-python` 0.3.16, en CPU (2 hilos).
  No es llama.rn: el modelo y sus pesos son los mismos, la capa nativa
  de Android no. Lo que aquí se mide es el modelo con el prompt de la
  app, no la app en un teléfono.
- **Prompt:** los mensajes los arma el código real de la ruta fija
  (`assembleChatMessages`, tono «Conciso y directo», nota de «sin
  fuentes», ventana de 1024). Se vuelcan con
  `scripts/benchmarks/house-llm/dump-cases.vitest.ts.txt` y se pasan
  por la plantilla ChatML del propio GGUF.
- **Muestreo:** el de la charla libre en la app para este modelo:
  temperatura 0,7, topP 0,8, topK 20, penalización de repetición 1,1.
- **Presupuesto:** el que la app asigna en la ventana estrecha (≈ 410
  tokens de generación).
- **Lectura:** solo métricas calculadas por programa (expresiones
  regulares sobre la respuesta). Ninguna puntuación puesta a mano.
- **Repeticiones:** 8 semillas por pregunta en el banco general, 6 en el
  de cuentas. El muestreo es aleatorio: una pasada sola no mide nada.

Guiones y resultados en bruto: `scripts/benchmarks/house-llm/`.

## 1. El banco del dueño, con lo publicado (0.1.91)

Siete preguntas del anexo F, 8 semillas cada una (56 respuestas).

| Medida | Resultado |
| --- | --- |
| Responde en español | 56/56 |
| Se abstiene («no sé…») | 1/56 |
| Llega al tope de tokens | 0/56 |
| Largo medio | 44 tokens |
| Llanta en 5 pasos: da exactamente 5 pasos | 8/8 |
| Llanta: menciona gato, tuercas, repuesto, aflojar, apretar (0 a 5) | 0,25 de media |
| Huevos (3 × 12 − 7): dice 29 | 0/8 |
| Tren (9:00 + 2 h 30 + 40 min): dice 12:10 | 0/8 |
| Cuento: hay zorro y nada | 8/8 |
| Correo: menciona la música | 8/8 |

La «flojera» que vio el dueño se reproduce: la llanta sale sin gato ni
tuercas y las cuentas salen mal siempre («Me quedan 5 huevos»). La
contradicción del motor («en marcha… desactiva el motor») no apareció
en 16 respuestas de llanta.

## 2. Las palancas del anexo F, medidas

Mismo banco, mismas semillas. Cada columna cambia una sola cosa.

| Medida | Publicado | Temp. 0,5 | Nota «sin fuentes» reescrita | Sin nota | Sistema mínimo | Sin recordatorio de estilo |
| --- | --- | --- | --- | --- | --- | --- |
| Se abstiene | 1/56 | 1/56 | 3/56 | 1/56 | 1/56 | 4/56 |
| Llanta, cobertura (0 a 5) | 0,25 | 0,19 | 0,31 | 0,06 | 0,12 | 0,25 |
| Huevos correctos | 0/8 | 0/8 | 0/8 | 1/8 | 0/8 | 0/8 |
| Tren correcto | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 |
| Largo medio (tokens) | 44 | 42 | 42 | 40 | 40 | 44 |

**Ninguna mueve nada medible.** Bajar la temperatura, reescribir o
quitar la nota de «sin fuentes», acortar el sistema o quitar el
recordatorio de estilo dejan las respuestas donde estaban. Quedan
contestadas las preguntas abiertas 1 a 3 del anexo F: no se tocan.

## 3. Razonar: la palanca que sí mueve

El Qwen3 trae un modo de razonamiento que el catálogo apaga (`noThink`).
Encendido para **todo** el banco:

| Medida | Directo (publicado) | Razonando siempre |
| --- | --- | --- |
| Huevos correctos | 0/8 | 8/8 |
| Tren correcto | 0/8 | 4/8 |
| Llanta, cobertura (0 a 5) | 0,25 | 0,62 |
| Largo medio (tokens) | 44 | 189 |
| Respuestas en inglés a preguntas en español | 0/56 | 11/56 |

Arregla las cuentas, pero cuesta más de cuatro veces en tokens (y por
tanto en tiempo) y una de cada cinco respuestas se va al inglés: las 8
de la llanta numerada salieron en inglés. Encenderlo para todo sería
cambiar un defecto por otro.

## 4. Razonar solo en las cuentas

Diez preguntas de cuentas (siete en español, dos en inglés, una en
portugués), 6 semillas, con el presupuesto de la ventana estrecha.

| Medida | Directo | Razonando |
| --- | --- | --- |
| Respuestas correctas | 16/60 | 41/60 |
| Se queda sin respuesta (el razonamiento no terminó) | 0/60 | 3/60 |
| Llega al tope | 0/60 | 4/60 |
| Tokens: mediana / percentil 90 / máximo | 15 / 43 / 80 | 143 / 347 / 410 |

Por pregunta (correctas de 6, directo → razonando): huevos 0 → 6;
tren 0 → 1; cambio de un billete 1 → 5; 15 % de 200, 6 → 6; lo que
queda de 250 pesos, 0 → 6; arroz para 10 personas, 1 → 5; minutos en 3
horas y cuarto, 0 → 0; manzanas (inglés) 6 → 6; hora de fin de la
película (inglés) 1 → 3; galletas (portugués) 1 → 3.

Las respuestas en español siguieron en español. Las tres que se
quedaron sin respuesta fueron las de portugués.

Las 60 respuestas razonadas se pasaron además por el camino real de la
app (`trimRepetitionLoop`, `trimToCompleteSentences`, `stripThinking`):
la guarda de bucles no se disparó en ninguna y 59 de 60 conservaron la
misma respuesta.

## Lo que cambia en la 0.1.92

- El turno de **cuentas** razona, y solo ese turno, y solo en el modelo
  donde se midió (Qwen3-0.6B). Condiciones: ruta fija, sin fuentes,
  plantilla de chat, al menos 384 tokens de generación asignados, y una
  pregunta con dos o más cifras y una pregunta de cantidad o de hora.
  Código: `src/routing/calculationQuestion.ts`.
- Si el razonamiento se queda sin respuesta, el turno se responde
  directo, como hasta la 0.1.91, en vez de quedarse en «No pude generar
  una respuesta».
- El razonamiento se ve y se pliega como ya ocurre con los modelos que
  razonan (LFM2.5); no entra en el historial.
- Temperatura, textos de sistema, nota de «sin fuentes» y recordatorio
  de estilo: **no se tocan**, por medida.

## Otros hechos medidos

- **El estimador de tokens de la app es conservador.** Para estos
  prompts estima 537 a 562 tokens; el tokenizador real del Qwen3 cuenta
  327 a 359. Sobrestima en torno a un 60 %. No rompe nada (nunca
  desborda la ventana), pero en la ventana de 1024 asigna unos 410
  tokens de generación cuando caben unos 690. No se toca en esta
  versión: afinarlo pide medirlo también en los otros modelos.
- **La cuenta de llamadas de `onToken` no es la cuenta de tokens.** En
  280 respuestas, 6 tenían algún token con un carácter UTF-8 a medias y
  44 tenían saltos de línea: son los dos casos en que llama.rn retiene
  la llamada. Es la base del arreglo de la señal de corte de esta
  versión (`src/inference/generationCut.ts`).

## Lo que no se midió

- Nada de esto corrió en un teléfono. Los tiempos reales en la Tab A9+
  (un turno que razona genera unas diez veces más tokens que uno
  directo) y el comportamiento de llama.rn con el razonamiento
  encendido quedan para la ronda física.
- Solo se midió el Qwen3-0.6B. El Qwen2.5-0.5B no tiene modo de
  razonamiento.
- El banco de cuentas son diez preguntas. «Minutos en 3 horas y cuarto»
  no la acierta de ninguna forma: el techo del modelo sigue ahí.
- La calidad de fondo de la llanta (gato, tuercas, repuesto) no mejora
  con ninguna palanca de la app que no sea razonar siempre, y esa se
  descarta por el idioma y el coste. Lo que la arreglaría es una guía
  en un pack, que sale literal y sin modelo.
