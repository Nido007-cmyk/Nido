# El estimador de tokens contaba de menos con cifras y tablas (2026-11-11)

## El defecto, probado

El presupuesto de contexto (`src/agent/loop/contextBudget.ts`,
`defaultTokenCounter`) y su gemela del agente (`estimatePromptTokens`)
estimaban los tokens como `ceil(longitud / 4) + 50`. El tokenizador de
Qwen parte cada cifra en un token propio, así que un texto con números
(tablas de dosis, horarios, teléfonos, cantidades) ocupa mucho más de lo
que el estimador creía.

Medido con el tokenizador real de los dos GGUF del catálogo
(llama-cpp-python 0.3.16, modo `vocab_only`):

- Qwen2.5-0.5B-Instruct Q4_K_M, sha256 `6eb923e7…8653`
- Qwen3-0.6B Q8_0, sha256 `ac2d9771…524a`

| Texto | Tokens reales | Estimación vieja |
| --- | ---: | ---: |
| Fragmento de documento con tabla (`doc-tabla`) | 1649 | 717 |

Corrección a lo que dije antes en la conversación: llama.rn **no recorta
el prompt en silencio**. Con `ctx_shift` en falso (su valor por defecto),
un prompt igual o mayor que `n_ctx` se rechaza con «Context is full», y
si la ventana se llena a mitad de respuesta, la respuesta se corta
(`context_full`, que `generationCut.ts` ya marca con la nota de corte).

Consecuencias reproducidas con el ensamblado real de mensajes del chat y
el tokenizador real (prompt real en tokens, reserva de respuesta 512):

| Caso | Antes | Después |
| --- | --- | --- |
| Tabla, nCtx 1024 | 0 fuentes entran (el fragmento no cabía y no se podía partir) | 1 fuente, 539 tokens, OK |
| Tabla, nCtx 2048 | 1 fuente, 1905 tokens: respuesta cortada a 143 tokens | 1 fuente, 1274 tokens, OK |
| Tabla, nCtx 4096 | 4 fuentes, 6953 tokens: «Context is full» | 1 fuente, 1905 tokens, OK |
| Prosa, nCtx 1024 | el turno muere: system (297) + mensaje actual (512) + reserva (256) exceden 1024 | 1 fuente, 514 tokens, OK |
| Prosa, nCtx 2048 | 805, OK | 805, OK (igual) |
| Prosa, nCtx 4096 | 2479, OK | 2479, OK (igual) |

El caso «prosa 1024» era un segundo defecto: `fitChunksToBudget` medía
el texto de las fuentes una sola vez, pero en la vía de mensajes las
fuentes se repiten en el mensaje de sistema y en el mensaje actual; el
juez que decide si el turno cabe las contaba dos veces y el ajuste solo
una.

## El cambio

1. **`estimateTokens`** (en `contextBudget.ts`), una sola función para
   las dos gemelas:
   `ceil(longitud/3 + cifras·2/3 + números + no-latinos·2/3) + 50`.
   Cada cifra cuenta un token entero; cada número suma uno por su borde;
   los caracteres fuera del latín extendido cuentan un token.
2. **`fitChunksToBudget`** acepta una medida opcional. La vía de mensajes
   le pasa la medida real (system + mensaje actual), la misma que usa el
   juez. Sin medida, el comportamiento es el de siempre.
3. **Cortes por línea** (`cutOffsets`): al recortar un fragmento que no
   cabe, se puede cortar en fin de frase o en fin de línea. Una tabla no
   tiene fin de frase; antes se perdía entera.

## Lo que cuesta

| Texto | Reales | Viejo | Nuevo |
| --- | ---: | ---: | ---: |
| System prompt de actuar | 1403 | 1705 | ~1757 |
| System prompt de conversar | 404 | 505 | — |
| System prompt de recordar | 293 | 394 | — |
| Prosa de las guías (media) | — | — | +3,7 % sobre el viejo |

En prosa normal el nuevo estimador gasta un 3,7 % más de presupuesto que
el viejo. A cambio, ya no subestima los textos con números.

## Pruebas

- `src/agent/loop/__fixtures__/tokenCounts.json`: 129 textos (guías en
  es, en y pt, prompts reales de la app, casos adversarios, la tabla) con
  su recuento real.
- `src/agent/loop/estimateTokens.test.ts` (164 pruebas): el nuevo nunca
  cuenta de menos salvo en los límites conocidos; el viejo falla con la
  tabla; en prosa queda por debajo de 1,1× el viejo; las dos gemelas dan
  lo mismo; el caso de la tabla a nCtx 2048 deja sitio a la respuesta.
- `src/rag/fitChunksMessages.test.ts` (8 pruebas): con nCtx 1024, 1280,
  1536, 2048 y 3072 nunca se lanza y siempre `usado + reserva ≤ nCtx`.

## Límites conocidos

El estimador sigue contando de menos en tres casos adversarios, que la
prueba deja fijados para que no empeoren sin verse: código fuente
(`adv-codigo`), texto todo en mayúsculas (`adv-mayus`) y ristras de
puntuación (`adv-puntuacion`). Ninguno aparece en las guías ni en los
prompts de la app.

## Lo que no se midió

Nada de esto corrió en un teléfono. Las cifras salen del tokenizador
real y del ensamblado real, fuera del aparato.

## Cómo medirlo en la Tab A9+ (techo nCtx 2048)

1. Importar un documento con una tabla larga de cifras (por ejemplo, una
   tabla de dosis o de horarios de 40 filas).
2. Preguntar algo que solo la tabla responde. En la 0.1.93: anotar si la
   respuesta sale con nota de corte o con error. En el candidato: la
   respuesta debe salir entera y citar la fuente.
3. En Telemetría de ejecución, anotar los tokens del prompt y si hubo
   `context_full`.
