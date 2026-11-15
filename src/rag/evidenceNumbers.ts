/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Post-chequeo de cifras (programa «Lo mejor de la bounty», tanda 1).
 *
 * Adaptado de la lógica de `citations.rs` de Commonplace (0xPD33,
 * Apache-2.0, ver ATTRIBUTION.md): una frase cuyas cifras no están en
 * la evidencia no está respaldada, aunque sus palabras sí lo estén.
 * grounding.ts ya quita la frase cuyas PALABRAS no salen de las
 * fuentes, pero una cifra equivocada («fundada en 1904» por «1804»)
 * solo contaba como una palabra nueva más y la frase pasaba. Y la
 * ruta de lengua cruzada comparaba las cifras por igualdad exacta de
 * dígitos, lo que quitaba frases verdaderas: «16,4 millones» nunca es
 * igual dígito a dígito a «16,431,599».
 *
 * Reglas (las de Commonplace, con el parseo de las tres lenguas):
 *  - Una cifra afirmada vale si ES una cifra de la evidencia o un
 *    redondeo suyo a la precisión con que se afirma: «27» vale por
 *    26,52 y «26,5» también.
 *  - Con decimales, vale también el redondeo a escala: «16,4»
 *    (millones) vale por 16.431.599. Miles y mayores SOLO con
 *    decimales: «12» no es un redondeo de 12.345.
 *  - El parseo acepta las convenciones de es/en/pt: coma decimal
 *    («26,5»), punto decimal («26.5») y separador de miles («1.234»,
 *    «1,234», «16.431.599»). Un token ambiguo («1.234» puede ser mil
 *    doscientos treinta y cuatro o uno coma dos tres cuatro) aporta
 *    sus dos lecturas: la ambigüedad es de notación, no de la frase.
 *  - Los enteros de un solo dígito no se juzgan (numeración de
 *    listas, «capítulo 3», «1» suelto): demasiado ruido, y la vía
 *    léxica ya juzga el resto de la frase.
 *  - T-J3 (barrido «revisa todo», J3): los números EN LETRA con los
 *    portillos de la caja (sourceCheck, C-08) — la frecuencia diaria
 *    («cinco veces al día») y la unidad de dosis pegada («cinco
 *    comprimidos») — también son cifras de la evidencia y de la
 *    respuesta. Sin esto, el juez sellaba «cinco veces al día»
 *    contra «dos veces al día» mientras la caja marcaba el
 *    conflicto: la dosis y la frecuencia dictadas en letra son
 *    habla natural. Fuera de los portillos («dos personas») la
 *    letra no se juzga, como en la caja. Las tablas viven aquí
 *    desde esta tanda y la caja las importa: una sola fuente para
 *    las dos superficies.
 *  - T-J4 (barrido «revisa todo», J4): las FRACCIONES de cocina
 *    («1/4 taza») son cifras con valor n/d. La gramática es
 *    estrecha a propósito: denominador de la tabla cerrada de
 *    cocina (2, 3, 4, 5, 6, 8, 10, 12, 16) y numerador menor —
 *    fuera de ahí, un «a/b» es una fecha d/m o una razón y sus
 *    partes vuelven a ser tokens sueltos, como siempre. Una
 *    fracción siempre se juzga: es el dato entero, no un dígito
 *    suelto.
 *
 * Puro, sin dependencias, 100% testeable.
 */

/**
 * El valor de un token «a/b» como fracción de cocina, o null si no
 * lo es (T-J4): denominador de la tabla cerrada y numerador menor
 * que el denominador. «10/11» no es una fracción (11 no está en la
 * tabla): es una fecha o una razón, y no se funde en un valor.
 */
const FRACTION_DENOMINATORS = new Set([2, 3, 4, 5, 6, 8, 10, 12, 16]);

export function fractionValue(token: string): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  const d = Number(m[2]);
  if (!FRACTION_DENOMINATORS.has(d) || n >= d) return null;
  return n / d;
}

/** Cifras candidatas de un texto, como tokens crudos («16.431.599», «26,5», «1/4»). */
export function numberTokens(text: string): string[] {
  const noCites = text.replace(/\[\d+\]/g, " ");
  const out: string[] = [];
  for (const m of noCites.matchAll(/\d+\/\d+(?![\d/])|\d[\d.,]*\d|\d/g)) {
    const tok = m[0];
    if (tok.includes("/") && fractionValue(tok) === null) {
      // No es fracción de cocina (una fecha d/m, una razón): sus
      // partes vuelven a ser tokens sueltos, como hasta hoy.
      out.push(...(tok.match(/\d+/g) ?? []));
    } else {
      out.push(tok);
    }
  }
  return out;
}

/**
 * Las lecturas plausibles de un token: casi siempre una; dos cuando la
 * notación es ambigua entre decimal y miles en alguna de las lenguas.
 */
