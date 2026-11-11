# El modelo se carga cuando el turno lo necesita (2026-11-11)

## El defecto, probado en el código de la 0.1.93

Desde la carga perezosa de la 0.1.83, lo primero que hacía el envío era
esto (`src/ui/ChatScreen.tsx`, función `send`):

```ts
if (!llamaEngine.isLoaded) {
  const ok = await ensureChatModel();
  if (!ok) return;
}
```

Iba antes de mirar el texto. Todo lo demás venía después: el
autoconocimiento, la charla básica, las respuestas fijas de seguridad
(monóxido, números de emergencia), los datos de los packs, las vías
deterministas del agente (hora, notas, recordatorios, memoria), la guía
literal y el texto seguro de salud.

Dos consecuencias:

1. **Tiempo y memoria gastados sin motivo.** Con el modelo descargado
   (arranque, o tres minutos sin actividad), una pregunta que responde
   una guía o la capa determinista esperaba la carga entera del modelo y
   ocupaba su memoria, aunque por ley esa pregunta no llega al modelo.
2. **Sin modelo no había respuesta de ningún tipo.** Si el modelo no
   cabía en la memoria disponible, el envío se detenía en ese `return`:
   tampoco salían el número de emergencia, el texto fijo ni la guía, que
   no necesitan modelo.

## El cambio

El envío ya no carga nada por adelantado. Cada camino que genera pide el
modelo justo antes de usarlo, con `requireChatModel`:

| Camino | Dónde lo pide |
| --- | --- |
| Capa determinista del chat (autoconocimiento, charla, seguridad fija, datos de packs) | Nunca |
| Bucle del agente, vías deterministas (hora, notas, recordatorios, memoria) | Nunca |
| Bucle del agente, cuando llega al modelo | `prepareEngine`, una vez, antes del primer `generate` |
| Guía literal y texto seguro de salud | Nunca |
| Ruta fija | Después de la guía, la recuperación y la puerta de salud |
| Ruta adaptativa | Antes de `runAdaptiveChat` |
| Investigar | Antes de `runDeepResearch` |
| Resumen en segundo plano | Solo si el modelo ya está cargado |

Lo que no cambia:

- La carga es la misma (`ensureChatModel` → `llamaEngine.load`), con su
  lectura de memoria real en cada intento, su escalera y su franja
  «Cargando modelo…».
- Un turno que genera carga y responde igual que antes.
- Si el modelo no cabe, la tarjeta de memoria sale igual. La diferencia
  es que ahora el mensaje de la persona queda en el chat y la burbuja
  enseña el motivo, en vez de quedarse el texto en la caja.
- El bucle del agente presupuesta contra el `n_ctx` del modelo que de
  verdad quedó cargado (lo devuelve `prepareEngine`), no contra uno
  supuesto.

## Telemetría

La carga ocurre ahora dentro del turno, así que se mide aparte para que
las cifras sigan siendo comparables con las de la 0.1.93:

- `modelLoadMs`: lo que tardó la carga en ese turno (antes solo lo
  rellenaba la ruta adaptativa).
- `ttftMs`: sigue siendo la espera del primer token **sin** la carga.
- `tokPerSec`: sigue sin contar la carga.

## Lo que no se midió

Nada de esto corrió en un teléfono. El cambio está probado por pruebas
de unidad y de cableado (`src/agent/loop/prepareEngine.test.ts`) y por
la suite entera. Los segundos que ahorra dependen de cuánto tarda la
carga en cada aparato, y eso solo lo da el aparato.

## Cómo medirlo en la Tab A9+

Con la 0.1.93 y con el candidato, mismo orden:

1. Abrir NIDO y esperar tres minutos sin tocar (o forzar cierre y
   abrir): el modelo queda descargado.
2. Enviar una pregunta que responde una guía (por ejemplo, «¿qué hago
   si alguien se atraganta?»). Anotar los segundos hasta que aparece el
   texto y si salió la franja «Cargando modelo…».
3. Repetir el paso 1 y enviar «gracias», «¿qué hora es?» y «¿cuál es el
   número de emergencias?». Anotar lo mismo.
4. Repetir el paso 1 y enviar una pregunta que genera («cuéntame un
   cuento corto»). En Telemetría de ejecución, anotar carga, primer
   token, tokens por segundo y pico de memoria.
5. En el candidato, el paso 2 y el 3 deben responder sin franja de
   carga y con el pico de memoria del turno por debajo del de un turno
   que genera. El paso 4 debe dar las mismas cifras que la 0.1.93, con
   la carga ahora en su propia casilla.
