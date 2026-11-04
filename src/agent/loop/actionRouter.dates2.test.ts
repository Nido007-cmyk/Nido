// Pruebas adversarias del 2026-11-03 (segunda tanda): fechas que salían un
// día antes o en el día equivocado, títulos con restos de fecha y el
// porcentaje sobre una cantidad. Pares: lo que ya iba bien no cambia.
import { describe, expect, it } from "vitest";
import { extractCalcAction, extractReminderAction } from "./actionRouter";

const now = new Date(2026, 10, 3, 17, 0); // martes 3 de noviembre, 17:00
const day = (iso: string | null | undefined) => (iso ? new Date(iso) : null);

describe("pasado mañana, en las tres lenguas", () => {
  it.each([
    ["recuérdame pasado mañana ir al banco", "ir al banco"],
    ["remind me the day after tomorrow to go to the bank", "go to the bank"],
    ["lembre-me depois de amanhã de ir ao banco", "ir ao banco"],
  ])("%s", (t, text) => {
    const r = extractReminderAction(t, now);
    expect(r?.text).toBe(text);
    expect(day(r?.dueAt)?.getDate()).toBe(5);
  });
  it("par: «mañana» sigue siendo mañana", () => {
    expect(day(extractReminderAction("recuérdame mañana ir al banco", now)?.dueAt)?.getDate()).toBe(4);
  });
});

describe("el día del mes sin mes", () => {
  it.each([
    ["recuérdame el 15 a las 10 pagar", "pagar", 10, 15],
    ["remind me on the 15th at 10am to pay", "pay", 10, 15],
    ["lembre-me no dia 15 às 10 de pagar", "pagar", 10, 15],
  ])("%s", (t, text, month, dom) => {
    const r = extractReminderAction(t, now);
    expect(r?.text).toBe(text);
    expect(day(r?.dueAt)?.getMonth()).toBe(month);
    expect(day(r?.dueAt)?.getDate()).toBe(dom);
    expect(day(r?.dueAt)?.getHours()).toBe(10);
  });
  it("un día que ya pasó este mes es el del mes siguiente, no el año que viene", () => {
    const d = day(extractReminderAction("recuérdame el 3 pagar", now)?.dueAt);
    expect([d?.getFullYear(), d?.getMonth(), d?.getDate()]).toEqual([2026, 11, 3]);
  });
  it("un mes sin ese día salta al siguiente que lo tiene", () => {
    const d = day(extractReminderAction("recuérdame el 31 pagar la renta", now)?.dueAt);
    expect([d?.getMonth(), d?.getDate()]).toEqual([11, 31]);
  });
  it("par: «el 15 de diciembre» y las cifras que no son día no cambian", () => {
    expect(day(extractReminderAction("recuérdame el 15 de diciembre a las 10 pagar", now)?.dueAt)?.getMonth()).toBe(11);
    expect(extractReminderAction("recuérdame tomar 2 pastillas a las 8", now)?.text).toBe("tomar 2 pastillas");
  });
});

describe("«next monday», «el lunes que viene», «esta noche»", () => {
  it.each([
    ["recuérdame el lunes que viene llamar", "llamar"],
    ["remind me next monday to call", "call"],
    ["lembre-me na próxima segunda de ligar", "ligar"],
  ])("%s → «%s» el lunes 9", (t, text) => {
    const r = extractReminderAction(t, now);
    expect(r?.text).toBe(text);
    expect(day(r?.dueAt)?.getDate()).toBe(9);
  });
  it("par: «la próxima reunión» no pierde «próxima»", () => {
    expect(extractReminderAction("recuérdame mañana preparar la próxima reunión", now)?.text).toBe("preparar la próxima reunión");
    expect(extractReminderAction("remind me tomorrow to prepare the next meeting", now)?.text).toBe("prepare the next meeting");
  });
  it.each(["recuérdame esta noche sacar la basura", "remind me tonight to take out the trash", "lembre-me hoje à noite de tirar o lixo"])(
    "%s → hoy a las 20:00",
    (t) => {
      const d = day(extractReminderAction(t, now)?.dueAt);
      expect([d?.getDate(), d?.getHours()]).toEqual([3, 20]);
    },
  );
});

describe("sumar o restar un porcentaje a una cantidad", () => {
  it.each([
    ["cuánto es 100 menos 30%", 70],
    ["cuánto es 200 más 15%", 230],
    ["what is 80 - 25%", 60],
    ["quanto é 50 mais 10%", 55],
  ])("%s = %d", (t, v) => {
    expect(extractCalcAction(t)?.result).toBeCloseTo(v, 9);
  });
  it("par: «15% de 200» y «30%» solos no cambian", () => {
    expect(extractCalcAction("cuánto es el 15% de 200")?.result).toBe(30);
    expect(extractCalcAction("cuánto es 30%")?.result).toBeCloseTo(0.3, 9);
  });
});
