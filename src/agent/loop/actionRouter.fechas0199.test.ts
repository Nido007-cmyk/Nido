// Tanda 1 de arreglos 0.1.99 — regresión de la auditoría del carril 3
// (2026-11-14, sondas reales sobre la 0.1.98). Cada caso es el texto
// exacto de una sonda del acta: lo que salía mal no vuelve, y los pares
// de control fijan lo que ya iba bien.
// now = sábado 14 de noviembre de 2026, 10:00 local (el de las sondas).
import { describe, expect, it } from "vitest";
import {
  extractReminderAction,
  hasImpossibleWhen,
  parseReminderDateTime,
  reminderInvalidWhen,
} from "./actionRouter";
import { extractToolAction, weekdayAction } from "./toolRouter";

const now = new Date(2026, 10, 14, 10, 0);
const day = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
const ymd = (iso: string | null | undefined) => {
  const d = day(iso);
  return d ? [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()] : null;
};

describe("A-C1 · fechas numéricas: nunca otra fecha en silencio", () => {
  it("«el 25/12» es el 25 de diciembre (a>12 fija d/m) y el título no se traga el «/12»", () => {
    const r = extractReminderAction("recuérdame el 25/12 comprar pan", now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2026, 11, 25, 9, 0]);
  });
  it("«12/25» en inglés es el 25 de diciembre (b>12 fija m/d)", () => {
    const r = extractReminderAction("remind me 12/25 to buy bread", now);
    expect(r?.text).toBe("buy bread");
    expect(ymd(r?.dueAt)).toEqual([2026, 11, 25, 9, 0]);
  });
  it("el año escrito manda: «el 25/12/2027» es 2027, no el próximo diciembre", () => {
    const r = extractReminderAction("recuérdame el 25/12/2027 comprar pan", now);
    expect(ymd(r?.dueAt)).toEqual([2027, 11, 25, 9, 0]);
  });
  it("el año de dos dígitos se expande como en dates.ts: «25/12/27» → 2027", () => {
    expect(ymd(parseReminderDateTime("el 25/12/27 a las 10", now))).toEqual([2027, 11, 25, 10, 0]);
  });
  it("«el 10/11/2027» es ambiguo (10-nov o 11-oct): no se crea y se dice", () => {
    expect(extractReminderAction("recuérdame el 10/11/2027 comprar pan", now)).toBeNull();
    expect(reminderInvalidWhen("recuérdame el 10/11/2027 comprar pan", now)).toBe(true);
  });
  it("«el 10/11» sin año también es ambiguo: no se crea el 10 de diciembre", () => {
    expect(extractReminderAction("recuérdame el 10/11 comprar pan", now)).toBeNull();
    expect(reminderInvalidWhen("recuérdame el 10/11 comprar pan", now)).toBe(true);
    expect(parseReminderDateTime("el 10/11 a las 3", now)).toBeNull();
  });
  it("la simétrica «10/10» no es ambigua: es el 10 de octubre (próxima vez, 2027)", () => {
    expect(ymd(parseReminderDateTime("el 10/10 a las 10", now))).toEqual([2027, 9, 10, 10, 0]);
  });
  it("«29/02/2027» no existe (2027 no es bisiesto): no se crea y se dice", () => {
    expect(extractReminderAction("recuérdame el 29/02/2027 comprar pan", now)).toBeNull();
    expect(reminderInvalidWhen("recuérdame el 29/02/2027 comprar pan", now)).toBe(true);
  });
  it("«29/02» sin año es el próximo 29 de febrero real: 2028", () => {
    expect(ymd(parseReminderDateTime("el 29/02 a las 10", now))).toEqual([2028, 1, 29, 10, 0]);
  });
  it("la fracción de cocina no es fecha: «el 1/2» no crea mención ni aviso", () => {
    expect(parseReminderDateTime("el 1/2", now)).toBeNull();
    expect(hasImpossibleWhen("el 1/2")).toBe(false);
  });
  it("par: «el 3» suelto sigue siendo el 3 del mes siguiente", () => {
    expect(ymd(extractReminderAction("recuérdame el 3 pagar la luz", now)?.dueAt)).toEqual([2026, 11, 3, 9, 0]);
  });
});

describe("A-M1 · meses abreviados en recordatorios y calendario (la tabla del juez)", () => {
  it.each([
    ["recuérdame el 15 de ene comprar pan", "comprar pan", [2027, 0, 15, 9, 0]],
    ["recuérdame el 15 de feb comprar pan", "comprar pan", [2027, 1, 15, 9, 0]],
    ["remind me Jan 15 to buy bread", "buy bread", [2027, 0, 15, 9, 0]],
    ["lembre-me 15 de jan de comprar pão", "comprar pão", [2027, 0, 15, 9, 0]],
    ["lembre-me 15 de fev de comprar pão", "comprar pão", [2027, 1, 15, 9, 0]],
  ])("%s", (t, text, want) => {
    const r = extractReminderAction(t, now);
    expect(r?.text).toBe(text);
    expect(ymd(r?.dueAt)).toEqual(want);
  });
  it("«el 31 de feb» abreviado también es imposible y se dice", () => {
    expect(hasImpossibleWhen("el 31 de feb")).toBe(true);
    expect(reminderInvalidWhen("recuérdame el 31 de feb comprar pan", now)).toBe(true);
  });
  it("calendario: «el 15 de ene» crea el evento ESE día, no mañana con la fecha en el título", () => {
    const a = extractToolAction("agenda una cita el 15 de ene a las 10", now);
    expect(a?.kind).toBe("calendarCreate");
    if (a?.kind === "calendarCreate") {
      expect(a.title).toBe("cita");
      expect(ymd(a.start)).toEqual([2027, 0, 15, 10, 0]);
    }
  });
  it("calendario: la numérica ambigua no crea el evento en otra fecha", () => {
    const a = extractToolAction("agenda una cita el 10/11 a las 10", now);
    if (a?.kind === "calendarCreate") expect(a.invalidWhen).toBe(true);
  });
  it("par: «el 15 de enero» completo no cambia", () => {
    expect(ymd(extractReminderAction("recuérdame el 15 de enero comprar pan", now)?.dueAt)).toEqual([2027, 0, 15, 9, 0]);
  });
});

