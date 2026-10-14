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
import { classifyTask, isRetrievalIrrelevant } from "./classify";

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
