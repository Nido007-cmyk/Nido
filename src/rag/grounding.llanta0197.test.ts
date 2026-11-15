/**
 * Regresión del defecto probado en el dispositivo del dueño
 * (Tab A9+, 2026-11-13, foto de las 17:44 MST): a la pregunta
 * «Como cambio la llanta de un carro», la guía sellada respondió bien
 * pero el modelo añadió «primero asegúrate de que el motor esté en
 * marcha» — una instrucción inventada y peligrosa (para cambiar una
 * llanta el motor va APAGADO) — y el juez la dejó pasar etiquetada
 * «del modelo sin fuente».
 *
 * Mecanismo: la recuperación trajo, tras la guía en español, dos
 * textos de Wikipedia en inglés que no venían al caso (Cambodia,
 * River Severn). La detección de idioma de las fuentes se hacía
 * sobre la unión de todos los textos, concluyó «otro idioma» y la
 * respuesta entera cayó en la rama débil, donde solo se cotejan
 * cifras, dosis y fechas. La frase inventada no tiene ninguna:
 * pasó. El idioma de juicio lo manda la fuente principal.
 */
import { describe, expect, it } from "vitest";
import { verifyGroundedAnswer, type GroundingChunk } from "./grounding";

// La guía sellada que encabezó la respuesta en la tablet (su paso 1,
// tal como se lee en la foto).
const GUIA: GroundingChunk = {
  title: "Avería en carretera — 1. Para en un sitio seguro",
  body:
    "Enciende las luces de emergencia en cuanto notes el problema. " +
    "Reduce la velocidad poco a poco y aparta el coche fuera de la calzada " +
    "siempre que puedas: arcén amplio, apartadero, área de descanso o salida " +
    "cercana. No te detengas en un carril, en una curva, en un cambio de " +
    "rasante ni en un túnel si puedes evitarlo.",
};

// El ruido que la recuperación trajo en la tablet (fuentes 2 y 3).
const CAMBODIA: GroundingChunk = {
  title: "Cambodia",
  body:
    "Cambodia is a country in Mainland Southeast Asia. It borders Thailand " +
    "to the northwest, Laos to the north and Vietnam to the east, and has a " +
    "coastline along the Gulf of Thailand. Its capital and most populous " +
    "city is Phnom Penh. Cambodia covers an area of 181,035 square " +
    "kilometres and had a population of about 16.7 million in 2023.",
};

const SEVERN: GroundingChunk = {
  title: "River Severn",
  body:
    "The River Severn is the longest river in Great Britain, at 220 miles " +
    "(354 km). It rises in Plynlimon in Wales and flows through Shropshire, " +
    "Worcestershire and Gloucestershire, emptying into the Bristol Channel.",
};

// La frase del modelo en la tablet, literal.
const INVENTADA =
  "Para cambiar la llanta de un carro, primero asegúrate de que el motor esté en marcha.";

describe("verifyGroundedAnswer — caso llanta: ruido en otro idioma tras la guía", () => {
  it("con la guía limpia, la instrucción inventada no pasa", () => {
    const r = verifyGroundedAnswer(INVENTADA, [GUIA], "es", "");
    expect(r.text).not.toContain("motor esté en marcha");
  });

  it("el ruido en inglés detrás de la guía NO degrada el juicio", () => {
    const r = verifyGroundedAnswer(INVENTADA, [GUIA, CAMBODIA, SEVERN], "es", "");
    expect(r.text).not.toContain("motor esté en marcha");
  });

  it("una cifra ajena al caso no se sostiene con las cifras del ruido", () => {
    const r = verifyGroundedAnswer(
      "Para cambiar la llanta, aprieta cada tuerca a 220 newtons y sigue.",
      [GUIA, CAMBODIA, SEVERN],
      "es", "");
    expect(r.text).not.toContain("220");
  });
});
