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
 * R-05 (ronda 0.1.68) añade el caso inverso: la OMISIÓN. La caja
 * nació para cifras que discrepan; la respuesta «el teléfono es el
 * número de emergencia» no trae cifra alguna que discrepe — el dato
 * debido simplemente no está, y la fuente sí lo trae. Si la regla
 * del dato pedido del verificador estimó mal la señal, esta red
 * enseña la frase fuente con el dato y rompe el silencio. La
 * adversaria de la cadena (H-03) acotó su «mismo tema»: la omisión
 * exige DOS palabras sustantivas compartidas, y los genéricos de
 * categoría («número», «año», «día»…) no cuentan como tema. La
 * segunda adversaria (ADV2-03/04) cerró el suelo por los dos lados:
 * las palabras de función tampoco son tema, la frase enseñada ha
 * de traer la categoría del dato omitido, y una sustantiva ajena a
 * la categoría basta cuando la categoría misma se comparte.
 *
 * C-08 (cadena «Arregla todo») le enseña las unidades en las que
 * Esencial dosifica: %, gotas (con su calificador «por litro»),
 * comprimidos, días/semanas/meses/años, ml/kg y mg/kg, las cucharas
 * y la frecuencia diaria. Y los rangos: «10 a 14 días» funde en una
 * medida {min, max} — el valor dentro del rango es la misma cifra,
 * el de fuera contradice, y rango contra rango con solape basta.
 * Tres varas de conversión, declaradas y escritas en el código (la
 * excepción a la regla de no convertir): cucharadita = 5 ml y
 * cucharada = 15 ml (el estándar culinario que las recetas de tipo
 * OMS presuponen; entre cucharas el factor se cancela), semana =
 * 7 días exactos, y «cada N horas» = 24/N veces al día. Las gotas
 * jamás se convierten a ml (su volumen depende del gotero y de la
 * concentración) y «veces» a secas no es unidad: sin marco diario
 * explícito es multiplicador («5 veces la distancia»), no dosis.
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
import { isCardCluster, splitSentences } from "./grounding";
import {
  numberTokens,
  parseNumberToken,
  roundsFromEvidence,
  tokenReadings,
  fractionValue,
  WORD_NUMBERS,
  DOSE_UNIT_WORDS,
  WORD_NUMBER_ALT,
} from "./evidenceNumbers";
import { dateConflictForSentence, parseSourceDateSentences } from "./dates";

export interface NumberConflict {
  /** La unidad normalizada en la que discrepan («km»). */
  unit: string;
  /** La frase de la FUENTE, que es la que se enseña (recortada). */
  sourceSentence: string;
  /**
   * R-05: true si no es una contradicción sino una OMISIÓN — la
   * respuesta nombra la categoría del dato (el teléfono, la dosis…)
   * sin darlo, y la fuente sí lo trae en cifras. `unit` lleva
   * entonces la categoría del dato, no una unidad.
   */
  omission?: boolean;
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
  // C-08: las unidades de dosis y duración de Esencial.
  "%": "%", percent: "%",
  gota: "gotas", gotas: "gotas", drop: "gotas", drops: "gotas",
  // ADV-J-C1: la familia del inhalador, en paridad con la tabla
  // del juez (DOSE_MEASURE_RE): sin «puffs»/«sprays» la caja no
  // parseaba la medida y la dosis cambiada no enseñaba conflicto.
  puff: "puffs", puffs: "puffs", spray: "sprays", sprays: "sprays",
  comprimido: "comprimidos", comprimidos: "comprimidos",
  tableta: "comprimidos", tabletas: "comprimidos",
  pastilla: "comprimidos", pastillas: "comprimidos",
  tablet: "comprimidos", tablets: "comprimidos",
  pill: "comprimidos", pills: "comprimidos",
  día: "dias", días: "dias", dia: "dias", dias: "dias", day: "dias", days: "dias",
  mes: "meses", meses: "meses", month: "meses", months: "meses",
  año: "años", años: "años", ano: "años", anos: "años", year: "años", years: "años",
  // T-J4: la taza, la unidad en la que las fracciones de cocina se
  // afirman («1/2 taza») — sin ella la fracción no tenía medida que
  // juzgar en esta superficie. Los dígitos en tazas se miden con
  // ella desde la misma tanda, por la misma razón.
  taza: "tazas", tazas: "tazas", cup: "tazas", cups: "tazas", xicara: "tazas", xicaras: "tazas",
};

