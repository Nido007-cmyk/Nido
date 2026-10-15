/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.42: normalizeForRouting — el texto tal como lo lee el router.
 */
import { describe, expect, it } from "vitest";
import { normalizeForRouting } from "./routingText";

describe("normalizeForRouting", () => {
  it("colapsa espacios y quita el espacio antes del signo final", () => {
    expect(normalizeForRouting("  recuérdame   llamar a mamá mañana  ?")).toBe("recuérdame llamar a mamá mañana?");
    expect(normalizeForRouting("qué hora es !")).toBe("qué hora es!");
  });

  it("quita muletillas de arranque en los tres idiomas", () => {
    expect(normalizeForRouting("oye, recuérdame comprar pan")).toBe("recuérdame comprar pan");
    expect(normalizeForRouting("Por cierto,mi color favorito es el verde")).toBe("mi color favorito es el verde");
    expect(normalizeForRouting("hey, set a timer for 5 minutes")).toBe("set a timer for 5 minutes");
    expect(normalizeForRouting("btw remind me to call John tomorrow")).toBe("remind me to call John tomorrow");
    expect(normalizeForRouting("ei, que horas são?")).toBe("que horas são?");
    expect(normalizeForRouting("por favor, cuánto es 2+2")).toBe("cuánto es 2+2");
    expect(normalizeForRouting("oye, por favor, apunta comprar leche")).toBe("apunta comprar leche");
  });

  it("las palabras con contenido solo se quitan con signo detrás", () => {
    expect(normalizeForRouting("mira, son las 5")).toBe("son las 5");
    expect(normalizeForRouting("mira mis notas")).toBe("mira mis notas");
    expect(normalizeForRouting("hola nido")).toBe("hola nido");
    expect(normalizeForRouting("ok, pon un temporizador de 3 minutos")).toBe("pon un temporizador de 3 minutos");
    expect(normalizeForRouting("so what is 2+2")).toBe("so what is 2+2");
  });

  it("una muletilla sola se queda como estaba (es un saludo)", () => {
    expect(normalizeForRouting("oye")).toBe("oye");
    expect(normalizeForRouting("hey!")).toBe("hey!");
    expect(normalizeForRouting("hola,")).toBe("hola,");
  });

  it("no toca acentos, mayúsculas ni signos de apertura", () => {
    expect(normalizeForRouting("¿Dónde Dejé el coche?")).toBe("¿Dónde Dejé el coche?");
    expect(normalizeForRouting("")).toBe("");
  });
});
