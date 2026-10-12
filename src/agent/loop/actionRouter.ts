/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

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
  /** The user wrote decimals with a comma ("2,5"): answer the same way. */
  decimalComma?: boolean;
}

/**
 * Detecta "cuánto es [expresión]" / "calcula [expresión]" y la evalúa.
 * Retorna null si no hay patrón de cálculo explícito.
 */
/**
 * Auditoría ofensiva (0.1.18): formas habituales de escribir una cuenta que
 * antes no llegaban a la calculadora (y el modelo podía inventar el
 * resultado): "15% de 200", "7 x 8", "12 ÷ 4", "3·4", "2,5 * 4" (coma
 * decimal). Devuelve null si la escritura es ambigua ("1,000": ¿mil o uno?).
 */
function normalizeCalcText(text: string): string | null {
  let t = text.replace(/^(?:el|la|o|a|the)\s+/i, "");
  // "15% de 200" / "15% of 200" / "15% do 200" → (15/100)*200
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*%\s*(?:de|del|of|do|da)\s+/gi, "($1/100)*");
  t = t.replace(/(\d)\s*[x×]\s*(?=\d)/gi, "$1*").replace(/[·∙]/g, "*").replace(/÷/g, "/");
  if (/,/.test(t)) {
    // Coma decimal solo si no hay puntos y ninguna coma va seguida de
    // exactamente tres cifras (eso es separador de miles en inglés).
    if (/\./.test(t) || /\d,\d{3}(?!\d)/.test(t)) return null;
    t = t.replace(/(\d),(\d)/g, "$1.$2");
  }
  return t;
}

