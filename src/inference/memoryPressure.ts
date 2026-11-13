/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Presión de memoria del sistema (optimización 2026-11-08, fase 5):
 * cuando Android avisa con onTrimMemory en nivel crítico, la app
 * suelta los motores ANTES de que el sistema la cierre — el patrón
 * que BOAR documenta en su módulo nativo. Si se está generando, no
 * se toca nada: interrumpir una respuesta a mitad es peor que el
 * riesgo. El LLM se descarga primero (es el residente grande) y el
 * embedding después; ambos vuelven bajo demanda (fases 1 y 4).
 * Nunca lanza: un fallo al descargar no debe tumbar el manejador
 * del evento.
 */
export interface MemoryPressureEngines {
  llm: { isLoaded: boolean; unload: () => Promise<void> };
  embedding: { isLoaded: boolean; unload: () => Promise<void> };
}

export async function handleMemoryPressure(
  state: { generating: boolean },
  engines: MemoryPressureEngines,
): Promise<void> {
  if (state.generating) return;
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
