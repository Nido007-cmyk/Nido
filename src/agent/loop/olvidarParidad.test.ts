/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda R de la serie de curas · la familia del olvido
 * (F-PC55, F-PC58 y F-PC59) sobre las superficies públicas
 * `extractReminderAction`, `extractRememberFact`,
 * `extractPeople`, `extractSelfName` y `classifyIntent`.
 *
 * La distinción de la casa es infinitivo contra cláusula:
 * tras estas aperturas, un contenido que abre con infinitivo
 * es una tarea (nace el recordatorio y el hecho cede) y un
 * contenido con cláusula es un hecho (se guarda y no nace
 * recordatorio). Los huecos son del móvil, heredados en
 * copia fiel; la tanda los cura en PC como mejora declarada.
 *
 * Nacimiento (contra el árbol sin curar): 40 rojos
 * (R1 19, R2 1, R3 0, R4 9, R5 11). Los verdes de nacimiento
 * son los controles que la cura no puede romper.
 */
import { describe, expect, it } from "vitest";
import { extractReminderAction } from "./actionRouter";
import {
  extractPeople,
  extractRememberFact,
  extractSelfName,
} from "./rememberRouter";
import { classifyIntent } from "./intent";

const NOW = new Date(2026, 10, 3, 17, 0);
const rem = (t: string) => extractReminderAction(t, NOW);

// ---------------------------------------------------------------- R1
// Nace el recordatorio (F-PC55): las aperturas hermanas de la
// familia con contenido en infinitivo crean el aviso. Los
// casos pt fijan además la clasificación por classifyIntent
// (actuar, por la consulta de la puerta al extractor).
describe("R1 · nace el recordatorio (F-PC55)", () => {
  const ES = [
    "no se me olvide comprar pan",
    "no se te olvide comprar pan",
    "no se te olvide de comprar pan",
    "que no se te olvide comprar pan",
    "no se te pase comprar pan",
    "no te olvides de comprar pan",
    "no olvides comprar pan",
    "no olvides de comprar pan",
    "acuérdate de comprar pan",
    "recuerda comprar pan",
  ];
  it.each(ES)("es «%s» → recordatorio", (t) => {
    expect(rem(t)).not.toBeNull();
  });
  it("es «no se te olvide llamarme mañana» → recordatorio con fecha de mañana", () => {
    const a = rem("no se te olvide llamarme mañana");
    expect(a).not.toBeNull();
    expect(a?.dueAt ?? "").toContain("2026-11-04");
  });
  const EN = ["don't forget to buy milk", "do not forget to buy milk"];
  it.each(EN)("en «%s» → recordatorio", (t) => {
    expect(rem(t)).not.toBeNull();
  });
  it("en «don't forget to call mom tomorrow» → recordatorio con fecha de mañana", () => {
    const a = rem("don't forget to call mom tomorrow");
    expect(a).not.toBeNull();
    expect(a?.dueAt ?? "").toContain("2026-11-04");
  });
  const PT = [
    "não se esqueça de comprar pão",
    "não esqueça de comprar pão",
    "não se esqueça de ligar para o médico amanhã",
    "não esqueças de comprar pão",
    "não se esquece de comprar pão",
    // La frase exacta que el barrido de rutas traía como casi
    // orden de olvido hasta F-PC55: hoy es orden de recordatorio.
    "não esqueça de ligar para a mãe",
  ];
  it.each(PT)("pt «%s» → recordatorio y la puerta dice actuar", (t) => {
    expect(rem(t)).not.toBeNull();
    expect(classifyIntent(t)).toBe("actuar");
  });
  const CTRL = [
    "que no se me olvide comprar pan",
    "recuérdame comprar pan",
    "don't let me forget to buy milk",
    "lembra-me de comprar pão",
  ];
  it.each(CTRL)("control «%s» → recordatorio (ya nacía)", (t) => {
    expect(rem(t)).not.toBeNull();
  });
});

// ---------------------------------------------------------------- R2
// La cláusula sigue siendo hecho (F-PC55): el contenido no
// abre con infinitivo, así que se guarda como hecho y no
// nace recordatorio. El rojo es la cláusula inglesa sin
// contraer, que hoy cae a chat entero.
describe("R2 · la cláusula sigue siendo hecho (F-PC55)", () => {
  const CASOS = [
    "no se te olvide que mañana es el cumpleaños de Ana",
    "que no se te olvide que el martes pago la renta",
    "no te olvides de que el martes pago la renta",
    "no olvides que mañana es el cumpleaños de Ana",
    "no se te olvide que mi mamá se llama Marta",
    "don't forget that tomorrow is Ana's birthday",
    "do not forget that tomorrow is Ana's birthday",
    "não esqueça que amanhã é o aniversário da Ana",
    "não se esqueça que amanhã é o aniversário da Ana",
    "não se esqueça de que amanhã é o aniversário da Ana",
  ];
  it.each(CASOS)("«%s» → hecho y sin recordatorio", (t) => {
    expect(extractRememberFact(t)).not.toBeNull();
    expect(rem(t)).toBeNull();
  });
});

