/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.92 (auditoría del paquete 0.1.91, familia 6) — ¿la generación se
 * detuvo por el TOPE, o terminó sola?
 *
 * Hasta la 0.1.91 el hecho se deducía contando llamadas de onToken:
 * `tokenCount >= nPredict`. Pero llama.rn (0.13.0-rc.7, y el mismo bucle en rc.9 y en rc.11, leído en su
 * código: cpp/jsi/RNLlamaJSI.cpp, bucle de llamaCompletion; la rc.11 se
 * re-leyó en la tanda T-22 y el bucle conserva el salto por UTF-8 a
 * medias y la retención por STOP_PARTIAL) NO llama
 * una vez por token: se salta la llamada cuando el token deja un
 * carácter UTF-8 a medias (`completion->incomplete`) y cuando el texto
 * pendiente podría ser el principio de una secuencia de parada
 * (STOP_PARTIAL), y lo envía junto con el siguiente. Con las paradas
 * del prompt a mano («\nUser:», «\nQuestion:») eso pasa en CADA salto
 * de línea. La cuenta se queda corta, y una respuesta que SÍ llegó al
 * tope pasaba por «terminó sola»: sin recorte a frase completa y, desde
 * la 0.1.91 (que ata la nota solo a este hecho), sin nota.
 *
 * El motor nativo ya dice el hecho en el resultado de la completion
 * (cpp/jsi/JSICompletion.h): `stopped_limit`, `stopped_eos`,
 * `stopped_word`, `context_full`. Esa es la señal; la cuenta de
 * llamadas queda solo como respaldo si el resultado no la trae.
 *
 *  - Tope de tokens sin fin natural → corte.
 *  - Ventana de contexto llena a mitad de respuesta → corte.
 *  - El fin de turno (EOS) o una secuencia de parada que cae justo en
 *    el último token → fin natural, no corte (el caso límite que el
 *    anexo E declaraba sin resolver).
 *  - Parada pedida (usuario, guarda de bucle) → no es el tope.
 */

export interface NativeStopSignals {
  stopped_limit?: boolean | number | null;
  stopped_eos?: boolean | null;
  stopped_word?: boolean | string | null;
  context_full?: boolean | null;
  interrupted?: boolean | null;
}

export function generationHitLimit(
  native: NativeStopSignals | null | undefined,
  callbackCount: number,
  nPredict: number
): boolean {
  // Parada pedida: también el resultado mínimo que llama.rn devuelve
  // cuando el contexto se liberó a mitad ({ text: "", interrupted: true }).
  if (native?.interrupted === true) return false;
  const hasNativeVerdict =
    native != null && (native.stopped_limit != null || native.context_full != null || native.stopped_eos != null);
  if (!hasNativeVerdict) return callbackCount >= nPredict;
  if (native!.context_full === true) return true;
  if (!native!.stopped_limit) return false;
  const endedByItself =
    native!.stopped_eos === true || (native!.stopped_word != null && native!.stopped_word !== false && native!.stopped_word !== "");
  return !endedByItself;
}
