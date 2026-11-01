/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * dates.ts — C-07: las fechas como datos comprobables.
 *
 * Hasta esta tanda el verificador de fundado era ciego ante las fechas:
 * ninguna fecha entraba en su firma («lunes», «ayer» y «mañana» no son
 * cifras ni unidades) y una respuesta que ponía la cita en lunes contra
 * una fuente que decía martes salía sellada `grounded`, indistinguible
 * de la honesta. Este módulo es el calendario que le faltaba: parsea
 * menciones de fecha (es/en/pt) y las juzga con las reglas R1–R5.
 *
 * Es un módulo PURO de `src/rag`: las tablas de días y meses viven aquí
 * y NO se importan desde `toolRouter.ts` (capa de agente, superior);
 * la duplicación de tablas es el diseño, no un descuido.
 *
 * La doctrina es la de precisión de la casa: lo que no se puede fijar
 * no se acusa. Por eso:
 *  - El parseo es por GRAMÁTICA DE POSICIÓN («10 de X», «X 10», «el
 *    martes 10»), nunca por palabra suelta: un mes fuera de gramática
 *    de fecha no crea mención, y un día de semana sin ancla de día/mes
 *    tampoco (regla decorativa: «el lunes me dolía la cabeza» jamás
 *    crea una mención juzgable).
 *  - No se normaliza lo que no tiene precisión de día: «la semana
 *    pasada», «el mes pasado», «hace una semana», «pronto» no crean
 *    mención.
 *  - Una fecha inexistente (29 de febrero de 2026) NO rueda al mes
 *    siguiente: queda sin fijar (day = null) y ninguna regla la juzga.
 *  - «El viernes que viene» se lee como el viernes ESTRICTAMENTE
 *    posterior a la referencia (lectura declarada; el uso real es
 *    ambiguo y si el dueño prefiere no juzgarla, se apaga esa forma
 *    sin tocar el resto).
 *
 * Reglas de juicio (dateConflictForSentence):
 *  - R1 · Consistencia interna: mención con día de semana + día + mes
 *    cuyo día de semana calculado no es el nombrado → falsa por
 *    calendario, aunque la fuente no nombre el día.
 *  - R2 · Emparejamiento: una mención solo se enfrenta a menciones de
 *    la fuente que compartan día (y mes compatible): la fecha es el
 *    tema, como `sharesTopic` para las cifras. Dos fechas distintas
 *    de un documento nunca se cruzan.
 *  - R3 · El año ausente: si exactamente un lado trae año, se toma
 *    prestado; si ninguno lo trae, se usa el año de referencia CON
 *    guarda de ambigüedad (si el juicio falla con ese año pero
 *    pasaría con ±1 año, no se juzga: un papel sin año puede ser del
 *    año pasado).
 *  - R4 · Día contra día: menciones emparejadas con día de semana en
 *    ambos lados y distintos → conflicto.
 *  - R5 · Relativa contra absoluta: la relativa de la respuesta se
 *    normaliza con la fecha de referencia y se empareja con la
 *    absoluta de la fuente solo si (a) la fuente tiene exactamente
 *    una mención de fecha, o (b) las frases comparten ≥1 raíz
 *    sustantiva (el tema). Sin emparejamiento no hay juicio.
 */

export interface DateMention {
  /** Día absoluto cuando es computable; null si la mención no se puede fijar. */
  day: { y: number; m: number; d: number } | null;
  weekday: number | null; // 0=domingo … 6=sábado, si la mención lo nombra
  hasYear: boolean;
  kind: "calendario" | "relativa";
  text: string; // la mención tal cual (plegada), para depurar/fixtures
  /**
   * C-07: componentes de emparejamiento (R2) cuando el día no se puede
   * fijar entero — la mención trae día del mes (y quizá mes) pero no
   * año, o es un día suelto con día de semana («el miércoles 10»).
   */
  dom?: number;
  month?: number;
}