/**
 * Conversiones con vara declarada (C-08): cucharas a ml con el
 * estándar culinario (cucharadita 5, cucharada 15) y semanas a días
 * exactos (×7). Meses y años no se convierten (28–31 y 365/366 no
 * son exactos): viven en UNITS y se comparan en su unidad. Las
 * cucharas portuguesas («colher de chá / de sopa») son de dos
 * palabras y las resuelve resolveUnit, no esta tabla.
 */
const CONVERT: Record<string, { unit: string; factor: number }> = {
  cucharadita: { unit: "ml", factor: 5 },
  cucharaditas: { unit: "ml", factor: 5 },
  cucharada: { unit: "ml", factor: 15 },
  cucharadas: { unit: "ml", factor: 15 },
  teaspoon: { unit: "ml", factor: 5 },
  teaspoons: { unit: "ml", factor: 5 },
  tablespoon: { unit: "ml", factor: 15 },
  tablespoons: { unit: "ml", factor: 15 },
  semana: { unit: "dias", factor: 7 },
  semanas: { unit: "dias", factor: 7 },
  week: { unit: "dias", factor: 7 },
  weeks: { unit: "dias", factor: 7 },
};

/**
 * Las tablas de números en letra (WORD_NUMBERS, DOSE_UNIT_WORDS,
 * WORD_NUMBER_ALT) viven desde T-J3 en evidenceNumbers.ts y se
 * importan: una sola fuente para las dos superficies — el juez las
 * consume con los mismos portillos que esta caja (C-08).
 */

/** Toda palabra que nombra una unidad o su conversión: no es tema. */
const UNIT_WORDS = new Set([...Object.keys(UNITS), ...Object.keys(CONVERT), "colher", "colheres"]);

const SCALE_WORDS: Record<string, number> = {
  mil: 1e3, miles: 1e3, thousand: 1e3,
  millón: 1e6, millones: 1e6, million: 1e6, millions: 1e6, milhão: 1e6, milhões: 1e6,
  "mil millones": 1e9, billion: 1e9, "mil milhões": 1e9,
};

interface FigureMeasure {
  value: number;
  decimals: number;
  unit: string;
  /** C-08: si la medida es un rango fundido («10 a 14 días»), sus extremos ya convertidos. */
  min?: number;
  max?: number;
}

const foldWord = (w: string): string =>
  w.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Las palabras que siguen a una posición de la frase plegada (la ventana de la caja). */
function wordsAfter(folded: string, at: number): string[] {
  return folded
    .slice(at, at + 40)
    .split(/[^a-z°%]+/)
    .filter(Boolean);
}

const PER_LITRE_WORDS = ["litro", "litros", "litre", "litres", "liter", "liters"];
const PER_KILO_WORDS = ["kilo", "kilos", "kg", "quilo", "quilos"];

/**
 * La unidad que sigue a una cifra, en la disciplina de siempre: se
 * miran hasta 3 palabras y se saltan las de escala («miles de» es
 * escala; «miles» a secas, millas). C-08 añade las formas que la
 * disciplina no veía: «por ciento / por cento», las cucharas
 * portuguesas de dos palabras («colher de chá / de sopa»), las
 * conversiones de CONVERT y los calificadores: gotas con «por
 * litro» tras la medida → gotas/l (la búsqueda del calificador mira
 * hasta 6 palabras: la frase de la guía es «gotas de lejía por
 * litro», con el «de lejía» en medio), y ml/mg con «por kilo» o
 * «/kg» pegado → ml/kg, mg/kg.
 */
