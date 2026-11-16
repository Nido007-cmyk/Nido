/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La cuenta de «¿está el usuario al final de la conversación?» de la
 * pantalla de chat, fuera del componente para poder probarla.
 *
 * Es la MISMA cuenta que ya decidía si la lista sigue al último
 * mensaje mientras llega la respuesta (followBottom): a menos de
 * 120 px del final, estás al final. 0.1.108 (pedido del dueño,
 * 2026-11-16: «algo para irte en los chats hasta el final sin tener
 * que hacer scroll») le da a esa misma cuenta su segundo uso: el
 * botón flotante de ir al final aparece exactamente cuando
 * followBottom deja de seguir — un solo umbral, una sola fuente de
 * verdad, para que el botón y el auto-seguimiento nunca discrepen.
 */

/** Distancia al final por debajo de la cual se considera «al final». */
export const AWAY_FROM_BOTTOM_PX = 120;

/** Pixeles entre el borde inferior visible y el final del contenido (nunca negativa). */
export function distanceToBottomPx(args: {
  contentOffsetY: number;
  contentHeight: number;
  layoutHeight: number;
}): number {
  return Math.max(args.contentHeight - args.layoutHeight - args.contentOffsetY, 0);
}

/** ¿Está el usuario desplazado hacia arriba, lejos del final? */
export function isAwayFromBottom(distanceToBottom: number): boolean {
  return distanceToBottom >= AWAY_FROM_BOTTOM_PX;
}