export function parseNumberToken(token: string): number[] {
  if (token.includes("/")) {
    const f = fractionValue(token);
    return f === null ? [] : [f];
  }
  const t = token.replace(/[.,]+$/, "");
  if (!/^\d[\d.,]*$/.test(t)) return [];
  const dots = (t.match(/\./g) ?? []).length;
  const commas = (t.match(/,/g) ?? []).length;
  if (dots === 0 && commas === 0) return [Number(t)];

  if (dots > 0 && commas > 0) {
    // La última separación es el decimal; la otra, miles.
    const lastDot = t.lastIndexOf(".");
    const lastComma = t.lastIndexOf(",");
    const decAt = Math.max(lastDot, lastComma);
    const intPart = t.slice(0, decAt).replace(/[.,]/g, "");
    const fracPart = t.slice(decAt + 1);
    return [Number(`${intPart}.${fracPart}`)];
  }

  const sep = dots > 0 ? "." : ",";
  const count = dots > 0 ? dots : commas;
  if (count > 1) {
    // Separador repetido: solo puede ser de miles («16.431.599»).
    return [Number(t.replace(/[.,]/g, ""))];
  }
  const [intPart, fracPart] = t.split(sep);
  const decimal = Number(`${intPart}.${fracPart}`);
  // «1.234» / «1,234»: ¿miles o decimal con tres cifras? Las dos.
  if (fracPart.length === 3 && intPart.length <= 3) {
    return [decimal, Number(`${intPart}${fracPart}`)];
  }
  return [decimal];
}

/**
 * Las lecturas de un token con los decimales que cada una afirma
 * (la pareja que la comparación de cifras necesita: el valor solo
 * no dice si «16,4» promete un decimal o ninguno).
 */
export function tokenReadings(token: string): Array<{ value: number; decimals: number }> {
  return parseNumberToken(token).map((value) => ({ value, decimals: decimalsOf(token, value) }));
}

/** Decimales con los que una lectura afirma su valor («26,5» → 1; la lectura de miles → 0). */
function decimalsOf(token: string, value: number): number {
  // T-J4: una fracción afirma su valor con 2 decimales de vara
  // («1/3» vale por «0,33» y no por «0» ni por «1»).
  if (token.includes("/")) return 2;
  const t = token.replace(/[.,]+$/, "");
  const dots = (t.match(/\./g) ?? []).length;
  const commas = (t.match(/,/g) ?? []).length;
  if (dots === 0 && commas === 0) return 0;
  if (dots > 0 && commas > 0) {
    const decAt = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
    return t.length - decAt - 1;
  }
  const sep = dots > 0 ? "." : ",";
  if ((dots > 0 ? dots : commas) > 1) return 0;
  const frac = t.split(sep)[1] ?? "";
  // Token ambiguo («1.234»): la lectura de miles afirma un entero y la
  // decimal conserva sus tres decimales; se distinguen por el valor.
  if (frac.length === 3 && value === Number(t.replace(/[.,]/g, ""))) return 0;
  return frac.length;
}

/** ¿Es `value`, afirmado con `decimals` decimales, un redondeo de alguna cifra de la evidencia? */
export function roundsFromEvidence(value: number, decimals: number, evidence: ReadonlySet<number>): boolean {
  const tol = 0.5 * Math.pow(10, -decimals) + 1e-9;
  for (const e of evidence) {
    if (Math.abs(e - value) <= tol) return true;
    if (decimals > 0) {
      for (const scale of [1e3, 1e6, 1e9, 1e12]) {
        if (Math.abs(e / scale - value) <= tol) return true;
      }
    }
  }
  return false;
}

/** Todos los valores que la evidencia afirma, con todas sus lecturas plausibles. */
export function evidenceNumberValues(texts: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const text of texts) {
    for (const token of numberTokens(text)) {
      for (const v of parseNumberToken(token)) out.add(v);
    }
    // T-J3: también los valores en letra tras sus portillos.
    for (const r of sentenceWordReadings(text)) out.add(r.value);
  }
  return out;
}

// ------------------------------------------------- números en letra

/**
 * Números en letra, con portillo estrecho (C-08, heredado de la
 * caja): tabla cerrada de las tres lenguas (las claves van
 * plegadas, como todo lo que se compara contra la frase plegada:
 * «três» llega como «tres») más media/medio/half/meia = 0,5. Solo
 * alimentan el juicio cuando la palabra siguiente es una unidad de
 * DOSIS (DOSE_UNIT_WORDS) o el marco de frecuencia diaria: «dos
 * personas» sigue sin juzgarse. Riesgo declarado (el de la caja):
 * «una» es artículo y dosis a la vez («compró una cucharada de
 * plata» formaría la lectura 1); el guarda de tema y la rareza lo
 * hacen aceptable.
 */
export const WORD_NUMBERS: Record<string, number> = {
  un: 1, una: 1, uno: 1, one: 1, um: 1, uma: 1,
  dos: 2, dois: 2, duas: 2, two: 2,
  tres: 3, three: 3,
  cuatro: 4, quatro: 4, four: 4,
  cinco: 5, five: 5,
  seis: 6, six: 6,
  siete: 7, sete: 7, seven: 7,
  ocho: 8, oito: 8, eight: 8,
  nueve: 9, nove: 9, nine: 9,
  diez: 10, dez: 10, ten: 10,
  once: 11, onze: 11, eleven: 11,
  doce: 12, doze: 12, twelve: 12,
  media: 0.5, medio: 0.5, half: 0.5, meia: 0.5,
};

/** Las unidades de dosis que un número en letra puede tocar (el portillo). */
export const DOSE_UNIT_WORDS = new Set([
  "cucharadita", "cucharaditas", "cucharada", "cucharadas",
  "teaspoon", "teaspoons", "tablespoon", "tablespoons",
  "colher", "colheres",
  "gota", "gotas", "drops",
  "comprimido", "comprimidos", "tableta", "tabletas",
  "pastilla", "pastillas", "tablet", "tablets", "pill", "pills",
]);

