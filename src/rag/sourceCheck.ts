/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La caja de comprobación de fuentes (programa «Lo mejor de la
 * bounty», tanda 8; patrón de AndroidLM, Apache-2.0 — su
 * comprobación final lista lo que las fuentes dicen y la respuesta
 * omite o dice distinto — y la comprobación de cifras de Field
 * Atlas, Apache-2.0, que la midió antes: sobre 200 respuestas
 * disparó dos veces, ambas en cifras realmente erróneas).
 *
 * Lo que la tanda 1 hace es RETIRAR la frase cuyo número no está
 * en la evidencia. Pero hay una ruta donde las cifras llegan al
 * usuario sin ese juicio: la «unverified» (la lengua no dejó
 * juzgar la respuesta contra las fuentes). Ahí es donde esta
 * comprobación trabaja: busca cifras de la respuesta que
 * CONTRADICEN a una fuente — mismo tema, misma unidad, otro valor
 * — y devuelve la frase de la fuente para enseñarla bajo la
 * respuesta. No cambia ni una palabra de la respuesta: la nota es
 * de la app, no del modelo.
 *
 * Estricta a propósito (la precisión es el producto; el recuerdo
 * bajo es aceptado y declarado, como en Field Atlas):
 *  - Misma unidad normalizada, sin convertir nunca (km ≠ millas).
 *  - La frase de la respuesta y la de la fuente comparten al menos
 *    una palabra de contenido (≥4 letras, plegada): mismo tema.
 *  - Los valores no se redondean el uno desde el otro en ninguna
 *    dirección (la regla de la tanda 1: redondeo y escala cuentan
 *    como la misma cifra: «16,4 millones» no contradice a
 *    16.431.599, y «870 km» sí contradice a «600 km»).
 *  - Máximo 2 avisos por respuesta, sin repetir unidad+tema.
 *
 * Puro, sin dependencias, 100% testeable.
 */

import type { RetrievedChunk } from "./retrieve";
import { splitSentences } from "./grounding";
import { numberTokens, roundsFromEvidence, tokenReadings } from "./evidenceNumbers";

export interface NumberConflict {
  /** La unidad normalizada en la que discrepan («km»). */
  unit: string;
  /** La frase de la FUENTE, que es la que se enseña (recortada). */
  sourceSentence: string;
}

/** Unidades sin conversión: cada forma aceptada mapea a su canónica. */
const UNITS: Record<string, string> = {
  km: "km", kilómetro: "km", kilómetros: "km", kilometro: "km", kilometros: "km", quilômetro: "km", quilômetros: "km",
  m: "m", metro: "m", metros: "m",
  cm: "cm", centímetro: "cm", centímetros: "cm", centimetro: "cm", centimetros: "cm",
  mm: "mm",
  millas: "millas", milla: "millas", miles: "millas", mile: "millas",
  pies: "pies", pie: "pies", feet: "pies", foot: "pies", ft: "pies",
  kg: "kg", kilos: "kg", quilos: "kg",
  g: "g", gramos: "g", gramas: "g",
  mg: "mg",
  l: "l", litros: "l", litros_: "l",
  ml: "ml",
  "°c": "°c", "°f": "°f",
  horas: "horas", hora: "horas", hours: "horas", hour: "horas", h: "horas",
  minutos: "minutos", minuto: "minutos", minutes: "minutos", minute: "minutos", min: "minutos",
  segundos: "segundos", segundo: "segundos", seconds: "segundos", second: "segundos",
  habitantes: "habitantes", personas: "personas", people: "personas",
};

const SCALE_WORDS: Record<string, number> = {
  mil: 1e3, miles: 1e3, thousand: 1e3,
  millón: 1e6, millones: 1e6, million: 1e6, millions: 1e6, milhão: 1e6, milhões: 1e6,
  "mil millones": 1e9, billion: 1e9, "mil milhões": 1e9,
};

interface FigureMeasure {
  value: number;
  decimals: number;
  unit: string;
}

const foldWord = (w: string): string =>
  w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Las medidas (valor + unidad) de una frase. El valor queda COMO SE
 * AFIRMA («16,4» con 1 decimal): la comparación de cifras de la
 * tanda 1 ya sabe juzgar la escala contra la evidencia, y
 * pre-multiplicar aquí rompería esa regla. Las palabras de escala
 * solo se saltan para encontrar la unidad («16,4 millones de
 * habitantes»); «miles» es unidad (millas, en inglés) salvo que le
 * siga «de», que es escala en español.
 */
