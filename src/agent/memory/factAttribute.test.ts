/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * N-02 — batería de pares de la clave de atributo (factAttribute).
 *
 * Reconstruida desde la preparación (sus casos nombrados y su medida
 * 40/40 sobre su batería) y engordada con frases de las rondas y del
 * registro de perdidas. Clasificación por par:
 *  - "merge": misma clave y mismo valor (o extensión) → se fusiona.
 *  - "replace": misma clave de valor único, valor distinto → gana lo nuevo.
 *  - "coexist": claves distintas o sin clave → conviven, como hoy.
 */
import { describe, expect, it } from "vitest";
import { factAttribute, attributeValuesMatch } from "./factAttribute";

type Verdict = "merge" | "replace" | "coexist";

function classify(a: string, b: string): Verdict {
  const fa = factAttribute(a);
  const fb = factAttribute(b);
  if (!fa || !fb || fa.key !== fb.key) return "coexist";
  if (!fa.singleValued) return "merge";
  return attributeValuesMatch(fa, fb) ? "merge" : "replace";
}

const PAIRS: Array<[string, string, Verdict, string]> = [
  // ———————————————— merge: mismo atributo, mismo valor
  ["vivo en Madrid", "I live in Madrid now", "merge", "residencia es/en con relleno temporal"],
  ["vivo en Málaga", "I live in Malaga", "merge", "residencia con tilde plegada"],
  ["mi cumpleaños es el 3 de mayo", "my birthday is May 3", "merge", "cumpleaños propio, fecha sin diccionario"],
  ["el cumpleaños de mi mamá es el 15 de marzo", "my mom's birthday is March 15", "merge", "cumpleaños de relación es/en"],
  ["o aniversário da minha mãe é 3 de maio", "el cumpleaños de mi mamá es el 3 de mayo", "merge", "pt «da minha mãe» contra es"],
  ["agora moro em Lisboa", "moro em Lisboa", "merge", "muletilla pt delante del ancla"],
  ["por cierto, vivo en Tucson", "I live in Tucson", "merge", "muletilla de las rondas delante del ancla"],
  ["me llamo Juan", "my name is Juan", "merge", "nombre propio es/en"],
  ["mi perro se llama Rocky", "mi perro se llama Rocky y es café", "merge", "valor por extensión (contención)"],
  ["mi color favorito es el azul", "my favorite color is blue", "merge", "favorito con léxico de colores"],
  ["mi coche es un Toyota", "my car is a Toyota", "merge", "sustantivo curado es/en"],
  ["soy alérgico a las nueces", "tengo alergia a las nueces", "merge", "alergia, dos marcos es"],
  ["tenho alergia ao polen", "tengo alergia al polen", "merge", "alergia pt/es, sustancia plegada"],
  ["soy vegetariano", "sou vegetariano", "merge", "dieta es/pt"],
  ["trabajo en un hospital", "I work at a hospital", "merge", "trabajo es/en"],
  ["mi cumpleaños es el 15 de marzo", "meu aniversário é 15 de março", "merge", "cumpleaños es/pt"],
  ["el cumpleaños de mi hermano es el 2 de junio", "my brother's birthday is June 2", "merge", "relación hermano/brother"],
  ["meu cachorro se chama Rex", "mi perro se llama Rex", "merge", "mascota pt/es por especie"],
  ["mi gato se llama Luna", "my cat is called Luna", "merge", "mascota es/en"],
  ["vivo en Sevilla", "vivo en Sevilla, España", "merge", "residencia por extensión"],
  ["mi banco es el Santander", "my bank is Santander", "merge", "sustantivo banco/bank"],
  ["mi cumpleaños es el 29 de febrero", "my birthday is February 29", "merge", "fecha bisiesta por próxima ocurrencia"],

  // ———————————————— replace: mismo atributo de valor único, valor distinto
  ["vivo en Madrid", "I live in Berlin now", "replace", "la contradictoria del titular"],
  ["mi cumpleaños es el 3 de mayo", "mi cumpleaños es el 5 de mayo", "replace", "corrección de fecha (a nivel de atributo)"],
  ["me llamo Ruben", "me llamo Juan", "replace", "nombre corregido"],
  ["mi perro se llama Rocky", "mi perro se llama Toby", "replace", "mascota corregida"],
  ["mi color favorito es el azul", "mi color favorito es el rojo", "replace", "favorito corregido"],
  ["el cumpleaños de mi mamá es el 15 de marzo", "el cumpleaños de mi mamá es el 20 de marzo", "replace", "fecha de relación corregida"],
  ["vivo en Nueva York", "I live in NYC", "replace", "sinónimo de valor: gana lo nuevo (doctrina del cableado)"],

  // ———————————————— coexist: sin clave común
  ["soy alérgico a las nueces", "soy alérgico al polen", "coexist", "multivaluado: la sustancia va en la clave"],
  ["soy vegetariano", "soy vegano", "coexist", "cada dieta es su clave"],
  ["vivo en Madrid y trabajo en Getafe", "vivo en Berlín", "coexist", "compuesto: fallo seguro, sin clave"],
  ["mi plato favorito es la pasta", "my favorite dish is pasta", "coexist", "sustantivo de favorito sin léxico (límite declarado)"],
  ["minha cor favorita é azul", "my favorite color is blue", "coexist", "la clave lleva el sustantivo plegado: cor ≠ color"],
  ["no soy alérgico a nada", "soy alérgico a las nueces", "coexist", "la negación no extrae clave"],
  ["mi cumpleaños es el 3 de mayo", "el cumpleaños de mi mamá es el 3 de mayo", "coexist", "propio ≠ de relación"],
  ["mi hermano vive en Madrid", "vivo en Madrid", "coexist", "residencia de tercero sin marco propio"],
  ["mi coche es un Toyota", "mi teléfono es un Samsung", "coexist", "sustantivos distintos"],
  ["trabajo en un hospital", "vivo en Madrid", "coexist", "atributos distintos"],
  ["soy alérgico a las nueces", "I'm allergic to nuts", "coexist", "sustancia entre idiomas sin diccionario (límite declarado)"],
  ["me gusta el café sin azúcar", "I like coffee without sugar", "coexist", "sin marco: conviven como hoy"],
];

describe("N-02 — factAttribute: batería de pares", () => {
  for (const [a, b, expected, note] of PAIRS) {
    it(`${note}: «${a}» ~ «${b}» → ${expected}`, () => {
      expect(classify(a, b)).toBe(expected);
      // La clasificación es simétrica: el orden de llegada no importa
      // para merge/coexist; en replace gana el SEGUNDO (lo nuevo).
      expect(classify(b, a)).toBe(expected);
    });
  }

  it("sin marco no hay clave (la vía no opina)", () => {
    expect(factAttribute("me gusta el café sin azúcar")).toBeNull();
    expect(factAttribute("mañana voy al mercado")).toBeNull();
    expect(factAttribute("")).toBeNull();
  });

  it("las claves nombradas por la preparación", () => {
    expect(factAttribute("vivo en Madrid")?.key).toBe("residence");
    expect(factAttribute("soy alérgico a las nueces")?.key).toBe("allergy:nueces");
    expect(factAttribute("soy vegano")?.key).toBe("diet:vegano");
    expect(factAttribute("mi coche es un Toyota")?.key).toBe("noun:car");
    expect(factAttribute("mi color favorito es el azul")?.key).toBe("favorite:color");
    expect(factAttribute("el cumpleaños de mi mamá es el 15 de marzo")?.key).toBe("birthday:rel:mama");
  });
});