export const WORD_NUMBER_ALT = Object.keys(WORD_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join("|");

const WORD_FREQ_FRAME_RE = new RegExp(
  `\\b(${WORD_NUMBER_ALT})\\s+(veces|times|vezes)\\s+(al dia|por dia|a day|per day|ao dia)\\b`,
  "g",
);
const WORD_NUMBER_SCAN_RE = new RegExp(`\\b(${WORD_NUMBER_ALT})\\b`, "g");

const foldForWords = (s: string): string =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Las lecturas en letra de UNA frase, tras los dos portillos de la
 * caja: el marco de frecuencia diaria y la unidad de dosis pegada.
 * El valor va como se afirma (5 por «cinco», 0,5 con 1 decimal por
 * «media»): la comparación de siempre (redondeo y escala contra la
 * evidencia) hace el resto, y letra contra dígito se juzgan en el
 * mismo conjunto de valores — «12 comprimidos» vale por «doce
 * comprimidos» y al revés.
 */
export function sentenceWordReadings(sentence: string): Array<{ value: number; decimals: number }> {
  const folded = foldForWords(sentence).replace(/\[\d+\]/g, " ");
  const out: Array<{ value: number; decimals: number }> = [];
  const consumed: Array<readonly [number, number]> = [];
  const push = (raw: string, at: number, len: number): void => {
    const value = WORD_NUMBERS[raw];
    if (value === undefined) return;
    out.push({ value, decimals: Number.isInteger(value) ? 0 : 1 });
    consumed.push([at, at + len]);
  };
  // T-05 (m-08 de la auditoría): «once»/«twice» ingleses en su marco
  // diario. No pasan por WORD_NUMBERS: «once» ya es el once español
  // en esa tabla, y su valor inglés (1) solo vale dentro de este
  // marco cerrado («twice a day», «once daily»); fuera de él, nada.
  // Sin esta lectura, la evidencia «twice a day» no sostenía la
  // paráfrasis fiel «two times a day» y la frase caía en falso.
  const EN_ONCE_TWICE_RE = /\b(once|twice)\s+(?:a day|per day|daily)\b/g;
  for (const m of folded.matchAll(EN_ONCE_TWICE_RE)) {
    out.push({ value: m[1] === "twice" ? 2 : 1, decimals: 0 });
    consumed.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  for (const m of folded.matchAll(WORD_FREQ_FRAME_RE)) push(m[1], m.index ?? 0, m[0].length);
  for (const m of folded.matchAll(WORD_NUMBER_SCAN_RE)) {
    const at = m.index ?? 0;
    if (consumed.some(([a, b]) => at >= a && at < b)) continue;
    const next = folded
      .slice(at + m[0].length, at + m[0].length + 40)
      .split(/[^a-zñ]+/)
      .filter(Boolean)[0];
    if (next === undefined || !DOSE_UNIT_WORDS.has(next)) continue;
    push(m[1], at, m[0].length);
  }
  return out;
}

/** Un rango que la evidencia afirma («entre 37 y 40 °C», «10 a 14 días», «5–6 %»). */
/**
 * El valor de UN token en letra («cinco», «twenty», «duzentos») o
 * null si no es un número de una sola palabra (CL-9: la simetría
 * dígito↔letra del apoyo la consume token a token).
 */
export function wordNumberValue(token: string): number | null {
  const r = parseWordNumber([token], 0);
  return r && r.len === 1 ? r.value : null;
}

export interface EvidenceRange {
  min: number;
  max: number;
}

/**
 * Los rangos de la evidencia (C-08): «N a M», «N–M» y «entre N y M»
 * (unidores `a`, `to`, `até`, guiones, y `y/e/and` solo tras «entre»,
 * que es donde la prosa los usa como rango y no como enumeración).
 * Un valor dentro de un rango está tan afirmado como sus extremos:
 * antes de esto, la respuesta exacta de la guía («39 °C» contra
 * «entre 37 y 40 °C») moría por no ser ni 37 ni 40. Los extremos se
 * leen con la primera lectura del token, la misma para ambos: un
 * token ambiguo («1.234») no mezcla lecturas dentro del rango.
 */
export function evidenceRanges(texts: readonly string[]): EvidenceRange[] {
  const out: EvidenceRange[] = [];
  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*(?:[-–—]|\ba\b|\bto\b|\baté\b)\s*(\d+(?:[.,]\d+)?)/g,
    /\bentre\s+(\d+(?:[.,]\d+)?)\s+(?:y|e|and)\s+(\d+(?:[.,]\d+)?)/g,
  ];
  for (const text of texts) {
    const noCites = text.replace(/\[\d+\]/g, " ");
    for (const re of patterns) {
      for (const m of noCites.matchAll(re)) {
        const lo = parseNumberToken(m[1]);
        const hi = parseNumberToken(m[2]);
        if (lo.length === 0 || hi.length === 0) continue;
        const min = Math.min(lo[0], hi[0]);
        const max = Math.max(lo[0], hi[0]);
        if (max > min) out.push({ min, max });
      }
    }
  }
  return out;
}

/** ¿Cae `value`, a la precisión con que se afirma, dentro de algún rango de la evidencia? */
function withinEvidenceRanges(value: number, decimals: number, ranges: readonly EvidenceRange[]): boolean {
  const tol = 0.5 * Math.pow(10, -decimals) + 1e-9;
  return ranges.some((r) => value >= r.min - tol && value <= r.max + tol);
}

/** Una cifra se juzga si tiene 2+ dígitos o trae parte decimal (ver cabecera). */
export function isJudged(token: string): boolean {
  // T-J4: una fracción siempre se juzga — es el dato entero.
  if (token.includes("/")) return true;
  // m-07 de la auditoría, MEDIDO en la tanda T-05 (2026-11-14):
  // juzgar también el entero de un dígito suelto se probó contra
  // la caza completa y la suite entera. En la caza: ningún caso
  // del residuo voltea y ningún control fiel cae. En la suite:
  // corta respuestas fieles — la prosa con paso numerado («repite
  // el paso 3», barrido0196), el control de la fecha delante del
  // evento (auditoria0197) y la dosis sin unidad en la evidencia
  // (measuredDose). Por el freno del dueño (ninguna estrechez
  // puede cortar una fiel), la exención SE QUEDA como está.
  const digits = token.replace(/[.,]/g, "");
  return digits.length >= 2 || /[.,]\d/.test(token);
}

/**
 * ¿Salen de la evidencia TODAS las cifras juzgables de la frase?
 * Las citas [n] no son cifras de la frase (se retiran antes de mirar).
 * C-08: un valor dentro de un rango de la evidencia también está
 * sostenido (los rangos se pasan aparte; sin ellos, la red juzga como
 * siempre: por valores sueltos).
 */
export function sentenceNumbersSupported(
  sentence: string,
  evidence: ReadonlySet<number>,
  ranges: readonly EvidenceRange[] = [],
): boolean {
  // CL-9 (caza 0.1.97): la contención también al revés — un rango
  // de la RESPUESTA que contiene un valor de la evidencia sostiene
  // sus extremos («entre 45 y 55 minutos» sostiene el 50 de la
  // guía, no lo contradice). C-08 solo cubría valor-en-rango.
  const answerRanges = evidenceRanges([sentence]);
  const endpointOfContainingRange = (v: number): boolean =>
    answerRanges.some(
      (r) =>
        (Math.abs(v - r.min) <= 1e-9 || Math.abs(v - r.max) <= 1e-9) &&
        [...evidence].some((e) => e >= r.min - 1e-9 && e <= r.max + 1e-9),
    );
  for (const token of numberTokens(sentence)) {
    if (!isJudged(token)) continue;
    const readings = parseNumberToken(token);
    const ok = readings.some(
      (v) =>
        roundsFromEvidence(v, decimalsOf(token, v), evidence) ||
        withinEvidenceRanges(v, decimalsOf(token, v), ranges) ||
        endpointOfContainingRange(v),
    );
    if (!ok) return false;
  }
  // T-J3: las lecturas en letra tras sus portillos se juzgan contra
  // el mismo conjunto de valores (que ya trae las de la evidencia).
  for (const r of sentenceWordReadings(sentence)) {
    if (!roundsFromEvidence(r.value, r.decimals, evidence) && !withinEvidenceRanges(r.value, r.decimals, ranges)) {
      return false;
    }
  }
  return true;
}

// ------------------------------------------- cantidades con unidad (CL-4/CL-5)

/**
 * La capa de cantidades (CL-4 y CL-5 de la caza 0.1.97). La vara de
 * valores de arriba juzga la CIFRA suelta: «500» apoyaba igual en
 * «500 mg» que en «500 g», «38» en °C que en °F, «230» en voltios
 * que en vatios, y el número en letra fuera de los portillos de
 * dosis («doscientos voltios») ni se veía. Aquí toda expresión de
 * cantidad (dígitos o letra plena en es/en/pt) pegada a una unidad
 * se normaliza a (dimensión, valor canónico): la cifra sin su
 * unidad no apoya nada, y la unidad de otra dimensión — o la misma
 * con otro factor — es otra cantidad.
 */
export interface Quantity {
  dim: string;
  canon: number;
  raw: number;
  decimals: number;
  /** Derivada de la conversión (para escalar la tolerancia de redondeo). */
  tolF: number;
  /** CL-9: la cantidad es extremo de un rango («entre 45 y 55 minutos»). */
  ranged?: boolean;
}

const WN_SMALL: Record<string, number> = {
  cero: 0, zero: 0,
  un: 1, una: 1, uno: 1, um: 1, uma: 1, one: 1,
  // T-05 (m-08): «twice» vale 2 como número en letra pleno (la
  // simetría de apoyo de grounding lo necesita para casar «two»
  // con el «twice» de la guía); «once» NO entra: ya es el 11
  // español y su valor inglés solo vale en el marco cerrado de
  // sentenceWordReadings.
  dos: 2, dois: 2, duas: 2, two: 2, twice: 2,
  tres: 3, three: 3,
  cuatro: 4, quatro: 4, four: 4,
  cinco: 5, five: 5,
  seis: 6, six: 6,
  siete: 7, sete: 7, seven: 7,
  ocho: 8, oito: 8, eight: 8,
  nueve: 9, nove: 9, nine: 9,
  diez: 10, dez: 10, ten: 10,
  once: 11, onze: 11, eleven: 11,
  doce: 12, doze: 12, twelve: 12,
  trece: 13, treze: 13, thirteen: 13,
  catorce: 14, catorze: 14, fourteen: 14,
  quince: 15, fifteen: 15,
  dieciseis: 16, dezesseis: 16, sixteen: 16,
  diecisiete: 17, dezessete: 17, seventeen: 17,
  dieciocho: 18, dezoito: 18, eighteen: 18,
  diecinueve: 19, dezanove: 19, dezenove: 19, nineteen: 19,
};

const WN_TENS: Record<string, number> = {
  veinte: 20, vinte: 20, twenty: 20,
  veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  trinta: 30, treinta: 30, thirty: 30,
  cuarenta: 40, quarenta: 40, forty: 40,
  cincuenta: 50, cinquenta: 50, fifty: 50,
  sesenta: 60, sessenta: 60, sixty: 60,
  setenta: 70, seventy: 70,
  ochenta: 80, oitenta: 80, eighty: 80,
  noventa: 90, ninety: 90,
};

const WN_HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, cem: 100, cento: 100,
  doscientos: 200, doscientas: 200, duzentos: 200, duzentas: 200,
  trescientos: 300, trescientas: 300, trezentos: 300, trezentas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quatrocentos: 400, quatrocentas: 400,
  quinientos: 500, quinientas: 500, quinhentos: 500, quinhentas: 500,
  seiscientos: 600, seiscientas: 600, seiscentos: 600, seiscentas: 600,
  setecientos: 700, setecientas: 700, setecentos: 700, setecentas: 700,
  ochocientos: 800, ochocientas: 800, oitocentos: 800, oitocentas: 800,
  novecientos: 900, novecientas: 900, novecentos: 900, novecentas: 900,
};

