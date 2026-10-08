/**
 * actionRouter.ts — NIDO: pre-routers determinísticos para acciones.
 *
 * FIX 2026-10-07: el modelo 0.5B a veces no genera el tool call para
 * acciones simples (calculadora, recordatorios). Estos pre-routers
 * detectan patrones explícitos y ejecutan la acción directamente,
 * sin pasar por el modelo (mismo patrón que rememberRouter).
 *
 * Puro, sin dependencias, 100% testeable.
 */

import { evaluateExpression } from "../tools/calc";

/** Resultado de una acción de calculadora. */
export interface CalcAction {
  expression: string;
  result: number;
}

/**
 * Detecta "cuánto es [expresión]" / "calcula [expresión]" y la evalúa.
 * Retorna null si no hay patrón de cálculo explícito.
 */
export function extractCalcAction(userText: string): CalcAction | null {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  // "cuánto es 245 * 38" / "cuanto es 2+2" / "calcula 10/3"
  const m = /(?:cu[áa]nto es|calcula)\s+(.+)/i.exec(trimmed);
  if (!m) return null;

  const expr = m[1].trim().replace(/[?.!]+$/, "").trim();
  // Validación: solo caracteres matemáticos permitidos.
  if (!/^[\d\s+\-*/().%^]+$/.test(expr)) return null;
  if (expr.length < 1 || expr.length > 50) return null;

  try {
    const result = evaluateExpression(expr);
    if (!Number.isFinite(result)) return null;
    return { expression: expr, result };
  } catch {
    return null;
  }
}

/** Resultado de una acción de recordatorio. */
export interface ReminderAction {
  text: string;
  dueAt: string | null;
}

/**
 * Detecta "agrégame cita/recordatorio..." y extrae el texto.
 * La fecha se parsea de forma simple; si no hay fecha clara, dueAt=null.
 */
