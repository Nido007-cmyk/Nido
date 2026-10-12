/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Dates and numbers for display WITHOUT Intl (final audit, 0.1.16).
 *
 * CRASH-2026-10-10 (src/agent/loop/reminderFormat.ts): on Hermes for
 * Android, Date/Number toLocale*String go through the Java Intl
 * implementation (JNI); a failure there isn't a JS error that can be
 * caught, it kills the process. That crash was fixed for reminders, but a
 * dozen screens still called toLocaleString(). These helpers use only Date
 * getters and plain string work: same output on every phone, testable.
 */

export type DisplayLang = "es" | "en" | "pt";

export function displayLang(tag: string | null | undefined): DisplayLang {
  const l = (tag ?? "").toLowerCase();
  if (l.startsWith("en")) return "en";
  if (l.startsWith("pt")) return "pt";
  return "es";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "14:05" (es/pt) / "2:05 PM" (en), local time. */
export function formatClock(d: Date, lang: DisplayLang): string {
  if (Number.isNaN(d.getTime())) return "";
  const mm = pad(d.getMinutes());
  if (lang === "en") {
    const h = d.getHours();
    return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
  }
  return `${d.getHours()}:${mm}`;
}

/** "12/10/2026" (es/pt, day first) / "10/12/2026" (en), local date. */
export function formatShortDate(d: Date, lang: DisplayLang): string {
  if (Number.isNaN(d.getTime())) return "";
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  return lang === "en" ? `${month}/${day}/${d.getFullYear()}` : `${day}/${month}/${d.getFullYear()}`;
}

/** "12/10/2026 14:05" / "10/12/2026 2:05 PM". Accepts ms, ISO string or Date. */
export function formatDateTime(value: number | string | Date, lang: DisplayLang): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatShortDate(d, lang)} ${formatClock(d, lang)}`;
}

/** Integer with thousands separators: "1.300" (es/pt) / "1,300" (en). */
export function formatInt(n: number, lang: DisplayLang): string {
  if (!Number.isFinite(n)) return String(n);
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.trunc(Math.abs(n)));
  const sep = lang === "en" ? "," : ".";
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Up to `decimals` decimals, trailing zeros removed: "1.234,5" (es/pt) / "1,234.5" (en). */
export function formatDecimal(n: number, lang: DisplayLang, decimals = 4): string {
  if (!Number.isFinite(n)) return String(n);
  const fixed = Math.abs(n).toFixed(decimals).replace(/\.?0+$/, "");
  const [int, frac] = fixed.split(".");
  const sign = n < 0 && Number(fixed) !== 0 ? "-" : "";
  const intPart = formatInt(Number(int), lang);
  if (!frac) return sign + intPart;
  return `${sign}${intPart}${lang === "en" ? "." : ","}${frac}`;
}
