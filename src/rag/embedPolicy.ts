/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Política de descarga del motor de embeddings por inactividad
 * (optimización 2026-11-08, fase 4): el motor se descarga cuando
 * lleva `idleMs` sin usarse Y el último trabajo de fondo terminó
 * hace al menos `idleMs`. La segunda condición protege la ventana
 * en la que el fondo acaba de soltar el motor y la primera búsqueda
 * lo necesitaría de vuelta al instante (recargar cuesta segundos):
 * la deuda de fondo no se paga dos veces. Pura, sin relojes: la
 * pantalla pasa los instantes que conoce.
 */
export function embeddingIdleUnloadDue(
  nowMs: number,
  lastUsedAtMs: number | null,
  lastBackgroundDoneAtMs: number | null,
  idleMs: number,
): boolean {
  if (lastUsedAtMs === null) return false;
  if (nowMs - lastUsedAtMs < idleMs) return false;
  if (lastBackgroundDoneAtMs !== null && nowMs - lastBackgroundDoneAtMs < idleMs) return false;
  return true;
}
