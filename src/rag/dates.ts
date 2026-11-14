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
 *  - T-J5: la forma numérica «d/m[/aaaa]» no declara su convención
 *    («10/11» es el 10 de noviembre o el 11 de octubre). La mención
 *    guarda sus lecturas y solo se fija cuando una lectura es
 *    imposible (un componente > 12) o el contexto la decide (R6).
 *    Sin año exige ancla de fecha delante («el 10/11»): un «a/b»
 *    suelto es una fracción o una razón. Y en la zona ambigua con
 *    forma de fracción de cocina (la gramática de T-J4), sin año
 *    manda la fracción: «el 1/2» no crea mención de fecha.
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
 *  - R6 · Numérica (T-J5): un par en el que alguna mención es
 *    numérica se juzga por candidatos: si alguna lectura de la
 *    respuesta ES la fecha de la fuente, no se acusa; si ninguna lo
 *    es y comparten un componente (o los dos cruzados: la
 *    transposición), hay conflicto. Las lecturas se fijan por
 *    imposibilidad, por la convención que cualquier numérica
 *    inequívoca del turno declara, o por una gemela con nombre del
 *    mismo lado — que desde ADV-J-C2 declara además la convención
 *    del turno por esa misma vía: antes fijaba solo su lado y la
 *    respuesta conservaba la lectura coincidente que la absolvía.
 *    Lo que ninguna vía fija queda ambiguo y no se fuerza: la
 *    transposición pelada «11/10» contra «10/11», sin más contexto,
 *    trae las mismas dos lecturas en los dos lados.
 *  - R7 · El año contradicho (ADV-J-C3): día y mes de acuerdo y los
 *    dos años escritos y distintos → conflicto, en forma numérica
 *    y con nombre. R3 sigue mandando sobre el año ausente: un lado
 *    sin año no se acusa por esta regla.
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
  /**
   * T-J5: los componentes crudos de una mención numérica «a/b[/aaaa]»
   * tal como se escribieron, sin convención aplicada; `year` es el
   * año escrito (las formas de 2 dígitos ya van expandidas) o null.
   */
  num?: { a: number; b: number; year: number | null };
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

  // — Pasada A2: absolutas numéricas «a/b[/aaaa]» (T-J5) —
  // La forma numérica no declara su convención: la mención guarda
  // los componentes crudos (num) y solo fija dom/mes cuando una
  // lectura es imposible. Sin año exige ancla de fecha delante
  // («el 10/11», «on 10/11»): un «a/b» suelto es una fracción o una
  // razón, no una fecha. Y en la zona ambigua con forma de fracción
  // de cocina (denominadores de la gramática de T-J4, duplicados
  // aquí como se duplican las tablas entre capas), sin año manda
  // la fracción: «el 1/2» no crea mención.
  const FRACTION_DENOMINATORS = new Set([2, 3, 4, 5, 6, 8, 10, 12, 16]);
  const NUM_ANCHOR_RE = /(?:^|\s)(el|del|la|on|dia|de)\s$/;
  const numRe = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  for (const match of t.matchAll(numRe)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    const a = parseInt(match[1], 10);
    const b = parseInt(match[2], 10);
    if (a === 0 || b === 0 || a > 31 || b > 31) continue;
    if (a > 12 && b > 12) continue; // ninguna de las dos lecturas es una fecha
    let year: number | null = null;
    if (match[3]) {
      const y = parseInt(match[3], 10);
      year = match[3].length === 2 ? 2000 + y : y;
    }
    if (year === null) {
      if (a <= 12 && b <= 12 && a < b && FRACTION_DENOMINATORS.has(b)) continue; // forma de fracción
      if (!NUM_ANCHOR_RE.test(t.slice(Math.max(0, start - 7), start))) continue;
    }
    let dom: number | undefined;
    let month: number | undefined;
    if (a > 12) {
      dom = a;
      month = b;
    } else if (b > 12) {
      dom = b;
      month = a;
    }
    push({
      day: year !== null && dom !== undefined && month !== undefined ? validDay(year, month, dom) : null,
      weekday: null,
      hasYear: year !== null,
      kind: "calendario",
      text: match[0],
      dom,
      month,
      num: { a, b, year },
      start,
      end,
    });
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
    // C2-H5 (barrido 0.1.96): «de la mañana», «por la mañana», «en la
    // mañana» son el SUSTANTIVO (la parte del día), no el adverbio
    // «mañana» (+1). Leídos como fecha relativa, chocaban por R5 con la
    // fecha de calendario de la misma frase y la cita fiel se retiraba
    // («Su cita es el martes 10 de noviembre … a las 9:30 de la
    // mañana»). El adverbio nunca lleva determinante delante. El
    // portugués no tiene el choque («manhã» ≠ «amanhã»), ni el inglés.
    { re: new RegExp(`(?<!(?<![a-z])(?:la|las)\\s)${BOUND_L}(manana|amanha|tomorrow)${BOUND_R}`, "g"), offset: 1 },
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

export type DateConflictKind = "interna" | "dia" | "relativa" | "numerica" | "anio" | "nombrada";

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

/**
 * El tramo de frase de cada mención: del final de la mención anterior
 * hasta el final de la suya (el evento suele ir delante de su fecha:
 * «la vacuna es el 12 de diciembre y la revisión el 3 de enero»). Si
 * algún tramo no trae tema propio («El 12 de diciembre es la vacuna
 * y…», con el evento detrás), o una mención no se localiza, null: el
 * llamador usa la frase entera.
 */
function dateSegments(sentence: string, mentions: readonly DateMention[]): string[] | null {
  if (mentions.length < 2) return null;
  const t = fold(sentence);
  const out: string[] = [];
  let cursor = 0;
  for (const m of mentions) {
    const at = t.indexOf(m.text, cursor);
    if (at < 0) return null;
    const end = at + m.text.length;
    const seg = t.slice(cursor, end);
    if (topicRoots(seg).size === 0) return null;
    out.push(seg);
    cursor = end;
  }
  return out;
}

function sharesTopicRoot(a: string, b: string): boolean {
  const rb = topicRoots(b);
  for (const r of topicRoots(a)) if (rb.has(r)) return true;
  return false;
}

/**
 * Juzga UNA frase de la respuesta contra las menciones de la fuente.
 * Devuelve el primer conflicto (orden R1 → R4 → R6 → R7 → R5 → R8) o null. Las
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

  // R6 · Numérica contra su pareja (T-J5). Los candidatos de una
  // mención — la fecha que puede ser — : la de nombre fija la suya;
  // la numérica ambigua trae las dos lecturas hasta que el contexto
  // la fija.
  type DayCand = { d: number; m: number; y: number | null };
  const rawCands = (mm: DateMention): DayCand[] => {
    if (mm.num) {
      const { a, b, year } = mm.num;
      if (a > 12) return [{ d: a, m: b, y: year }];
      if (b > 12) return [{ d: b, m: a, y: year }];
      return [
        { d: a, m: b, y: year },
        { d: b, m: a, y: year },
      ];
    }
    const d = domOf(mm);
    const mo = monOf(mm);
    if (d === null || mo === null) return [];
    return [{ d, m: mo, y: mm.day?.y ?? null }];
  };
  // La convención del turno: cualquier numérica con una lectura
  // imposible la declara para todas (un «25/12» en la fuente decide
  // que el documento escribe d/m). Decisores contradictorios la
  // dejan sin declarar.
  let convention: "dm" | "md" | null = null;
  {
    let dm = false;
    let md = false;
    for (const mm of [...ans, ...srcAll.map((x) => x.m)]) {
      if (!mm.num) continue;
      if (mm.num.a > 12) dm = true;
      if (mm.num.b > 12) md = true;
    }
    // ADV-J-C2: la gemela con nombre declara la convención del
    // turno por la misma vía. Una numérica ambigua con una gemela
    // con nombre EN SU MISMO LADO cuya fecha es una de sus dos
    // lecturas fija el orden (la primera componente es el día, o
    // el mes); la numérica simétrica («10/10») no declara nada.
    // Antes la gemela solo fijaba las menciones de su propio lado
    // (fixedCands) y la respuesta conservaba la lectura
    // coincidente que la absolvía siempre: «11/10» contra «10/11»
    // + «10 de noviembre» sellaba en el juez y la caja callaba.
    // Los decisores contradictorios — de cualquier vía — la dejan
    // sin declarar, la doctrina de arriba.
    const sides: ReadonlyArray<readonly DateMention[]> = [ans, srcAll.map((x) => x.m)];
    for (const side of sides) {
      for (const mm of side) {
        if (!mm.num || mm.num.a === mm.num.b) continue;
        const { a, b } = mm.num;
        for (const named of side) {
          if (named.num) continue;
          const nd = domOf(named);
          const nm = monOf(named);
          if (nd === null || nm === null) continue;
          if (a === nd && b === nm) dm = true;
          if (a === nm && b === nd) md = true;
        }
      }
    }
    if (dm !== md) convention = dm ? "dm" : "md";
  }
  const fixedCands = (mm: DateMention, side: readonly DateMention[]): DayCand[] => {
    const cands = rawCands(mm);
    if (cands.length < 2 || !mm.num) return cands;
    if (convention) {
      const want =
        convention === "dm" ? { d: mm.num.a, m: mm.num.b } : { d: mm.num.b, m: mm.num.a };
      return cands.filter((c) => c.d === want.d && c.m === want.m);
    }
    // Una gemela con nombre del mismo lado fija la lectura que
    // coincide con ella.
    for (const named of side) {
      if (named.num) continue;
      const nd = domOf(named);
      const nm = monOf(named);
      if (nd === null || nm === null) continue;
      const hit = cands.filter((c) => c.d === nd && c.m === nm);
      if (hit.length > 0) return hit;
    }
    return cands;
  };
  const srcMentions = srcAll.map((x) => x.m);
  for (const a of ans) {
    const ca = fixedCands(a, ans);
    if (ca.length === 0) continue;
    for (const { m: s, sentence } of srcAll) {
      if (!a.num && !s.num) continue; // R6 solo juzga pares con una numérica
      const cs = fixedCands(s, srcMentions);
      if (cs.length === 0) continue;
      const compat = (x: DayCand, y: DayCand): boolean => x.y === null || y.y === null || x.y === y.y;
      const agree = ca.some((x) => cs.some((y) => compat(x, y) && x.d === y.d && x.m === y.m));
      if (agree) continue;
      const share = ca.some((x) =>
        cs.some(
          (y) =>
            compat(x, y) &&
            (x.d === y.d || x.m === y.m || (x.d === y.m && x.m === y.d && x.d !== x.m)),
        ),
      );
      if (share) return { kind: "numerica", sourceSentence: sentence };
    }
  }

  // R7 · El año contradicho (ADV-J-C3). Día y mes de acuerdo bajo
  // las lecturas fijadas y los dos años ESCRITOS y distintos: no
  // hay ambigüedad que proteger — R3 cubre el año AUSENTE (se toma
  // prestado), no el año que un lado escribe contra el otro. R6
  // saltaba el par numérico por su puerta de compatibilidad (lo
  // que no empareja en año no se acusaba) y el par con nombre ni
  // entraba en R6: la caja no enseñaba el conflicto en ninguna de
  // las dos formas, aunque el verificador retirara la frase por
  // otras piernas. Si alguna mención de la fuente trae la fecha
  // ENTERA de la respuesta (día, mes y año), no se acusa: la
  // respuesta puede estar citando esa.
  for (const a of ans) {
    if (a.kind !== "calendario") continue;
    const ca = fixedCands(a, ans).map((c) => ({ ...c, y: a.num || a.hasYear ? c.y : null }));
    if (!ca.some((x) => x.y !== null)) continue;
    let clashSentence: string | null = null;
    let absolved = false;
    for (const { m: s, sentence } of srcAll) {
      if (s.kind !== "calendario") continue;
      const cs = fixedCands(s, srcMentions).map((c) => ({ ...c, y: s.num || s.hasYear ? c.y : null }));
      if (ca.some((x) => cs.some((y) => x.d === y.d && x.m === y.m && x.y !== null && x.y === y.y))) {
        absolved = true;
      } else if (
        clashSentence === null &&
        ca.some((x) => cs.some((y) => x.d === y.d && x.m === y.m && x.y !== null && y.y !== null && x.y !== y.y))
      ) {
        clashSentence = sentence;
      }
    }
    if (!absolved && clashSentence !== null) return { kind: "anio", sourceSentence: clashSentence };
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

  // R8 · Nombrada contra nombrada, emparejada por tema (CL-7 de la
  // caza 0.1.97). Ninguna regla de arriba comparaba la fecha con
  // nombre de la respuesta contra la de la fuente: R1/R4 exigen día
  // de semana, R6 una numérica, R7 el mismo día y mes con el año
  // cambiado. Desplazar el día o el mes («revisada el 10 de marzo»
  // → «el 10 de abril»; «April 14» → «April 24») no rompía ningún
  // emparejamiento y pasaba siempre. Aquí la fecha de la respuesta
  // se empareja por EVENTO (las frases fuente que comparten una
  // raíz de tema con ella, la vía que R5 ya usa para las
  // relativas): si esas frases afirman una sola fecha distinta, la
  // de la respuesta la contradice. Conservadora como R5: sin tema
  // compartido no se juzga; con varias fechas emparejadas tampoco;
  // y si una mención de la fuente trae la fecha exacta de la
  // respuesta EN SU MISMO EVENTO, no se acusa (puede estar citando
  // esa otra).
  //
  // Auditoría de la 0.1.97 (fecha con el evento cambiado, la gemela
  // de C2-H2 en fechas): esa guarda valía para CUALQUIER mención, así
  // que la fecha de OTRO evento de la fuente pasaba sellada —
  // «La revisión es el 12 de diciembre» ante «La vacuna es el 12 de
  // diciembre. La revisión es el 3 de enero» salía grounded con
  // origen source, en es/en/pt. Ahora la fecha exacta solo absuelve
  // si su evento comparte tema con la respuesta; y el evento de cada
  // mención es su TRAMO de frase (dateSegments: de la mención
  // anterior hasta ella), para que una frase con dos eventos («la
  // vacuna el 12 de diciembre y la revisión el 3 de enero») no
  // preste a una el tema de la otra. Sin tramos fiables, el tramo es
  // la frase entera, como antes.
  const srcSeg = sources.flatMap((s) => {
    const segs = dateSegments(s.text, s.mentions);
    return s.mentions.map((m, i) => ({ m, sentence: s.text, segment: segs ? segs[i] : s.text }));
  });
  for (const a of ans) {
    if (a.kind !== "calendario" || a.num) continue;
    const ad = domOf(a);
    const am = monOf(a);
    if (ad === null || am === null) continue;
    if (srcSeg.some(({ m, segment }) => domOf(m) === ad && monOf(m) === am && sharesTopicRoot(answerSentence, segment))) continue;
    const pairedDates = new Map<string, { d: number; m: number; sentence: string }>();
    for (const { m, sentence, segment } of srcSeg) {
      if (m.kind !== "calendario" || m.num) continue;
      const sd = domOf(m);
      const sm = monOf(m);
      if (sd === null || sm === null) continue;
      if (!sharesTopicRoot(answerSentence, segment)) continue;
      pairedDates.set(`${sd}-${sm}`, { d: sd, m: sm, sentence });
    }
    if (pairedDates.size !== 1) continue;
    const only = [...pairedDates.values()][0]!;
    if (only.d !== ad || only.m !== am) return { kind: "nombrada", sourceSentence: only.sentence };
  }

  return null;
}