const WN_CONNECTORS = new Set(["y", "e", "and"]);

/** El tramo < 1000 que empieza en `i` (centenas, decenas, unidades), o null. */
function parseUnder1000(tokens: readonly string[], i: number): { value: number; len: number } | null {
  let value = 0;
  let n = 0;
  const t0 = tokens[i];
  if (t0 !== undefined && WN_HUNDREDS[t0] !== undefined) {
    value += WN_HUNDREDS[t0]!;
    n++;
  } else if (t0 !== undefined && WN_SMALL[t0] !== undefined && tokens[i + 1] === "hundred") {
    value += WN_SMALL[t0]! * 100;
    n += 2;
  }
  let j = i + n;
  if (n > 0 && tokens[j] !== undefined && WN_CONNECTORS.has(tokens[j]!)) j++;
  const tt = tokens[j];
  if (tt !== undefined && WN_TENS[tt] !== undefined) {
    value += WN_TENS[tt]!;
    n = j - i + 1;
    j++;
    if (tokens[j] !== undefined && WN_CONNECTORS.has(tokens[j]!)) j++;
    const ts = tokens[j];
    if (ts !== undefined && WN_SMALL[ts] !== undefined && WN_SMALL[ts]! < 10) {
      value += WN_SMALL[ts]!;
      n = j - i + 1;
    }
  } else if (tt !== undefined && WN_SMALL[tt] !== undefined) {
    value += WN_SMALL[tt]!;
    n = j - i + 1;
  }
  return n > 0 ? { value, len: n } : null;
}

