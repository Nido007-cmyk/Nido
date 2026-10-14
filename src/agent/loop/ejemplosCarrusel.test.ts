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
      "Recuérdame que el cumpleaños de mi mamá es el 15 de marzo y que le gustan las orquídeas. Guárdalo en tu memoria para que me avises con tiempo.",
      "el cumpleaños de mi mamá es el 15 de marzo y le gustan las orquídeas",
      "Cumpleaños de mi mamá",
    ],
    [
      "Remember that my mom's birthday is March 15th and she loves orchids. Save it so you can remind me in time.",
      "my mom's birthday is March 15th and she loves orchids",
      "My mom's birthday",
    ],
    [
      "Lembre-se de que o aniversário da minha mãe é 15 de março e ela adora orquídeas. Guarde para me avisar com antecedência.",
      "o aniversário da minha mãe é 15 de março e ela adora orquídeas",
      "Aniversário da minha mãe",
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