function resolveUnit(words: readonly string[]): { unit: string; factor: number } | undefined {
  for (let i = 0; i < Math.min(words.length, 3); i++) {
    const w = words[i];
    if (w === "miles" && words[i + 1] === "de") continue; // «miles de…»: escala
    if (w === "por" && (words[i + 1] === "ciento" || words[i + 1] === "cento")) return { unit: "%", factor: 1 };
    if (w === "colher" || w === "colheres") {
      if (words[i + 1] === "de" && words[i + 2] === "cha") return { unit: "ml", factor: 5 };
      if (words[i + 1] === "de" && words[i + 2] === "sopa") return { unit: "ml", factor: 15 };
      return undefined;
    }
    const conv = CONVERT[w];
    if (conv) return { unit: conv.unit, factor: conv.factor };
    const canonical = UNITS[w];
    if (canonical !== undefined) {
      let unit = canonical;
      if (unit === "gotas") {
        for (let j = i + 1; j < Math.min(words.length - 1, i + 6); j++) {
          if ((words[j] === "por" || words[j] === "per") && PER_LITRE_WORDS.includes(words[j + 1])) {
            unit = "gotas/l";
            break;
          }
        }
      }
      if (
        (unit === "ml" || unit === "mg") &&
        (words[i + 1] === "kg" ||
          ((words[i + 1] === "por" || words[i + 1] === "per") && PER_KILO_WORDS.includes(words[i + 2] ?? "")))
      ) {
        unit = `${unit}/kg`;
      }
      return { unit, factor: 1 };
    }
    if (SCALE_WORDS[w] !== undefined) continue;
    return undefined;
  }
  return undefined;
}

/** Las duraciones que «cada N …» convierte en intervalo (canónica cada-<unidad>). */
const INTERVAL_UNITS: Record<string, { unit: string; factor: number }> = {
  dia: { unit: "dias", factor: 1 },
  dias: { unit: "dias", factor: 1 },
  day: { unit: "dias", factor: 1 },
  days: { unit: "dias", factor: 1 },
  semana: { unit: "dias", factor: 7 },
  semanas: { unit: "dias", factor: 7 },
  week: { unit: "dias", factor: 7 },
  weeks: { unit: "dias", factor: 7 },
  mes: { unit: "meses", factor: 1 },
  meses: { unit: "meses", factor: 1 },
  month: { unit: "meses", factor: 1 },
  months: { unit: "meses", factor: 1 },
  ano: { unit: "años", factor: 1 },
  anos: { unit: "años", factor: 1 },
  year: { unit: "años", factor: 1 },
  years: { unit: "años", factor: 1 },
  minuto: { unit: "minutos", factor: 1 },
  minutos: { unit: "minutos", factor: 1 },
  minute: { unit: "minutos", factor: 1 },
  minutes: { unit: "minutos", factor: 1 },
  segundo: { unit: "segundos", factor: 1 },
  segundos: { unit: "segundos", factor: 1 },
  second: { unit: "segundos", factor: 1 },
  seconds: { unit: "segundos", factor: 1 },
};

const RANGE_RES = [
  /(\d+(?:[.,]\d+)?)\s*(?:[-–—]|\ba\b|\bto\b|\baté\b)\s*(\d+(?:[.,]\d+)?)/g,
  /\bentre\s+(\d+(?:[.,]\d+)?)\s+(?:y|e|and)\s+(\d+(?:[.,]\d+)?)/g,
];
const CADA_HOURS_RE = /\b(?:cada|every)\s+(\d+(?:[.,]\d+)?)\s+(horas|hora|hours|hour|h)\b/g;
const CADA_INTERVAL_RE = /\b(?:cada|every)\s+(\d+(?:[.,]\d+)?)\s+([a-z]+)\b/g;
const FREQ_FRAME_RE = new RegExp(
  `\\b(\\d+(?:[.,]\\d+)?|${WORD_NUMBER_ALT})\\s+(veces|times|vezes)\\s+(al dia|por dia|a day|per day|ao dia)\\b`,
  "g",
);
const WORD_NUMBER_RE = new RegExp(`\\b(${WORD_NUMBER_ALT})\\b`, "g");
const DIGIT_TOKEN_RE = /\d[\d.,]*\d|\d/g;
/** T-J4: las fracciones «a/b» candidatas (la validez la decide fractionValue). */
const FRACTION_TOKEN_RE = /\d+\/\d+(?![\d/])/g;

/**
 * Las medidas (valor + unidad) de una frase. El valor queda COMO SE
 * AFIRMA («16,4» con 1 decimal): la comparación de cifras de la
 * tanda 1 ya sabe juzgar la escala contra la evidencia, y
 * pre-multiplicar aquí rompería esa regla. Las palabras de escala
 * solo se saltan para encontrar la unidad («16,4 millones de
 * habitantes»); «miles» es unidad (millas, en inglés) salvo que le
 * siga «de», que es escala en español.
 *
 * C-08 ordena la extracción en pre-pasos que CONSUMEN su tramo de
 * frase, para que la pasada general no vuelva a juzgar esas cifras
 * con otra ropa: (1) los rangos funden sus extremos — si el 10 y el
 * 14 quedaran sueltos, «12 días» chocaría contra el 10 en vez de
 * caer dentro; (2) «cada N horas» vale 24/N veces al día y su cifra
 * no queda además como horas sueltas; (3) «cada N <duración>» forma
 * el intervalo cada-<unidad>; (4) el marco «N veces al día» (dígito
 * o letra) forma la frecuencia; (5) los números en letra tocan solo
 * unidades de dosis. Las conversiones declaradas (CONVERT) se
 * aplican al valor ya aquí: el factor se cancela entre iguales y
 * contra ml/días manda la vara.
 */