/** Un número en letra pleno (con miles) que empieza en `i`, o null. */
function parseWordNumber(tokens: readonly string[], i: number): { value: number; len: number } | null {
  let value = 0;
  let n = 0;
  const seg = parseUnder1000(tokens, i);
  const after = tokens[i + (seg?.len ?? 0)];
  if (seg && seg.value > 0 && (after === "mil" || after === "thousand")) {
    value += seg.value * 1000;
    n += seg.len + 1;
  } else if (tokens[i] === "mil" || tokens[i] === "thousand") {
    value += 1000;
    n += 1;
  }
  const rest = parseUnder1000(tokens, i + n);
  if (rest) {
    value += rest.value;
    n += rest.len;
  }
  return n > 0 ? { value, len: n } : null;
}

/** Unidades: palabra plegada (singular) → dimensión y factor a la canónica. */
const UNIT_TABLE: Record<string, { dim: string; f: number }> = {
  // masa → mg
  miligramo: { dim: "masa", f: 1 }, milligram: { dim: "masa", f: 1 }, miligrama: { dim: "masa", f: 1 }, mg: { dim: "masa", f: 1 },
  microgramo: { dim: "masa", f: 0.001 }, mcg: { dim: "masa", f: 0.001 },
  gramo: { dim: "masa", f: 1e3 }, gram: { dim: "masa", f: 1e3 }, grama: { dim: "masa", f: 1e3 }, g: { dim: "masa", f: 1e3 },
  kilogramo: { dim: "masa", f: 1e6 }, kilogram: { dim: "masa", f: 1e6 }, kilo: { dim: "masa", f: 1e6 }, kg: { dim: "masa", f: 1e6 },
  // volumen → ml
  mililitro: { dim: "volumen", f: 1 }, milliliter: { dim: "volumen", f: 1 }, ml: { dim: "volumen", f: 1 },
  centilitro: { dim: "volumen", f: 10 }, decilitro: { dim: "volumen", f: 100 },
  litro: { dim: "volumen", f: 1e3 }, liter: { dim: "volumen", f: 1e3 }, litre: { dim: "volumen", f: 1e3 }, l: { dim: "volumen", f: 1e3 },
  // tiempo → s
  segundo: { dim: "tiempo", f: 1 }, second: { dim: "tiempo", f: 1 }, seg: { dim: "tiempo", f: 1 },
  minuto: { dim: "tiempo", f: 60 }, minute: { dim: "tiempo", f: 60 }, min: { dim: "tiempo", f: 60 },
  hora: { dim: "tiempo", f: 3600 }, hour: { dim: "tiempo", f: 3600 }, h: { dim: "tiempo", f: 3600 },
  dia: { dim: "tiempo", f: 86400 }, day: { dim: "tiempo", f: 86400 },
  semana: { dim: "tiempo", f: 604800 }, week: { dim: "tiempo", f: 604800 },
  // T-05 (m-06 de la auditoría): mes y año SÍ son duraciones. Sin
  // ellos «dura 3 años» contra «3 meses» se sellaba: la cifra casaba
  // y la palabra no la comparaba ninguna pierna. Mes canónico de 30
  // días y año de 365, las cuentas de las guías.
  mes: { dim: "tiempo", f: 2592000 }, month: { dim: "tiempo", f: 2592000 },
  ano: { dim: "tiempo", f: 31536000 }, year: { dim: "tiempo", f: 31536000 },
  // electricidad (sin conversión entre dimensiones: ese es el punto)
  voltio: { dim: "voltaje", f: 1 }, volt: { dim: "voltaje", f: 1 }, v: { dim: "voltaje", f: 1 },
  vatio: { dim: "potencia", f: 1 }, watt: { dim: "potencia", f: 1 }, w: { dim: "potencia", f: 1 },
  amperio: { dim: "corriente", f: 1 }, ampere: { dim: "corriente", f: 1 }, amp: { dim: "corriente", f: 1 },
  // longitud → mm
  milimetro: { dim: "longitud", f: 1 }, millimeter: { dim: "longitud", f: 1 }, mm: { dim: "longitud", f: 1 },
  centimetro: { dim: "longitud", f: 10 }, centimeter: { dim: "longitud", f: 10 }, centimetre: { dim: "longitud", f: 10 }, cm: { dim: "longitud", f: 10 },
  metro: { dim: "longitud", f: 1e3 }, meter: { dim: "longitud", f: 1e3 }, metre: { dim: "longitud", f: 1e3 }, m: { dim: "longitud", f: 1e3 },
  kilometro: { dim: "longitud", f: 1e6 }, kilometer: { dim: "longitud", f: 1e6 }, kilometre: { dim: "longitud", f: 1e6 }, km: { dim: "longitud", f: 1e6 },
  pulgada: { dim: "longitud", f: 25.4 }, inch: { dim: "longitud", f: 25.4 },
  pie: { dim: "longitud", f: 304.8 }, foot: { dim: "longitud", f: 304.8 }, feet: { dim: "longitud", f: 304.8 }, ft: { dim: "longitud", f: 304.8 },
  milla: { dim: "longitud", f: 1609344 }, mile: { dim: "longitud", f: 1609344 },
  // presión → psi
  psi: { dim: "presion", f: 1 }, bar: { dim: "presion", f: 14.5038 }, kpa: { dim: "presion", f: 0.145038 },
  // dinero (dimensión por moneda; sin conversión entre monedas)
  euro: { dim: "dinero:eur", f: 1 }, eur: { dim: "dinero:eur", f: 1 },
  dolar: { dim: "dinero:usd", f: 1 }, dollar: { dim: "dinero:usd", f: 1 }, usd: { dim: "dinero:usd", f: 1 },
  peso: { dim: "dinero:peso", f: 1 },
  real: { dim: "dinero:brl", f: 1 }, reais: { dim: "dinero:brl", f: 1 },
  // porcentaje
  percent: { dim: "porcentaje", f: 1 }, porcentaje: { dim: "porcentaje", f: 1 }, porcento: { dim: "porcentaje", f: 1 },
};

