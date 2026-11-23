/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.34 (prueba física, Tab A9+): ejemplo «Memoria privada» del carrusel
// y parentescos con una tecla vecina.
import { describe, expect, it } from "vitest";
import { extractPeople, extractRememberFact, reminderTitleForFact } from "./rememberRouter";

describe("ejemplo «Memoria privada» del carrusel", () => {
  it.each([
    [
      "Recuérdame que el cumpleaños de mi amiga Laura es el 8 de junio y que le gustan los tulipanes. Guárdalo en tu memoria para que me avises con tiempo.",
      "el cumpleaños de mi amiga Laura es el 8 de junio y le gustan los tulipanes",
      "Cumpleaños de mi amiga Laura",
    ],
    [
      "Remember that my friend Laura's birthday is June 8th and she loves tulips. Save it so you can remind me in time.",
      "my friend Laura's birthday is June 8th and she loves tulips",
      "My friend Laura's birthday",
    ],
    [
      "Lembre-se de que o aniversário da minha amiga Laura é 8 de junho e ela adora tulipas. Guarde para me avisar com antecedência.",
      "o aniversário da minha amiga Laura é 8 de junho e ela adora tulipas",
      "Aniversário da minha amiga Laura",
    ],
  ])("%s", (q, content, title) => {
    const f = extractRememberFact(q);
    expect(f?.content).toBe(content);
    expect(reminderTitleForFact(f!.content)).toBe(title);
  });

  it("un hecho sin cumpleaños conserva su texto como título", () => {
    expect(reminderTitleForFact("mi color favorito es el azul")).toBe("mi color favorito es el azul");
  });
});

describe("parentesco con una tecla vecina", () => {
  it.each([
    ["Mi hermank se llama juan", "hermano", "Juan"],
    ["mi hermsna se llama Ana", "hermana", "Ana"],
    ["mi esposs se llama Laura", "esposa", "Laura"],
    ["meu irmap se chama João", "irmão", "João"],
  ])("%s", (q, rel, name) => {
    expect(extractPeople(q)).toEqual([{ name, relationship: rel }]);
  });

  it.each(["mi perro se llama Max", "mi gerente se llama Pedro", "mi mamq se llama Marta"])(
    "«%s» no se adivina",
    (q) => {
      expect(extractPeople(q)).toEqual([]);
    },
  );
});
