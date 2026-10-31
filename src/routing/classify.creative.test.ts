/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.34 (prueba física, Tab A9+): el ejemplo «Cocina creativa» del
// carrusel buscaba en la enciclopedia offline y la respuesta quedaba en
// «[1] Quesadilla [2] Ginataang langka». Pedir ideas o un texto creativo
// no se busca: lo responde el modelo.
import { describe, expect, it } from "vitest";
import { classifyTask, isCreativeRequest, isRetrievalIrrelevant } from "./classify";

describe("peticiones creativas sin búsqueda offline", () => {
  it.each([
    "Tengo arroz, frijoles, cebolla, tomate y queso. ¿Qué puedo cocinar con esto? Dame 3 ideas con instrucciones.",
    "I have rice, beans, onion, tomato and cheese. What can I cook with this? Give me 3 ideas with instructions.",
    "Tenho arroz, feijão, cebola, tomate e queijo. O que posso cozinhar com isso? Dê-me 3 ideias com instruções.",
    "escribe un poema corto sobre el mar",
    "write me a story about a dragon",
    "me dá três ideias de presente",
  ])("%s", (q) => {
    expect(isRetrievalIrrelevant(classifyTask(q))).toBe(true);
  });

  it.each(["qué es la fotosíntesis", "dame información sobre Roma", "ideas de la ilustración francesa"])(
    "«%s» sigue buscando",
    (q) => {
      expect(isRetrievalIrrelevant(classifyTask(q))).toBe(false);
    },
  );
});

// 2026-10-30 (prueba física, Tab A9+): «Cuéntame un cuento largo sobre un
// zorro que vive en un faro» no casaba con ninguna forma creativa y el
// turno se iba a búsqueda; el acta importada por el propio usuario casó
// al 85 % y el verificador sustituyó el cuento por su extracto. La
// familia de «cuéntame» tiene que ser creativa — pero solo con el objeto
// creado detrás: el objeto manda, no el verbo.
describe("la familia de «cuéntame»: creativa solo con objeto creado", () => {
  it.each([
    "Cuéntame un cuento largo sobre un zorro que vive en un faro",
    "¿Me cuentas una historia de piratas?",
    "Cuéntanos una leyenda",
    "Nárrame un relato corto",
    "redacta un cuento sobre el invierno",
    "tell me a story about a dragon",
    "Conta-me um conto",
    "Conte uma história",
  ])("%s", (q) => {
    expect(isRetrievalIrrelevant(classifyTask(q))).toBe(true);
    expect(isCreativeRequest(q)).toBe(true);
  });

  it.each([
    // El objeto es un dato, no una creación: sigue yendo a datos.
    "cuéntame el número de emergencias de Chile",
    "Cuéntame el número de habitaciones del hotel",
    "dime el número de emergencias de Chile",
    "tell me the emergency number for Chile",
  ])("%s", (q) => {
    expect(isRetrievalIrrelevant(classifyTask(q))).toBe(false);
    expect(isCreativeRequest(q)).toBe(false);
  });
});
