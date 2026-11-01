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

describe("normalizeForRouting — N-04: reparación acotada del verbo gatillo", () => {
  it("repara el typo inconfundible con contexto de orden", () => {
    expect(normalizeForRouting("Recueda que tengo sita el lunes")).toBe("Recuerda que tengo sita el lunes");
    expect(normalizeForRouting("recuedame comprar leche mañana")).toBe("recuerdame comprar leche mañana");
    expect(normalizeForRouting("acuedate de apagar la estufa")).toBe("acuerdate de apagar la estufa");
    expect(normalizeForRouting("lemba de comprar leite amanhã")).toBe("lembra de comprar leite amanhã");
    expect(normalizeForRouting("No olvide que el martes pago la renta")).toBe("No olvides que el martes pago la renta");
    expect(normalizeForRouting("Remembr to call John tomorrow")).toBe("Remember to call John tomorrow");
    expect(normalizeForRouting("¿Recuedas cuando es el cumpleaños de mamá?")).toBe("¿Recuerdas cuando es el cumpleaños de mamá?");
  });

  it("las palabras reales jamás se «reparan»", () => {
    expect(normalizeForRouting("Recuerdo que tengo dentista mañana")).toBe("Recuerdo que tengo dentista mañana");
    expect(normalizeForRouting("Recordando los viejos tiempos")).toBe("Recordando los viejos tiempos");
    expect(normalizeForRouting("el acuerdo que firmamos ayer")).toBe("el acuerdo que firmamos ayer");
    expect(normalizeForRouting("Olvido todo lo que me dicen")).toBe("Olvido todo lo que me dicen");
  });

  it("sin contexto de orden, o en mitad de frase, no se toca nada", () => {
    expect(normalizeForRouting("por favor recueda eso mañana")).toBe("recueda eso mañana");
    expect(normalizeForRouting("el recordatorio de las 3")).toBe("el recordatorio de las 3");
    expect(normalizeForRouting("recueda")).toBe("recueda");
    expect(normalizeForRouting("recueda el papel")).toBe("recueda el papel");
  });
});