export function extractCalcAction(userText: string): CalcAction | null {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  // "cuánto es 245 * 38" / "cuanto es 2+2" / "calcula 10/3"
  // 0.1.14 (guía): también en/pt — "what is 245 * 38", "calculate 10/3",
  // "quanto é 245 * 38". La expresión se sigue validando abajo (solo
  // caracteres matemáticos), así que "what is love" nunca entra aquí.
  const m = /(?:cu[áa]nto es|calculate|calcula|calcule|what(?:'s| is)|quanto (?:[ée]|d[áa]))\s+(.+)/i.exec(trimmed);
  if (!m) return null;

  const raw = m[1].trim();
  // Auditoría ofensiva (0.1.18): "3!" es factorial, que la calculadora no
  // tiene; antes se quitaba el "!" como si fuera exclamación y respondía 3.
  if (/\d\s*!/.test(raw)) return null;
  // "0x10" es hexadecimal, no 0 por 10.
  if (/\b0x[0-9a-f]/i.test(raw)) return null;
  const shown = raw.replace(/[?.!¿¡]+$/, "").trim().replace(/^(?:el|la|o|a|the)\s+/i, "");
  const expr = normalizeCalcText(shown);
  if (expr === null) return null;
  // Validación: solo caracteres matemáticos permitidos.
  if (!/^[\d\s+\-*/().%^]+$/.test(expr)) return null;
  if (expr.length < 1 || expr.length > 50) return null;
  // F3 (auditoría 2026-10-10): "1.000 + 1" en español es mil más uno, pero
  // el evaluador lo lee como 1.0 + 1 = 2. Un punto seguido de exactamente
  // tres dígitos es ambiguo: no se resuelve por la ruta rápida.
  if (/\d\.\d{3}(?!\d)/.test(expr)) return null;

  try {
    const result = evaluateExpression(expr);
    if (!Number.isFinite(result)) return null;
    // Se muestra como lo escribió el usuario ("15% de 200 = 30").
    return /\d,\d/.test(shown) ? { expression: shown, result, decimalComma: true } : { expression: shown, result };
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
  // 0.1.14 (guía): "remind me to …" y portugués "me lembra de …" /
  // "lembre-me de …". "me lembra que X" es memoria, no recordatorio.
  const m = /(?:agr[ée]game|cr[ée]ame|ponme|crea|recu[ée]rdame|remember me to|remind me(?: to)?|me lembr[ae](?!\s+que\b)(?: de)?|lembr[ae]-me(?: de)?)\s+(?:una?\s+)?(?:cita|recordatorio)?\s*(.+)/i.exec(trimmed);
  if (!m) return null;

  let text = m[1].trim();
  if (text.length < 3) return null;

  // CALENDAR-FIX 2026-10-07: parsear fecha/hora del texto.
  const dueAt = parseReminderDateTime(text);
  // Limpiar la fecha del texto para que no quede duplicada.
  if (dueAt) {
    text = stripDateWords(text);
  }

  // F6 (auditoría 2026-10-10): "recuérdame mañana" dejaba el texto vacío
  // tras quitar la fecha. Sin texto no hay recordatorio: que decida el modelo.
  if (!text.trim()) return null;
  return { text, dueAt };
}

/**
 * Quita del texto las palabras de fecha/hora que entiende el parser, para
 * que no queden repetidas en el título (recordatorios y, desde 0.1.8,
 * eventos de calendario). Exportada para toolRouter.
 */
/**
 * Auditoría ofensiva (0.1.18): "a las 7 de la mañana" programaba la alarma
 * MAÑANA a las 19:00 ("mañana" se leía como "tomorrow" y, sin am/pm, las 7
 * pasaban a la tarde); "a las 9 de la noche" quedaba a las 9:00 y "a las 2
 * de la madrugada" a las 14:00. La parte del día manda sobre la suposición.
 */
const AM_PERIOD_RE =
  /(?:(?:de|por|en)\s+la\s+(?:mañana|manana|madrugada)|in\s+the\s+morning|(?:da|de|pela)\s+(?:manhã|manha|madrugada))(?![\p{L}])/giu;
const PM_PERIOD_RE =
  /(?:(?:de|por|en)\s+la\s+(?:tarde|noche)|esta\s+(?:tarde|noche)|in\s+the\s+(?:afternoon|evening)|at\s+night|tonight|this\s+(?:afternoon|evening)|(?:da|de|à|a|pela|esta)\s+(?:tarde|noite))(?![\p{L}])/giu;
const NIGHT_RE = /(?:noche|night|noite)/i;
const NOON_RE = /(?<![\p{L}])(?:a\s+)?(?:mediod[ií]a|noon|meio-dia|meio\s+dia)(?![\p{L}])/giu;
const MIDNIGHT_RE = /(?<![\p{L}])(?:a\s+)?(?:medianoche|midnight|meia-noite|meia\s+noite)(?![\p{L}])/giu;

function dayPeriod(t: string): "am" | "pm" | null {
  AM_PERIOD_RE.lastIndex = 0;
  PM_PERIOD_RE.lastIndex = 0;
  if (AM_PERIOD_RE.test(t)) return "am";
  if (PM_PERIOD_RE.test(t)) return "pm";
  return null;
}

export function stripDateWords(input: string): string {
  return input
      .replace(AM_PERIOD_RE, "")
      .replace(PM_PERIOD_RE, "")
      .replace(NOON_RE, "")
      .replace(MIDNIGHT_RE, "")
      .replace(/\b(el|la|the|o|a|na|no)?\s*(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?)\b/gi, "")
      .replace(/(?<![\p{L}])(mañana|manana|tomorrow|hoy|today|amanhã|amanha|hoje)(?![\p{L}])/giu, "")
      .replace(/\ba\s+las\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, "")
      .replace(/(?<![\p{L}])às\s+\d{1,2}(:\d{2})?\s*(am|pm|h)?\b/giu, "")
      .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/gi, "")
      // TESTFIX-2026-10-08: limpiar tiempo relativo ("en 2 minutos" no es
      // parte del texto del recordatorio). FIX 2026-10-08: \s* para "1minuto".
      .replace(/\ben\s+\d+\s*(minutos?|minutes?|min|horas?|hours?|hrs?|h|d[ií]as?|days?|d|semanas?|weeks?|w)\b/gi, "")
      .replace(/\bin\s+\d+\s*(minutes?|min|hours?|hrs?|h|days?|d|weeks?|w)\b/gi, "")
      // 0.1.14: portugués "em 2 horas".
      .replace(/\bem\s+\d+\s*(minutos?|min|horas?|h|dias?|d|semanas?)\b/gi, "")
      .replace(/\ben\s+(uno|una|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten|once|eleven|doce|twelve|quince|fifteen|veinte|twenty|treinta|thirty|media|half)\s*(minutos?|minutes?|min|horas?|hours?|hrs?|h|d[ií]as?|days?|d|semanas?|weeks?|w)\b/gi, "")
      // M3 FIX: limpiar hora suelta después de día ("el viernes 10" → el 10 es la hora).
      .replace(/\b(\d{1,2})(:\d{2})?\s*(am|pm)?\s*$/gi, "")
      .replace(/\s+/g, " ")
      .trim();
}

/** Palabras numéricas ES/EN para tiempos relativos ("en dos minutos"). */
const NUMBER_WORDS: Record<string, number> = {
  uno: 1, una: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3,
  cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6,
  siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9,
  diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12,
  quince: 15, fifteen: 15, veinte: 20, twenty: 20,
  treinta: 30, thirty: 30, "media": 0.5, "half": 0.5,
};

/**
 * TESTFIX-2026-10-08: parsea tiempos relativos ("en 2 minutos",
 * "en dos minutos", "in 1 hour", "en media hora").
 * Devuelve la fecha objetivo o null si no hay patrón relativo.
 */
function parseRelativeTime(t: string, now: Date): Date | null {
  // FIX 2026-10-08: \s* entre número y unidad para "1minuto" (sin espacio).
  const m = /\b(?:en|in|em)\s+(\d+|uno|una|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten|once|eleven|doce|twelve|quince|fifteen|veinte|twenty|treinta|thirty|media|half)\s*(minutos?|minutes?|min|horas?|hours?|hrs?|h|d[ií]as?|days?|d|semanas?|weeks?|w)\b/i.exec(t);
  if (!m) return null;

  const rawNum = m[1].toLowerCase();
  const n = /^\d+$/.test(rawNum) ? parseInt(rawNum, 10) : NUMBER_WORDS[rawNum];
  if (n === undefined || n <= 0) return null;

  const unit = m[2].toLowerCase();
  let target = new Date(now);
  // "en media hora": n = 0.5. setMinutes/setHours truncan a entero (media
  // hora daba +0 y se rechazaba); en milisegundos no.
  if (/^min/.test(unit)) {
    target = new Date(now.getTime() + Math.round(n * 60_000));
  } else if (/^(h|hora|horas|hour|hours|hrs)$/.test(unit)) {
    target = new Date(now.getTime() + Math.round(n * 3_600_000));
  } else if (!Number.isInteger(n)) {
    return null;
  } else if (/^(d|d[ií]a|dias|días|day|days)$/.test(unit)) {
    target.setDate(target.getDate() + n);
  } else if (/^(w|semana|semanas|week|weeks)$/.test(unit)) {
    target.setDate(target.getDate() + n * 7);
  } else {
    return null;
  }
  // "en 0 minutos" no tiene sentido; cantidades absurdas se rechazan.
  if (target.getTime() <= now.getTime()) return null;
  if (target.getTime() - now.getTime() > 366 * 24 * 3600 * 1000) return null;
  return target;
}

/**
 * Parsea fecha/hora de un texto de recordatorio.
 * Soporta: días de semana (es/en), hoy/mañana, horas, tiempos relativos
 * ("en 2 minutos", "in 1 hour") y hora suelta ("a las 6:02" → hoy).
 * Devuelve ISO string o null si no hay fecha clara.
 */
export function parseReminderDateTime(text: string, now: Date = new Date()): string | null {
  const full = text.toLowerCase();
  const period = dayPeriod(full);
  const noon = new RegExp(NOON_RE.source, "iu").test(full);
  const midnight = new RegExp(MIDNIGHT_RE.source, "iu").test(full);
  // "de la mañana" no es "tomorrow": se quita antes de buscar el día.
  const t = full.replace(AM_PERIOD_RE, " ").replace(PM_PERIOD_RE, " ");
  // `now` is a parameter so callers that already have a reference time
  // (toolRouter's extractToolAction) and tests get dates relative to it,
  // not to the real clock.

  // TESTFIX-2026-10-08: tiempos relativos ("en 2 minutos", "in 1 hour").
  // Antes: no se soportaban → dueAt null → el recordatorio se guardaba
  // como texto y se preguntaba "¿para cuándo?" en bucle (evidencia física).
  const relative = parseRelativeTime(t, now);
  if (relative) return relative.toISOString();

  // Días de la semana → próximo día futuro.
  const dayMap: Record<string, number> = {
    domingo: 0, sunday: 0,
    lunes: 1, monday: 1,
    martes: 2, tuesday: 2,
    "miércoles": 3, miercoles: 3, wednesday: 3,
    jueves: 4, thursday: 4,
    viernes: 5, friday: 5,
    "sábado": 6, sabado: 6, saturday: 6,
    // 0.1.8: portugués.
    segunda: 1, "terça": 2, terca: 2, quarta: 3, quinta: 4, sexta: 5,
  };

  let targetDate: Date | null = null;
  let explicitYear = false;

  // "mañana" / "tomorrow"
  // 0.1.8: portugués (amanhã / hoje), sin \b tras letras acentuadas.
  if (/(?<![\p{L}])(mañana|manana|tomorrow|amanhã|amanha)(?![\p{L}])/u.test(t)) {
    targetDate = new Date(now);
    targetDate.setDate(now.getDate() + 1);
  }
  // "hoy" / "today"
  else if (/\b(hoy|today|hoje)\b/.test(t)) {
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

  // M4 FIX 2026-10-07: fallback a formato "15 de marzo" / "March 15th".
  // extractDateISO lo entiende pero parseReminderDateTime no; unificamos.
  if (!targetDate) {
    const meses: Record<string, number> = {
      enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
      julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      // 0.1.8: portugués.
      janeiro: 0, fevereiro: 1, "março": 2, marco: 2, maio: 4, junho: 5,
      julho: 6, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
    };
    const mEs = /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|janeiro|fevereiro|março|marco|maio|junho|julho|setembro|outubro|novembro|dezembro)(?:\s+de(?:l)?\s+(\d{4}))?/i.exec(t);
    const mEn = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(t);
    let month: number | undefined, day: number | undefined, year: number | undefined;
    if (mEs) { day = parseInt(mEs[1], 10); month = meses[mEs[2].toLowerCase()]; year = mEs[3] ? parseInt(mEs[3], 10) : undefined; }
    else if (mEn) { month = meses[mEn[1].toLowerCase()]; day = parseInt(mEn[2], 10); year = mEn[3] ? parseInt(mEn[3], 10) : undefined; }
    if (month !== undefined && day !== undefined && day >= 1 && day <= 31) {
      // Validar fecha real (M5) en el año en que caería. Antes se validaba
      // contra 2024 (bisiesto) y "el 29 de febrero" en 2027 se convertía en
      // silencio en el 1 de marzo. Ahora: el próximo 29 de febrero real.
      // Con año explícito ("de 2027") se usa ese año; si ya pasó, no hay fecha
      // (antes "el 1 de enero de 1990" se programaba para el próximo enero).
      const build = (y: number): Date | null => {
        const d = new Date(now);
        d.setFullYear(y, month!, day!);
        return d.getMonth() === month && d.getDate() === day ? d : null;
      };
      if (year !== undefined) {
        const d = build(year);
        if (!d) return null;
        targetDate = d;
        explicitYear = true;
      } else {
        for (let y = now.getFullYear(); y <= now.getFullYear() + 8 && !targetDate; y++) {
          const d = build(y);
          if (!d) continue;
          const endOfDay = new Date(d);
          endOfDay.setHours(23, 59, 59, 999);
          if (endOfDay.getTime() > now.getTime()) targetDate = d;
        }
      }
    }
  }

  // TESTFIX-2026-10-08: hora suelta sin día ("a las 6:02", "at 6:02pm").
  // Antes: sin día → return null aunque hubiera hora explícita → mismo
  // bucle de "¿para cuándo?" (evidencia física). Ahora se asume hoy;
  // el rollover M2 la mueve a mañana si ya pasó.
  const timeMatch = /(?:a\s+las|at|às)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(t);
  if (!targetDate && (timeMatch || noon || midnight)) {
    targetDate = new Date(now);
  }

  if (!targetDate) return null;

  // Hora: "a las 10", "at 10am", "a las 10:30"
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    // M1 FIX 2026-10-07: validar rangos. "a las 25" o "10:75" son inválidos,
    // no hacer rollover silencioso que cambia el día.
    if (hour > 23 || minute > 59) return null;
    const ampm = (timeMatch[3] || period || "").toLowerCase();
    // "a las 12 de la noche" es medianoche.
    if (ampm === "pm" && hour === 12 && NIGHT_RE.test(full)) hour = 0;
    else if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    // Sin am/pm: asumir hora razonable (de 1 a 7, probablemente PM). "a las
    // 0" es medianoche, no mediodía.
    if (!ampm && hour >= 1 && hour < 8) hour += 12;
    targetDate.setHours(hour, minute, 0, 0);
  } else if (noon) {
    targetDate.setHours(12, 0, 0, 0);
  } else if (midnight) {
    targetDate.setHours(0, 0, 0, 0);
    // "a medianoche" es el final del día nombrado (o de hoy).
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (period) {
    // "mañana por la tarde" sin hora: una hora razonable de esa parte del día.
    targetDate.setHours(period === "pm" ? (NIGHT_RE.test(full) ? 20 : 16) : 9, 0, 0, 0);
  } else {
    // Sin hora: 9 AM por defecto.
    targetDate.setHours(9, 0, 0, 0);
  }

  // F6 (auditoría 2026-10-10): "hoy a las 8" dicho por la tarde. Sin am/pm
  // la hora se leía como 8:00, ya pasada, y el rollover de abajo la movía a
  // MAÑANA aunque el usuario dijo "hoy". Si la versión de la tarde todavía
  // cae hoy en el futuro, es la lectura correcta.
  if (
    timeMatch &&
    !(timeMatch[3] || period || "") &&
    /\b(hoy|today|hoje)\b/.test(t) &&
    targetDate.getTime() <= now.getTime() &&
    targetDate.getHours() < 12
  ) {
    const evening = new Date(targetDate);
    evening.setHours(targetDate.getHours() + 12);
    if (evening.getTime() > now.getTime()) targetDate = evening;
  }

  // Fecha con año explícito que ya pasó: no se inventa otra.
  if (explicitYear && targetDate.getTime() <= now.getTime()) return null;

  // M2 FIX 2026-10-07: si la fecha resultante ya pasó, mover al día siguiente.
  // "recuérdame hoy a las 6" a las 20:00 no debe crear recordatorio para las 18:00.
  if (targetDate.getTime() <= now.getTime()) {
    targetDate.setDate(targetDate.getDate() + 1);
  }

  return targetDate.toISOString();
}

/** Resultado de una acción de planificación semanal. */
export interface WeeklyPlanAction {
  workStart: number; // hora 24h, ej 9
  workEnd: number;   // hora 24h, ej 18
  exerciseDays: number; // veces por semana
  wantsFamilyTime: boolean;
  lang: "es" | "en"; // M7d: idioma para la salida
}

/**
 * WEEKLY-PLAN 2026-10-07: detecta "plan my week / planifica mi semana"
 * y extrae restricciones. El horario se genera con plantilla determinística,
 * no se deja al modelo inventar (el 0.5B inventaba turnos de 8AM/4PM/8PM).
 */
export function extractWeeklyPlanAction(userText: string): WeeklyPlanAction | null {
  const t = userText.toLowerCase();
  // M7a FIX: word boundary en "week" para no matchear "weekend".
  const isPlanRequest =
    /plan\s*(my|la)?\s*week\b|planifica(r)?\s*(mi\s+)?semana|organiza(r)?\s*(mi\s+)?semana|horario\s+semanal/i.test(t);
  if (!isPlanRequest) return null;

  // Extraer horario de trabajo: "work 9 to 6", "trabajo de 9 a 6"
  // M7b FIX: requerir contexto work/trabajo/horario, no cualquier "N to M"
  // como "I have 2 to 3 meetings".
  let workStart = 9, workEnd = 18;
  const workMatch =
    /(?:work|trabajo|horario)\s*(?:de\s*|from\s*)?(\d{1,2})\s*(?:to|a|-)\s*(\d{1,2})/i.exec(t);
  if (workMatch) {
    let s = parseInt(workMatch[1], 10);
    let e = parseInt(workMatch[2], 10);
    // "9 to 6" = 9 AM a 6 PM
    if (e < s) e += 12;
    if (s >= 1 && s <= 12 && e >= 1 && e <= 23) {
      workStart = s;
      workEnd = e;
    }
    // M7c: si es formato 24h válido (ej: 22 a 6 → e < s después del ajuste),
    // no hacer fallback silencioso; mantener lo parseado si es razonable.
  }

  // Extraer ejercicio: "exercise 3 times", "ejercicio 3 veces"
  let exerciseDays = 3;
  const exMatch = /exercis\w*\s*(\d+)\s*times?|ejercicio\s*(\d+)\s*veces?|(\d+)\s*(?:times|veces)\s*(?:a\s*la\s*semana|per\s*week)?/i.exec(t);
  if (exMatch) {
    const n = parseInt(exMatch[1] || exMatch[2] || exMatch[3], 10);
    if (n >= 1 && n <= 7) exerciseDays = n;
  }

  const wantsFamilyTime = /famil/i.test(t);

  // M7d: detectar idioma del trigger para la salida.
  const lang: "es" | "en" = /planifica|semana|organiza|horario|trabajo|ejercicio/i.test(t) ? "es" : "en";

  return { workStart, workEnd, exerciseDays, wantsFamilyTime, lang };
}

/**
 * Genera un horario semanal determinístico de 7 días.
 * Días de ejercicio distribuidos (lun/mié/vie o similar).
 * Sin traslapes: trabajo, ejercicio, familia en bloques separados.
 */
export function generateWeeklyPlan(action: WeeklyPlanAction): string {
  // M7d FIX: usar el idioma detectado del trigger.
  const es = action.lang === "es";
  const days = es
    ? ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
    : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

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
  const title = es
    ? `Horario semanal (trabajo ${fmtHour(action.workStart)}–${fmtHour(action.workEnd)}):`
    : `Weekly Schedule (work ${fmtHour(action.workStart)}–${fmtHour(action.workEnd)}):`;
  lines.push(title);
  lines.push("");

  for (let d = 0; d < 7; d++) {
    const isWeekend = d >= 5;
    lines.push(`**${days[d]}**`);

    const workLabel = es ? "Trabajo" : "Work";
    const exLabel = es ? "Ejercicio (1 hora)" : "Exercise (1 hour)";
    const famLabel = es ? "Tiempo en familia" : "Family time";
    const restLabel = es ? "Día de descanso" : "Rest day";
    const restFamLabel = es ? "Resto del día: familia y descanso" : "Rest of day: Family time & rest";

    if (!isWeekend) {
      lines.push(`- ${fmtHour(action.workStart)}–${fmtHour(action.workEnd)}: ${workLabel}`);
      if (exDays[d]) {
        lines.push(`- ${fmtHour(action.workEnd)}–${fmtHour(action.workEnd + 1)}: ${exLabel}`);
        if (action.wantsFamilyTime) {
          lines.push(`- ${fmtHour(action.workEnd + 1)}–${fmtHour(action.workEnd + 3)}: ${famLabel}`);
        }
      } else if (action.wantsFamilyTime) {
        lines.push(`- ${fmtHour(action.workEnd)}–${fmtHour(action.workEnd + 2)}: ${famLabel}`);
      }
    } else {
      // Fin de semana: más flexible.
      if (exDays[d]) {
        lines.push(`- 10:00 AM–11:00 AM: ${exLabel}`);
      }
      if (action.wantsFamilyTime) {
        lines.push(`- ${restFamLabel}`);
      } else {
        lines.push(`- ${restLabel}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
