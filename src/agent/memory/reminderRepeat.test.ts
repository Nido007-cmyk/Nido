/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { isReminderRepeat, nextOccurrence } from "./reminderRepeat";

describe("nextOccurrence", () => {
  const base = new Date(2026, 9, 13, 9, 0); // martes 9:00

  it("diaria: la siguiente tras `after`, a la misma hora", () => {
    const n = nextOccurrence(base, "day", new Date(2026, 9, 13, 9, 0));
    expect(n).toEqual(new Date(2026, 9, 14, 9, 0));
  });

  it("diaria: varios días perdidos saltan a la próxima futura", () => {
    const n = nextOccurrence(base, "day", new Date(2026, 9, 20, 12, 0));
    expect(n).toEqual(new Date(2026, 9, 21, 9, 0));
  });

  it("semanal: mismo día de la semana y hora", () => {
    const n = nextOccurrence(base, "week", new Date(2026, 9, 15, 0, 0));
    expect(n).toEqual(new Date(2026, 9, 20, 9, 0));
    expect(n.getDay()).toBe(2);
  });

  it("base muy futura retrocede hasta la primera tras `after`", () => {
    const n = nextOccurrence(new Date(2026, 9, 30, 9, 0), "day", new Date(2026, 9, 13, 10, 0));
    expect(n).toEqual(new Date(2026, 9, 14, 9, 0));
  });

  it("isReminderRepeat solo acepta day/week", () => {
    expect(isReminderRepeat("day")).toBe(true);
    expect(isReminderRepeat("week")).toBe(true);
    expect(isReminderRepeat(null)).toBe(false);
  });
});

describe("0.1.35: cada mes / cada año", () => {
  it("anual: el próximo aniversario, conservando día y hora", () => {
    const n = nextOccurrence(new Date(2026, 2, 15, 9, 0), "year", new Date(2026, 9, 13, 18, 0));
    expect(n).toEqual(new Date(2027, 2, 15, 9, 0));
  });
  it("anual 29 de febrero: el próximo año bisiesto", () => {
    const n = nextOccurrence(new Date(2024, 1, 29, 9, 0), "year", new Date(2026, 9, 13, 18, 0));
    expect(n).toEqual(new Date(2028, 1, 29, 9, 0));
  });
  it("mensual: el mismo día del mes siguiente", () => {
    const n = nextOccurrence(new Date(2026, 9, 5, 9, 0), "month", new Date(2026, 9, 13, 18, 0));
    expect(n).toEqual(new Date(2026, 10, 5, 9, 0));
  });
  it("mensual día 31: salta los meses que no lo tienen", () => {
    const n = nextOccurrence(new Date(2026, 0, 31, 9, 0), "month", new Date(2026, 1, 1, 0, 0));
    expect(n).toEqual(new Date(2026, 2, 31, 9, 0));
  });
  it("base muy futura vuelve a la primera tras `after`", () => {
    const n = nextOccurrence(new Date(2030, 2, 15, 9, 0), "year", new Date(2026, 9, 13, 18, 0));
    expect(n).toEqual(new Date(2027, 2, 15, 9, 0));
  });
  it("isReminderRepeat acepta month/year", () => {
    expect(isReminderRepeat("month")).toBe(true);
    expect(isReminderRepeat("year")).toBe(true);
    expect(isReminderRepeat("fortnight")).toBe(false);
  });
});
