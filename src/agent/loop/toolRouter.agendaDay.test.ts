// Pruebas adversarias del 2026-11-03: la agenda de un día de la semana
// caía al modelo en las tres lenguas, y «nota:» guardaba la nota solo en
// inglés. Pares: hoy, mañana y la semana no cambian.
import { describe, expect, it } from "vitest";
import { extractToolAction } from "./toolRouter";

const now = new Date(2026, 10, 3, 17, 0); // martes

describe("agenda de un día de la semana", () => {
  it.each([
    ["qué tengo el viernes", "es", "el viernes"],
    ["what do I have on friday", "en", "on Friday"],
    ["o que tenho na sexta", "pt", "na sexta-feira"],
    ["o que tenho no sábado", "pt", "no sábado"],
  ])("%s", (t, lang, prefix) => {
    const a = extractToolAction(t, now) as { kind: string; lang: string; from: string; to: string; rangeText?: string };
    expect(a.kind).toBe("calendarList");
    expect(a.lang).toBe(lang);
    expect(a.rangeText?.startsWith(prefix)).toBe(true);
    expect(new Date(a.to).getTime() - new Date(a.from).getTime()).toBeLessThanOrEqual(24 * 3600 * 1000);
    expect(new Date(a.from).getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
  it("el mismo día de la semana que hoy es hoy, desde ahora", () => {
    const a = extractToolAction("qué tengo el martes", now) as { from: string };
    expect(new Date(a.from).getTime()).toBe(now.getTime());
  });
  it("par: hoy, mañana y la semana no cambian", () => {
    expect(extractToolAction("qué tengo mañana", now)).toMatchObject({ kind: "calendarList", label: "tomorrow" });
    expect(extractToolAction("what do I have this week", now)).toMatchObject({ kind: "calendarList", label: "week" });
    expect(extractToolAction("o que tenho hoje", now)).toMatchObject({ kind: "calendarList", label: "today" });
  });
});

describe("«nota:» y «anota aí»", () => {
  it("«nota: …» guarda la nota en es y pt, como «note: …» en inglés", () => {
    expect(extractToolAction("nota: llamar a Juan", now)).toMatchObject({ kind: "noteSave", body: "llamar a Juan" });
    expect(extractToolAction("nota: ligar para o João", now)).toMatchObject({ kind: "noteSave", body: "ligar para o João" });
    expect(extractToolAction("note: call John", now)).toMatchObject({ kind: "noteSave", body: "call John" });
  });
  it("«anota aí: …» es portugués y «aí» no entra en el título", () => {
    expect(extractToolAction("anota aí: ligar para o João", now)).toMatchObject({ kind: "noteSave", body: "ligar para o João", lang: "pt" });
  });
  it("par: «la nota del médico» no es una orden", () => {
    expect(extractToolAction("la nota del médico era buena", now)?.kind).not.toBe("noteSave");
  });
});
