/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { dateConflictForSentence, parseDateMentions, parseSourceDateSentences } from "./dates";

// C-07: el verificador aprende fechas. La nota clínica de la ronda de
// pruebas del dueño es la fuente de la familia: la cita es el MARTES
// 10 de noviembre de 2026 (ancla del sistema: getDay() === 2), a las
// 9:30, sala 214. Ninguna fixture puede «corregir» ese martes.
const NOTA =
  "La cita de seguimiento es el martes 10 de noviembre de 2026 a las 9:30 en la sala 214. Toma el jarabe dos veces al día.";
const REF = new Date(2026, 10, 1); // domingo 1 de noviembre de 2026

const judge = (answer: string, sourceSentences: string[], ref: Date = REF) =>
  dateConflictForSentence(answer, parseSourceDateSentences(sourceSentences, ref), ref);

describe("parseDateMentions (C-07)", () => {
  it("la gramática absoluta fija el día en es, en y pt", () => {
    const es = parseDateMentions("La cita es el martes 10 de noviembre de 2026.", REF);
    expect(es).toHaveLength(1);
    expect(es[0].day).toEqual({ y: 2026, m: 11, d: 10 });
    expect(es[0].weekday).toBe(2);
    expect(es[0].hasYear).toBe(true);
    expect(es[0].kind).toBe("calendario");
    expect(parseDateMentions("The appointment is on November 10, 2026.", REF)[0].day).toEqual({ y: 2026, m: 11, d: 10 });
    expect(parseDateMentions("The appointment is 10 November 2026.", REF)[0].day).toEqual({ y: 2026, m: 11, d: 10 });
    expect(parseDateMentions("A consulta é 10 de novembro de 2026.", REF)[0].day).toEqual({ y: 2026, m: 11, d: 10 });
  });

  it("las relativas de día se normalizan contra la referencia (es)", () => {
    const day = (t: string) => parseDateMentions(t, REF)[0]?.day;
    expect(day("eso fue ayer")).toEqual({ y: 2026, m: 10, d: 31 });
    expect(day("eso fue anteayer")).toEqual({ y: 2026, m: 10, d: 30 });
    expect(day("la cita es hoy")).toEqual({ y: 2026, m: 11, d: 1 });
    expect(day("la cita es mañana")).toEqual({ y: 2026, m: 11, d: 2 });
    expect(day("la cita es pasado mañana")).toEqual({ y: 2026, m: 11, d: 3 });
    expect(parseDateMentions("eso fue ayer", REF)[0].kind).toBe("relativa");
  });

  it("las relativas de día en en y pt", () => {
    const day = (t: string) => parseDateMentions(t, REF)[0]?.day;
    expect(day("it was yesterday")).toEqual({ y: 2026, m: 10, d: 31 });
    expect(day("it is the day before yesterday")).toEqual({ y: 2026, m: 10, d: 30 });
    expect(day("the appointment is tomorrow")).toEqual({ y: 2026, m: 11, d: 2 });
    expect(day("it is the day after tomorrow")).toEqual({ y: 2026, m: 11, d: 3 });
    expect(day("foi ontem")).toEqual({ y: 2026, m: 10, d: 31 });
    expect(day("a consulta é amanhã")).toEqual({ y: 2026, m: 11, d: 2 });
    expect(day("é depois de amanhã")).toEqual({ y: 2026, m: 11, d: 3 });
  });

  it("el día de semana relativo es el estrictamente anterior/posterior", () => {
    const day = (t: string) => parseDateMentions(t, REF)[0]?.day;
    // Referencia: domingo 2026-11-01. El viernes pasado = 30 oct; el que viene = 6 nov.
    expect(day("llamé el viernes pasado")).toEqual({ y: 2026, m: 10, d: 30 });
    expect(day("llamaré el viernes que viene")).toEqual({ y: 2026, m: 11, d: 6 });
    expect(day("I called last Friday")).toEqual({ y: 2026, m: 10, d: 30 });
    expect(day("I will call next Friday")).toEqual({ y: 2026, m: 11, d: 6 });
    expect(day("liguei na sexta passada")).toEqual({ y: 2026, m: 10, d: 30 });
    expect(day("ligo na próxima sexta")).toEqual({ y: 2026, m: 11, d: 6 });
  });

  it("el día decorativo sin ancla y la semana sin día no crean mención", () => {
    expect(parseDateMentions("el lunes me dolía la cabeza", REF)).toEqual([]);
    expect(parseDateMentions("la próxima semana lo revisamos", REF)).toEqual([]);
    expect(parseDateMentions("la semana pasada fui", REF)).toEqual([]);
    expect(parseDateMentions("en noviembre hace frío", REF)).toEqual([]);
  });

  it("la forma corta portuguesa solo crea mención dentro de gramática de fecha", () => {
    expect(parseDateMentions("na segunda eu descansei", REF)).toEqual([]);
    const m = parseDateMentions("na segunda, dia 10, eu vou", REF);
    expect(m).toHaveLength(1);
    expect(m[0].weekday).toBe(1);
    expect(m[0].day).toBeNull();
  });

  it("la fecha inexistente no rueda al mes siguiente: queda sin fijar", () => {
    const m = parseDateMentions("la cita es el 29 de febrero de 2026", REF);
    expect(m).toHaveLength(1);
    expect(m[0].day).toBeNull(); // 2026 no es bisiesto: nada de rodar al 1 de marzo
    expect(parseDateMentions("la cita es el 29 de febrero de 2028", REF)[0].day).toEqual({ y: 2028, m: 2, d: 29 });
  });
});

