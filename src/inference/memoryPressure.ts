/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Presión de memoria del sistema (optimización 2026-11-08, fase 5):
 * cuando Android avisa con onTrimMemory en nivel crítico, la app
 * suelta los motores ANTES de que el sistema la cierre — el patrón
 * que BOAR documenta en su módulo nativo. El LLM se descarga primero
 * (es el residente grande) y el embedding después; ambos vuelven
 * bajo demanda (fases 1 y 4). Nunca lanza: un fallo al descargar no
 * debe tumbar el manejador del evento.
 *
 * Generando (F3-04, auditoría 2026-11-13): la política ya no es «no
 * se toca nada». Aquella dejaba la sesión a merced del LMK justo en
 * el momento de mayor residencia (contexto + KV crecidos), sin
 * acortar la exposición ni salvar el parcial: si el sistema mataba
 * el proceso, la respuesta se perdía entera. Ahora, generando, se
 * pide la PARADA LIMPIA de la completion: generate() se asienta con
 * el texto ya generado (con su recorte a frase completa) y la
 * residencia se cede en el siguiente evento de presión, ya sin
 * generación en vuelo. Descargar en el mismo evento destruiría el
 * parcial que la parada acaba de salvar — por eso el evento que
 * para no descarga.
 */
export interface MemoryPressureEngines {
  llm: { isLoaded: boolean; unload: () => Promise<void>; stop?: () => Promise<void> };
  embedding: { isLoaded: boolean; unload: () => Promise<void> };
}

export async function handleMemoryPressure(
  state: { generating: boolean },
  engines: MemoryPressureEngines,
  level?: number,
): Promise<void> {
  // P-36 (auditoría 2026-11-13, F3-18): el nivel manda. Hasta la
  // 0.1.98 el manejador ignoraba el nivel del evento y el nativo
  // reenviaba también los niveles de fondo (≥15 incluía 20 UI_HIDDEN
  // y 40/60/80 de proceso en segundo plano): salir de la app a mitad
  // de respuesta paraba la generación que el keep-alive existe para
  // proteger, y un trim de fondo descargaba motores a los que el
  // usuario podía volver en segundos. Los niveles ≥20 son estados de
  // fondo/UI oculta — no son «el sistema se está quedando sin memoria
  // con la app en uso» — y se ignoran. Sin nivel (llamantes viejos) o
  // con el crítico (15, también el de onLowMemory) se actúa como
  // siempre. El nativo, además, ya solo reenvía el 15.
  if (level !== undefined && level >= 20) return;
  if (state.generating) {
    try {
      await engines.llm.stop?.();
    } catch {
      /* la parada nunca tumba el manejador */
    }
    return;
  }
  try {
    if (engines.llm.isLoaded) await engines.llm.unload();
  } catch {
    /* seguir con el embedding igualmente */
  }
  try {
    if (engines.embedding.isLoaded) await engines.embedding.unload();
  } catch {
    /* nada más que hacer */
  }
}
