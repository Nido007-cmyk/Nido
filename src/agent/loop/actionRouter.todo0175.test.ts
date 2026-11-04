// Arreglos de la lista «todo es todo» (2026-11-03): división entre cero,
// alarmas, títulos de citas y el día de la semana con número. Pares.
import { describe, expect, it } from "vitest";
import { extractCalcAction, extractReminderAction } from "./actionRouter";
import { extractToolAction } from "./toolRouter";

const now = new Date(2026, 10, 3, 17, 0); // martes 3 de noviembre, 17:00
const at = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

describe("división entre cero", () => {
  it.each(["cuánto es 10/0", "quanto é 10 dividido por 0", "what is 5 divided by 0", "cuánto es 100/(5-5)"])("%s → sin resultado", (t) => {
    expect(extractCalcAction(t)?.divisionByZero).toBe(true);
  });
  it("par: «10/0.5» y «1/3» siguen calculando", () => {
    expect(extractCalcAction("cuánto es 10/0.5")?.result).toBe(20);
    expect(extractCalcAction("cuánto es 1/3")?.divisionByZero).toBeUndefined();
  });
});

describe("alarmas", () => {
  it.each([
    ["pon una alarma para las 7", "Alarma"],
    ["set an alarm for 7am", "Alarm"],
    ["coloca um alarme para as 7", "Alarme"],
  ])("%s → «%s» a las 7:00", (t, title) => {
    const r = extractReminderAction(t, now);
    expect(r?.text).toBe(title);
    expect(at(r?.dueAt)?.getHours()).toBe(7);
  });
  it("«pon una alarma mañana a las 6» son las 6:00 (mañana es el día, no la parte del día)", () => {
    const r = extractReminderAction("pon una alarma mañana a las 6 para ir al gimnasio", now);
    expect(r?.text).toBe("ir al gimnasio");
    expect([at(r?.dueAt)?.getDate(), at(r?.dueAt)?.getHours()]).toEqual([4, 6]);
  });
  it("par: «despiértame a las 7» no es «Alarma»: se titula «Despertar» (segunda tanda)", () => {
    expect(extractReminderAction("despiértame a las 7", now)?.text).toBe("Despertar");
  });
});

describe("títulos de citas", () => {
  it.each([
    ["agenda una cita con el dentista el 15 de diciembre a las 10:30", "cita con el dentista"],
    ["agenda una llamada en 2 horas", "llamada"],
    ["schedule a meeting with John on friday at 3pm", "meeting with John"],
    ["agenda un almuerzo con Ana mañana a las 2", "almuerzo con Ana"],
    ["añade una cita con el doctor mañana a las 9", "cita con el doctor"],
  ])("%s → «%s»", (t, title) => {
    expect(extractToolAction(t, now)).toMatchObject({ kind: "calendarCreate", title });
  });
});

describe("día de la semana con número", () => {
  it("«el viernes 13» es el viernes día 13 (existe)", () => {
    const r = extractReminderAction("recuérdame el viernes 13 llamar", now);
    expect(r?.text).toBe("llamar");
    expect(at(r?.dueAt)?.getDate()).toBe(13);
  });
  it("«el viernes 10 llamar» (no hay viernes 10 cerca): el viernes a las 10", () => {
    const r = extractReminderAction("recuérdame el viernes 10 llamar", now);
    expect(r?.text).toBe("llamar");
    expect([at(r?.dueAt)?.getDate(), at(r?.dueAt)?.getHours()]).toEqual([6, 10]);
  });
  it("«el viernes 10 de diciembre» manda la fecha con mes", () => {
    expect(at(extractReminderAction("recuérdame el viernes 10 de diciembre llamar", now)?.dueAt)?.getMonth()).toBe(11);
  });
  it("«el viernes 10:30» es la hora y sale del título", () => {
    const r = extractReminderAction("recuérdame el viernes 10:30 llamar", now);
    expect(r?.text).toBe("llamar");
    expect([at(r?.dueAt)?.getHours(), at(r?.dueAt)?.getMinutes()]).toEqual([10, 30]);
  });
  it("par: «el lunes 2 pastillas» son dos pastillas el lunes, no las 2", () => {
    const r = extractReminderAction("recuérdame el lunes 2 pastillas", now);
    expect(r?.text).toBe("2 pastillas");
    expect([at(r?.dueAt)?.getDay(), at(r?.dueAt)?.getHours()]).toEqual([1, 9]);
  });
});
