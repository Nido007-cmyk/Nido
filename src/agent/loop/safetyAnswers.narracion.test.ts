/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Ampliación de la capa de narración (tanda de narración,
 * familia F-CO): el monóxido contado con su marcador («ayer
 * sonó la alarma de monóxido», «ontem o alarme tocou», «last
 * night the alarm went off») no es un parte: las caras de
 * monóxido traen formas de pasado a propósito («sonó»,
 * «disparou») porque una alarma que acaba de sonar ES una
 * emergencia, pero ninguna miraba la distancia. La cura trae el
 * veto de narración a las dos caras de monóxido de esta tabla
 * (marcador ∧ suceso en pasado ∧ ninguna ancla viva de CO:
 * alarma sonando ahora, síntoma en presente, olor presente) y
 * las formas de pasado del suceso de CO a la puerta, para las
 * frases que caen a la cara de situación («había un olor a gas
 * muy fuerte en la cocina»). Corpus de la tanda: 161 frases
 * F-CO; esta batería genera las mismas tablas y las cobra
 * enteras a nivel de ruta, más las guardas vivas de CO.
 */
import { describe, it, expect } from "vitest";
import { matchSafetyAnswer } from "./safetyAnswers";
import { deterministicAnswer } from "../../eval/blindCore";

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const modelSide = (t: string): boolean => {
  const r = deterministicAnswer({ id: "n", type: "emergencia", lang: "es", expected: "model-side", query: t });
  return r.route === "model" || r.route === "factual-refusal";
};

const MARK_ES = ["ayer", "anoche", "anteayer", "esta mañana", "la semana pasada", "el mes pasado", "el año pasado", "hace un rato", "hace dos días", "hace una semana", "el otro día", "el lunes pasado"];
const MARK_EN = ["yesterday", "last night", "the day before yesterday", "this morning", "last week", "last month", "last year", "two days ago", "a while ago", "the other day", "on monday"];
const MARK_PT = ["ontem", "ontem à noite", "anteontem", "esta manhã", "na semana passada", "no mês passado", "no ano passado", "faz dois dias", "há dois dias", "no outro dia", "na segunda passada"];

const EV_CO_ES = [
  "sonó la alarma de monóxido de carbono", "el detector de monóxido sonó y nos dolía a todos la cabeza",
  "había un olor a gas muy fuerte en la cocina", "se encendió la alarma de monóxido y salimos de la casa",
  "nos dolía la cabeza y era el monóxido de la estufa",
];
const EV_CO_EN = [
  "the carbon monoxide alarm went off", "the CO detector went off and we all had headaches",
  "there was a strong smell of gas in the kitchen", "the monoxide alarm sounded and we left the house",
];
const EV_CO_PT = [
  "o alarme de monóxido de carbono tocou", "o detector de monóxido disparou e todos tivemos dor de cabeça",
  "tinha um cheiro forte de gás na cozinha", "o alarme de monóxido tocou e saímos de casa",
];

function fco(): string[] {
  const out: string[] = [];
  MARK_ES.forEach((m) => EV_CO_ES.forEach((e) => out.push(`${cap(m)} ${e}`)));
  EV_CO_ES.forEach((e) => out.push(`${cap(e)} el martes pasado`));
  MARK_EN.forEach((m) => EV_CO_EN.forEach((e) => out.push(`${cap(m)} ${e}`)));
  EV_CO_EN.forEach((e) => out.push(`${cap(e)} last tuesday`));
  MARK_PT.forEach((m) => EV_CO_PT.forEach((e) => out.push(`${cap(m)} ${e}`)));
  EV_CO_PT.forEach((e) => out.push(`${cap(e)} na terça passada`));
  return [...new Set(out)];
}

// Las guardas vivas de CO del corpus del acto 0, verbatim: su
// ruta fija es esta tabla (o la situación de la puerta), nunca
// el modelo. («Está sonando la alarma de monóxido ahora mismo»,
// con el verbo delante, no casa ninguna forma de la cara en la
// punta: hueco de forma previo, ajeno a la narración, nombrado
// en el cierre de la tanda.)
const GUARDAS_CO: string[] = [
  "suena la alarma de monóxido y me duele la cabeza",
  "el detector de monóxido está sonando y me duele la cabeza",
  "o alarme de monóxido está tocando e minha cabeça dói",
  "o detector de monóxido está tocando e minha cabeça dói",
  "the carbon monoxide alarm is going off and my head hurts",
  "the monoxide detector is sounding and my head hurts",
  "hay olor a gas muy fuerte en la cocina ahora",
  "me duele la cabeza y huele a gas en la cocina",
];

describe("tabla de seguridad · el monóxido contado no es un parte (F-CO)", () => {
  it("las tablas generadas enteras van al modelo a nivel de ruta", () => {
    const fuera = fco().filter((t) => !modelSide(t));
    expect(fuera).toEqual([]);
  });
  it("la alarma contada no casa ninguna cara de esta tabla", () => {
    expect(matchSafetyAnswer("Ayer sonó la alarma de monóxido de carbono", "es")).toBeNull();
    expect(matchSafetyAnswer("Ontem o alarme de monóxido de carbono tocou", "pt")).toBeNull();
    expect(matchSafetyAnswer("Yesterday the CO detector went off and we all had headaches", "en")).toBeNull();
  });
});

describe("tabla de seguridad · la guarda de CO manda", () => {
  it("el monóxido vivo sigue recibiendo su respuesta fija", () => {
    const fuera = GUARDAS_CO.filter((t) => modelSide(t));
    expect(fuera).toEqual([]);
  });
  it("la alarma que suena ahora sigue siendo co-symptoms", () => {
    expect(matchSafetyAnswer("suena la alarma de monóxido y me duele la cabeza", "es")?.kind).toBe("co-symptoms");
    expect(matchSafetyAnswer("the carbon monoxide alarm is going off and my head hurts", "en")?.kind).toBe("co-symptoms");
  });
});