function measuresIn(sentence: string): FigureMeasure[] {
  const out: FigureMeasure[] = [];
  const folded = ` ${foldWord(sentence).replace(/\[\d+\]/g, (m) => " ".repeat(m.length))} `;
  const consumed: Array<readonly [number, number]> = [];
  const isConsumed = (at: number): boolean => consumed.some(([a, b]) => at >= a && at < b);
  const consume = (at: number, len: number): void => {
    consumed.push([at, at + len]);
  };

  // (1) Rangos: «10 a 14 días», «entre 37 y 40 °C», «5–6 %».
  for (const re of RANGE_RES) {
    for (const m of folded.matchAll(re)) {
      const at = m.index;
      if (isConsumed(at)) continue;
      const lo = parseNumberToken(m[1]);
      const hi = parseNumberToken(m[2]);
      if (lo.length === 0 || hi.length === 0) continue;
      const resolved = resolveUnit(wordsAfter(folded, at + m[0].length));
      if (!resolved) continue; // sin unidad tras el rango no hay rango que juzgar
      const min = Math.min(lo[0], hi[0]) * resolved.factor;
      const max = Math.max(lo[0], hi[0]) * resolved.factor;
      if (max <= min) continue;
      out.push({ value: min, decimals: 0, unit: resolved.unit, min, max });
      consume(at, m[0].length);
    }
  }

  // (2) «Cada N horas» = 24/N veces al día, con la tolerancia de
  // redondeo de siempre (cada 5 horas = 4,8 ≈ 5).
  for (const m of folded.matchAll(CADA_HOURS_RE)) {
    const at = m.index;
    if (isConsumed(at)) continue;
    const n = parseNumberToken(m[1])[0];
    if (!n) continue;
    const value = 24 / n;
    out.push({ value, decimals: Number.isInteger(value) ? 0 : 1, unit: "veces/dia" });
    consume(at, m[0].length);
  }

  // (3) «Cada N <duración>» = intervalo cada-<unidad>.
  for (const m of folded.matchAll(CADA_INTERVAL_RE)) {
    const at = m.index;
    if (isConsumed(at)) continue;
    const base = INTERVAL_UNITS[m[2]];
    if (!base) continue;
    const n = parseNumberToken(m[1])[0];
    if (n === undefined) continue;
    out.push({ value: n * base.factor, decimals: 0, unit: `cada-${base.unit}` });
    consume(at, m[0].length);
  }

  // (4) El marco de frecuencia diaria, en dígito o en letra.
  for (const m of folded.matchAll(FREQ_FRAME_RE)) {
    const at = m.index;
    if (isConsumed(at)) continue;
    const raw = m[1];
    const reading = /^\d/.test(raw) ? tokenReadings(raw)[0] : { value: WORD_NUMBERS[raw], decimals: 0 };
    if (!reading) continue;
    out.push({ value: reading.value, decimals: reading.decimals, unit: "veces/dia" });
    consume(at, m[0].length);
  }

  // (4.5) T-J4: las fracciones con unidad («1/4 taza»), con la
  // gramática compartida con el juez (evidenceNumbers: tabla de
  // denominadores de cocina y numerador menor; «10/11» no es una
  // fracción y no se funde). Consumen su tramo: el «1» y el «4» no
  // vuelven a juzgarse sueltos en la pasada general.
  for (const m of folded.matchAll(FRACTION_TOKEN_RE)) {
    const at = m.index;
    if (isConsumed(at)) continue;
    const value = fractionValue(m[0]);
    if (value === null) continue;
    const resolved = resolveUnit(wordsAfter(folded, at + m[0].length));
    if (!resolved) continue;
    out.push({ value: value * resolved.factor, decimals: 2, unit: resolved.unit });
    consume(at, m[0].length);
  }

  // (5) Números en letra que tocan una unidad de dosis.
  for (const m of folded.matchAll(WORD_NUMBER_RE)) {
    const at = m.index;
    if (isConsumed(at)) continue;
    const words = wordsAfter(folded, at + m[0].length);
    if (words.length === 0 || !DOSE_UNIT_WORDS.has(words[0])) continue;
    const resolved = resolveUnit(words);
    if (!resolved) continue;
    out.push({ value: WORD_NUMBERS[m[1]] * resolved.factor, decimals: 0, unit: resolved.unit });
    consume(at, m[0].length);
  }

  // La pasada general: cada cifra con su unidad, como siempre.
  for (const m of folded.matchAll(DIGIT_TOKEN_RE)) {
    const at = m.index;
    if (isConsumed(at)) continue;
    const token = m[0];
    const resolved = resolveUnit(wordsAfter(folded, at + token.length));
    if (!resolved) continue;
    for (const reading of tokenReadings(token)) {
      out.push({ value: reading.value * resolved.factor, decimals: reading.decimals, unit: resolved.unit });
    }
  }
  return out;
}

