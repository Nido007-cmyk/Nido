// Pruebas adversarias del 2026-11-03: el mediodía/la medianoche con su
// preposición en en/pt dejaban basura en el título, y «en 1 hora y
// media» avisaba media hora antes. Pares: lo que ya iba bien no cambia.
import { describe, expect, it } from "vitest";
import { extractReminderAction } from "./actionRouter";

const now = new Date(2026, 10, 3, 17, 0);
const mins = (iso: string | null | undefined, from: Date) => (iso ? Math.round((new Date(iso).getTime() - from.getTime()) / 60_000) : null);

describe("mediodía y medianoche: la preposición sale con ellos", () => {
  it.each([
    ["remind me at noon to eat", "eat"],
    ["lembre-me ao meio-dia de almoçar", "almoçar"],
    ["recuérdame al mediodía comer", "comer"],
    ["recuérdame a mediodía comer", "comer"],
    ["remind me at midnight to sleep", "sleep"],
    ["lembre-me à meia-noite de dormir", "dormir"],
  ])("%s → «%s»", (t, text) => {
    const r = extractReminderAction(t, now);
    expect(r?.text).toBe(text);
    expect(r?.dueAt).toBeTruthy();
  });
});

describe("relativo en horas con su cola", () => {
  it.each([
    ["recuérdame en 1 hora y media salir", 90, "salir"],
    ["remind me in 2 hours and a half to leave", 150, "leave"],
    ["lembre-me em 1 hora e meia de sair", 90, "sair"],
    ["recuérdame en 1 hora y 30 minutos salir", 90, "salir"],
    ["recuérdame en 2 horas y cuarto salir", 135, "salir"],
  ])("%s → +%d min, «%s»", (t, expected, text) => {
    const before = now;
    const r = extractReminderAction(t, now);
    expect(r?.text).toBe(text);
    const m = mins(r?.dueAt, before);
    expect(m).not.toBeNull();
    expect(Math.abs((m as number) - expected)).toBeLessThanOrEqual(1);
  });
  it("par: sin cola, el relativo no cambia", () => {
    const before = now;
    const r = extractReminderAction("recuérdame en 1 hora salir", now);
    expect(r?.text).toBe("salir");
    expect(Math.abs((mins(r?.dueAt, before) as number) - 60)).toBeLessThanOrEqual(1);
  });
});
