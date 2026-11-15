// Tanda T-33 (0.1.99) — regresión de la repetición de Z-02
// (ACTA-z02-r2.md, NO AGUANTA): H-Z4-5-R2 y la abreviatura
// desnuda sin «de». Las sondas de T-02 y la regresión de T-28
// pasan enteras; estos casos son los que la repetición midió
// en rojo, con sus pares de control.
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

describe("H-Z4-5-R2 · la guarda de una edición decide por el idioma del marco", () => {
  it("caso mínimo: «às onse» (PT, «onze» distorsionado) no crea a las 09:00 en silencio: avisa", () => {
    expect(extractReminderAction("lembre-me amanhã às onse de comprar pão", now)).toBeNull();
    expect(reminderInvalidWhen("lembre-me amanhã às onse de comprar pão", now)).toBe(true);
    expect(hasImpossibleWhen("amanhã às onse")).toBe(true);
  });
  it("las gemelas cruzadas a una edición avisan igual (la palabra no es del idioma del marco)", () => {
    expect(hasImpossibleWhen("mañana a las onze")).toBe(true);
    expect(hasImpossibleWhen("amanhã às once")).toBe(true);
    expect(extractReminderAction("recuérdame mañana a las onze comprar pan", now)).toBeNull();
    expect(extractReminderAction("lembre-me amanhã às once de comprar pão", now)).toBeNull();
  });
  it("control: el ES «a las onse» sigue creando a las 11, sin aviso (la cura de T-28 no se rompe)", () => {
    const r = extractReminderAction("recuérdame mañana a las onse comprar pan", now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 11, 0]);
    expect(hasImpossibleWhen("mañana a las onse")).toBe(false);
  });
  it("control: el PT bien dicho («às onze», «às nove») no avisa y crea a su hora", () => {
    const r = extractReminderAction("lembre-me amanhã às onze de comprar pão", now);
    expect(r?.text).toBe("comprar pão");
    expect(ymd(r?.dueAt)).toEqual([2026, 10, 15, 11, 0]);
    expect(hasImpossibleWhen("amanhã às nove")).toBe(false);
    expect(ymd(parseReminderDateTime("amanhã às nove", now))).toEqual([2026, 10, 15, 9, 0]);
  });
  it("control: las distorsiones PT que ya avisaban siguen avisando («dozi», «onzi»)", () => {
    expect(extractReminderAction("lembre-me amanhã às dozi de comprar pão", now)).toBeNull();
    expect(hasImpossibleWhen("amanhã às onzi")).toBe(true);
  });
  it("control: los ordinarios del marco no avisan en ninguno de los dos idiomas", () => {
    expect(reminderInvalidWhen("recuérdame mañana presentarme a la nueva jefa", now)).toBe(false);
    expect(hasImpossibleWhen("amanhã à nova")).toBe(false);
    expect(reminderInvalidWhen("lembre-me amanhã às vezes de tomar o remédio", now)).toBe(false);
  });
});