export function extractReminderAction(userText: string): ReminderAction | null {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  // "agrégame cita con el doctor el viernes a las 10"
  // "créame un recordatorio para comprar leche mañana"
  // LOOP-1 FIX 2026-10-07: también "recuérdame comprar pan" / "remember me to call mom"
  // El intent clasificador ya marca estos como "actuar", pero el router no los capturaba.
  const m = /(?:agr[ée]game|cr[ée]ame|ponme|crea|recu[ée]rdame|remember me to)\s+(?:una?\s+)?(?:cita|recordatorio)?\s*(.+)/i.exec(trimmed);
  if (!m) return null;

  let text = m[1].trim();
  if (text.length < 3) return null;

  // CALENDAR-FIX 2026-10-07: parsear fecha/hora del texto.
  const dueAt = parseReminderDateTime(text);
  // Limpiar la fecha del texto para que no quede duplicada.
  if (dueAt) {
    text = text
      .replace(/\b(el|la|the)?\s*(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
      .replace(/\b(mañana|manana|tomorrow|hoy|today)\b/gi, "")
      .replace(/\ba\s+las\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, "")
      .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  return { text, dueAt };
}

/**
 * Parsea fecha/hora de un texto de recordatorio.
 * Soporta: días de semana (es/en), hoy/mañana, horas.
 * Devuelve ISO string o null si no hay fecha clara.
 */
function parseReminderDateTime(text: string): string | null {
  const t = text.toLowerCase();
  const now = new Date();

  // Días de la semana → próximo día futuro.
  const dayMap: Record<string, number> = {
    domingo: 0, sunday: 0,
    lunes: 1, monday: 1,
    martes: 2, tuesday: 2,
    "miércoles": 3, miercoles: 3, wednesday: 3,
    jueves: 4, thursday: 4,
    viernes: 5, friday: 5,
    "sábado": 6, sabado: 6, saturday: 6,
  };

  let targetDate: Date | null = null;

  // "mañana" / "tomorrow"
  if (/\b(mañana|manana|tomorrow)\b/.test(t)) {
    targetDate = new Date(now);
    targetDate.setDate(now.getDate() + 1);
  }
  // "hoy" / "today"
  else if (/\b(hoy|today)\b/.test(t)) {
    targetDate = new Date(now);
  }
  // Día de la semana
  else {
    for (const [name, dayNum] of Object.entries(dayMap)) {
      if (t.includes(name)) {
        targetDate = new Date(now);
        const diff = (dayNum - now.getDay() + 7) % 7;
        // Si es hoy, asumir próxima semana (no pasado).
        targetDate.setDate(now.getDate() + (diff === 0 ? 7 : diff));
        break;
      }
    }
  }

  if (!targetDate) return null;

  // Hora: "a las 10", "at 10am", "a las 10:30"
  const timeMatch = /(?:a\s+las|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(t);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = (timeMatch[3] || "").toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    // Sin am/pm: asumir hora razonable (si es < 8, probablemente PM).
    if (!ampm && hour < 8) hour += 12;
    targetDate.setHours(hour, minute, 0, 0);
  } else {
    // Sin hora: 9 AM por defecto.
    targetDate.setHours(9, 0, 0, 0);
  }

  return targetDate.toISOString();
}

/** Resultado de una acción de planificación semanal. */
export interface WeeklyPlanAction {
  workStart: number; // hora 24h, ej 9
  workEnd: number;   // hora 24h, ej 18
  exerciseDays: number; // veces por semana
  wantsFamilyTime: boolean;
}

/**
 * WEEKLY-PLAN 2026-10-07: detecta "plan my week / planifica mi semana"
 * y extrae restricciones. El horario se genera con plantilla determinística,
 * no se deja al modelo inventar (el 0.5B inventaba turnos de 8AM/4PM/8PM).
 */
export function extractWeeklyPlanAction(userText: string): WeeklyPlanAction | null {
  const t = userText.toLowerCase();
  const isPlanRequest =
    /plan\s*(my|la)?\s*week|planifica(r)?\s*(mi\s+)?semana|organiza(r)?\s*(mi\s+)?semana|horario\s+semanal/i.test(t);
  if (!isPlanRequest) return null;

  // Extraer horario de trabajo: "work 9 to 6", "trabajo de 9 a 6", "9-18"
  let workStart = 9, workEnd = 18;
  const workMatch =
    /(?:work|trabajo)\s*(?:de\s*|from\s*)?(\d{1,2})\s*(?:to|a|-)\s*(\d{1,2})/i.exec(t) ||
    /(\d{1,2})\s*(?:to|a)\s*(\d{1,2})/.exec(t);
  if (workMatch) {
    let s = parseInt(workMatch[1], 10);
    let e = parseInt(workMatch[2], 10);
    // "9 to 6" = 9 AM a 6 PM
    if (e < s) e += 12;
    if (s >= 1 && s <= 12 && e >= 1 && e <= 23) {
      workStart = s;
      workEnd = e;
    }
  }

  // Extraer ejercicio: "exercise 3 times", "ejercicio 3 veces"
  let exerciseDays = 3;
  const exMatch = /exercis\w*\s*(\d+)\s*times?|ejercicio\s*(\d+)\s*veces?|(\d+)\s*(?:times|veces)\s*(?:a\s*la\s*semana|per\s*week)?/i.exec(t);
  if (exMatch) {
    const n = parseInt(exMatch[1] || exMatch[2] || exMatch[3], 10);
    if (n >= 1 && n <= 7) exerciseDays = n;
  }

  const wantsFamilyTime = /famil/i.test(t);

  return { workStart, workEnd, exerciseDays, wantsFamilyTime };
}

/**
 * Genera un horario semanal determinístico de 7 días.
 * Días de ejercicio distribuidos (lun/mié/vie o similar).
 * Sin traslapes: trabajo, ejercicio, familia en bloques separados.
 */
export function generateWeeklyPlan(action: WeeklyPlanAction): string {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const daysEs = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

  // Distribuir días de ejercicio uniformemente.
  const exDays: boolean[] = [false, false, false, false, false, false, false];
  if (action.exerciseDays >= 1) {
    const step = 7 / action.exerciseDays;
    for (let i = 0; i < action.exerciseDays; i++) {
      exDays[Math.floor(i * step) % 7] = true;
    }
  }

  const fmtHour = (h: number) => {
    const hh = h % 24;
    const ampm = hh < 12 ? "AM" : "PM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:00 ${ampm}`;
  };

  const lines: string[] = [];
  lines.push(`Weekly Schedule (work ${fmtHour(action.workStart)}–${fmtHour(action.workEnd)}):`);
  lines.push("");

  for (let d = 0; d < 7; d++) {
    const isWeekend = d >= 5;
    const dayName = `${days[d]} / ${daysEs[d]}`;
    lines.push(`**${dayName}**`);

    if (!isWeekend) {
      lines.push(`- ${fmtHour(action.workStart)}–${fmtHour(action.workEnd)}: Work`);
      if (exDays[d]) {
        lines.push(`- ${fmtHour(action.workEnd)}–${fmtHour(action.workEnd + 1)}: Exercise (1 hour)`);
        if (action.wantsFamilyTime) {
          lines.push(`- ${fmtHour(action.workEnd + 1)}–${fmtHour(action.workEnd + 3)}: Family time`);
        }
      } else if (action.wantsFamilyTime) {
        lines.push(`- ${fmtHour(action.workEnd)}–${fmtHour(action.workEnd + 2)}: Family time`);
      }
    } else {
      // Fin de semana: más flexible.
      if (exDays[d]) {
        lines.push(`- 10:00 AM–11:00 AM: Exercise (1 hour)`);
      }
      if (action.wantsFamilyTime) {
        lines.push(`- Rest of day: Family time & rest`);
      } else {
        lines.push(`- Rest day`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