interface SpanMention extends DateMention {
  start: number;
  end: number;
}

/** Plegado de la casa: minúsculas y sin diacríticos (NFD). */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Día de semana: 0=domingo … 6=sábado. Las formas que colisionan entre
// idiomas valen lo mismo en todos, así que una sola tabla manda.
const WEEKDAYS: Record<string, number> = {
  domingo: 0, sunday: 0,
  lunes: 1, monday: 1, segunda: 1, "segunda-feira": 1,
  martes: 2, tuesday: 2, terca: 2, "terca-feira": 2,
  miercoles: 3, wednesday: 3, quarta: 3, "quarta-feira": 3,
  jueves: 4, thursday: 4, quinta: 4, "quinta-feira": 4,
  viernes: 5, friday: 5, sexta: 5, "sexta-feira": 5,
  sabado: 6, saturday: 6,
};

// Mes: 1=enero … 12=diciembre (completos y abreviaturas es/en/pt).
const MONTHS: Record<string, number> = {
  enero: 1, january: 1, janeiro: 1, ene: 1, jan: 1,
  febrero: 2, february: 2, fevereiro: 2, feb: 2, fev: 2,
  marzo: 3, march: 3, marco: 3, mar: 3,
  abril: 4, april: 4, abr: 4, apr: 4,
  mayo: 5, may: 5, maio: 5, mai: 5,
  junio: 6, june: 6, junho: 6, jun: 6,
  julio: 7, july: 7, julho: 7, jul: 7,
  agosto: 8, august: 8, ago: 8, aug: 8,
  septiembre: 9, setiembre: 9, september: 9, setembro: 9, sep: 9, sept: 9, set: 9,
  octubre: 10, october: 10, outubro: 10, oct: 10, out: 10,
  noviembre: 11, november: 11, novembro: 11, nov: 11,
  diciembre: 12, december: 12, dezembro: 12, dic: 12, dec: 12, dez: 12,
};

const alt = (table: Record<string, number>): string =>
  Object.keys(table)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[-]/g, "\\-"))
    .join("|");
const MONTH_ALT = alt(MONTHS);
const WEEKDAY_ALT = alt(WEEKDAYS);
const BOUND_L = "(?<![a-z])";
const BOUND_R = "(?![a-z])";

/** Día de semana real de (y, m, d); null si la fecha no existe (no rueda). */
function weekdayOf(y: number, m: number, d: number): number | null {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt.getDay();
}

function validDay(y: number, m: number, d: number): { y: number; m: number; d: number } | null {
  return weekdayOf(y, m, d) === null ? null : { y, m, d };
}