describe("el juicio de fechas R1–R5 (C-07)", () => {
  it("R1: el lunes contra el calendario muere aunque la fuente no nombre el día; el martes vive", () => {
    const sinDia = ["La cita de seguimiento es el 10 de noviembre de 2026 a las 9:30 en la sala 214."];
    expect(judge("La cita es el lunes 10 de noviembre de 2026.", sinDia)).not.toBeNull();
    expect(judge("La cita es el martes 10 de noviembre de 2026.", sinDia)).toBeNull();
    // Y con la fuente nombrándolo (la nota real), también:
    expect(judge("La cita es el lunes 10 de noviembre de 2026.", [NOTA])).not.toBeNull();
    expect(judge("La cita es el martes 10 de noviembre de 2026.", [NOTA])).toBeNull();
  });

  it("R4: «el miércoles 10» (sin mes) empareja por día contra el martes de la nota", () => {
    const c = judge("eso fue el miércoles 10", [NOTA]);
    expect(c).not.toBeNull();
    expect(c?.sourceSentence).toContain("martes 10 de noviembre");
    // El año prestado: la respuesta sin año, la fuente con año y día nombrado.
    expect(judge("La cita es el lunes 10 de noviembre.", [NOTA])).not.toBeNull();
  });

  it("R5: «ayer» contra la absoluta de la nota dispara; la relativa honesta no", () => {
    expect(judge("Su cita es ayer.", [NOTA])).not.toBeNull();
    expect(judge("Su cita es ayer.", ["La cita es el 2 de noviembre de 2026."])).not.toBeNull();
    expect(judge("Su cita es mañana.", ["La cita es el 2 de noviembre de 2026."])).toBeNull();
    // «El viernes pasado» (30 oct) contra una absoluta que dice 30 oct: vive.
    expect(judge("Llamé el viernes pasado.", ["Llamé el 30 de octubre de 2026."])).toBeNull();
    expect(judge("Llamé el viernes pasado.", ["Llamé el 31 de octubre de 2026."])).not.toBeNull();
  });

  it("R3: el par sin año ambiguo a ±1 año no se juzga", () => {
    // «miércoles 10 de noviembre» sin año: en 2026 el 10 nov es martes
    // (fallaría), pero en 2027 es miércoles: el papel puede ser del año
    // que viene o del pasado — no se acusa.
    expect(judge("La cita fue el miércoles 10 de noviembre.", ["La cita fue el 10 de noviembre."])).toBeNull();
  });

  it("dos fechas en el documento no se cruzan (la cita y «llame antes del viernes»)", () => {
    const doc = [NOTA, "Llame antes del viernes para confirmar la cita."];
    expect(judge("La cita es el martes 10 de noviembre de 2026.", doc)).toBeNull();
    expect(judge("Llame antes del viernes.", doc)).toBeNull();
  });
});

