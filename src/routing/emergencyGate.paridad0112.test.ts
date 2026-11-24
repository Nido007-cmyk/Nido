/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría de la 0.1.112, bloque 2: paridad de las puertas de salud y
 * emergencia por MATRIZ de sondas equivalentes, no por listas revisadas
 * a ojo. Cada fila es la misma situación dicha con naturalidad en los
 * tres idiomas; la puerta debe dar el mismo veredicto en las tres:
 *  - «peligro» = isHealthQuestion || isEmergencySituation (lo que decide
 *    la ruta protegida en ChatScreen.tsx:2011);
 *  - «emergencia» = isEmergencySituation (el texto y la vía de emergencia).
 * La cara de la caída queda fuera: tiene encargo propio en el lote
 * gobernado. Las filas negativas no deben declarar nada.
 */
import { describe, expect, it } from "vitest";
import { isEmergencySituation, isHealthQuestion } from "./emergencyGate";

// filas: [id, es, en, pt]
const ROWS: [string, string, string, string][] = [
  ["pecho-1", "me duele el pecho", "my chest hurts", "meu peito dói"],
  ["pecho-2", "me duele el pecho y el brazo izquierdo", "my chest and left arm hurt", "meu peito e o braço esquerdo doem"],
  ["pecho-3", "tengo un dolor fuerte en el pecho", "I have a strong pain in my chest", "estou com uma dor forte no peito"],
  ["pecho-4", "me duele mucho el pecho", "my chest hurts a lot", "meu peito está doendo muito"],
  ["pecho-5", "a mi padre le duele el pecho", "my father's chest hurts", "o peito do meu pai está doendo"],
  ["lejia-1", "mi hijo se tomó lejía", "my son drank bleach", "meu filho bebeu água sanitária"],
  ["lejia-2", "mi hijo bebió lejía", "my son swallowed bleach", "meu filho tomou água sanitária"],
  ["lejia-3", "mi hija tomó lejía", "my daughter drank some bleach", "minha filha engoliu água sanitária"],
  ["veneno-1", "mi hijo se tomó un veneno", "my son drank poison", "meu filho tomou veneno"],
  ["veneno-2", "mi hijo se comió unas pastillas de mi madre", "my son ate some of my mother's pills", "meu filho comeu uns comprimidos da minha mãe"],
  ["incons-1", "hombre inconsciente en la calle", "man unconscious on the street", "homem inconsciente na rua"],
  ["incons-2", "hay un hombre inconsciente en la calle", "there is a man unconscious on the street", "tem um homem inconsciente na rua"],
  ["incons-3", "hay un hombre inconsciente en la calle", "there's an unconscious man in the street", "há um homem inconsciente na rua"],
  ["incons-4", "mi abuelo está inconsciente", "my grandfather is unconscious", "meu avô está inconsciente"],
  ["incons-5", "mi madre no responde", "my mother isn't responding", "minha mãe não responde"],
  ["resp-1", "mi hijo no puede respirar", "my son can't breathe", "meu filho não consegue respirar"],
  ["resp-2", "mi bebé no respira", "my baby isn't breathing", "meu bebê não está respirando"],
  ["sangre-1", "mi padre está sangrando mucho", "my father is bleeding a lot", "meu pai está sangrando muito"],
  ["sangre-2", "no para de sangrar", "it won't stop bleeding", "não para de sangrar"],
  ["convul-1", "mi hija está convulsionando", "my daughter is having a seizure", "minha filha está tendo uma convulsão"],
  ["ictus-1", "mi abuelo tiene la cara caída y no puede hablar", "my grandfather's face is drooping and he can't speak", "meu avô está com o rosto caído e não consegue falar"],
  ["ictus-2", "creo que mi madre está teniendo un ictus", "I think my mother is having a stroke", "acho que minha mãe está tendo um AVC"],
  ["infarto-1", "creo que mi padre está teniendo un infarto", "I think my father is having a heart attack", "acho que meu pai está tendo um infarto"],
  ["quem-1", "me quemé la mano con aceite hirviendo", "I burned my hand with boiling oil", "queimei a mão com óleo fervendo"],
  ["atrag-1", "mi hijo se está atragantando", "my son is choking", "meu filho está engasgando"],
  ["ahog-1", "mi hijo se está ahogando en la piscina", "my son is drowning in the pool", "meu filho está se afogando na piscina"],
  ["alerg-1", "se le está hinchando la garganta después de comer cacahuetes", "his throat is swelling after eating peanuts", "a garganta dele está inchando depois de comer amendoim"],
  ["hurt-casa", "me duelen el pecho y el brazo", "my chest and arm hurt", "meu peito e meu braço doem"],
  ["lejia-casa", "se tomó lejía", "he drank bleach", "ele tomou água sanitária"],
  ["sobredosis-1", "mi amigo tomó demasiadas pastillas", "my friend took too many pills", "meu amigo tomou comprimidos demais"],
];

const NEGATIVE: [string, string, string, string][] = [
  ["neg-precio", "el precio de la gasolina cayó", "the price of gas fell", "o preço da gasolina caiu"],
  ["neg-receta", "cómo hago una sopa de pollo", "how do I make chicken soup", "como faço uma sopa de frango"],
  ["neg-pelicula", "vi una película donde alguien se desmaya", "I watched a movie where someone faints", "vi um filme em que alguém desmaia"],
  ["neg-limpieza", "cómo limpio el baño con lejía", "how do I clean the bathroom with bleach", "como limpo o banheiro com água sanitária"],
];

const verdict = (t: string) => ({
  danger: isHealthQuestion(t) || isEmergencySituation(t),
  emergency: isEmergencySituation(t),
});

describe("bloque 2 (0.1.112): la matriz trilingüe da el mismo veredicto en es/en/pt", () => {
  for (const [id, es, en, pt] of ROWS) {
    it(id, () => {
      const v = [es, en, pt].map(verdict);
      expect(v[1], `${id} en «${en}» frente a es «${es}»`).toEqual(v[0]);
      expect(v[2], `${id} pt «${pt}» frente a es «${es}»`).toEqual(v[0]);
    });
  }

  it("las sondas de la casa declaran lo que deben", () => {
    expect(isHealthQuestion("my chest and left arm hurt")).toBe(true);
    expect(isHealthQuestion("mi hijo se tomó lejía")).toBe(true);
    expect(isHealthQuestion("mi hija tomó lejía")).toBe(true);
    expect(isEmergencySituation("there is a man unconscious on the street")).toBe(true);
    expect(isEmergencySituation("there's an unconscious man in the street")).toBe(true);
    expect(isEmergencySituation("my mother isn't responding")).toBe(true);
  });

  it("las filas negativas no declaran en ninguna lengua", () => {
    for (const [id, ...v] of NEGATIVE) for (const t of v) expect(verdict(t), `${id}: ${t}`).toEqual({ danger: false, emergency: false });
  });

  it("y las formas cotidianas de las palabras nuevas siguen fuera", () => {
    for (const t of [
      "I hurt her feelings yesterday",
      "se quemó la comida",
      "the cake burned in the oven",
      "o bolo queimou",
      "the man fixed the car",
      "a boy and a girl were playing",
      "how do I clean the bathroom with bleach",
    ]) expect(verdict(t).emergency, t).toBe(false);
  });
});