function addDays(day: { y: number; m: number; d: number }, n: number): { y: number; m: number; d: number } {
  const dt = new Date(day.y, day.m - 1, day.d + n);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

/** El día con ese día de semana, estrictamente antes/después de `ref`. */
function shiftWeekday(
  ref: { y: number; m: number; d: number },
  weekday: number,
  dir: "past" | "next",
): { y: number; m: number; d: number } {
  const refWd = weekdayOf(ref.y, ref.m, ref.d) ?? 0;
  let delta = dir === "past" ? (refWd - weekday + 7) % 7 : (weekday - refWd + 7) % 7;
  if (delta === 0) delta = 7; // estrictamente anterior/posterior, nunca el mismo día
  return addDays(ref, dir === "past" ? -delta : delta);
}

/**
 * Parsea las menciones de fecha de un texto contra una fecha de
 * referencia (la del turno: las relativas se normalizan contra ella).
 */
export function parseDateMentions(text: string, referenceDate: Date): DateMention[] {
  const t = fold(text ?? "");
  const ref = {
    y: referenceDate.getFullYear(),
    m: referenceDate.getMonth() + 1,
    d: referenceDate.getDate(),
  };
  const out: SpanMention[] = [];
  const spans: Array<{ start: number; end: number }> = [];
  const overlaps = (start: number, end: number): boolean =>
    spans.some((s) => start < s.end && end > s.start);
  const push = (m: SpanMention): void => {
    out.push(m);
    spans.push({ start: m.start, end: m.end });
  };

  // — Pasada A: absolutas con mes (la gramática de posición manda) —
  const absPatterns: Array<{ re: RegExp; dayFirst: boolean }> = [
    { re: new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+de\\s+(${MONTH_ALT})\\s+de\\s+(\\d{4})`, "g"), dayFirst: true },
    { re: new RegExp(`(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+(\\d{4})`, "g"), dayFirst: false },
    { re: new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\s+(\\d{4})`, "g"), dayFirst: true },
    { re: new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+de\\s+(${MONTH_ALT})${BOUND_R}`, "g"), dayFirst: true },
    { re: new RegExp(`(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?${BOUND_R}`, "g"), dayFirst: false },
    { re: new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})${BOUND_R}`, "g"), dayFirst: true },
  ];
  for (const { re, dayFirst } of absPatterns) {
    for (const match of t.matchAll(re)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      const d = parseInt(dayFirst ? match[1] : match[2], 10);
      const monthName = (dayFirst ? match[2] : match[1]).replace(/\s+/g, " ");
      const m = MONTHS[monthName];
      const y = match[3] ? parseInt(match[3], 10) : null;
      if (!m || !(d >= 1 && d <= 31)) continue;
      push({
        day: y !== null ? validDay(y, m, d) : null,
        weekday: null,
        hasYear: y !== null,
        kind: "calendario",
        text: match[0],
        dom: d,
        month: m,
        start,
        end,
      });
    }
  }

  // — Pasada B: días de semana (relativos, pegados a una absoluta, o
  //    con día suelto; sueltos sin ancla = decorativos, no crean nada) —
  const wdRe = new RegExp(`${BOUND_L}(${WEEKDAY_ALT})${BOUND_R}`, "g");
  for (const match of t.matchAll(wdRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    const weekday = WEEKDAYS[match[1]];
    if (weekday === undefined) continue;
    const before = t.slice(Math.max(0, start - 24), start);
    const after = t.slice(end, end + 26);
    const pastMark = /^\s*(pasado|pasada|passada)\b/.exec(after) ?? /\blast\s*$/.exec(before);
    const nextMark =
      /^\s*que\s+viene\b/.exec(after) ?? /\b(next|proximo|proxima)\s*$/.exec(before);
    if (pastMark || nextMark) {
      const mark = pastMark ?? nextMark;
      const markLen = mark && after.startsWith(mark[0]) ? mark[0].length : 0;
      push({
        day: shiftWeekday(ref, weekday, pastMark ? "past" : "next"),
        weekday,
        hasYear: false,
        kind: "relativa",
        text: t.slice(start, end + markLen).trim(),
        start,
        end: end + markLen,
      });
      continue;
    }
    // Pegado a una absoluta ya parseada («el martes 10 de noviembre»,
    // «on Tuesday, November 10»): solo relleno entre ambos.
    const host = out
      .filter((m) => m.kind === "calendario" && m.start >= end)
      .sort((a, b) => a.start - b.start)[0];
    if (host && /^[\s,]*((el|la|los|las|on|de|del|o|a|dia)\s+)*$/.test(t.slice(end, host.start))) {
      if (host.weekday === null) host.weekday = weekday;
      continue;
    }
    // Día suelto dentro de gramática («na segunda, dia 10»,
    // «segunda-feira 10», «Tuesday the 10th»): mención de emparejamiento.
    const domMatch = /^\s*,?\s*(the\s+|dia\s+)?(\d{1,2})(?:st|nd|rd|th)?(?![\d])/.exec(after);
    if (domMatch) {
      const dom = parseInt(domMatch[2], 10);
      const numStart = end + domMatch[0].indexOf(domMatch[2]);
      if (dom >= 1 && dom <= 31 && !overlaps(numStart, numStart + domMatch[2].length)) {
        push({
          day: null,
          weekday,
          hasYear: false,
          kind: "calendario",
          text: t.slice(start, numStart + domMatch[2].length).trim(),
          dom,
          start,
          end: numStart + domMatch[2].length,
        });
        continue;
      }
    }
    // Sin ancla: decorativo. No crea mención (regla declarada).
  }

  // — Pasada C: relativas de día (formas largas primero) —
  const relPatterns: Array<{ re: RegExp; offset: number }> = [
    { re: new RegExp(`${BOUND_L}the day before yesterday${BOUND_R}`, "g"), offset: -2 },
    { re: new RegExp(`${BOUND_L}the day after tomorrow${BOUND_R}`, "g"), offset: 2 },
    { re: new RegExp(`${BOUND_L}pasado manana${BOUND_R}`, "g"), offset: 2 },
    { re: new RegExp(`${BOUND_L}depois de amanha${BOUND_R}`, "g"), offset: 2 },
    { re: new RegExp(`${BOUND_L}(anteayer|anteontem)${BOUND_R}`, "g"), offset: -2 },
    { re: new RegExp(`${BOUND_L}(ayer|ontem|yesterday)${BOUND_R}`, "g"), offset: -1 },
    { re: new RegExp(`${BOUND_L}(hoy|hoje|today)${BOUND_R}`, "g"), offset: 0 },
    { re: new RegExp(`${BOUND_L}(manana|amanha|tomorrow)${BOUND_R}`, "g"), offset: 1 },
  ];
  for (const { re, offset } of relPatterns) {
    for (const match of t.matchAll(re)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      const day = addDays(ref, offset);
      push({
        day,
        weekday: weekdayOf(day.y, day.m, day.d),
        hasYear: false,
        kind: "relativa",
        text: match[0],
        start,
        end,
      });
    }
  }

  return out
    .sort((a, b) => a.start - b.start)
    .map(({ start: _s, end: _e, ...mention }) => mention);
}

// ------------------------------------------------------------------
// El juicio (R1–R5), compartido por las dos superficies: la pierna de
// grounding.ts (retira la frase) y la caja de sourceCheck.ts (enseña
// la frase de la fuente). Una sola implementación, dos desenlaces.

export interface SourceDateSentence {
  text: string;
  mentions: DateMention[];
}

/** Parsea las frases de la fuente una sola vez para juzgar contra ellas. */
export function parseSourceDateSentences(
  sentences: readonly string[],
  referenceDate: Date,
): SourceDateSentence[] {
  return sentences.map((text) => ({ text, mentions: parseDateMentions(text, referenceDate) }));
}

export type DateConflictKind = "interna" | "dia" | "relativa";

export interface DateConflictInfo {
  kind: DateConflictKind;
  /** La frase de la fuente emparejada, cuando la hay (la caja la enseña). */
  sourceSentence: string | null;
}

const domOf = (m: DateMention): number | null => m.day?.d ?? m.dom ?? null;
const monOf = (m: DateMention): number | null => m.day?.m ?? m.month ?? null;

/** R2: comparten día y no se contradicen en mes (el mes ausente empareja por día). */
function paired(a: DateMention, s: DateMention): boolean {
  const da = domOf(a);
  return da !== null && da === domOf(s) && (monOf(a) === null || monOf(s) === null || monOf(a) === monOf(s));
}

// Palabras que nunca son «tema» para R5(b): las de las propias fechas
// y las de función más comunes. La raíz se aproxima como la casa
// (sin sufijo plural, prefijo comparado).
const NOT_TOPIC = new Set([
  ...Object.keys(WEEKDAYS),
  ...Object.keys(MONTHS),
  "ayer", "anteayer", "hoy", "manana", "pasado", "yesterday", "today", "tomorrow",
  "ontem", "anteontem", "hoje", "amanha", "depois", "last", "next", "que", "viene",
  "para", "con", "sin", "los", "las", "una", "uno", "del", "por", "the", "and",
  "fue", "son", "esta", "that", "this", "with", "from",
]);

function topicRoots(sentence: string): Set<string> {
  const roots = new Set<string>();
  for (const raw of fold(sentence).split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || NOT_TOPIC.has(raw) || /^\d+$/.test(raw)) continue;
    roots.add(raw.replace(/(es|s)$/, "").slice(0, 6));
  }
  return roots;
}

function sharesTopicRoot(a: string, b: string): boolean {
  const rb = topicRoots(b);
  for (const r of topicRoots(a)) if (rb.has(r)) return true;
  return false;
}

/**
 * Juzga UNA frase de la respuesta contra las menciones de la fuente.
 * Devuelve el primer conflicto (orden R1 → R4 → R5) o null. Las
 * afirmaciones con cláusula de fecha solo viven o mueren por esta
 * pierna: ni la tolerancia ±1 de las cifras ni el apoyo léxico las
 * salvan ni las condenan aquí.
 */
export function dateConflictForSentence(
  answerSentence: string,
  sources: readonly SourceDateSentence[],
  referenceDate: Date,
): DateConflictInfo | null {
  const ans = parseDateMentions(answerSentence, referenceDate);
  if (ans.length === 0) return null;
  const srcAll = sources.flatMap((s) => s.mentions.map((m) => ({ m, sentence: s.text })));
  const refY = referenceDate.getFullYear();

  // R1 · Consistencia interna (con la guarda de ambigüedad de R3).
  for (const a of ans) {
    if (a.kind !== "calendario" || a.weekday === null) continue;
    const d = domOf(a);
    const mo = monOf(a);
    if (d === null || mo === null) continue;
    let year: number | null = null;
    let guarded = false;
    if (a.day) {
      year = a.day.y;
    } else {
      const withYear = srcAll.find(({ m }) => m.hasYear && m.day && paired(a, m));
      if (withYear?.m.day) year = withYear.m.day.y;
      else {
        year = refY;
        guarded = true;
      }
    }
    if (year === null) continue;
    const wd = weekdayOf(year, mo, d);
    if (wd === null) continue; // la fecha no existe en ese año: no se fija, no se acusa
    if (wd !== a.weekday) {
      if (guarded && [year - 1, year + 1].some((yy) => weekdayOf(yy, mo, d) === a.weekday)) {
        continue; // R3: pasaría con ±1 año — ambiguo, no se juzga
      }
      const p = srcAll.find(({ m }) => paired(a, m));
      return { kind: "interna", sourceSentence: p?.sentence ?? null };
    }
  }

  // R4 · Día contra día en menciones emparejadas.
  for (const a of ans) {
    if (a.weekday === null) continue;
    for (const { m: s, sentence } of srcAll) {
      if (s.weekday === null) continue;
      if (paired(a, s) && s.weekday !== a.weekday) return { kind: "dia", sourceSentence: sentence };
    }
  }

  // R5 · Relativa contra absoluta (emparejamiento conservador).
  const absSrc = srcAll.filter(({ m }) => m.kind === "calendario" && domOf(m) !== null);
  for (const a of ans) {
    if (a.kind !== "relativa" || !a.day) continue;
    let candidates = absSrc;
    if (absSrc.length !== 1) {
      const topic = absSrc.filter(({ sentence }) => sharesTopicRoot(answerSentence, sentence));
      const distinct = new Set(topic.map(({ m }) => `${domOf(m)}-${monOf(m)}-${m.day?.y ?? ""}`));
      candidates = topic.length > 0 && distinct.size === 1 ? topic : [];
    }
    for (const { m: s, sentence } of candidates) {
      const differs = s.day
        ? s.day.y !== a.day.y || s.day.m !== a.day.m || s.day.d !== a.day.d
        : monOf(s) !== a.day.m || domOf(s) !== a.day.d;
      if (differs) return { kind: "relativa", sourceSentence: sentence };
    }
  }

  return null;
}
