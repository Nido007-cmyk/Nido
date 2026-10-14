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

export type ReminderRepeat = "day" | "week" | "month" | "year";

export function isReminderRepeat(v: unknown): v is ReminderRepeat {
  return v === "day" || v === "week" || v === "month" || v === "year";
}

/** 0.1.35: «cada mes» / «cada año» (cumpleaños) se guardan en su propia tabla. */
export function isCalendarRepeat(v: unknown): v is "month" | "year" {
  return v === "month" || v === "year";
}

/**
 * Suma `n` pasos de calendario conservando el día; si el día no existe en
 * ese mes (31 en abril, 29-F en año no bisiesto) se salta a la siguiente
 * vez en que sí exista, como hace la alarma del sistema.
 */
function addCalendar(base: Date, repeat: "month" | "year", n: number): Date {
  const d = new Date(base);
  const day = base.getDate();
  for (let k = n; k < n + 48; k++) {
    const t = new Date(base);
    t.setDate(1);
    if (repeat === "month") t.setMonth(base.getMonth() + k);
    else t.setFullYear(base.getFullYear() + k);
    const month = t.getMonth();
    t.setDate(day);
    if (t.getMonth() === month) return t;
  }
  return d;
}

/**
 * Próxima vez, ESTRICTAMENTE después de `after`, con la misma hora local
 * (y el mismo día de la semana si es semanal) que `base`.
 */
export function nextOccurrence(base: Date, repeat: ReminderRepeat, after: Date): Date {
  if (isCalendarRepeat(repeat)) {
    // Por pasos de calendario desde la base: primero hacia atrás mientras
    // la anterior siga siendo futura, luego hacia delante.
    let k = 0;
    while (k > -600 && addCalendar(base, repeat, k - 1).getTime() > after.getTime()) k--;
    while (addCalendar(base, repeat, k).getTime() <= after.getTime()) k++;
    return addCalendar(base, repeat, k);
  }
  const next = new Date(base);
  const step = repeat === "day" ? 1 : 7;
  // 0.1.37 (auditoría): tras un cambio de hora la hora local se corría
  // (02:30 → 03:30) y se quedaba corrida. Cada paso vuelve a la hora pedida.
  const hh = base.getHours();
  const mm = base.getMinutes();
  const stepBy = (d: Date, days: number) => {
    d.setDate(d.getDate() + days);
    d.setHours(hh, mm, base.getSeconds(), base.getMilliseconds());
  };
  if (next.getTime() > after.getTime()) {
    // Ya es futura: retrocede mientras la anterior también lo sea (por si
    // la base quedó muy adelante) y devuelve la primera tras `after`.
    while (true) {
      const prev = new Date(next);
      stepBy(prev, -step);
      if (prev.getTime() <= after.getTime()) return next;
      next.setTime(prev.getTime());
    }
  }
  while (next.getTime() <= after.getTime()) stepBy(next, step);
  return next;
}
