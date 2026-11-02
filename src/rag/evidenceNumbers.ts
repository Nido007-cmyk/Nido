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
function isJudged(token: string): boolean {
  // T-J4: una fracción siempre se juzga — es el dato entero.
  if (token.includes("/")) return true;
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
  for (const token of numberTokens(sentence)) {
    if (!isJudged(token)) continue;
    const readings = parseNumberToken(token);
    const ok = readings.some(
      (v) => roundsFromEvidence(v, decimalsOf(token, v), evidence) || withinEvidenceRanges(v, decimalsOf(token, v), ranges),
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