function measuresIn(sentence: string): FigureMeasure[] {
  const out: FigureMeasure[] = [];
  const tokens = numberTokens(sentence);
  const folded = ` ${foldWord(sentence)} `;
  for (const token of tokens) {
    const at = folded.indexOf(foldWord(token));
    if (at < 0) continue;
    const after = folded.slice(at + token.length, at + token.length + 24);
    const words = after.split(/[^a-z°%]+/).filter(Boolean);
    let unit: string | undefined;
    for (let i = 0; i < Math.min(words.length, 3); i++) {
      const w = words[i];
      if (w === "miles" && words[i + 1] === "de") continue; // «miles de…»: escala
      if (UNITS[w] !== undefined) {
        unit = UNITS[w];
        break;
      }
      if (SCALE_WORDS[w] !== undefined) continue;
      break;
    }
    if (!unit) continue;
    for (const reading of tokenReadings(token)) {
      out.push({ value: reading.value, decimals: reading.decimals, unit });
    }
  }
  return out;
}

/** Palabras de contenido de una frase (para el «mismo tema»); la unidad y la escala no son tema. */
function contentWords(sentence: string): Set<string> {
  return new Set(
    foldWord(sentence)
      .split(/[^a-zñ]+/)
      .filter((w) => w.length >= 4 && UNITS[w] === undefined && SCALE_WORDS[w] === undefined)
  );
}

function sharesTopic(a: string, b: string): boolean {
  const bw = contentWords(b);
  for (const w of contentWords(a)) if (bw.has(w)) return true;
  return false;
}

function sameFigure(a: FigureMeasure, b: FigureMeasure): boolean {
  const asSet = new Set([b.value]);
  if (roundsFromEvidence(a.value, a.decimals, asSet)) return true;
  const bsSet = new Set([a.value]);
  return roundsFromEvidence(b.value, b.decimals, bsSet);
}

/**
 * La aproximación declarada no se marca (Field Atlas: los rangos y
 * el «about» se permiten): si la frase de la respuesta se cubre a
 * sí misma («unos 600», «about 600»), no hay contradicción que
 * enseñar aunque la cifra exacta difiera.
 */
const APPROXIMATION =
  /\b(unos|unas|about|around|approximately|aproximadamente|cerca de|uns|umas|roughly|some)\b/i;

const MAX_CONFLICTS = 2;
const SOURCE_SENTENCE_MAX = 220;

/**
 * Las contradicciones cifra a cifra entre la respuesta y sus
 * fuentes. Vacío en la inmensa mayoría (así debe ser: la ausencia
 * de avisos no certifica nada, su presencia sí señala).
 */
export function findNumberConflicts(answerText: string, chunks: readonly RetrievedChunk[]): NumberConflict[] {
  if (!answerText || chunks.length === 0) return [];
  const sourceSentences: Array<{ text: string; measures: FigureMeasure[] }> = [];
  for (const chunk of chunks) {
    for (const s of splitSentences(chunk.body)) {
      const measures = measuresIn(s);
      if (measures.length > 0) sourceSentences.push({ text: s, measures });
    }
  }
  if (sourceSentences.length === 0) return [];

  const conflicts: NumberConflict[] = [];
  const seen = new Set<string>();
  for (const answerSentence of splitSentences(answerText)) {
    if (APPROXIMATION.test(answerSentence)) continue;
    for (const answerMeasure of measuresIn(answerSentence)) {
      for (const source of sourceSentences) {
        for (const sourceMeasure of source.measures) {
          if (sourceMeasure.unit !== answerMeasure.unit) continue;
          if (sameFigure(answerMeasure, sourceMeasure)) continue;
          if (!sharesTopic(answerSentence, source.text)) continue;
          const dedupe = `${answerMeasure.unit}:${source.text.slice(0, 40)}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          conflicts.push({
            unit: answerMeasure.unit,
            sourceSentence:
              source.text.length > SOURCE_SENTENCE_MAX ? `${source.text.slice(0, SOURCE_SENTENCE_MAX - 1)}…` : source.text,
          });
          if (conflicts.length >= MAX_CONFLICTS) return conflicts;
        }
      }
    }
  }
  return conflicts;
}