// A6-40 (FV-1, opción (i)): la familia ordinal inglesa queda fijada
// como comportamiento aceptado. Las gramáticas de dates.ts aceptan el
// sufijo ordinal opcional (st|nd|rd|th) tras el día y la mención de
// emparejamiento («Tuesday the 10th»); la ruta existía solo en el
// código y en la medida de FV-1, sin una sola fixture. El defecto era
// la falta de asiento, no la conducta: producción intacta. El ancla
// es la misma de C-07: el 10 de noviembre de 2026 es MARTES.
describe("ordinales ingleses: comportamiento aceptado (A6-40, FV-1)", () => {
  it("parse, mes primero: «November 10th, 2026» crea la mención completa", () => {
    const m = parseDateMentions("The appointment is on November 10th, 2026.", REF);
    expect(m).toHaveLength(1);
    expect(m[0].day).toEqual({ y: 2026, m: 11, d: 10 });
    expect(m[0].hasYear).toBe(true);
    expect(m[0].kind).toBe("calendario");
  });

  it("la familia de sufijos sobre la misma gramática, cada uno con su fecha exacta", () => {
    const day = (t: string) => parseDateMentions(t, REF)[0]?.day;
    expect(day("November 1st, 2026")).toEqual({ y: 2026, m: 11, d: 1 });
    expect(day("November 2nd, 2026")).toEqual({ y: 2026, m: 11, d: 2 });
    expect(day("November 3rd, 2026")).toEqual({ y: 2026, m: 11, d: 3 });
    expect(day("November 21st, 2026")).toEqual({ y: 2026, m: 11, d: 21 });
    expect(day("November 23rd, 2026")).toEqual({ y: 2026, m: 11, d: 23 });
  });

  it("parse, emparejamiento: «Tuesday the 10th» crea la mención de emparejamiento", () => {
    const m = parseDateMentions("The appointment is on Tuesday the 10th.", REF);
    expect(m).toHaveLength(1);
    expect(m[0].weekday).toBe(2); // martes
    expect(m[0].dom).toBe(10);
    expect(m[0].day).toBeNull(); // emparejamiento: sin ancla absoluta en la frase
    expect(m[0].kind).toBe("calendario");
  });

  it("conflicto falso: «Monday, November 10th, 2026» se acusa (el 10 es martes)", () => {
    const src = ["The follow-up appointment is on November 10, 2026 at 9:30."];
    expect(judge("The appointment is on Monday, November 10th, 2026.", src)).not.toBeNull();
  });

  it("conflicto honesto: «Tuesday, November 10th, 2026» no se acusa", () => {
    const src = ["The follow-up appointment is on November 10, 2026 at 9:30."];
    expect(judge("The appointment is on Tuesday, November 10th, 2026.", src)).toBeNull();
  });

  it("control sin ordinal: «November 10, 2026» conserva exactamente el desenlace de hoy", () => {
    const bare = parseDateMentions("The appointment is on November 10, 2026.", REF);
    const ordinal = parseDateMentions("The appointment is on November 10th, 2026.", REF);
    expect(bare).toHaveLength(1);
    expect(bare[0].day).toEqual({ y: 2026, m: 11, d: 10 });
    expect(bare[0].day).toEqual(ordinal[0].day);
    expect(bare[0].hasYear).toBe(true);
    expect(bare[0].kind).toBe("calendario");
  });
});

