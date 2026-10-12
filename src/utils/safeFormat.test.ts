/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { displayLang, formatClock, formatDateTime, formatDecimal, formatInt, formatShortDate } from "./safeFormat";

const d = new Date(2026, 9, 12, 14, 5);

describe("safeFormat — no Intl", () => {
  it("language tag → display language", () => {
    expect(displayLang("en-US")).toBe("en");
    expect(displayLang("pt-BR")).toBe("pt");
    expect(displayLang("es-MX")).toBe("es");
    expect(displayLang(undefined)).toBe("es");
  });
  it("clock", () => {
    expect(formatClock(d, "es")).toBe("14:05");
    expect(formatClock(d, "en")).toBe("2:05 PM");
    expect(formatClock(new Date(2026, 0, 1, 0, 7), "en")).toBe("12:07 AM");
  });
  it("short date and date-time", () => {
    expect(formatShortDate(d, "es")).toBe("12/10/2026");
    expect(formatShortDate(d, "en")).toBe("10/12/2026");
    expect(formatDateTime(d.getTime(), "pt")).toBe("12/10/2026 14:05");
    expect(formatDateTime(d.toISOString(), "en")).toBe("10/12/2026 2:05 PM");
    expect(formatDateTime("not a date", "es")).toBe("");
  });
  it("integers", () => {
    expect(formatInt(1300, "es")).toBe("1.300");
    expect(formatInt(1300, "en")).toBe("1,300");
    expect(formatInt(115813, "pt")).toBe("115.813");
    expect(formatInt(999, "es")).toBe("999");
    expect(formatInt(-1234567, "en")).toBe("-1,234,567");
  });
  it("decimals", () => {
    expect(formatDecimal(1234.5, "es")).toBe("1.234,5");
    expect(formatDecimal(1234.5, "en")).toBe("1,234.5");
    expect(formatDecimal(2.0, "es")).toBe("2");
    expect(formatDecimal(0.12345678, "en")).toBe("0.1235");
    expect(formatDecimal(-3.25, "es")).toBe("-3,25");
  });
});
