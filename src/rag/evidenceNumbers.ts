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
 *
 * Puro, sin dependencias, 100% testeable.
 */

/** Cifras candidatas de un texto, como tokens crudos («16.431.599», «26,5»). */
export function numberTokens(text: string): string[] {
  const noCites = text.replace(/\[\d+\]/g, " ");
  return noCites.match(/\d[\d.,]*\d|\d/g) ?? [];
}

/**
 * Las lecturas plausibles de un token: casi siempre una; dos cuando la
 * notación es ambigua entre decimal y miles en alguna de las lenguas.
 */
export function parseNumberToken(token: string): number[] {
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
  }
  return out;
}

/** Una cifra se juzga si tiene 2+ dígitos o trae parte decimal (ver cabecera). */
function isJudged(token: string): boolean {
  const digits = token.replace(/[.,]/g, "");
  return digits.length >= 2 || /[.,]\d/.test(token);
}

/**
 * ¿Salen de la evidencia TODAS las cifras juzgables de la frase?
 * Las citas [n] no son cifras de la frase (se retiran antes de mirar).
 */
export function sentenceNumbersSupported(sentence: string, evidence: ReadonlySet<number>): boolean {
  for (const token of numberTokens(sentence)) {
    if (!isJudged(token)) continue;
    const readings = parseNumberToken(token);
    const ok = readings.some((v) => roundsFromEvidence(v, decimalsOf(token, v), evidence));
    if (!ok) return false;
  }
  return true;
}