// ---------------------------------------------------------------
// T-J5 (barrido «revisa todo», J5): la forma numérica «d/m[/aaaa]»
// no existía en la gramática — la transposición «11/10» contra
// «10/11» se sellaba porque los dígitos son los mismos y ninguna
// pierna los leía como fecha. La mención numérica guarda sus dos
// lecturas; R6 juzga cuando el contexto las fija (lectura única,
// convención declarada por un inequívoco del turno, gemela con
// nombre) y no fuerza lo ambiguo de verdad.

describe("T-J5: las fechas numéricas se parsean con sus lecturas", () => {
  it("la ambigua guarda los componentes crudos y no fija día", () => {
    const ms = parseDateMentions("La cita es el 10/11/2026.", REF);
    expect(ms).toHaveLength(1);
    expect(ms[0].num).toEqual({ a: 10, b: 11, year: 2026 });
    expect(ms[0].day).toBeNull();
    expect(ms[0].hasYear).toBe(true);
    expect(ms[0].kind).toBe("calendario");
  });

  it("la de lectura única se fija entera (13 solo puede ser el día; tras la barra, el mes va primero)", () => {
    const dm = parseDateMentions("La cita es el 13/10/2026.", REF);
    expect(dm[0].day).toEqual({ y: 2026, m: 10, d: 13 });
    const md = parseDateMentions("The appointment is 10/13/2026.", REF);
    expect(md[0].day).toEqual({ y: 2026, m: 10, d: 13 });
  });

  it("sin año exige ancla: «el 10/11» sí; un «a/b» suelto, no", () => {
    expect(parseDateMentions("La cita es el 10/11.", REF)).toHaveLength(1);
    expect(parseDateMentions("quedan 10/11 por revisar", REF)).toEqual([]);
  });

  it("la fracción de cocina no es una fecha, ni con ancla", () => {
    expect(parseDateMentions("Añade 1/2 taza de azúcar a la mezcla.", REF)).toEqual([]);
    expect(parseDateMentions("Añade el 1/2 de la harina.", REF)).toEqual([]);
  });

  it("el día de semana se pega a la numérica como a la de nombre (R1 la juzga)", () => {
    expect(judge("La cita es el lunes 13/10/2026.", ["La cita es el 13/10/2026."])?.kind).toBe("interna");
    expect(judge("La cita es el martes 13/10/2026.", ["La cita es el 13/10/2026."])).toBeNull();
  });
});

describe("T-J5 · R6: la transposición se juzga cuando el contexto decide", () => {
  it("con un inequívoco en la fuente (25/12: escribe d/m), la transpuesta es conflicto", () => {
    const c = judge("La cita con el dentista es el 11/10/2026.", [
      "La cita con el dentista es el 10/11/2026.",
      "La receta caduca el 25/12/2026.",
    ]);
    expect(c?.kind).toBe("numerica");
    expect(c?.sourceSentence).toContain("10/11/2026");
  });

  it("la transposición pelada, sin contexto, trae las mismas lecturas en los dos lados: no se fuerza", () => {
    expect(
      judge("La cita con el dentista es el 11/10/2026.", ["La cita con el dentista es el 10/11/2026."]),
    ).toBeNull();
  });

  it("la misma fecha en las dos convenciones acuerda: «10/13» contra «13/10» no es conflicto", () => {
    expect(judge("La cita es el 10/13/2026.", ["La cita es el 13/10/2026."])).toBeNull();
  });

  it("el componente cambiado contra una lectura única comparte mes y no acuerda: conflicto", () => {
    expect(judge("La cita es el 11/10/2026.", ["La cita es el 13/10/2026."])?.kind).toBe("numerica");
  });

  it("fechas sin ningún componente compartido no se cruzan (la doctrina R2 sigue)", () => {
    expect(
      judge("La cita es el 5/6/2027.", ["La cita es el 13/10/2026.", "La receta caduca el 25/12/2026."]),
    ).toBeNull();
  });
});