const SINGLE_LETTER_UNITS = new Set(["g", "l", "v", "w", "m", "h"]);

interface UnitHit {
  dim: string;
  f: number;
  len: number;
  /** Conversión afín (temperatura) en vez de factor. */
  affine?: (v: number) => number;
}

function lookupUnit(tokens: readonly string[], i: number, fromDigit: boolean): UnitHit | null {
  const t = tokens[i];
  if (t === undefined) return null;
  // «38° f», «38 %»: símbolo suelto entre la cifra y su letra.
  if (t === "°") {
    const letter = tokens[i + 1];
    if (letter === "c") return { dim: "temperatura", f: 1, len: 2, affine: (v) => v };
    if (letter === "f") return { dim: "temperatura", f: 5 / 9, len: 2, affine: (v) => ((v - 32) * 5) / 9 };
    return null;
  }
  if (t === "%") return { dim: "porcentaje", f: 1, len: 1 };
  if (t === "€") return { dim: "dinero:eur", f: 1, len: 1 };
  if (t === "$") return { dim: "dinero:usd", f: 1, len: 1 };
  // Dos palabras: «por ciento», «por cento», «grados fahrenheit»…
  const t2 = tokens[i + 1];
  if ((t === "por" && (t2 === "ciento" || t2 === "cento")) || (t === "per" && t2 === "cent")) {
    return { dim: "porcentaje", f: 1, len: 2 };
  }
  if (t === "grados" || t === "degrees" || t === "graus") {
    if (t2 === "fahrenheit") return { dim: "temperatura", f: 5 / 9, len: 2, affine: (v) => ((v - 32) * 5) / 9 };
    if (t2 === "kelvin") return { dim: "temperatura", f: 1, len: 2, affine: (v) => v - 273.15 };
    // «grados» a secas: en las guías de la casa es la escala del
    // propio texto (°C en es/pt, la local en en); canónica °C.
    return { dim: "temperatura", f: 1, len: 1, affine: (v) => v };
  }
  if (t === "fahrenheit") return { dim: "temperatura", f: 5 / 9, len: 1, affine: (v) => ((v - 32) * 5) / 9 };
  if (t === "celsius" || t === "centigrado" || t === "centigrade") return { dim: "temperatura", f: 1, len: 1, affine: (v) => v };
  if (t === "kelvin") return { dim: "temperatura", f: 1, len: 1, affine: (v) => v - 273.15 };
  // T-05 (M-03b de la auditoría): el plural en -es también se prueba
  // («dólares»→«dólar», «reales»→«real», «meses»→«mes»): la búsqueda
  // vieja solo recortaba la «s» y esas formas — las corrientes de
  // escribir precios en es/pt — no parseaban como cantidad.
  const cand =
    UNIT_TABLE[t] ??
    (t.endsWith("s") ? UNIT_TABLE[t.slice(0, -1)] : undefined) ??
    (t.endsWith("es") ? UNIT_TABLE[t.slice(0, -2)] : undefined);
  if (!cand) return null;
  // Las unidades de una letra solo se pegan a cifras en dígitos
  // («30 g» sí; «cinco g» no es prosa real, y «m»/«h» sueltas en
  // letra serían otra palabra).
  if (t.length === 1 && !fromDigit) return null;
  if (SINGLE_LETTER_UNITS.has(t) && !fromDigit) return null;
  return { dim: cand.dim, f: cand.f, len: 1 };
}