describe("Ítem 2 · la abreviatura desnuda sin «de» se lee como con «de» (ES)", () => {
  it.each([
    ["ene", 2027, 0], ["feb", 2027, 1], ["mar", 2027, 2], ["abr", 2027, 3],
    ["mai", 2027, 4], ["jun", 2027, 5], ["jul", 2027, 6], ["ago", 2027, 7],
    ["sep", 2027, 8], ["sept", 2027, 8], ["set", 2027, 8], ["oct", 2027, 9],
    ["out", 2027, 9], ["nov", 2026, 10], ["dic", 2026, 11], ["dez", 2026, 11],
    ["jan", 2027, 0], ["fev", 2027, 1], ["apr", 2027, 3], ["aug", 2027, 7],
  ])("«el 15 %s» desnuda, con punto y en mayúsculas = «el 15 de %s»", (ab, y, m) => {
    for (const forma of [`el 15 ${ab}`, `el 15 ${ab}.`, `el 15 ${ab.toUpperCase()}`]) {
      const r = extractReminderAction(`recuérdame ${forma} comprar pan`, now);
      expect(r?.text).toBe("comprar pan");
      expect(ymd(r?.dueAt)).toEqual([y, m, 15, 9, 0]);
    }
  });
  it.each([
    ["enero", 2027, 0], ["marzo", 2027, 2], ["mayo", 2027, 4], ["septiembre", 2027, 8],
  ])("el nombre completo desnudo también: «el 15 %s»", (mes, y, m) => {
    const r = extractReminderAction(`recuérdame el 15 ${mes} comprar pan`, now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([y, m, 15, 9, 0]);
  });
  it("con año escrito tras la desnuda: «el 15 ene de 2028» es ese año", () => {
    expect(ymd(parseReminderDateTime("el 15 ene de 2028", now))).toEqual([2028, 0, 15, 9, 0]);
  });
});

describe("Ítem 2 · la abreviatura desnuda sin «de» se lee como con «de» (PT)", () => {
  it.each([
    ["jan", 2027, 0], ["fev", 2027, 1], ["mar", 2027, 2], ["abr", 2027, 3],
    ["mai", 2027, 4], ["jun", 2027, 5], ["jul", 2027, 6], ["ago", 2027, 7],
    ["set", 2027, 8], ["out", 2027, 9], ["nov", 2026, 10], ["dez", 2026, 11],
  ])("«15 %s» desnuda y con punto = «15 de %s»", (ab, y, m) => {
    for (const forma of [`15 ${ab}`, `15 ${ab}.`]) {
      const r = extractReminderAction(`lembre-me ${forma} de comprar pão`, now);
      expect(r?.text).toBe("comprar pão");
      expect(ymd(r?.dueAt)).toEqual([y, m, 15, 9, 0]);
    }
  });
  it.each([
    ["janeiro", 2027, 0], ["fevereiro", 2027, 1], ["setembro", 2027, 8],
  ])("el nombre completo desnudo también: «15 %s»", (mes, y, m) => {
    const r = extractReminderAction(`lembre-me 15 ${mes} de comprar pão`, now);
    expect(r?.text).toBe("comprar pão");
    expect(ymd(r?.dueAt)).toEqual([y, m, 15, 9, 0]);
  });
});

describe("Ítem 2 · la desnuda en las demás vías y en los límites", () => {
  it("calendario ES: «cita el 15 ene a las 10» titula «cita» y cae el 15 de enero", () => {
    const a = extractToolAction("agenda una cita el 15 ene a las 10", now);
    expect(a?.kind).toBe("calendarCreate");
    if (a?.kind === "calendarCreate") {
      expect(a.title).toBe("cita");
      expect(ymd(a.start)).toEqual([2027, 0, 15, 10, 0]);
    }
  });
  it("calendario PT: «dentista 15 fev às 10» titula «dentista» y cae el 15 de febrero", () => {
    const a = extractToolAction("agende dentista 15 fev às 10", now);
    expect(a?.kind).toBe("calendarCreate");
    if (a?.kind === "calendarCreate") {
      expect(a.title).toBe("dentista");
      expect(ymd(a.start)).toEqual([2027, 1, 15, 10, 0]);
    }
  });
  it("la imposible desnuda avisa como la de «de», no crea otra fecha en silencio", () => {
    expect(hasImpossibleWhen("el 31 abr")).toBe(true);
    expect(hasImpossibleWhen("el 30 feb")).toBe(true);
    expect(hasImpossibleWhen("31 abr")).toBe(true);
    // Hoy «el 31 abr» creaba el 31 de diciembre por la vía del día suelto.
    expect(extractReminderAction("recuérdame el 31 abr comprar pan", now)).toBeNull();
    expect(reminderInvalidWhen("recuérdame el 31 abr comprar pan", now)).toBe(true);
    const pt = extractReminderAction("lembre-me 31 abr de comprar pão", now);
    expect(pt?.dueAt ?? null).toBeNull();
  });
  it("la válida límite desnuda rueda como con «de»: «el 29 feb» → 29-feb-2028", () => {
    const r = extractReminderAction("recuérdame el 29 feb comprar pan", now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2028, 1, 29, 9, 0]);
    expect(hasImpossibleWhen("el 29 feb")).toBe(false);
  });
  it("con «día/dia» delante, la desnuda también deja el título limpio", () => {
    const es = extractReminderAction("recuérdame el día 15 ene comprar pan", now);
    expect(es?.text).toBe("comprar pan");
    expect(ymd(es?.dueAt)).toEqual([2027, 0, 15, 9, 0]);
    const pt = extractReminderAction("lembre-me dia 15 fev de comprar pão", now);
    expect(pt?.text).toBe("comprar pão");
    expect(ymd(pt?.dueAt)).toEqual([2027, 1, 15, 9, 0]);
  });
  it("con día de la semana delante manda la fecha nombrada, como con «de»", () => {
    const r = extractReminderAction("recuérdame el viernes 15 ene comprar pan", now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2027, 0, 15, 9, 0]);
  });
  it("«qué día cae» lee la desnuda en ES y en PT", () => {
    const es = weekdayAction("qué día cae el 15 ene", now);
    expect(es?.kind).toBe("weekday");
    if (es?.kind === "weekday") {
      expect([es.year, es.month, es.day]).toEqual([2027, 1, 15]);
    }
    const pt = weekdayAction("que dia cai 15 fev", now);
    expect(pt?.kind).toBe("weekday");
    if (pt?.kind === "weekday") {
      expect([pt.year, pt.month, pt.day]).toEqual([2027, 2, 15]);
    }
  });
  it("control de falso positivo: «15 marcos» no es una fecha (la desnuda exige frontera)", () => {
    const r = extractReminderAction("recuérdame comprar 15 marcos", now);
    expect(r?.text).toBe("comprar 15 marcos");
    expect(r?.dueAt ?? null).toBeNull();
  });
  it("control: la forma con «de» no cambia", () => {
    const r = extractReminderAction("recuérdame el 15 de ene comprar pan", now);
    expect(r?.text).toBe("comprar pan");
    expect(ymd(r?.dueAt)).toEqual([2027, 0, 15, 9, 0]);
  });
});
