/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Recordatorios que se repiten (0.1.32). Puro, sin dependencias.
 *
 * Solo dos ritmos, los que el sistema puede programar sin la app abierta
 * (disparadores DAILY y WEEKLY de expo-notifications): cada día a una
 * hora, o cada semana un día a una hora. «Cada mes»/«cada año» siguen sin
 * soporte y el loop lo dice (nunca se guarda en silencio como si se
 * repitiera).
 */

export type ReminderRepeat = "day" | "week";

export function isReminderRepeat(v: unknown): v is ReminderRepeat {
  return v === "day" || v === "week";
}

/**
 * Próxima vez, ESTRICTAMENTE después de `after`, con la misma hora local
 * (y el mismo día de la semana si es semanal) que `base`.
 */
export function nextOccurrence(base: Date, repeat: ReminderRepeat, after: Date): Date {
  const next = new Date(base);
  const step = repeat === "day" ? 1 : 7;
  if (next.getTime() > after.getTime()) {
    // Ya es futura: retrocede mientras la anterior también lo sea (por si
    // la base quedó muy adelante) y devuelve la primera tras `after`.
    while (true) {
      const prev = new Date(next);
      prev.setDate(prev.getDate() - step);
      if (prev.getTime() <= after.getTime()) return next;
      next.setTime(prev.getTime());
    }
  }
  while (next.getTime() <= after.getTime()) next.setDate(next.getDate() + step);
  return next;
}