/** Los tokens de un texto plegado: palabras, cifras con su decimal y los símbolos de unidad. */
function quantityTokens(text: string): string[] {
  const folded = foldForWords(text).replace(/\[\d+\]/g, " ");
  return folded.match(/[a-zñ]+|\d+(?:[.,]\d+)?|°|%|€|\$/g) ?? [];
}

/** Los periodos del marco de frecuencia (M-05), en días. */
const FREQ_PERIOD_DAYS: Record<string, number> = {
  dia: 1, day: 1, semana: 7, week: 7, mes: 30, month: 30,
};
const FREQ_COUNT_WORDS = new Set(["vez", "veces", "vezes", "times"]);

/** Todas las cantidades con unidad de un texto, normalizadas. */
export function quantitiesOf(text: string): Quantity[] {
  const tokens = quantityTokens(text);
  const out: Quantity[] = [];
  const push = (raw: number, decimals: number, unit: UnitHit, ranged = false) => {
    out.push({
      dim: unit.dim,
      canon: unit.affine ? unit.affine(raw) : raw * unit.f,
      raw,
      decimals,
      tolF: unit.f,
      ...(ranged ? { ranged: true } : {}),
    });
  };
  // Los rangos con unidad al final («entre 37 y 40 °C»): la unidad
  // vale para los dos extremos, no solo para el segundo.
  const rangeRe = /(\d+(?:[.,]\d+)?)\s*(?:[-–—]|\ba\b|\bto\b|\baté\b)\s*(\d+(?:[.,]\d+)?)\s*([a-zñ°%]+)/g;
  const entreRe = /\bentre\s+(\d+(?:[.,]\d+)?)\s+(?:y|e|and)\s+(\d+(?:[.,]\d+)?)\s*([a-zñ°%]+)/g;
  for (const re of [rangeRe, entreRe]) {
    for (const m of foldForWords(text).replace(/\[\d+\]/g, " ").matchAll(re)) {
      const lo = parseNumberToken(m[1]!)[0];
      const hi = parseNumberToken(m[2]!)[0];
      if (lo === undefined || hi === undefined) continue;
      const unit = lookupUnit([m[3]!], 0, true);
      if (!unit) continue;
      push(lo, decimalsOf(m[1]!, lo), unit, true);
      push(hi, decimalsOf(m[2]!, hi), unit, true);
    }
  }
  // T-05 (M-05 de la auditoría): la frecuencia como cantidad. «Dos
  // veces por semana» contra «dos veces al día» se sellaba: el marco
  // de sentenceWordReadings es solo diario y ninguna otra pierna
  // comparaba el periodo. Aquí el marco entero (veces × periodo,
  // es/en/pt, en dígitos o en letra) produce una cantidad de
  // dimensión «frecuencia» cuyo canónico son las veces por día; la
  // comparación de quantityConflict hace el resto, y solo juzga si
  // la evidencia trae frecuencia (mundo cerrado, ver allí). El
  // «once» español (11) llega por parseWordNumber como en el resto
  // del fichero; el «once» inglés solo vale en su marco sin «times».
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    let count: number | null = null;
    let span = 0;
    if (/^\d/.test(t)) {
      const readings = parseNumberToken(t);
      if (readings.length === 0) continue;
      count = readings[0]!;
      span = 1;
    } else {
      const wn = parseWordNumber(tokens, i);
      if (!wn) continue;
      count = wn.value;
      span = wn.len;
    }
    const w = tokens[i + span];
    if (w === undefined || !FREQ_COUNT_WORDS.has(w)) continue;
    let j = i + span + 1;
    const intro = tokens[j];
    if (intro === "a" && tokens[j + 1] === "la") j++;
    if (intro !== "al" && intro !== "por" && intro !== "a" && intro !== "per" && intro !== "ao") continue;
    const days = FREQ_PERIOD_DAYS[tokens[j + 1] ?? ""];
    if (days === undefined) continue;
    out.push({ dim: "frecuencia", canon: count / days, raw: count, decimals: 0, tolF: 0.01 });
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t !== "once" && t !== "twice") continue;
    const count = t === "twice" ? 2 : 1;
    const n1 = tokens[i + 1];
    if (n1 === "daily") {
      out.push({ dim: "frecuencia", canon: count, raw: count, decimals: 0, tolF: 0.01 });
    } else if (n1 === "a" || n1 === "per") {
      const days = FREQ_PERIOD_DAYS[tokens[i + 2] ?? ""];
      if (days !== undefined) out.push({ dim: "frecuencia", canon: count / days, raw: count, decimals: 0, tolF: 0.01 });
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    let raw: number | null = null;
    let decimals = 0;
    let span = 0;
    let fromDigit = false;
    if (/^\d/.test(t)) {
      const readings = parseNumberToken(t);
      if (readings.length === 0) continue;
      raw = readings[0]!;
      decimals = decimalsOf(t, raw);
      span = 1;
      fromDigit = true;
    } else if (t === "media" || t === "medio" || t === "half" || t === "meia") {
      raw = 0.5;
      decimals = 1;
      span = 1;
    } else {
      const wn = parseWordNumber(tokens, i);
      if (!wn) continue;
      raw = wn.value;
      span = wn.len;
    }
    const unit = lookupUnit(tokens, i + span, fromDigit);
    if (!unit) continue;
    push(raw, decimals, unit);
    i += span + unit.len - 1;
  }
  return out;
}

