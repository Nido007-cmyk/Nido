/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.108 (pedido del dueño, 2026-11-16): «algo para irte en los chats
// hasta el final sin tener que hacer scroll». El botón de ir al final
// se muestra con la misma cuenta que ya decidía si la lista sigue al
// último mensaje (followBottom): a menos de 120 px del final estás
// «al final»; a 120 o más, el botón aparece. Un solo umbral, una sola
// fuente de verdad para las dos cosas.
import { describe, expect, it } from "vitest";
import { AWAY_FROM_BOTTOM_PX, distanceToBottomPx, isAwayFromBottom } from "./ChatScreen.pure";

describe("ChatScreen.pure: el botón de ir al final (0.1.108)", () => {
  it("la distancia al final es contenido menos vista menos desplazamiento", () => {
    expect(distanceToBottomPx({ contentOffsetY: 0, contentHeight: 2000, layoutHeight: 800 })).toBe(1200);
    expect(distanceToBottomPx({ contentOffsetY: 1200, contentHeight: 2000, layoutHeight: 800 })).toBe(0);
    // Contenido más corto que la vista: ya estás al final (distancia 0, nunca negativa).
    expect(distanceToBottomPx({ contentOffsetY: 0, contentHeight: 500, layoutHeight: 800 })).toBe(0);
  });

  it("el umbral es el de followBottom: menos de 120 px es «al final», 120 o más es «lejos»", () => {
    expect(AWAY_FROM_BOTTOM_PX).toBe(120);
    expect(isAwayFromBottom(0)).toBe(false);
    expect(isAwayFromBottom(119)).toBe(false);
    expect(isAwayFromBottom(120)).toBe(true);
    expect(isAwayFromBottom(5000)).toBe(true);
  });

  it("predicado y distancia juntos: pegado al final no hay botón; arriba, sí", () => {
    const atEnd = distanceToBottomPx({ contentOffsetY: 1150, contentHeight: 2000, layoutHeight: 800 });
    expect(isAwayFromBottom(atEnd)).toBe(false);
    const upTop = distanceToBottomPx({ contentOffsetY: 0, contentHeight: 2000, layoutHeight: 800 });
    expect(isAwayFromBottom(upTop)).toBe(true);
  });
});