// ---------------------------------------------------------------- R3
// Guardas sin infinitivo (F-PC55): la apertura con contenido
// que no es tarea no crea recordatorio; el flujo sigue como
// hoy. Nace en verde.
describe("R3 · guardas sin infinitivo (F-PC55)", () => {
  const CASOS = [
    "no olvides el cumpleaños de mamá",
    "recuerda el cumpleaños de mamá",
    "no te olvides del cumpleaños de mamá",
    "não esqueça o aniversário da mãe",
  ];
  it.each(CASOS)("«%s» → sin recordatorio", (t) => {
    expect(rem(t)).toBeNull();
  });
});

// ---------------------------------------------------------------- R4
// El artículo portugués (F-PC58): el patrón m5 de
// extractPeople y el patrón pt de extractSelfName admiten el
// artículo delante del posesivo, como el lado de consulta ya
// admite. La clase es solo portuguesa: es y en no tienen
// forma con artículo.
describe("R4 · el artículo pt (F-PC58)", () => {
  const CASOS: Array<[string, string, string]> = [
    ["a minha mãe se chama Maria", "Maria", "mãe"],
    ["a minha mãe chama-se Maria", "Maria", "mãe"],
    ["o meu pai se chama João", "João", "pai"],
    ["o meu pai chama-se João", "João", "pai"],
    ["a minha avó se chama Rosa", "Rosa", "avó"],
    ["lembra que a minha mãe se chama Maria", "Maria", "mãe"],
    ["lembre que o meu pai se chama João", "João", "pai"],
    ["olá, a minha mãe se chama Maria", "Maria", "mãe"],
    ["minha mãe se chama Maria", "Maria", "mãe"],
    ["minha mãe chama-se Maria", "Maria", "mãe"],
    ["meu pai se chama João", "João", "pai"],
  ];
  it.each(CASOS)("«%s» → %s (%s)", (t, nombre, rel) => {
    const p = extractPeople(t);
    expect(p).toHaveLength(1);
    expect(p[0]?.name).toBe(nombre);
    expect(p[0]?.relationship).toBe(rel);
  });
  it("«o meu nome é Ana» → el nombre propio con su artículo", () => {
    expect(extractSelfName("o meu nome é Ana")).toBe("Ana");
  });
  it("control «meu nome é Ana» → Ana (ya nacía)", () => {
    expect(extractSelfName("meu nome é Ana")).toBe("Ana");
  });
});

// ---------------------------------------------------------------- R5
// Dos presentaciones (F-PC59): extractPeople recoge a todas
// las personas del dictado — el plural rinde la lista
// entera, los singulares barren el texto sin cortarse entre
// sí, y la continuación sin verbo rinde tras una primera
// extracción. La salida va en el orden del texto.
describe("R5 · dos presentaciones (F-PC59)", () => {
  const CASOS: Array<[string, string[]]> = [
    ["mi mamá se llama Marta y mi papá se llama José", ["Marta", "José"]],
    ["mi papá se llama José y mi mamá se llama Marta", ["José", "Marta"]],
    ["mi mamá se llama Marta, mi papá se llama José", ["Marta", "José"]],
    ["mi mamá se llama Marta. Mi papá se llama José", ["Marta", "José"]],
    ["mi hijo se llama Leo y mi hija se llama Ana", ["Leo", "Ana"]],
    ["recuerda que mi mamá se llama Marta y mi papá se llama José", ["Marta", "José"]],
    ["my mom is called Mary and my dad is called John", ["Mary", "John"]],
    ["minha mãe se chama Maria e meu pai se chama João", ["Maria", "João"]],
    ["recuerda que mi mamá Marta y mi papá José vienen el lunes", ["Marta", "José"]],
    ["mi mejor amigo se llama Diego y mi mamá se llama Marta", ["Diego", "Marta"]],
    ["mis hijos se llaman Leo, Max y Ana", ["Leo", "Max", "Ana"]],
    ["mis hijos se llaman Leo y Max", ["Leo", "Max"]],
    ["mi mamá se llama Marta", ["Marta"]],
    ["my mom is called Mary", ["Mary"]],
  ];
  it.each(CASOS)("«%s» → %j", (t, nombres) => {
    expect(extractPeople(t).map((p) => p.name)).toEqual(nombres);
  });
});