/** Las cantidades de toda la evidencia, texto a texto (sin cruzar fronteras). */
export function evidenceQuantities(texts: readonly string[]): Quantity[] {
  return texts.flatMap((t) => quantitiesOf(t));
}

/**
 * ¿Contradice alguna cantidad de la frase a la evidencia? Tres
 * salidas honestas: la dimensión está en la evidencia y ninguna de
 * sus cantidades casa (tras convertir) → contradicción; la
 * dimensión no está y el valor tampoco aparece suelto → invención;
 * el valor cae dentro de un rango de la evidencia → sostenida (la
 * doctrina de C-08 manda también aquí).
 */
export function quantityConflict(
  sentence: string,
  evidence: readonly Quantity[],
  evidenceValues: ReadonlySet<number>,
  ranges: readonly EvidenceRange[] = [],
): boolean {
  const mine = quantitiesOf(sentence);
  // CL-9: los extremos de un rango de la respuesta que CONTIENE
  // una cantidad de la evidencia en su dimensión no contradicen:
  // acotan. Se excusan por dimensión antes de juzgar uno a uno.
  const excusedDims = new Set<string>();
  for (const q of mine) {
    if (!q.ranged) continue;
    const group = mine.filter((o) => o.ranged && o.dim === q.dim);
    if (group.length < 2) continue;
    const lo = Math.min(...group.map((o) => o.canon));
    const hi = Math.max(...group.map((o) => o.canon));
    if (evidence.some((e) => e.dim === q.dim && e.canon >= lo - 1e-9 && e.canon <= hi + 1e-9)) {
      excusedDims.add(q.dim);
    }
  }
  // La misma cantidad leída dos veces (extremo del rango y lectura
  // suelta del escaneo general) no se juzga dos veces: si su valor
  // es un extremo del rango excusado, también está excusada.
  const excusedValues = new Map<string, number[]>();
  for (const dim of excusedDims) {
    excusedValues.set(dim, mine.filter((o) => o.ranged && o.dim === dim).map((o) => o.canon));
  }
  for (const q of mine) {
    // T-05 (M-05): la frecuencia se juzga en mundo cerrado — solo si
    // la evidencia trae alguna cantidad de frecuencia. La guía que
    // pauta sin este marco («cada 12 horas», «por la mañana y por la
    // noche») no declara frecuencia en esta dimensión, y condenar la
    // de la respuesta contra un conjunto vacío castigaría la
    // paráfrasis que el resto del juez sostiene.
    if (q.dim === "frecuencia" && !evidence.some((e) => e.dim === "frecuencia")) continue;
    if (withinEvidenceRanges(q.raw, q.decimals, ranges)) continue;
    if (q.ranged && excusedDims.has(q.dim)) continue;
    if (excusedValues.get(q.dim)?.some((v) => Math.abs(v - q.canon) <= 1e-9)) continue;
    const sameDim = evidence.filter((e) => e.dim === q.dim);
    if (sameDim.length > 0) {
      const tol = 0.5 * Math.pow(10, -q.decimals) * q.tolF + 1e-9;
      if (!sameDim.some((e) => Math.abs(e.canon - q.canon) <= tol)) return true;
    } else if (
      // T-05 (M-03a de la auditoría): el valor que aparece en la
      // evidencia bajo OTRA dimensión no rescata: es un trasplante
      // («230 vatios» por «230 voltios», «25 minutos» por «25
      // metres»). El rescate por valor suelto de antes lo sellaba:
      // bastaba que la cifra existiera en cualquier dimensión. El
      // valor suelto SIN cantidad en la evidencia (un conteo, una
      // cifra de un dato) sigue rescatando como siempre.
      evidence.some(
        (e) =>
          e.dim !== q.dim &&
          (roundsFromEvidence(q.raw, q.decimals, new Set([e.raw])) ||
            Math.abs(e.canon - q.canon) <= 0.5 * Math.pow(10, -q.decimals) * q.tolF + 1e-9),
      )
    ) {
      return true;
    } else if (
      !roundsFromEvidence(q.raw, q.decimals, evidenceValues) &&
      !roundsFromEvidence(q.canon, q.decimals, evidenceValues)
    ) {
      return true;
    }
  }
  return false;
}
