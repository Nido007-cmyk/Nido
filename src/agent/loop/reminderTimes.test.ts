/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Offensive audit (0.1.18): a reminder must ring when the user said, or not
 * be scheduled at all — never at a different time.
 */
import { describe, expect, it } from "vitest";
import { extractReminderAction, parseReminderDateTime } from "./actionRouter";

// Monday 12 Oct 2026, 06:57 local time.
const NOW = new Date(2026, 9, 12, 6, 57);
const at = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

describe("reminders — part of the day", () => {
  it.each([
    ["correr a las 7 de la mañana", "2026-10-12 07:00"],
    ["correr mañana a las 7 de la mañana", "2026-10-13 07:00"],
    ["cenar a las 9 de la noche", "2026-10-12 21:00"],
    ["algo a las 3 de la tarde", "2026-10-12 15:00"],
    ["algo a las 2 de la madrugada", "2026-10-13 02:00"],
    ["algo a las 12 de la noche", "2026-10-13 00:00"],
    ["algo esta noche a las 9", "2026-10-12 21:00"],
    ["algo mañana por la tarde", "2026-10-13 16:00"],
    ["algo a mediodía", "2026-10-12 12:00"],
    ["algo a las 0", "2026-10-13 00:00"],
    ["x at 7 in the morning", "2026-10-12 07:00"],
    ["x at 9 tonight", "2026-10-12 21:00"],
    ["algo às 7 da manhã", "2026-10-12 07:00"],
    ["algo às 8 da noite", "2026-10-12 20:00"],
    ["algo en media hora", "2026-10-12 07:27"],
  ])("%s → %s", (text, expected) => {
    expect(at(parseReminderDateTime(text, NOW))).toBe(expected);
  });

  it("the part of the day doesn't stay in the reminder text", () => {
    expect(extractReminderAction("recuérdame correr a las 7 de la mañana")?.text).toBe("correr");
    expect(extractReminderAction("recuérdame cenar a las 9 de la noche")?.text).toBe("cenar");
  });
});

describe("reminders — dates that don't exist or already passed", () => {
  it("29 February goes to the next real one", () => {
    expect(at(parseReminderDateTime("algo el 29 de febrero", NOW))).toBe("2028-02-29 09:00");
  });
  it("an explicit year is respected; a past one gives no date", () => {
    expect(at(parseReminderDateTime("algo el 1 de enero de 2027", NOW))).toBe("2027-01-01 09:00");
    expect(at(parseReminderDateTime("x on march 3rd, 2027", NOW))).toBe("2027-03-03 09:00");
    expect(parseReminderDateTime("algo el 1 de enero de 1990", NOW)).toBeNull();
    expect(parseReminderDateTime("algo el 29 de febrero de 2027", NOW)).toBeNull();
  });
  it("today's date without a time stays today if it's still ahead", () => {
    expect(at(parseReminderDateTime("algo el 12 de octubre", NOW))).toBe("2026-10-12 09:00");
  });
  it.each(["algo el 31 de febrero", "algo a las 25", "algo a las 12:75", "algo en 0 minutos", "algo en -5 minutos"])(
    "%s → no date",
    (text) => {
      expect(parseReminderDateTime(text, NOW)).toBeNull();
    },
  );
});

describe("remembered dates (birthdays)", () => {
  it("29 February is never turned into 1 March", async () => {
    const { extractDateISO } = await import("./rememberRouter");
    const iso = extractDateISO("el cumpleaños de Ana es el 29 de febrero");
    expect(iso).not.toBeNull();
    const d = new Date(iso!);
    expect([d.getMonth(), d.getDate()]).toEqual([1, 29]);
  });
});
