/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { formatReminderDay, formatReminderTime, formatReminderWhen } from "./reminderFormat";

describe("reminderFormat (sin Intl, CRASH-2026-10-10)", () => {
  // Fechas construidas en hora LOCAL: el formateador usa getters locales.
  const birthday = new Date(2027, 2, 15, 9, 0); // lunes 15 de marzo de 2027, 9:00
  const evening = new Date(2026, 9, 10, 21, 5); // sábado 10 de octubre, 21:05
  const midnight = new Date(2026, 0, 3, 0, 30); // sábado 3 de enero, 0:30

  it("español: mismo texto que daba Intl", () => {
    expect(formatReminderDay(birthday, "es")).toBe("lunes, 15 de marzo");
    expect(formatReminderTime(birthday, "es")).toBe("9:00");
    expect(formatReminderDay(evening, "es")).toBe("sábado, 10 de octubre");
    expect(formatReminderTime(evening, "es")).toBe("21:05");
  });

  it("inglés: 12 h con AM/PM", () => {
    expect(formatReminderDay(birthday, "en")).toBe("Monday, March 15");
    expect(formatReminderTime(birthday, "en")).toBe("9:00 AM");
    expect(formatReminderTime(evening, "en")).toBe("9:05 PM");
    expect(formatReminderTime(midnight, "en")).toBe("12:30 AM");
  });

  it("formatReminderWhen arma el fragmento y nunca lanza", () => {
    expect(formatReminderWhen(birthday.toISOString(), "es")).toBe(" el lunes, 15 de marzo a las 9:00");
    expect(formatReminderWhen("no es fecha", "es")).toBe("");
  });
});