/** Palabras de contenido de una frase (para el «mismo tema»); la unidad y la escala no son tema. */
function contentWords(sentence: string): Set<string> {
  return new Set(
    foldWord(sentence)
      .split(/[^a-zñ]+/)
      .filter((w) => w.length >= 4 && !UNIT_WORDS.has(w) && SCALE_WORDS[w] === undefined)
  );
}

function sharesTopic(a: string, b: string): boolean {
  const bw = contentWords(b);
  for (const w of contentWords(a)) if (bw.has(w)) return true;
  return false;
}

/** Cuántas palabras de contenido comparten dos frases (para elegir la fuente que enseñar). */
function sharedContentWords(a: string, b: string): number {
  const bw = contentWords(b);
  let n = 0;
  for (const w of contentWords(a)) if (bw.has(w)) n++;
  return n;
}

/**
 * Sustantivos genéricos de alta frecuencia: nombran la CATEGORÍA de
 * un dato, no un tema. Compartir solo «número» (o «año», «día» y
 * familia) con una frase fuente no la hace «del mismo tema»
 * (adversaria H-03). Solo las formas que contentWords puede dar
 * (≥4 letras, plegadas); «año»/«día»/«day» ya caen por longitud.
 */
const GENERIC_TOPIC_WORDS = new Set([
  "numero", "numeros", "number", "numbers",
  "anos", "year", "years", "dias", "days",
]);

/**
 * Palabras de FUNCIÓN de 4+ letras (segunda adversaria, ADV2-03):
 * el filtro de «contenido» era la longitud, y «está» contaba como
 * tema sustantivo — «sala»+«está» colgaban la sala 214 de una
 * respuesta sobre la sala de espera que no debía cifra alguna.
 * Demostrativos, formas de estar y preposiciones/conjunciones
 * corrientes (es/en/pt) no son tema: por lista, no por longitud.
 */
const FUNCTION_TOPIC_WORDS = new Set([
  // es/pt: demostrativos y formas de estar
  "esta", "este", "esto", "estas", "estos", "estan", "estaba", "estaban", "estao", "estava",
  "esa", "ese", "eso", "esas", "esos", "aquel", "aquella", "isto", "isso",
  // es/pt: preposiciones y conjunciones
  "para", "como", "cada", "sobre", "entre", "desde", "hasta", "hacia", "durante",
  "porque", "aunque", "cuando", "donde", "mientras", "contra", "segun", "quando", "enquanto",
  // en: función corriente
  "with", "from", "that", "this", "these", "those", "there", "their",
  "about", "would", "could", "should", "been", "were", "does", "what", "when", "where", "which", "while",
]);

/** Palabras compartidas que son tema sustantivo (las genéricas y las de función no cuentan). */
function substantiveSharedWords(a: string, b: string): number {
  const bw = contentWords(b);
  let n = 0;
  for (const w of contentWords(a)) if (bw.has(w) && !GENERIC_TOPIC_WORDS.has(w) && !FUNCTION_TOPIC_WORDS.has(w)) n++;
  return n;
}

