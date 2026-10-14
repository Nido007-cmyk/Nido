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

import { nextOccurrence, type ReminderRepeat } from "../memory/reminderRepeat";
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
  let t = text.replace(/^(?:el|la|los|las|de|del|o|a|the)\s+/i, "");
  // 0.1.19 (sonda de routing): operadores escritos con palabras. Todo lo
  // que no se convierta aquí deja letras y lo rechaza la validación de
  // caracteres del final, así que una frase normal nunca se convierte en
  // cuenta por accidente.
  // Verbo inicial: "suma 45 y 67", "multiplica 6 por 9", "divide 100 entre 4".
  const verb = /^(suma|sumar|resta|restar|multiplica|multiplicar|divide|dividir|sum|add|subtract|multiply|divide)\s+/i.exec(t);
  if (verb) {
    t = t.slice(verb[0].length).replace(/^(?:el|la|los|las|de|del|o|a|the)\s+/i, "");
    // "resta 25 de 100" es 100 − 25: el minuendo va DESPUÉS del "de".
    if (/^(?:resta|restar|subtract)$/i.test(verb[1])) {
      const sub = /^(\d+(?:[.,]\d+)?)\s+de\s+(\d+(?:[.,]\d+)?)$/i.exec(t);
      if (sub) {
        if (/\d,\d{3}(?!\d)/.test(sub[1]) || /\d,\d{3}(?!\d)/.test(sub[2])) return null;
        return `(${sub[2].replace(",", ".")})-(${sub[1].replace(",", ".")})`;
      }
    }
  }
  // "la propina del 15% de 230": la propina ES ese porcentaje.
  t = t.replace(/^(?:la\s+)?propina\s+(?:de|del)\s+/i, "");
  // "la mitad de 80" / "el doble de 35" / "el triple de 12".
  // 0.1.20 (evidencia Tab A9+): las formas con nombre solo existían en
  // español — «Half of 80» caía al modelo, que respondía el 40 con un
  // panel de «fuentes» absurdas (la Interestatal 80, Sugar Ray Leonard).
  // Paridad EN/PT: "half of 80", "double 35", "a metade de 80", "o dobro de 35".
  const frac =
    /^(mitad|doble|triple)\s+de\s+(.+)$/i.exec(t) ||
    /^(half|double|triple)\s+(?:of\s+)?(.+)$/i.exec(t) ||
    /^(metade|dobro|triplo)\s+de\s+(.+)$/i.exec(t);
  if (frac) {
    const inner = normalizeCalcText(frac[2].trim());
    if (inner === null) return null;
    const f = frac[1].toLowerCase();
    return f === "mitad" || f === "half" || f === "metade"
      ? `(${inner})/2`
      : f === "doble" || f === "double" || f === "dobro"
        ? `(${inner})*2`
        : `(${inner})*3`;
  }
  // "15% de 200" / "15% of 200" / "15% do 200" → (15/100)*200
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*%\s*(?:de|del|of|do|da)\s+/gi, "($1/100)*");
  // "15 percent of 200" / "15 por ciento de 200" → (15/100)*200
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(?:percent|por\s*ciento|por\s*cento)\s+(?:de|del|of|do|da)\s+/gi, "($1/100)*");
  // "3 docenas" → (3*12); "2 elevado a 10" → 2^10
  t = t.replace(/(\d+(?:[.,]\d+)?)\s+(?:docenas?|dozen)\b/gi, "($1*12)");
  // 0.1.31: también «to the power of» / «elevado a la potencia» / «elevado à».
  t = t.replace(/(\d+(?:[.,]\d+)?)\s+(?:elevado\s+a(?:\s+la(?:\s+potencia)?)?|elevado\s+[àa]|raised\s+to(?:\s+the\s+power\s+of)?|to\s+the\s+power\s+of|to\s+the)\s+(\d+(?:[.,]\d+)?)/gi, "$1^$2");
  // Operadores entre cifras: "45 más 67", "9 por 7", "100 entre 4", "45 y 67".
  t = t.replace(/(\d)\s+(?:m[áa]s|plus|mais)\s+(?=\d)/gi, "$1+");
  t = t.replace(/(\d)\s+(?:menos|minus)\s+(?=\d)/gi, "$1-");
  t = t.replace(/(\d)\s+(?:por|vezes|times)\s+(?=\d)/gi, "$1*");
  t = t.replace(/(\d)\s+(?:entre|dividido\s+(?:entre|por)|divided\s+by)\s+(?=\d)/gi, "$1/");
  t = t.replace(/(\d)\s+(?:y|and)\s+(?=\d)/gi, "$1+");
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
  // 0.1.19: "cuánto sería / sale / da" y "how much is" como gatillos.
  const m = /(?:cu[áa]nto (?:es|ser[íi]a|sale|da|son)|cu[áa]ntos son|calculate|calcula|calcule|what(?:'s| is)|how much is|quanto (?:[ée]|d[áa]))\s+(.+)/i.exec(trimmed);
  // 0.1.19 (sonda de routing): la cuenta escrita SOLA ("15% de 200",
  // "245*38", "9 por 7") no llegaba y el modelo repetía el error interno.
  // Sin gatillo, TODO el mensaje debe ser la cuenta: se valida igual que
  // con gatillo y además se exige un operador binario. Una fecha suelta
  // ("12/10/2026") no es una cuenta.
  // 0.1.34 (prueba física, Tab A9+): el autocorrector cambia «Cuánto» por
  // «Canton» y «Canton es 15% de 200» no tenía gatillo. Una palabra
  // cualquiera + «es/son/is/é» + cuenta vale, pero SIN gatillo real se trata
  // como cuenta suelta: exige operador («mi edad es 30» no es una cuenta).
  const loose = m ? null : /^\S+\s+(?:es|son|da|sale|is|é)\s+(.+)$/i.exec(trimmed);
  const bare = !m;
  if (bare) {
    if (!/\d/.test(trimmed) || trimmed.length > 60) return null;
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(trimmed)) return null;
  }

  const raw = (m ? m[1] : loose ? loose[1] : trimmed).trim();
  // «Teléfono es 555-1234» no es una resta.
  if (loose && !m && /^\d+(?:\s*-\s*\d+)+$/.test(raw)) return null;
  // 0.1.37 (auditoría): «hoy es 14/10», «today is 10/14» son fechas, no divisiones.
  if (loose && !m && /^\d{1,2}\s*\/\s*\d{1,2}$/.test(raw)) return null;
  // 0.1.33 (medición del router): una cuenta real cabe holgada en 120
  // caracteres (la expresión final admite 50). Sin este tope, pegar una
  // tira de miles de dígitos costaba tiempo CUADRÁTICO en la
  // normalización (≈110 ms con 4.000 en un PC; segundos en el teléfono)
  // y se pagaba varias veces por turno, bloqueando la interfaz.
  if (raw.length > 120) return null;
  // Auditoría ofensiva (0.1.18): "3!" es factorial, que la calculadora no
  // tiene; antes se quitaba el "!" como si fuera exclamación y respondía 3.
  if (/\d\s*!/.test(raw)) return null;
  // "0x10" es hexadecimal, no 0 por 10.
  if (/\b0x[0-9a-f]/i.test(raw)) return null;
  const shown = raw.replace(/[?.!¿¡]+$/, "").trim().replace(/^(?:el|la|o|a|the)\s+/i, "");
  // 0.1.19: "raíz cuadrada de 144" / "raíz cúbica de 27" — el evaluador
  // tiene sqrt, pero la validación de caracteres no admite letras; se
  // resuelve aquí directamente.
  // 0.1.30: «la raíz de 16» sin «cuadrada» es la cuadrada.
  const root = /^ra[íi]z\s+(?:(cuadrada|quadrada|c[úu]bica)\s+)?de\s+(\d+(?:[.,]\d+)?)$/i.exec(shown);
  if (root) {
    const n = Number(root[2].replace(",", "."));
    const kind = (root[1] ?? "cuadrada").toLowerCase();
    const result = kind === "cuadrada" || kind === "quadrada" ? Math.sqrt(n) : Math.cbrt(n);
    return /\d,\d/.test(shown) ? { expression: shown, result, decimalComma: true } : { expression: shown, result };
  }
  // 0.1.20: "square root of 144" / "cube root of 27" (paridad EN de la raíz).
  const rootEn = /^(square|cube) root of\s+(\d+(?:[.,]\d+)?)$/i.exec(shown);
  if (rootEn) {
    const n = Number(rootEn[2].replace(",", "."));
    const result = rootEn[1].toLowerCase() === "square" ? Math.sqrt(n) : Math.cbrt(n);
    return /\d,\d/.test(shown) ? { expression: shown, result, decimalComma: true } : { expression: shown, result };
  }
  const expr = normalizeCalcText(shown);
  if (expr === null) return null;
  // Validación: solo caracteres matemáticos permitidos.
  if (!/^[\d\s+\-*/().%^]+$/.test(expr)) return null;
  // Sin gatillo hace falta un operador binario: "200" o "15%" a secas no
  // son una cuenta que responder.
  if (bare && !/[+\-*/^]/.test(expr)) return null;
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

/**
 * 0.1.19: inicio interrogativo (es/en/pt). Lo usan el router de
 * recordatorios y el de memoria: una pregunta no es ni un recordatorio ni
 * un hecho. Ojo: el corte es (?![\p{L}]) y no \b — tras una vocal
 * acentuada ("qué") el \b ASCII no ve frontera de palabra y la guardia no
 * dispararía.
 */
export const INTERROGATIVE_START_RE =
  /^(?:c[óo]mo|qu[ée]|qui[ée]n(?:es)?|cu[áa]ndo|d[óo]nde|cu[áa]l(?:es)?|por\s*qu[ée]|how|what|who|whom|when|where|which|why|como|qual|quais|quando|onde|quem)(?![\p{L}])/iu;

/** Resultado de una acción de recordatorio. */
export interface ReminderAction {
  text: string;
  dueAt: string | null;
  /**
   * 0.1.19: el usuario pidió repetición ("cada día…") pero el sistema de
   * recordatorios no soporta recurrencia en ninguna capa. La acción se
   * crea una sola vez y el caller DEBE avisar de ello: antes se creaba en
   * silencio y el usuario creía que era diario (riesgo real con
   * medicación).
   */
  recurrenceRequested?: boolean;
  /**
   * 0.1.32: repetición soportada («cada día», «cada lunes», «every
   * week»…). dueAt es la PRIMERA vez; la notificación se programa como
   * diaria/semanal y completeReminder avanza a la siguiente.
   */
  repeat?: ReminderRepeat;
}

const RECURRENCE_RE =
  /\b(?:cada\s+\d+(?:\s+(?:d[ií]as?|semanas?|meses|horas?|a[ñn]os?|minutos?))?|every\s+\d+(?:\s+(?:days?|weeks?|months?|hours?|years?|minutes?))?|a\s+cada\s+\d+(?:\s+(?:dias?|semanas?|meses|horas?|anos?))?|cada\s+(?:d[ií]a|semana|mes|a[ñn]o|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)|todos\s+los\s+d[ií]as|todas\s+las\s+semanas|diariamente|a\s+diario|semanalmente|mensualmente|every\s+(?:day|week|month|morning|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly|monthly|todo\s+dia|todos\s+os\s+dias|diariamente|semanalmente)\b/iu;

/**
 * 0.1.37 (auditoría): intervalos que NIDO no sabe repetir. «cada 8 horas»,
 * «cada dos días», «every other day», «biweekly», «de lunes a viernes»…
 * Antes, si además había un ritmo soportado («todos los días cada 8
 * horas»), se guardaba como diario y se decía que se repetiría; y los
 * números escritos con letras ni se detectaban. Ahora se crea una sola vez
 * y se avisa (recurrenceRequested).
 */
const INTERVAL_NUMBER =
  "\\d+|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|quince|veinte|treinta|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|dois|duas|tr[eê]s|quatro|sete|oito|nove|dez|quinze|vinte|trinta|other|otro|otra";
const UNSUPPORTED_INTERVAL_RE = new RegExp(
  `(?<![\\p{L}])(?:(?:cada|every|each|a\\s+cada)\\s+(?:${INTERVAL_NUMBER})(?=\\s|$|[,.;!?])|biweekly|bi-weekly|fortnightly|every\\s+weekday|weekdays|quincenal(?:mente)?|de\\s+lunes\\s+a\\s+viernes|entre\\s+semana|de\\s+segunda\\s+a\\s+sexta|dias\\s+[úu]teis)(?![\\p{L}])`,
  "iu",
);
const UNSUPPORTED_INTERVAL_PHRASE_RE = new RegExp(
  `(?<![\\p{L}])(?:(?:cada|every|each|a\\s+cada)\\s+(?:${INTERVAL_NUMBER})(?:\\s+(?:d[ií]as?|dias?|semanas?|meses|m[eê]ses|horas?|minutos?|a[ñn]os?|anos?|days?|weeks?|months?|hours?|minutes?|years?))?|biweekly|bi-weekly|fortnightly|every\\s+weekday|weekdays|quincenal(?:mente)?|de\\s+lunes\\s+a\\s+viernes|entre\\s+semana|de\\s+segunda\\s+a\\s+sexta|dias\\s+[úu]teis)(?![\\p{L}])`,
  "giu",
);
export function hasUnsupportedInterval(text: string): boolean {
  return UNSUPPORTED_INTERVAL_RE.test(text);
}

/**
 * Detecta "agrégame cita/recordatorio..." y extrae el texto.
 * La fecha se parsea de forma simple; si no hay fecha clara, dueAt=null.
 */
/**
 * 0.1.32: «ponme un recordatorio para el lunes» (fecha sin contenido)
 * devolvía null y caía al modelo. extractReminderAction lo sigue
 * devolviendo null (sin texto no hay recordatorio), pero deja anotada la
 * fecha para que reminderMissingText() permita PREGUNTAR qué recordar.
 */
let lastMissingText: string | null = null;
export function reminderMissingText(userText: string): string | null {
  lastMissingText = null;
  if (extractReminderAction(userText)) return null;
  return lastMissingText;
}

const WEEKDAY_NAMES = "lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?";
const WEEKDAY_NUM: Array<[RegExp, number]> = [
  [/^(?:domingo|sunday)/i, 0],
  [/^(?:lunes|monday|segunda)/i, 1],
  [/^(?:martes|tuesday|ter[çc]a)/i, 2],
  [/^(?:mi[ée]rcoles|wednesday|quarta)/i, 3],
  [/^(?:jueves|thursday|quinta)/i, 4],
  [/^(?:viernes|friday|sexta)/i, 5],
  [/^(?:s[áa]bado|saturday)/i, 6],
];
// «cada lunes», «todos los lunes», «every monday», «on mondays», «toda segunda», «todas as segundas», «todo domingo».
const REPEAT_WEEKDAY_RE = new RegExp(
  `(?<![\\p{L}])(?:cada|todos\\s+los|every|on|todas?\\s+(?:as\\s+)?|todos?\\s+(?:os\\s+)?)\\s*(${WEEKDAY_NAMES})s?(?![\\p{L}-])`,
  "iu",
);
const REPEAT_WEEK_RE =
  /(?<![\p{L}])(?:cada\s+semana|todas\s+las\s+semanas|semanalmente|every\s+week|weekly|toda\s+semana|todas\s+as\s+semanas)(?![\p{L}])/iu;
const REPEAT_MORNING_RE =
  /(?<![\p{L}])(?:cada\s+ma[ñn]ana|todas\s+las\s+ma[ñn]anas|every\s+morning|toda\s+manh[ãa]|todas\s+as\s+manh[ãa]s)(?![\p{L}])/iu;
const REPEAT_NIGHT_RE =
  /(?<![\p{L}])(?:cada\s+noche|todas\s+las\s+noches|every\s+(?:night|evening)|toda\s+noite|todas\s+as\s+noites)(?![\p{L}])/iu;
const REPEAT_DAY_RE =
  /(?<![\p{L}])(?:cada\s+d[ií]a|todos\s+los\s+d[ií]as|diariamente|a\s+diario|every\s*day|each\s+day|daily|todo\s+dia|todos\s+os\s+dias)(?![\p{L}])/iu;

interface RepeatSpec { repeat: ReminderRepeat; weekday?: number; monthDay?: number; cleaned: string; defaultHour: number; period?: "am" | "pm" }

// 0.1.35: cada mes / cada año (cumpleaños, alquiler, facturas).
const REPEAT_YEAR_RE =
  /(?<![\p{L}])(?:cada\s+a[ñn]o|todos\s+los\s+a[ñn]os|anualmente|every\s+year|yearly|annually|todo\s+ano|todos\s+os\s+anos)(?![\p{L}])/iu;
const REPEAT_MONTH_RE =
  /(?<![\p{L}])(?:(?:de\s+)?cada\s+mes|(?:de\s+)?todos\s+los\s+meses|mensualmente|(?:of\s+)?every\s+month|monthly|(?:de\s+)?cada\s+m[eê]s|todo\s+m[eê]s|todos\s+os\s+meses|mensalmente)(?![\p{L}])/iu;
// «el día 5», «el 1», «on the 5th», «the 1st», «no dia 5», «dia 10».
const MONTH_DAY_RE =
  /(?<![\p{L}])(?:el\s+d[ií]a|el|on\s+the|the|(?:todo\s+)?(?:no\s+)?dia)\s+(\d{1,2})(?:st|nd|rd|th|º)?(?=\s|$|[,.;:!?])/iu;

// 30/31 de febrero, 31 de abril/junio/septiembre/noviembre (es/en/pt).
const IMPOSSIBLE_DATE_RE =
  /(?<![\d])(?:3[01]\s+(?:de\s+)?(?:febrero|february|fevereiro)|31\s+(?:de\s+)?(?:abril|april|junio|june|junho|septiembre|setiembre|september|setembro|noviembre|november|novembro)|(?:february|april|june|september|november)\s+31|february\s+3[01])(?![\p{L}\d])/iu;

/**
 * 0.1.37 (auditoría): ¿lo que va DELANTE del verbo («recuérdame»,
 * «recuerda que»…) deja que sea una orden? Vale nada, una fecha («mañana
 * recuérdame…») o una cortesía/enlace («oye,», «mejor», «y también»). Una
 * frase citada («traduce: recuérdame…», «una canción que se llame
 * recuérdame…») no lo es.
 */
export function isOrderLead(rawLead: string): boolean {
  const lead = rawLead.trim().replace(/[,:;]+$/, "").trim();
  if (!lead) return true;
  if (
    /^(?:(?:por\s+favor|porfa|oye|hey|hola|ok|okay|vale|bueno|please|hi|nido|ei|olá|ola|mejor|better|melhor|no|n[aã]o|y|and|e|tambi[eé]n|also|tamb[eé]m|entonces|then|ent[aã]o|ahora|now|agora)[,!.]?\s*)+$/i.test(lead)
  ) {
    return true;
  }
  return Boolean(parseReminderDateTime(lead));
}

// «los lunes», «on mondays», «todas as segundas» junto a un intervalo no
// soportado: sobran en el título del aviso de una vez.
const WEEKDAY_PLURAL_RE = new RegExp(
  `(?<![\\p{L}])(?:los|on|todos\\s+los|every|as|todas\\s+as)\\s+(?:${WEEKDAY_NAMES})s?(?![\\p{L}-])`,
  "giu",
);

/** Detecta una repetición soportada y devuelve la frase sin ella. */
export function detectReminderRepeat(text: string): RepeatSpec | null {
  const tidy = (s: string) => s.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  const yr = REPEAT_YEAR_RE.exec(text);
  if (yr) return { repeat: "year", defaultHour: 9, cleaned: tidy(text.replace(REPEAT_YEAR_RE, " ")) };
  const mo0 = REPEAT_MONTH_RE.exec(text);
  if (mo0) {
    let cleaned = text.replace(REPEAT_MONTH_RE, " ");
    const dm = MONTH_DAY_RE.exec(cleaned);
    const n = dm ? Number(dm[1]) : NaN;
    let monthDay: number | undefined;
    if (dm && n >= 1 && n <= 31) {
      monthDay = n;
      cleaned = cleaned.slice(0, dm.index) + " " + cleaned.slice(dm.index + dm[0].length);
    }
    return { repeat: "month", monthDay, defaultHour: 9, cleaned: tidy(cleaned) };
  }
  const wd = REPEAT_WEEKDAY_RE.exec(text);
  // «on monday» es UNA vez; solo el plural («on mondays») se repite.
  if (wd && !(/^on\s/i.test(wd[0]) && !/s$/i.test(wd[0]))) {
    const name = wd[1];
    const weekday = WEEKDAY_NUM.find(([re]) => re.test(name))?.[1];
    if (weekday !== undefined) {
      // Se deja el nombre del día: el parser lo entiende y luego lo quita
      // del título; sin él, «ponme un recordatorio cada lunes» perdía la
      // fecha y no se podía preguntar qué recordar.
      return { repeat: "week", weekday, defaultHour: 9, cleaned: tidy(text.slice(0, wd.index) + " " + name + " " + text.slice(wd.index + wd[0].length)) };
    }
  }
  const wk = REPEAT_WEEK_RE.exec(text);
  if (wk) return { repeat: "week", defaultHour: 9, cleaned: tidy(text.replace(REPEAT_WEEK_RE, " ")) };
  const mo = REPEAT_MORNING_RE.exec(text);
  if (mo) return { repeat: "day", defaultHour: 9, period: "am", cleaned: tidy(text.replace(REPEAT_MORNING_RE, " ")) };
  const ni = REPEAT_NIGHT_RE.exec(text);
  if (ni) return { repeat: "day", defaultHour: 21, period: "pm", cleaned: tidy(text.replace(REPEAT_NIGHT_RE, " ")) };
  const dy = REPEAT_DAY_RE.exec(text);
  if (dy) return { repeat: "day", defaultHour: 9, cleaned: tidy(text.replace(REPEAT_DAY_RE, " ")) };
  return null;
}

export function extractReminderAction(userText: string, now: Date = new Date()): ReminderAction | null {
  lastMissingText = null;
  // 0.1.37: un intervalo no soportado manda: una sola vez y aviso honesto,
  // aunque la frase traiga también «todos los días» o «cada lunes».
  if (hasUnsupportedInterval(userText)) return extractReminderCore(userText);
  const spec = detectReminderRepeat(userText.trim());
  if (!spec) return extractReminderCore(userText);
  const res = extractReminderCore(spec.cleaned);
  if (!res) return null;
  // Hora: la que dijo el usuario o la por defecto del ritmo. «cada noche a
  // las 10» es 22:00 (sin am/pm el parser tomaría las 10 de la mañana).
  let hour = spec.defaultHour;
  let minute = 0;
  if (res.dueAt) {
    const d = new Date(res.dueAt);
    hour = d.getHours();
    minute = d.getMinutes();
    if (spec.period === "pm" && hour < 12 && hour !== 0) hour += 12;
  }
  const first = new Date(now);
  first.setHours(hour, minute, 0, 0);
  if (spec.repeat === "year" || spec.repeat === "month") {
    // Base: la fecha dicha («el 15 de marzo», «el día 5») o la de hoy; la
    // primera vez es la próxima ocurrencia a partir de ahora.
    let base = res.dueAt ? new Date(res.dueAt) : new Date(now);
    if (spec.repeat === "month" && spec.monthDay) {
      // 0.1.37 (auditoría): «el día 31» dicho en noviembre era el 1 de
      // diciembre (setDate desbordaba) y quedaba «cada día 1». La base es el
      // primer mes, desde este, que tiene ese día; nextOccurrence salta los
      // meses cortos igual que la alarma del sistema.
      for (let k = 0; k < 12; k++) {
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + k + 1, 0).getDate();
        if (daysInMonth >= spec.monthDay) {
          base = new Date(now.getFullYear(), now.getMonth() + k, spec.monthDay);
          break;
        }
      }
    }
    // «cada año el 30 de febrero»: una fecha que no existe no se cambia por
    // la de hoy en silencio; no se crea nada (el modelo/el usuario aclaran).
    if (spec.repeat === "year" && IMPOSSIBLE_DATE_RE.test(spec.cleaned)) return null;
    base.setHours(hour, minute, 0, 0);
    const next = nextOccurrence(base, spec.repeat, new Date(now.getTime() - 1));
    const text = res.text.replace(/\s{2,}/g, " ").trim();
    return { text, dueAt: next.toISOString(), repeat: spec.repeat };
  }
  if (spec.repeat === "week") {
    const weekday = spec.weekday ?? (res.dueAt ? new Date(res.dueAt).getDay() : now.getDay());
    first.setDate(first.getDate() + ((weekday - now.getDay() + 7) % 7));
    if (first.getTime() <= now.getTime()) first.setDate(first.getDate() + 7);
  } else if (first.getTime() <= now.getTime()) {
    first.setDate(first.getDate() + 1);
  }
  const text = res.text.replace(/\s{2,}/g, " ").trim();
  return { text, dueAt: first.toISOString(), repeat: spec.repeat };
}

function extractReminderCore(userText: string): ReminderAction | null {
  lastMissingText = null;
  const trimmed = userText.trim();
  if (!trimmed) return null;
  const recurrenceRequested = RECURRENCE_RE.test(trimmed) || UNSUPPORTED_INTERVAL_RE.test(trimmed);

  // 0.1.19 (sonda de routing): "recuerda que mañana tengo dentista" se
  // guardaba como HECHO de memoria y el aviso nunca existía. Con fecha
  // futura parseable Y evento en primera persona es un recordatorio; sin
  // una de las dos ("recuerda que mi mamá se llama Marta", "recuerda que
  // el cumpleaños de mamá es el 15 de marzo") sigue siendo memoria y esta
  // vía devuelve null para que el flujo normal (personas/hechos) decida.
  const que = /^(?:recuerda|remember|lembra(?:-te)?|lembre(?:-se)?)\s+(?:que|that)\s+(.+)/i.exec(trimmed);
  if (que) {
    const content = que[1].trim();
    const dueAt = parseReminderDateTime(content);
    if (dueAt && /\b(?:tengo|debo|hay que|tenho|preciso|i have|i need)\b/i.test(content)) {
      const text = stripDateWords(content).trim();
      if (text.length >= 3) return recurrenceRequested ? { text, dueAt, recurrenceRequested: true } : { text, dueAt };
    }
    return null;
  }

  // "agrégame cita con el doctor el viernes a las 10"
  // "créame un recordatorio para comprar leche mañana"
  // LOOP-1 FIX 2026-10-07: también "recuérdame comprar pan" / "remember me to call mom"
  // El intent clasificador ya marca estos como "actuar", pero el router no los capturaba.
  // 0.1.14 (guía): "remind me to …" y portugués "me lembra de …" /
  // "lembre-me de …". "me lembra que X" es memoria, no recordatorio.
  // 0.1.20 (P3-11): verbos de AVISO — «avísame a las 3 de estudiar»,
  // «despiértame a las 7», «me acorde às 7», «wake me at 7» creaban
  // nada: caían al modelo. El verbo va en su grupo para saber si es un
  // aviso (su texto puede ser la propia orden cuando no hay tarea).
  const m = /((?:agr[ée]game|cr[ée]ame|ponme|crea)(?=\s+(?:una?\s+)?(?:cita|recordatorio|aviso|alarma)(?![a-záéíóúñ]))|recu[ée]rdame|remember me to|remind me(?: to)?|me lembr[ae](?!\s+que\b)(?: de)?|lembr[ae]-me(?: de)?|av[íi]same|despi[ée]rtame|despertame|me\s+avisa|me\s+acorde|acorda-me|wake\s+me(?:\s+up)?|let\s+me\s+know|pon(?:me)?\s+una\s+alarma|set\s+(?:a|an|my)\s+(?:reminder|alarm)(?:\s+for)?|no\s+me\s+dejes\s+olvidar|(?:me\s+)?(?:p[õo]e|coloca|cria|crie|faz|fa[çc]a)\s+um\s+lembrete|(?:me\s+)?(?:p[õo]e|coloca|cria|crie|define|defina)\s+um\s+alarme(?:\s+para)?|que\s+no\s+se\s+me\s+olvide|don'?t\s+let\s+me\s+forget(?:\s+to)?)\s+(?:una?\s+)?(?:cita|recordatorio|reminder)?\s*(.+)/i.exec(trimmed);
  if (!m) return null;
  // 0.1.37 (auditoría): el verbo tiene que abrir la orden. Delante solo
  // cabe una fecha («mañana recuérdame…») o una cortesía («oye, …»). Así
  // «traduce al inglés: recuérdame comprar pan», «una canción que se llame
  // recuérdame siempre» o «how do I say remind me to…» no crean nada.
  if (!isOrderLead(trimmed.slice(0, m.index))) return null;
  // «avísame si llueve», «let me know if…», «me avisa se chover»: NIDO no
  // puede comprobar condiciones; no es un recordatorio.
  if (/^(?:si|if|se)\s+\S/i.test(m[2].trim())) return null;
  // «let me know your thoughts…» no es un aviso: sin hora, no hay recordatorio.
  if (/^let\s+me\s+know$/i.test(m[1]) && !parseReminderDateTime(m[2])) return null;
  // 0.1.30 (rutas que caían al modelo): «pon una alarma a las 7» y «set a
  // reminder for 5pm» también son avisos: sin tarea, el título es la frase.
  // «set a reminder» sin contenido NO es un aviso: se pregunta qué recordar (0.1.32).
  const isAlertVerb = /av[íi]s|despi|despert|wake|acord|let\s+me\s+know|alarm/i.test(m[1]);

  let text = m[2].trim();
  // 0.1.35: «set an alarm for 7» deja solo «7»: corto pero válido.
  if (text.length < 3 && !/^\d/.test(text)) return null;
  // 0.1.20 (P3-11): un DESPERTADOR es de mañana. Sin esta marca, «a
  // las 7» a media tarde se programaba a las 19:00 (la siguiente
  // ocurrencia de las 7). Con verbos de despertar y sin parte del día
  // explícita, se añade la de la mañana según el idioma del verbo.
  // 0.1.35: una ALARMA sin parte del día también es de mañana (como el
  // despertador): «set an alarm for 7» a las 20:00 son las 7:00, no las 19:00.
  const isWakeVerb = /despi|despert|wake|acord|alarm/i.test(m[1]);
  // «set an alarm for 7» / «coloca um alarme para 7»: hora suelta → «at 7».
  text = text.replace(/^(?:for\s+|para\s+(?:las\s+|as\s+)?)?(\d{1,2}(?::\d{2})?)\s*$/i, "at $1");
  if (isWakeVerb && !/(ma[ñn]ana|tarde|noche|madrugada|morning|afternoon|evening|night|manh[ãa]|noite|am\b|pm\b)/i.test(text)) {
    text += /wake|alarm(?!a|e)/i.test(m[1]) ? " in the morning" : /acord|alarme/i.test(m[1]) ? " da manhã" : " de la mañana";
  }
  // «avísame cuando sean las 3»: el parser entiende «a las 3», no la
  // subordinada. Se reformula solo el arranque.
  text = text
    // «set a reminder for 5pm»: el parser entiende «at 5pm».
    .replace(/^(?:for\s+)?(?=\d{1,2}(?::\d{2})?\s*(?:am|pm)\b)/i, "at ")
    .replace(/^cuando\s+(?:sean|sea)\s+/i, "a ")
    .replace(/^when\s+it'?s\s+/i, "at ")
    .replace(/^quando\s+(?:forem|for)\s+/i, "às ");

  // 0.1.19 (sonda de routing): "recuérdame cómo se llama la capital de
  // Francia" es una PREGUNTA: creaba un recordatorio basura con el texto
  // de la pregunta y nadie la respondía. Si el texto empieza con palabra
  // interrogativa, que responda el flujo normal.
  if (INTERROGATIVE_START_RE.test(text)) return null;

  // CALENDAR-FIX 2026-10-07: parsear fecha/hora del texto.
  let dueAt = parseReminderDateTime(text);
  if (!dueAt) {
    // 0.1.19 (sonda de routing): la hora puede ir ANTES del verbo —
    // "en media hora recuérdame la junta", "mañana recuérdame comprar
    // pan". La regex no está anclada al inicio y ese prefijo se perdía:
    // el recordatorio se creaba con dueAt null y nunca avisaba.
    const prefix = trimmed.slice(0, m.index).trim();
    if (prefix) dueAt = parseReminderDateTime(prefix);
  }
  // Limpiar la fecha del texto para que no quede duplicada.
  if (dueAt) {
    text = stripDateWords(text);
  }

  // 0.1.19 (sonda de routing): "ponme un recordatorio para el viernes"
  // dejaba el título en "para" (la fecha se comía el contenido) y se
  // guardaba así. Un "para" inicial sobra en el título, y si no queda
  // contenido no hay recordatorio que crear.
  // 0.1.20: también el "de" de «avísame a las 3 de estudiar» (queda
  // «estudiar») y de «un recordatorio de comprar pan».
  // 0.1.32: puede haber varios («para el lunes de pagar…» → «para de pagar…»).
  text = text.replace(/^(?:(?:para|de|to|for|about|sobre|do|da)\s+)+/i, "").trim();

  // F6 (auditoría 2026-10-10): "recuérdame mañana" dejaba el texto vacío
  // tras quitar la fecha. Sin texto no hay recordatorio: que decida el modelo.
  // 0.1.20 (P3-11): con un verbo de AVISO la orden sola sí es el aviso
  // («despiértame a las 7», «avísame cuando sean las 3»): el título es
  // la frase del usuario, que es exactamente lo que pidió.
  if (!text.trim()) {
    if (isAlertVerb && dueAt) {
      const title = trimmed.replace(/[.!]+$/, "").trim();
      return recurrenceRequested ? { text: title, dueAt, recurrenceRequested: true } : { text: title, dueAt };
    }
    // 0.1.32: hay fecha pero no qué recordar → se pregunta (no al modelo).
    if (dueAt) lastMissingText = dueAt;
    return null;
  }
  // «ponme un recordatorio» sin nada más: la palabra no es el contenido.
  if (/^(?:para|de|a|el|la|the|to|for|recordatorio|reminder|lembrete|cita)$/i.test(text)) {
    if (dueAt) lastMissingText = dueAt;
    return null;
  }
  if (recurrenceRequested) {
    // 0.1.32: «cada mes» no se queda en el título de un aviso de una vez.
    const clean = text
      .replace(UNSUPPORTED_INTERVAL_PHRASE_RE, " ")
      .replace(UNSUPPORTED_INTERVAL_RE.test(text) ? WEEKDAY_PLURAL_RE : /(?!)/, " ")
      .replace(UNSUPPORTED_INTERVAL_RE.test(text) ? /^\s*(?:los|las|on|os|as)\s+/i : /(?!)/, " ")
      .replace(new RegExp(RECURRENCE_RE.source, "giu"), " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return { text: clean.length >= 3 ? clean : text, dueAt, recurrenceRequested: true };
  }
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
      // 0.1.24 (auditoría de alcanzabilidad, H-3): «on» entra en el
      // grupo de artículos/preposiciones ante día — sin él, «schedule
      // dentist on Friday at 10» (el ejemplo exacto de la guía EN)
      // dejaba el título «dentist on»: se quitaban día y hora pero no
      // la preposición. La misma fuga dejaba «call mom on» en
      // recordatorios EN.
      // 0.1.31: el artículo solo cuenta como palabra suelta. Con \b, la «o»
      // final de «reunião»/«canção» (tras «ã», que \b no ve como letra)
      // se tomaba por artículo: «marca reunião segunda» quedaba «reuniã».
      .replace(/(?:(?<![\p{L}])(?:el|la|the|o|a|na|no|on)\s+)?(?<![\p{L}])(lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|monday|tuesday|wednesday|thursday|friday|saturday|sunday|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?)(?![\p{L}-])/giu, "")
      .replace(/(?<![\p{L}])(mañana|manana|tomorrow|hoy|today|amanhã|amanha|hoje)(?![\p{L}])/giu, "")
      // 0.1.35: fecha de calendario («el 15 de marzo», «em 15 de março»,
      // «on March 15th»): el título del aviso quedaba con la fecha dentro.
      .replace(/(?:(?<![\p{L}])(?:el|em|no|on)\s+)?(?<![\p{L}\d])\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|janeiro|fevereiro|março|marco|maio|junho|julho|setembro|outubro|novembro|dezembro)(?:\s+de(?:l)?\s+\d{4})?(?![\p{L}])/giu, "")
      .replace(/(?:(?<![\p{L}])on\s+)?(?<![\p{L}])(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?(?![\p{L}\d])/giu, "")
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

/** Resultado de una acción de temporizador. */
export interface TimerAction {
  /** Etiqueta del usuario («para la pasta») o null. */
  label: string | null;
  durationMs: number;
}

const TIMER_NUMBER_WORDS: Record<string, number> = {
  ...NUMBER_WORDS,
  um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, quinze: 15, vinte: 20,
  trinta: 30, meia: 0.5,
};

const TIMER_UNIT_MS: Array<{ re: RegExp; ms: number }> = [
  { re: /^(?:s|seg|segs|segundo|segundos|sec|secs|second|seconds)$/i, ms: 1_000 },
  { re: /^(?:m|min|mins|minuto|minutos|minute|minutes)$/i, ms: 60_000 },
  { re: /^(?:h|hr|hrs|hora|horas|hour|hours)$/i, ms: 3_600_000 },
];

/** «10 minutos», «1 hora y 30 minutos», «half an hour», «meia hora». */
function parseTimerDuration(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/,/g, " ");
  if (!t) return null;
  // Se recorre por componentes número+unidad; «y/and/e» son conectores.
  let total = 0;
  let components = 0;
  let i = 0;
  const words = t.split(/\s+/).filter((w) => !/^(y|e|and)$/.test(w));
  while (i < words.length) {
    const numTok = words[i];
    // «half an hour», «una hora»: el artículo puede ir entre la
    // cantidad y la unidad; se salta.
    let unitTok = words[i + 1];
    let consumed = 2;
    if (unitTok !== undefined && /^(?:a|an|un|una|um|uma)$/.test(unitTok) && words[i + 2] !== undefined) {
      unitTok = words[i + 2];
      consumed = 3;
    }
    if (unitTok === undefined) return null;
    let n: number | null = null;
    if (/^\d+(?:\.\d+)?$/.test(numTok)) n = Number(numTok);
    else if (TIMER_NUMBER_WORDS[numTok] !== undefined) n = TIMER_NUMBER_WORDS[numTok];
    if (n === null || !(n > 0)) return null;
    const unit = TIMER_UNIT_MS.find((u) => u.re.test(unitTok));
    if (!unit) return null;
    total += n * unit.ms;
    components++;
    i += consumed;
  }
  if (components === 0 || total <= 0) return null;
  // Más de 24 h no es un temporizador: es un recordatorio.
  if (total > 24 * 3_600_000) return null;
  return total;
}

const TIMER_FORMS: Array<{ re: RegExp }> = [
  // ES: «pon un temporizador de 10 minutos (para la pasta)»
  { re: /^(?:pon(?:me)?|inicia|empieza|activa|crea)\s+(?:un\s+)?(?:temporizador|timer)\s+(?:de\s+)?(.+?)(?:\s+(?:para|de)\s+(.+))?$/i },
  { re: /^(?:temporizador|timer)\s+(?:de\s+)?(.+?)(?:\s+(?:para|de)\s+(.+))?$/i },
  // EN: «set a timer for 10 minutes (for the pasta)»
  { re: /^(?:set|start)\s+(?:a\s+)?timer\s+(?:for\s+)?(.+?)(?:\s+(?:for|to)\s+(.+))?$/i },
  { re: /^timer\s+(?:for\s+)?(.+?)(?:\s+(?:for|to)\s+(.+))?$/i },
  // 0.1.35: «10 minute timer» (la duración delante).
  { re: /^(?:(?:set|start)\s+)?(?:a\s+)?(\d+\s*(?:-\s*)?(?:second|sec|minute|min|hour)s?)\s+timer(?:\s+(?:for|to)\s+(.+))?$/i },
  // PT: «coloca um temporizador de 10 minutos (para a massa)»
  { re: /^(?:coloca|inicia|come[çc]a|ativa|p[õo]e|ponha)\s+(?:um\s+)?(?:temporizador|cron[ôo]metro)\s+(?:de\s+)?(.+?)(?:\s+(?:para|de)\s+(.+))?$/i },
  { re: /^(?:temporizador|cron[ôo]metro)\s+(?:de\s+)?(.+?)(?:\s+(?:para|de)\s+(.+))?$/i },
];

/**
 * 0.1.20 (P3-16): temporizador. No es un sistema nuevo: es un
 * recordatorio cuya hora es ahora + duración, y suena con la MISMA
 * notificación que cualquier recordatorio (scheduleReminderNotification).
 * El usuario lo ve y lo borra en la misma lista de recordatorios, y el
 * deshacer existente lo cubre. Solo se reclaman las formas explícitas
 * («pon un temporizador de…»); sin duración válida no hay temporizador.
 */
export function extractTimerAction(userText: string): TimerAction | null {
  const trimmed = userText.trim().replace(/[.!]+$/, "");
  if (!trimmed || trimmed.length > 120) return null;
  if (INTERROGATIVE_START_RE.test(trimmed)) return null;
  for (const { re } of TIMER_FORMS) {
    const m = re.exec(trimmed);
    if (!m) continue;
    const durationMs = parseTimerDuration(m[1]);
    if (durationMs === null) continue;
    const label = m[2]?.trim();
    if (label !== undefined && (label.length < 2 || /^\d/.test(label))) continue;
    return { label: label ?? null, durationMs };
  }
  return null;
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
  // 0.1.24 (auditoría de alcanzabilidad, H-6): «pt» añadido — el tipo
  // solo admitía es|en y toda petición en portugués salía en español.
  lang: "es" | "en" | "pt"; // M7d: idioma para la salida
}

/**
 * WEEKLY-PLAN 2026-10-07: detecta "plan my week / planifica mi semana"
 * y extrae restricciones. El horario se genera con plantilla determinística,
 * no se deja al modelo inventar (el 0.5B inventaba turnos de 8AM/4PM/8PM).
 */
export function extractWeeklyPlanAction(userText: string): WeeklyPlanAction | null {
  const t = userText.toLowerCase();
  // M7a FIX: word boundary en "week" para no matchear "weekend".
  // 0.1.20 (P3-14): las formas naturales faltaban — «hazme un plan
  // semanal» caía al modelo mientras «planifica mi semana» sí entraba.
  // Las formas nuevas exigen verbo de petición o el mensaje pelado, así
  // «¿cuánto cuesta el plan semanal?» y «mi plan de datos» no disparan.
  const bare = t.trim().replace(/[.?!\s]+$/, "");
  const isPlanRequest =
    /plan\s*(my|la)?\s*week\b|planifica(r)?\s*(mi\s+|la\s+)?semana|(?:ay[uú]dame\s+a\s+|quiero\s+|necesito\s+|^)planea(?:r)?\s+(?:mi\s+|la\s+)?semana|organiza(r)?\s*(mi\s+|la\s+)?semana|horario\s+semanal/i.test(t) ||
    /(?:haz(?:me)?|quiero|necesito|dame|cr[eé]a(?:me)?|arma(?:me)?|prep[aá]ra(?:me)?)\s+(?:un\s+|una\s+)?plan\s+(?:semanal|de\s+(?:la|mi)\s+semana|para\s+(?:la|mi)\s+semana)/i.test(t) ||
    /(?:make(?:\s+me)?|give\s+me|i\s+want|i\s+need|create)\s+(?:a\s+)?(?:weekly\s+plan|plan\s+for\s+(?:my|the)\s+week)/i.test(t) ||
    /(?:faz|quero|preciso|planej[ae](?:r)?|organiz[ae](?:r)?)\s+(?:um\s+|a\s+)?(?:plano\s+(?:semanal|da\s+(?:minha\s+)?semana)|minha\s+semana)/i.test(t) ||
    /^(?:plan\s+(?:semanal|de\s+la\s+semana)|weekly\s+plan|plano\s+semanal)$/i.test(bare);
  if (!isPlanRequest) return null;

  // Extraer horario de trabajo: "work 9 to 6", "trabajo de 9 a 6"
  // M7b FIX: requerir contexto work/trabajo/horario, no cualquier "N to M"
  // como "I have 2 to 3 meetings".
  let workStart = 9, workEnd = 18;
  // 0.1.24 (H-6): contexto y separadores PT («trabalho das 9 às 18») —
  // sin esto el plan en PT usaba el horario por defecto salvo que
  // coincidiera con 9–18.
  const workMatch =
    /(?:work|trabajo|trabalho|horario|horário)\s*(?:de\s*|das\s*|from\s*)?(\d{1,2})\s*(?:to|a|à|às|-)\s*(\d{1,2})/i.exec(t);
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
  // 0.1.24 (H-6): ramas PT («exercício 3 vezes») — grupos 4 y 5.
  const exMatch = /exercis\w*\s*(\d+)\s*times?|ejercicio\s*(\d+)\s*veces?|(\d+)\s*(?:times|veces)\s*(?:a\s*la\s*semana|per\s*week)?|exerc[ií]ci\w*\s*(\d+)\s*vezes|(\d+)\s*vezes(?:\s*por\s*semana)?/i.exec(t);
  if (exMatch) {
    const n = parseInt(exMatch[1] || exMatch[2] || exMatch[3] || exMatch[4] || exMatch[5], 10);
    if (n >= 1 && n <= 7) exerciseDays = n;
  }

  // 0.1.24 (H-6): /fam[ií]l/ — «família» en PT lleva í acentuada y
  // /famil/ no la casaba: el plan PT salía sin tiempo en familia.
  const wantsFamilyTime = /fam[ií]l/i.test(t);

  // M7d: detectar idioma del trigger para la salida.
  // 0.1.24 (H-6): el PT se detecta ANTES que el ES — «planeja minha
  // semana» contiene «semana» y caía en «es»: el plan salía en
  // español a una petición en portugués. Marcadores inequívocos de
  // PT (ninguno es forma española): planej-, plano, minha, faz,
  // quero, preciso.
  const lang: "es" | "en" | "pt" = /planej|\bplano\b|\bminha\b|\bfaz\b|\bquero\b|\bpreciso\b/i.test(t)
    ? "pt"
    : /planifica|semana|organiza|horario|trabajo|ejercicio/i.test(t)
      ? "es"
      : "en";

  return { workStart, workEnd, exerciseDays, wantsFamilyTime, lang };
}

/**
 * Genera un horario semanal determinístico de 7 días.
 * Días de ejercicio distribuidos (lun/mié/vie o similar).
 * Sin traslapes: trabajo, ejercicio, familia en bloques separados.
 */
export function generateWeeklyPlan(action: WeeklyPlanAction): string {
  // M7d FIX: usar el idioma detectado del trigger.
  // 0.1.24 (H-6): etiquetas y días en portugués cuando lang es «pt».
  const es = action.lang === "es";
  const pt = action.lang === "pt";
  const days = es
    ? ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
    : pt
      ? ["Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado", "Domingo"]
      : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  // Distribuir días de ejercicio uniformemente.
  const exDays: boolean[] = [false, false, false, false, false, false, false];
  if (action.exerciseDays >= 1) {
    const step = 7 / action.exerciseDays;
    for (let i = 0; i < action.exerciseDays; i++) {
      exDays[Math.floor(i * step) % 7] = true;
    }
  }

  // 0.1.31 (auditoría del loop): en español y portugués la hora va en
  // formato de 24 h, como en el resto de respuestas («9:00–18:00»).
  const fmtHour = (h: number) => {
    const hh = h % 24;
    if (es || pt) return `${hh}:00`;
    const ampm = hh < 12 ? "AM" : "PM";
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:00 ${ampm}`;
  };

  const lines: string[] = [];
  const title = es
    ? `Horario semanal (trabajo ${fmtHour(action.workStart)}–${fmtHour(action.workEnd)}):`
    : pt
      ? `Horário semanal (trabalho ${fmtHour(action.workStart)}–${fmtHour(action.workEnd)}):`
      : `Weekly Schedule (work ${fmtHour(action.workStart)}–${fmtHour(action.workEnd)}):`;
  lines.push(title);
  lines.push("");

  for (let d = 0; d < 7; d++) {
    const isWeekend = d >= 5;
    lines.push(`**${days[d]}**`);

    const workLabel = es ? "Trabajo" : pt ? "Trabalho" : "Work";
    const exLabel = es ? "Ejercicio (1 hora)" : pt ? "Exercício (1 hora)" : "Exercise (1 hour)";
    const famLabel = es ? "Tiempo en familia" : pt ? "Tempo em família" : "Family time";
    const restLabel = es ? "Día de descanso" : pt ? "Dia de descanso" : "Rest day";
    const restFamLabel = es
      ? "Resto del día: familia y descanso"
      : pt
        ? "Resto do dia: família e descanso"
        : "Rest of day: Family time & rest";

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
        lines.push(`- ${fmtHour(10)}–${fmtHour(11)}: ${exLabel}`);
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
