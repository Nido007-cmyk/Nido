// 2026-11-07 (prueba física): con muchos chats el menú quedaba cortado.
import { describe, expect, it } from "vitest";
import { RECENT_VISIBLE, drawerWidthFor, visibleSessions } from "./drawerLayout";

const many = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("menú lateral", () => {
  it("con pocos chats se ven todos y no hay botón", () => {
    expect(visibleSessions(many(5), "", false)).toEqual({ list: many(5), hidden: 0 });
    expect(visibleSessions(many(RECENT_VISIBLE), "", false).hidden).toBe(0);
  });

  it("con muchos se ven los primeros y el resto queda detrás de «Ver todos»", () => {
    const r = visibleSessions(many(60), "", false);
    expect(r.list).toHaveLength(RECENT_VISIBLE);
    expect(r.list[0]).toBe(0);
    expect(r.hidden).toBe(60 - RECENT_VISIBLE);
  });

  it("«Ver todos» y la búsqueda muestran todos los resultados", () => {
    expect(visibleSessions(many(60), "", true).list).toHaveLength(60);
    expect(visibleSessions(many(60), "rcp", false).list).toHaveLength(60);
    expect(visibleSessions(many(60), "   ", false).list).toHaveLength(RECENT_VISIBLE);
  });

  it("el ancho sigue a la pantalla (girar la tableta) sin pasar de 310", () => {
    expect(drawerWidthFor(360)).toBe(295);
    expect(drawerWidthFor(1280)).toBe(310);
    expect(drawerWidthFor(320)).toBeLessThan(320);
  });
});