/** La familia de cada categoría de dato (para exigir que la frase enseñada TRAIGA ese dato). */
const CATEGORY_FAMILY: Record<string, string> = {
  telefono: "phone", telefonos: "phone", phone: "phone", phones: "phone",
  numero: "phone", numeros: "phone", number: "phone", numbers: "phone",
  telefone: "phone", telefones: "phone",
  sala: "room", room: "room",
  hora: "hour", horas: "hour", hour: "hour", hours: "hour",
  fecha: "date", date: "date",
  dia: "day", dias: "day", day: "day", days: "day",
  dosis: "dose", dose: "dose", doses: "dose",
};

/** Las palabras de cada familia de dato (la categoría y sus nombres, es/en/pt). */
const FAMILY_WORDS: Record<string, readonly string[]> = {
  phone: [
    "telefono", "telefonos", "telefone", "telefones", "phone", "phones",
    "numero", "numeros", "number", "numbers", "linea", "line",
  ],
  room: ["sala", "salas", "room", "rooms"],
  hour: ["hora", "horas", "hour", "hours"],
  date: ["fecha", "fechas", "date", "dates", "data"],
  day: ["dia", "dias", "day", "days", "data"],
  dose: ["dosis", "dose", "doses"],
};

const DATE_NAME_RE =
  /\b(lunes|martes|miercoles|jueves|viernes|sabado|sabados|domingo|domingos|monday|tuesday|wednesday|thursday|friday|saturday|sunday|segunda|terca|quarta|quinta|sexta|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/;

/** Las palabras de una frase, plegadas, como conjunto. */
function wordSet(sentence: string): Set<string> {
  return new Set(foldWord(sentence).split(/[^a-zñ]+/).filter(Boolean));
}

/** ¿Trae el texto una ristra de ≥ 7 dígitos (la forma de un teléfono)? */
function hasPhoneCluster(sentence: string): boolean {
  const clusters = sentence.match(/\d[\d .-]*\d/g) ?? [];
  // T1 (barrido «revisa todo», clase 3): la guarda de tarjeta de la
  // gemela del verificador (isCardCluster, ADV2-01) llega por fin a
  // esta copia: una ristra que ES una tarjeta no es forma de
  // teléfono, aquí tampoco.
  return clusters.some((c) => c.replace(/\D/g, "").length >= 7 && !isCardCluster(c));
}

/**
 * ¿TRAE la frase fuente el dato de la categoría omitida? (segunda
 * adversaria, ADV2-03: la segunda pata que la cura de H-03 declinó
 * y la medición demostró necesaria). Compartir tema no basta: la
 * frase de los 300 puestos comparte «mercado» y «pueblo» con la
 * respuesta y no contiene ningún día que enseñar.
 */
function sourceCarriesCategory(sentence: string, category: string): boolean {
  const family = CATEGORY_FAMILY[category];
  if (!family) return true; // categoría fuera del mapa (el conjunto es cerrado): manda la vara anterior
  const words = wordSet(sentence);
  const has = (ws: readonly string[]) => ws.some((w) => words.has(w));
  switch (family) {
    case "phone": {
      if (hasPhoneCluster(sentence)) return true;
      // T1, la otra mitad del asiento: la frase de la tarjeta
      // también entraba por la palabra genérica «número», y la caja
      // la enseñaba como el teléfono omitido («…tarjeta de la
      // clínica es 4111 1111 1111 1111», omission: true). Con una
      // ristra-tarjeta presente y sin ristra telefónica de verdad,
      // la palabra genérica no rescata: solo las palabras propias
      // de teléfono cuentan. El suelo del 911 queda intacto: su
      // ristra no es tarjeta y «número» sigue bastando.
      const clusters = sentence.match(/\d[\d .-]*\d/g) ?? [];
      if (clusters.some((c) => isCardCluster(c))) {
        return has(["telefono", "telefonos", "telefone", "telefones", "phone", "phones", "llame", "llama", "llamar", "call", "ligar", "discar"]);
      }
      return has(["telefono", "telefonos", "telefone", "telefones", "phone", "phones", "numero", "numeros", "number", "numbers", "llame", "llama", "llamar", "call", "ligar", "discar"]);
    }
    case "room":
      return has(["sala", "salas", "room", "rooms"]);
    case "hour":
      return has(["hora", "horas", "hour", "hours"]) || /\d{1,2}:\d{2}/.test(sentence);
    case "date":
    case "day":
      return (
        has(["fecha", "fechas", "date", "dates", "data", "dia", "dias", "day", "days"]) ||
        DATE_NAME_RE.test(foldWord(sentence)) ||
        /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(sentence)
      );
    case "dose":
      return (
        has(["dosis", "dose", "doses"]) ||
        /\d+(?:[.,]\d+)?\s*(ml|mg|mcg|kg|g|miligramos?|gramos?|comprimidos?|pastillas?|cucharadas?|cucharaditas?|gotas|tabletas?|capsulas?|unidades?)\b/.test(
          foldWord(sentence),
        )
      );
  }
  return true;
}

function sameFigure(a: FigureMeasure, b: FigureMeasure): boolean {
  // C-08: el juicio de rangos. Un valor dentro del rango ajeno — con
  // la tolerancia de redondeo a la precisión con que se afirma — es
  // la misma cifra; fuera, contradice. Rango contra rango con
  // solape basta (declarado): dos guías que se pisan no se acusan.
  const aRange = a.min !== undefined && a.max !== undefined ? { min: a.min, max: a.max } : null;
  const bRange = b.min !== undefined && b.max !== undefined ? { min: b.min, max: b.max } : null;
  if (aRange && bRange) return aRange.min <= bRange.max && bRange.min <= aRange.max;
  const range = aRange ?? bRange;
  if (range) {
    const plain = aRange ? b : a;
    const tol = 0.5 * Math.pow(10, -plain.decimals) + 1e-9;
    return plain.value >= range.min - tol && plain.value <= range.max + tol;
  }
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

/** ¿Trae la frase alguna cifra juzgable? (La vara de evidenceNumbers: 2+ dígitos o parte decimal.) */
function hasJudgedDigit(sentence: string): boolean {
  return numberTokens(sentence).some((t) => {
    const digits = t.replace(/[.,]/g, "");
    return digits.length >= 2 || /[.,]\d/.test(t);
  });
}

/** Categorías de dato que se dan en cifras (R-05), sobre palabras plegadas. */
const DATUM_CATEGORY_WORDS = new Set([
  "telefono", "telefonos", "numero", "numeros", "phone", "phones", "number", "numbers",
  "telefone", "telefones", "dosis", "dose", "doses", "hora", "horas", "hour", "hours",
  "fecha", "date", "dia", "dias", "day", "days", "sala", "room",
]);

/** La primera categoría de dato que la frase nombra, o null. */
function datumCategoryOf(sentence: string): string | null {
  for (const w of foldWord(sentence).split(/[^a-zñ]+/)) {
    if (DATUM_CATEGORY_WORDS.has(w)) return w;
  }
  return null;
}

function clipSourceSentence(s: string): string {
  return s.length > SOURCE_SENTENCE_MAX ? `${s.slice(0, SOURCE_SENTENCE_MAX - 1)}…` : s;
}

/**
 * Las contradicciones cifra a cifra entre la respuesta y sus
 * fuentes. Vacío en la inmensa mayoría (así debe ser: la ausencia
 * de avisos no certifica nada, su presencia sí señala).
 */
export function findNumberConflicts(answerText: string, chunks: readonly RetrievedChunk[]): NumberConflict[] {
  if (!answerText || chunks.length === 0) return [];
  const sourceSentences: Array<{ text: string; measures: FigureMeasure[] }> = [];
  // R-05: las frases fuente con cifras juzgables aunque no lleven
  // unidad («…llame al 520-555-0147» no tiene medida y hoy ni entraba
  // en la caja): son la evidencia del caso de omisión.
  const digitSentences: string[] = [];
  for (const chunk of chunks) {
    for (const s of splitSentences(chunk.body)) {
      const measures = measuresIn(s);
      if (measures.length > 0) sourceSentences.push({ text: s, measures });
      if (hasJudgedDigit(s)) digitSentences.push(s);
    }
  }
  if (sourceSentences.length === 0 && digitSentences.length === 0) return [];

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

  // R-05, el caso inverso (la red): la falsedad por OMISIÓN. Una frase
  // de la respuesta que nombra la categoría del dato sin dar ninguna
  // cifra («el teléfono … es el número de emergencia»), cuando una
  // fuente trae ese dato en cifras y del mismo tema: se enseña la
  // frase fuente, como en las contradicciones. No retira nada de la
  // respuesta; rompe el silencio si la regla del dato pedido del
  // verificador (grounding.ts) estimó mal la señal.
  for (const answerSentence of splitSentences(answerText)) {
    if (conflicts.length >= MAX_CONFLICTS) break;
    if (APPROXIMATION.test(answerSentence)) continue;
    const category = datumCategoryOf(answerSentence);
    if (!category) continue;
    if (measuresIn(answerSentence).length > 0 || hasJudgedDigit(answerSentence)) continue;
    // La fuente que se enseña es la de MAYOR tema compartido: con el
    // primer «mismo tema» a secas, a la pregunta del teléfono se le
    // enseñaría la frase de la cita (comparte «cita») en vez de la
    // del número (comparte «para cambiar la cita»).
    // Adversaria H-03: el tema se mide en palabras SUSTANTIVAS y el
    // suelo es DOS. Una sola palabra compartida — y menos aún un
    // genérico como «número» o «año» — no es tema: la red le colgó
    // la cifra de un museo a una frase cualitativa sobre visitantes
    // que no omitía ningún dato debido.
    // Segunda adversaria (ADV2-03/04) acota el suelo en las dos
    // direcciones: la frase enseñada ha de TRAER la categoría del
    // dato (sourceCarriesCategory) y las palabras de función no
    // cuentan como tema (FUNCTION_TOPIC_WORDS); y con UNA sustantiva
    // ajena a la categoría basta si la categoría misma se comparte
    // («emergencia» + «número») — el suelo de dos a secas dejaba
    // escapar el 911, el dato canónico de R-05.
    const familyWords = new Set(FAMILY_WORDS[CATEGORY_FAMILY[category] ?? ""] ?? []);
    const answerWords = wordSet(answerSentence);
    let source: string | null = null;
    let bestTopic = 0;
    let bestShared = 0;
    for (const s of digitSentences) {
      if (!sourceCarriesCategory(s, category)) continue;
      const topic = substantiveSharedWords(answerSentence, s);
      const shared = sharedContentWords(answerSentence, s);
      const sWords = wordSet(s);
      const categoryShared = [...familyWords].some((w) => answerWords.has(w) && sWords.has(w));
      let nonCatTopic = 0;
      if (categoryShared) {
        const bw = contentWords(s);
        for (const w of contentWords(answerSentence))
          if (bw.has(w) && !GENERIC_TOPIC_WORDS.has(w) && !FUNCTION_TOPIC_WORDS.has(w) && !familyWords.has(w)) nonCatTopic++;
      }
      if (topic < 2 && !(nonCatTopic >= 1 && categoryShared)) continue;
      if (topic > bestTopic || (topic === bestTopic && shared > bestShared)) {
        bestTopic = topic;
        bestShared = shared;
        source = s;
      }
    }
    if (!source) continue;
    const dedupe = `omission:${category}:${source.slice(0, 40)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    conflicts.push({ unit: category, sourceSentence: clipSourceSentence(source), omission: true });
  }
  return conflicts;
}

/**
 * C-07: la caja aprende fechas. La hermana de findNumberConflicts con
 * la misma forma de nota (`unit: "fecha"`): el juicio vive en
 * dates.ts (R1–R5) y aquí solo se convierte en aviso cuando hay una
 * frase de la fuente emparejada que enseñar — sin frase que enseñar
 * no hay aviso (un R1 sin pareja lo retira la pierna del verificador
 * en la ruta verificada; la caja es la red de la ruta sin verificar y
 * su contrato es enseñar la fuente). Mismo tope que su hermana; en la
 * costura de ChatScreen las cifras van primero y ganan el empate.
 */
export function findDateConflicts(
  answerText: string,
  chunks: readonly RetrievedChunk[],
  referenceDate: Date = new Date(),
): NumberConflict[] {
  if (!answerText || chunks.length === 0) return [];
  const sources = parseSourceDateSentences(
    chunks.flatMap((c) => splitSentences(c.body)),
    referenceDate,
  );
  if (!sources.some((s) => s.mentions.length > 0)) return [];
  const conflicts: NumberConflict[] = [];
  const seen = new Set<string>();
  for (const answerSentence of splitSentences(answerText)) {
    const info = dateConflictForSentence(answerSentence, sources, referenceDate);
    if (!info?.sourceSentence) continue;
    const dedupe = `fecha:${info.sourceSentence.slice(0, 40)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    conflicts.push({ unit: "fecha", sourceSentence: clipSourceSentence(info.sourceSentence) });
    if (conflicts.length >= MAX_CONFLICTS) return conflicts;
  }
  return conflicts;
}