describe("A-M2 · «qué día cae…» con abreviaturas en los tres idiomas", () => {
  it.each([
    ["qué día cae el 25 de dic", 12, 25],
    ["qué día cae el 15 de ene", 1, 15],
    ["que dia cai 25 de dez", 12, 25],
    ["que dia cai 15 de jan", 1, 15],
    ["what day is 25 of Dec", 12, 25],
  ])("%s", (t, month, dom) => {
    const a = weekdayAction(t, now);
    expect(a?.kind).toBe("weekday");
    if (a?.kind === "weekday") {
      expect(a.month).toBe(month);
      expect(a.day).toBe(dom);
    }
  });
});

describe("A-M3 · la hora en letra también suena (es/en/pt, con dictado)", () => {
  it.each([
    ["recuérdame a las cinco comprar pan", "comprar pan", [2026, 10, 14, 17, 0]],
    ["recuérdame a las sinco comprar pan", "comprar pan", [2026, 10, 14, 17, 0]],
    ["remind me at five to buy bread", "buy bread", [2026, 10, 14, 17, 0]],
    ["lembre-me às cinco de comprar pão", "comprar pão", [2026, 10, 14, 17, 0]],
    ["recuérdame a la una comprar pan", "comprar pan", [2026, 10, 14, 13, 0]],
  ])("%s", (t, text, want) => {
    const r = extractReminderAction(t, now);
    expect(r?.text).toBe(text);
    expect(ymd(r?.dueAt)).toEqual(want);
  });
  it("con parte del día manda ella: «a las cinco de la mañana» son las 5:00", () => {
    expect(ymd(parseReminderDateTime("mañana a las cinco de la mañana", now))).toEqual([2026, 10, 15, 5, 0]);
  });
});

describe("A-M4 · las fracciones no pierden el minuto", () => {
  it.each([
    ["mañana a las 3 y media", [2026, 10, 15, 15, 30]],
    ["mañana a las tres y media", [2026, 10, 15, 15, 30]],
    ["tomorrow at half past three", [2026, 10, 15, 15, 30]],
    ["mañana a las 4 menos cuarto", [2026, 10, 15, 15, 45]],
    ["tomorrow at quarter to four", [2026, 10, 15, 15, 45]],
    ["amanhã às quatro menos um quarto", [2026, 10, 15, 15, 45]],
    ["amanhã às três e meia", [2026, 10, 15, 15, 30]],
    ["mañana a las tres y cuarto", [2026, 10, 15, 15, 15]],
    ["tomorrow at quarter past three", [2026, 10, 15, 15, 15]],
  ])("%s", (t, want) => {
    expect(ymd(parseReminderDateTime(t, now))).toEqual(want);
  });
  it("el título no conserva la fracción: «a las tres y media» sale entero", () => {
    const r = extractReminderAction("recuérdame mañana a las tres y media comprar pan", now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 15, 30]);
  });
});

describe("A-M5/A-M6 · relativos con artículo y quincena en los tres idiomas", () => {
  it.each([
    ["in a week at 10", [2026, 10, 21, 10, 0]],
    ["in an hour", [2026, 10, 14, 11, 0]],
    ["en una quincena a las 10", [2026, 10, 28, 10, 0]],
    ["in a fortnight at 10", [2026, 10, 28, 10, 0]],
    ["em uma quinzena às 10", [2026, 10, 28, 10, 0]],
  ])("%s", (t, want) => {
    expect(ymd(parseReminderDateTime(t, now))).toEqual(want);
  });
  it("«in a week» dentro de la orden crea el aviso en 7 días y no deja resto en el título", () => {
    const r = extractReminderAction("remind me in a week to buy bread", now);
    expect(r?.text).toBe("buy bread");
    // Sin hora escrita, el relativo conserva la hora actual (10:00),
    // como «in an hour» → 11:00: es el diseño de los relativos.
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 21, 10, 0]);
  });
  it("par: «in one week» y «dentro de una semana» no cambian", () => {
    expect(ymd(parseReminderDateTime("in one week at 10", now))).toEqual([2026, 10, 21, 10, 0]);
    expect(ymd(parseReminderDateTime("dentro de una semana a las 10", now))).toEqual([2026, 10, 21, 10, 0]);
  });
});
