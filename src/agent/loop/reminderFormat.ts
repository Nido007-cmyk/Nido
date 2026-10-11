/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * reminderFormat.ts — fecha y hora de un recordatorio SIN `Intl`.
 *
 * CRASH-2026-10-10: enviar cualquier recordatorio con hora cerraba la app
 * en la Tab A9+ justo después de guardarlo. `toLocaleDateString` /
 * `toLocaleTimeString` con opciones pasan, en Hermes para Android, por la
 * implementación Java de Intl (JNI): un fallo ahí no es un error de JS que
 * se pueda capturar, tumba el proceso. Este formateador usa solo getters
 * de Date: determinista, igual en todos los teléfonos y testeable.
 *
 * Mantiene el mismo texto que producía Intl:
 *   es → "lunes, 15 de marzo" / "9:00"
 *   en → "Monday, March 15" / "9:00 AM"
 */

const DAYS = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
} as const;

const MONTHS = {
  es: [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ],
  en: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
} as const;

export type ReminderLang = "es" | "en";

/** "lunes, 15 de marzo" (es) / "Monday, March 15" (en), en hora local. */
export function formatReminderDay(d: Date, lang: ReminderLang = "es"): string {
  const day = DAYS[lang][d.getDay()];
  const month = MONTHS[lang][d.getMonth()];
  return lang === "en" ? `${day}, ${month} ${d.getDate()}` : `${day}, ${d.getDate()} de ${month}`;
}

/** "9:00" (es, 24 h) / "9:00 AM" (en, 12 h), en hora local. */
export function formatReminderTime(d: Date, lang: ReminderLang = "es"): string {
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (lang === "en") {
    const h = d.getHours();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm} ${h < 12 ? "AM" : "PM"}`;
  }
  return `${d.getHours()}:${mm}`;
}

/**
 * Fragmento " el <día> a las <hora>" para la confirmación del recordatorio,
 * o "" si la fecha no es válida (nunca lanza).
 */
export function formatReminderWhen(iso: string, lang: ReminderLang = "es"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return ` el ${formatReminderDay(d, lang)} a las ${formatReminderTime(d, lang)}`;
}
