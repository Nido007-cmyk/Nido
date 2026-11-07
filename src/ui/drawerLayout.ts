/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Menú lateral: medidas y cuántos chats se ven, sin React (se prueba solo).
 */

/** Ancho del panel: se recalcula al girar la tableta (antes se fijaba al arrancar). */
export function drawerWidthFor(screenWidth: number): number {
  return Math.round(Math.min(310, screenWidth * 0.82));
}

/**
 * Cuántos chats recientes se ven sin pedir más. Con decenas de chats, los
 * atajos (Ajustes, Guías…) quedaban al fondo de una lista enorme; ahora se
 * ven los primeros y un botón «Ver todos». Buscar siempre mira todos.
 */
export const RECENT_VISIBLE = 15;

export function visibleSessions<T>(matches: T[], query: string, showAll: boolean): { list: T[]; hidden: number } {
  if (showAll || query.trim() !== "" || matches.length <= RECENT_VISIBLE) return { list: matches, hidden: 0 };
  return { list: matches.slice(0, RECENT_VISIBLE), hidden: matches.length - RECENT_VISIBLE };
}
