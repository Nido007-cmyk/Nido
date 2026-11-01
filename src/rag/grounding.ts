/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * grounding.ts — NIDO: anclaje de respuestas a las fuentes RAG (Fase 3:
 * "mejor no inventar").
 *
 * Evidencia física (Tab A9+, v0.1.6, Qwen2.5-0.5B): para "fotosíntesis" el
 * RAG trajo "Photosynthesis" (81%) y "Chloroplast" (77%), pero la respuesta
 * dijo que la luz se absorbe "in a process called phototropism", que la luz
 * "is transported to the roots" y que el agua "is absorbed by the leaves".
 * Nada de eso está en las fuentes (assets/corpus/corpus.json, entrada
 * "Photosynthesis"): el modelo lo sacó de su "conocimiento general".
 *
 * Causas raíz encontradas en el código (src/rag/pure.ts, antes de este fix):
 *  1. La instrucción le PERMITÍA inventar: "If the context doesn't cover the
 *     question, say so and answer from general knowledge."
 *  2. Las fuentes iban al final de un mensaje de sistema largo, separadas de
 *     la pregunta por todo el historial: lo más lejos posible de donde el
 *     modelo mira al generar ("Lost in the Middle", Liu et al. 2023).
 *  3. Se generaba a temperatura 0.7 (preset de charla) aunque hubiera
 *     fuentes.
 *  4. Nada comprobaba la respuesta contra las fuentes después.
 *
 * Un 0.5B no se vuelve más listo; este módulo es la parte de CÓDIGO del
 * arreglo (la parte de prompt está en pure.ts y la de muestreo en
 * ChatScreen):
 *
 *  - verifyGroundedAnswer(): verificación determinista por FRASE. Cada frase
 *    se reduce a sus palabras de contenido (sin palabras vacías, raíz
 *    aproximada) y se mide qué fracción aparece en las fuentes. Las frases
 *    sin respaldo se quitan y se avisa. Si no queda ninguna, la respuesta
 *    se sustituye por un "no lo sé" honesto + lo que la fuente SÍ dice
 *    (extracto literal, citado). Ese es el punto del pipeline donde se
 *    decide el "no lo sé": después de generar, con la respuesta y las
 *    fuentes delante — antes no se puede saber si el modelo se ciñó.
 *  - Cada frase conservada sin cita recibe la [n] de la fuente que más la
 *    respalda (enlace afirmación → fuente, determinista).
 *  - Post-chequeo de cifras (programa bounty, tanda 1; lógica adaptada
 *    de Commonplace, Apache-2.0): cada cifra de la respuesta tiene que
 *    salir de la evidencia, con su redondeo honesto (evidenceNumbers.ts).
 *    Una cifra inventada tumba la frase en las dos rutas, la de la misma
 *    lengua y la de lengua cruzada.
 *  - Si la respuesta está en otro idioma que las fuentes (pregunta en
 *    español, corpus en inglés), la comparación léxica no es válida: no se
 *    inventa un veredicto. Solo se comprueban cifras (iguales en todos los
 *    idiomas) y citas; el estado queda "unverified" y la UI lo dice.
 *  - Idioma por frase (R-04, ronda 0.1.68): un chunk puede mezclar
 *    idiomas (un documento importado con el mismo texto en es/en/pt) y
 *    el modelo copia la frase gemela en el idioma equivocado; el apoyo
 *    léxico la aprueba porque la frase ESTÁ en el chunk. Ahora una copia
 *    literal cuya gemela con las mismas cifras puntúe mejor en el idioma
 *    de la pregunta se sustituye por esa gemela; sin gemela, se retira.
 *    Detectar sin actuar era el fallo: el pie ya decía «otro idioma» y
 *    la frase se servía igual.
 *  - El dato pedido (R-05, misma ronda): si la pregunta pide un dato
 *    que se da en cifras y la evidencia lo trae, una frase que afirma
 *    qué es ese dato SIN darlo («el teléfono es el número de
 *    emergencia») se sustituye por la frase fuente que lo trae. Las
 *    puertas de cifras juzgan cifras presentes; esta juzga la
 *    ausencia del dato debido.
 *
 * Limitación honesta: es una heurística léxica (sin modelo de NLI, que no
 * cabe en el presupuesto de RAM). Detecta afirmaciones con vocabulario
 * ajeno a las fuentes —el patrón de la evidencia— pero no una frase que
 * reordene palabras de la fuente para decir algo falso.
 *
 * Puro, sin dependencias, 100% testeable.
 */

import type { SentenceProvenance } from "./provenance";
import { evidenceNumberValues, numberTokens, parseNumberToken, sentenceNumbersSupported } from "./evidenceNumbers";

export type GroundingLang = "es" | "en" | "pt";

export type GroundingStatus =
  /** Todas las frases verificables tienen respaldo en las fuentes. */
  | "grounded"
  /** Se quitaron frases sin respaldo; el resto sí lo tiene. */
  | "partial"
  /** Nada tenía respaldo (o el modelo dijo no saber): "no lo sé" + extracto. */
  | "abstained"
  /** Idioma distinto al de las fuentes: no se pudo verificar frase a frase. */
  | "unverified"
  /** No aplica (sin fuentes, respuesta vacía, modelo razonador). */
  | "skipped";

export interface GroundingChunk {
  title: string;
  body: string;
}

export interface GroundingResult {
  text: string;
  status: GroundingStatus;
  /** Frases quitadas por no tener respaldo. */
  removed: number;
  /** Frases conservadas. */
  kept: number;
  /**
   * 0.1.61: de dónde sale cada frase del texto final (provenance.ts). Ausente
   * en «skipped» por modelo razonador o respuesta vacía.
   */
  sentences?: SentenceProvenance[];
}

// ------------------------------------------------------------- texto

const STOPWORDS = new Set(
  (
    // en
    "a an the and or but if then than so as of in on at to for from by with without into onto over under " +
    "about above below between through during before after while is are was were be been being am do does " +
    "did done have has had having it its it's this that these those there here their them they he she him " +
    "her his hers we us our you your i me my mine not no nor can could would should will shall may might " +
    "must also just very much many more most some any each every all both such only own same other another " +
    "which who whom whose what when where why how called known like make makes made use uses used using " +
    "get gets got one ones thing things way ways part well even still yet however therefore thus because " +
    "since although though whether either neither per via etc according source sources context " +
    // es
    "el la los las un una unos unas y o u e pero si sino que de del al en con sin por para sobre entre " +
    "hasta desde durante ante tras es son era eran fue fueron ser sido siendo esta este estos estas ese " +
    "esa esos esas eso esto aquel aquella estar esta estan estaba estaban hay ha han habia haber se su sus " +
    "lo le les me te nos mi mis tu tus yo tu el ella ellos ellas nosotros usted ustedes muy mas menos tambien " +
    "solo ya aun como cuando donde quien quienes cual cuales cuyo porque pues asi tanto cada todo toda todos " +
    "todas otro otra otros otras mismo misma puede pueden hace hacen hacer llamado llamada llamados segun " +
    "fuente fuentes contexto ademas parte forma manera " +
    // pt
    "o os um uma uns umas e ou mas se que de do da dos das no na nos nas em com sem por para pelo pela " +
    "sobre entre ate desde durante e sao era eram foi foram ser sido sendo esta este estes estas esse essa " +
    "esses essas isso isto aquele aquela estar estao estava ha tem seu sua seus suas lhe me te nos meu minha " +
    "voce voces ele ela eles elas muito mais menos tambem so ja ainda como quando onde quem qual quais " +
    "porque assim cada todo toda todos todas outro outra outros outras mesmo mesma pode podem faz fazem fazer " +
    "chamado chamada segundo fonte fontes contexto alem"
  ).split(/\s+/),
);

/** Palabras vacías típicas de cada idioma, para detectar el idioma de un texto. */
const LANG_HINTS: Record<GroundingLang, Set<string>> = {
  en: new Set("the and is are was were of to in that it with for this which by from have has not".split(" ")),
  es: new Set("el la los las y es son del que en por para con una un se su lo como pero mas".split(" ")),
  pt: new Set("o os as e sao do da dos das que em por para com uma um se seu sua como mas nao".split(" ")),
};

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function words(text: string): string[] {
  return stripAccents(text.toLowerCase())
    .replace(/\[\d+\]/g, " ")
    .replace(/[^a-z0-9ñ\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
}

/** Raíz aproximada: quita sufijos frecuentes (en/es/pt) y corta a 7 letras. */
export function stem(w: string): string {
  let s = w;
  for (const suf of [
    "ations", "ation", "ings", "ing", "ies", "ied", "edly", "ed", "es", "s",
    "ciones", "cion", "mente", "amente", "coes", "cao",
  ]) {
    if (s.length - suf.length >= 4 && s.endsWith(suf)) {
      s = s.slice(0, s.length - suf.length);
      break;
    }
  }
  return s.slice(0, 7);
}

function contentStems(text: string): string[] {
  return words(text)
    .filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !STOPWORDS.has(w))
    .map((w) => (/^\d/.test(w) ? w : stem(w)));
}

export function detectTextLang(text: string): GroundingLang | null {
  const ws = words(text);
  if (ws.length < 4) return null;
  let best: GroundingLang | null = null;
  let bestScore = 0;
  let second = 0;
  for (const lang of ["en", "es", "pt"] as GroundingLang[]) {
    const score = ws.filter((w) => LANG_HINTS[lang].has(w)).length / ws.length;
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = lang;
    } else if (score > second) {
      second = score;
    }
  }
  // Señal débil o empate (es/pt comparten muchas palabras): sin veredicto.
  if (bestScore < 0.08 || bestScore - second < 0.03) return null;
  return best;
}

/**
 * Cuántas palabras pista de `lang` trae el texto, sin umbrales. La regla
 * de idioma por frase (R-04) compara puntuaciones entre dos frases
 * concretas en vez de pedir un veredicto absoluto: hay frases clínicas
 * cortas cuyo idioma detectTextLang no se atreve a decir (la del jarabe
 * en español da null: su única pista es «el») y aun así su gemela
 * portuguesa puntúa más en portugués que ella.
 */
export function langHintCount(text: string, lang: GroundingLang): number {
  const hints = LANG_HINTS[lang];
  return words(text).filter((w) => hints.has(w)).length;
}

/** Divide en frases conservando la puntuación final y las citas [n]. */
export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\r/g, "")
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}¿¡"«“(\d*•-])|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts;
}

// --------------------------------------------------------- abstención

const IDK_RE = new RegExp(
  [
    // es
    // «no sé» / «no lo sé». Without the accent only «no lo se»: a bare
    // «no se» is the reflexive in «su médico no se lo ha prohibido», which
    // made a first aid step count as "I don't know" (0.1.59).
    "\\bno (lo )?sé(?![\\p{L}])",
    "\\bno lo se(?![\\p{L}])",
    "\\bno (tengo|encuentro|encontr[eé]|hay) (esa |la |suficiente |ninguna )?informaci[oó]n",
    "\\blas fuentes no (lo |la )?(mencionan|dicen|contienen|incluyen|explican|hablan)",
    "\\bno (se )?(menciona|explica|aparece) en las fuentes",
    // en
    "\\bi (don'?t|do not) know\\b",
    "\\b(the )?(sources?|context) (do(es)?n'?t|do(es)? not) (mention|contain|say|cover|include|explain)",
    "\\bnot (mentioned|covered|stated|explained) in the (sources?|context)",
    "\\bno information (about|on)\\b",
    // pt
    "\\bn[aã]o sei(?![\\p{L}])",
    "\\bn[aã]o (tenho|encontrei|h[aá]) (essa |a |informa)",
    "\\bas fontes n[aã]o",
  ].join("|"),
  "iu",
);

export function isAbstention(sentence: string): boolean {
  return IDK_RE.test(sentence);
}

// ------------------------------------------------------- verificación

export interface SentenceSupport {
  /** Fracción de palabras de contenido presentes en las fuentes (0..1). */
  support: number;
  /** Palabras de contenido ausentes de todas las fuentes. */
  novel: number;
  /** Total de palabras de contenido únicas de la frase. */
  total: number;
  /** Índice (0-based) de la fuente que más respalda la frase, o -1. */
  bestChunk: number;
}

export function sentenceSupport(sentence: string, chunkStemSets: Set<string>[]): SentenceSupport {
  const stems = [...new Set(contentStems(sentence))];
  const union = new Set<string>();
  for (const set of chunkStemSets) for (const s of set) union.add(s);
  const found = stems.filter((s) => union.has(s)).length;
  let bestChunk = -1;
  let bestHits = 0;
  chunkStemSets.forEach((set, i) => {
    const hits = stems.filter((s) => set.has(s)).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestChunk = i;
    }
  });
  return {
    support: stems.length ? found / stems.length : 1,
    novel: stems.length - found,
    total: stems.length,
    bestChunk,
  };
}

/**
 * Umbrales (documentados y cubiertos por tests con la evidencia real):
 *  - frases con menos de 3 palabras de contenido no se juzgan ("¡Claro!");
 *  - sin respaldo si < 50% de sus palabras están en las fuentes, o si trae
 *    2+ términos ajenos y el respaldo no llega al 75% (el caso
 *    "process called phototropism": 3/5 = 60% con 2 términos nuevos).
 */
export const MIN_JUDGED_TERMS = 3;
export const MIN_SUPPORT = 0.5;
export const STRICT_SUPPORT = 0.75;
export const MAX_NOVEL_LOOSE = 2;

export function isSupported(s: SentenceSupport): boolean {
  if (s.total < MIN_JUDGED_TERMS) return true;
  if (s.support < MIN_SUPPORT) return false;
  if (s.novel >= MAX_NOVEL_LOOSE && s.support < STRICT_SUPPORT) return false;
  return true;
}

const NOTE: Record<"removed", Record<GroundingLang, string>> = {
  removed: {
    es: "(Quité {{n}} frase(s) que las fuentes offline no respaldan.)",
    en: "(I removed {{n}} sentence(s) that the offline sources don't support.)",
    pt: "(Removi {{n}} frase(s) que as fontes offline não confirmam.)",
  },
};

const IDK_TEXT: Record<GroundingLang, string> = {
  es: "No lo sé con certeza: las fuentes offline no responden exactamente a eso, y prefiero no inventar.",
  en: "I don't know for sure: the offline sources don't answer exactly that, and I'd rather not make things up.",
  pt: "Não sei com certeza: as fontes offline não respondem exatamente a isso, e prefiro não inventar.",
};

const EXTRACT_INTRO: Record<GroundingLang, string> = {
  es: "Esto es lo que sí dice la fuente «{{title}}»:",
  en: "Here's what the source “{{title}}” does say:",
  pt: "Isto é o que a fonte “{{title}}” diz:",
};

/** Primeras frases literales de la fuente principal, citadas. */
export function extractiveSnippet(chunk: GroundingChunk, index: number, maxChars = 320, lang?: GroundingLang | null): string {
  let sentences = splitSentences(chunk.body.trim());
  if (lang) {
    // R-04: en un chunk multilingüe el extracto prefiere las frases del
    // idioma de la pregunta (antes salían las primeras del chunk,
    // acertaran o no con el idioma de quien pregunta).
    const own = sentences.filter((s) => detectTextLang(s) === lang);
    if (own.length > 0) {
      sentences = [...own, ...sentences.filter((s) => detectTextLang(s) !== lang)];
    }
  }
  let out = "";
  for (const s of sentences) {
    if (out && out.length + s.length + 1 > maxChars) break;
    out = out ? `${out} ${s}` : s;
    if (out.length >= maxChars * 0.6) break;
  }
  if (!out) out = chunk.body.trim().slice(0, maxChars);
  return `${out} [${index + 1}]`;
}

export function honestAbstention(chunks: GroundingChunk[], lang: GroundingLang): string {
  if (chunks.length === 0) return IDK_TEXT[lang];
  const intro = EXTRACT_INTRO[lang].split("{{title}}").join(chunks[0].title);
  return `${IDK_TEXT[lang]}\n\n${intro}\n${extractiveSnippet(chunks[0], 0, 320, lang)}`;
}

/** Quita citas [n] que no corresponden a ninguna fuente (el modelo inventa números). */
export function stripInvalidCitations(text: string, chunkCount: number): string {
  return text.replace(/\s?\[(\d+)\]/g, (m, n) => {
    const k = Number(n);
    return k >= 1 && k <= chunkCount ? m : "";
  });
}

function hasCitation(sentence: string): boolean {
  return /\[\d+\]/.test(sentence);
}

function addCitation(sentence: string, n: number): string {
  // Antes de la puntuación final: "… energía química [1]."
  const m = /^(.*?)([.!?…]+)?$/su.exec(sentence);
  if (!m) return `${sentence} [${n}]`;
  return `${m[1].trimEnd()} [${n}]${m[2] ?? ""}`;
}

/**
 * Cifras de la evidencia (tanda 1 del programa bounty, evidenceNumbers.ts):
 * los valores que las fuentes afirman, contra los que se juzga cada
 * cifra de la respuesta — con redondeo y escala, no por dígitos.
 */

// ------------------------------------------------ negaciones (0.1.59)

/**
 * Negation words. They are not content words, so the support check above is
 * blind to them: «no está sangrando» → «está sangrando» kept 100% support.
 * Seen on a tablet in the aspirin rule of the chest-pain guide.
 */
const NEGATION_RE = /(?<![\p{L}])(no|nunca|jam[aá]s|ni|sin|tampoco|ning[uú]n[oa]?|nada|not|never|nor|without|none|n[aã]o|nem|sem|nenhum[a]?)(?![\p{L}])|n['’]t(?![\p{L}])/giu;

export function negationCount(text: string): number {
  return (text.match(NEGATION_RE) ?? []).length;
}

/**
 * The source sentence that shares the most content words with `sentence`
 * (at least 3), or null. Used to compare negations sentence by sentence.
 */
export function closestSourceSentence(sentence: string, sourceSentences: string[]): string | null {
  const want = new Set(contentStems(sentence));
  let best: string | null = null;
  let bestHits = 0;
  for (const src of sourceSentences) {
    const hits = new Set(contentStems(src).filter((w) => want.has(w))).size;
    if (hits > bestHits) {
      bestHits = hits;
      best = src;
    }
  }
  // Only a sentence that is mostly a copy of ONE source sentence is compared
  // (85% of its content words): one that merges two would lose the other.
  return bestHits >= MIN_JUDGED_TERMS && want.size > 0 && bestHits / want.size >= 0.85 ? best : null;
}

// ------------------------------------------- idioma por frase (R-04)

/** Una frase de las fuentes, con el chunk del que sale. */
export interface SourceSentenceRec {
  text: string;
  chunk: number;
}

/** Todas las lecturas de todas las cifras de un texto, como conjunto. */
function numberValueSet(text: string): Set<number> {
  const out = new Set<number>();
  for (const token of numberTokens(text)) {
    for (const v of parseNumberToken(token)) out.add(v);
  }
  return out;
}

function sameNumbers(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/**
 * La frase fuente de la que `sentence` es copia (literal o casi), o null.
 * Umbrales propios, no los de closestSourceSentence: el 85 % está
 * calibrado para la negación dentro de la misma lengua, y una copia
 * entre lenguas hermanas pierde raíces por el camino («veces» → «vece»
 * contra «vezes» → «veze»: el híbrido real de la ronda comparte 5/6 de
 * sus raíces con su fuente portuguesa y aun así ES una copia). Se
 * exige: ≥ 3 raíces compartidas, ≥ 75 % de las raíces de la frase
 * salen de ESA fuente, y la frase cubre ≥ 50 % de las raíces de la
 * fuente (un fragmento suelto de una frase larga no cuenta como copia).
 */
function bestCopySource(sentence: string, recs: SourceSentenceRec[]): SourceSentenceRec | null {
  const want = new Set(contentStems(sentence));
  if (want.size < MIN_JUDGED_TERMS) return null;
  let best: SourceSentenceRec | null = null;
  let bestScore = 0;
  for (const rec of recs) {
    const srcStems = new Set(contentStems(rec.text));
    let hits = 0;
    for (const w of want) if (srcStems.has(w)) hits++;
    if (hits < MIN_JUDGED_TERMS) continue;
    const ofSentence = hits / want.size;
    const ofSource = hits / Math.max(1, srcStems.size);
    if (ofSentence < 0.75 || ofSource < 0.5) continue;
    const score = ofSentence + ofSource;
    if (score > bestScore) {
      bestScore = score;
      best = rec;
    }
  }
  return best;
}

/**
 * La gemela de `copy` en el idioma de la pregunta: otra frase fuente
 * con LAS MISMAS cifras, solape léxico real con la copia (≥ 3 raíces y
 * ≥ 1/3 del conjunto menor) y mejor puntuación de pistas en el idioma
 * de la pregunta que la propia copia. El empate de pistas solo vale si
 * la candidata SÍ tiene veredicto claro en el idioma de la pregunta y
 * la copia no (la frase del teléfono: «para» puntúa en las dos, pero
 * solo la española tiene veredicto «es»). Una candidata con veredicto
 * claro de un tercer idioma nunca es la gemela.
 */
function findSourceTwin(copy: SourceSentenceRec, recs: SourceSentenceRec[], lang: GroundingLang): SourceSentenceRec | null {
  const nums = numberValueSet(copy.text);
  const copyStems = new Set(contentStems(copy.text));
  const copyHints = langHintCount(copy.text, lang);
  const copyLang = detectTextLang(copy.text);
  let best: SourceSentenceRec | null = null;
  let bestOverlap = 0;
  for (const cand of recs) {
    if (cand === copy) continue;
    const candLang = detectTextLang(cand.text);
    if (candLang !== null && candLang !== lang) continue;
    if (!sameNumbers(numberValueSet(cand.text), nums)) continue;
    const candStems = new Set(contentStems(cand.text));
    let overlap = 0;
    for (const w of candStems) if (copyStems.has(w)) overlap++;
    if (overlap < MIN_JUDGED_TERMS) continue;
    if (overlap * 3 < Math.min(candStems.size, copyStems.size)) continue;
    const hints = langHintCount(cand.text, lang);
    const wins = hints > copyHints || (hints === copyHints && candLang === lang && copyLang !== lang);
    if (!wins) continue;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = cand;
    }
  }
  return best;
}

export type ForeignCopyFix =
  | { kind: "replace"; text: string; chunk: number }
  | { kind: "remove" }
  | null;

/**
 * R-04: qué hacer con una frase que copia a las fuentes en un idioma
 * que no es el de la pregunta. Con gemela en el idioma de la pregunta,
 * se sustituye por ella (verbatim, con su cita). Sin gemela, solo se
 * retira si la copia es de otro idioma con veredicto claro; si el
 * idioma de la copia no se distingue del de la pregunta, la frase se
 * deja en paz (el detector es tímido con frases cortas y la frase
 * puede ser legítima). Si la frase no copia a ninguna fuente, null:
 * no es asunto de esta regla.
 */
export function foreignCopyFix(sentence: string, recs: SourceSentenceRec[], lang: GroundingLang): ForeignCopyFix {
  const copy = bestCopySource(sentence, recs);
  if (!copy) return null;
  // Una copia cuyo idioma SÍ tiene veredicto claro y es el de la
  // pregunta ya está en el idioma correcto: no se toca. Sin esta
  // guarda, la gemela portuguesa del teléfono («…ligue para
  // 520-555-0147», de veredicto null y con «para» puntuando como
  // pista española) podía ganar el duelo de pistas y sustituir a la
  // frase española CORRECTA por la portuguesa (bug cazado por la
  // fixture de R-05 antes de publicar este carril).
  if (detectTextLang(copy.text) === lang) return null;
  const twin = findSourceTwin(copy, recs, lang);
  if (twin) return { kind: "replace", text: twin.text, chunk: twin.chunk };
  const copyLang = detectTextLang(copy.text);
  if (copyLang !== null && copyLang !== lang) return { kind: "remove" };
  return null;
}

// ------------------------------------------- el dato pedido (R-05)

/**
 * Ronda física 0.1.68, R-05: a «¿Qué teléfono aparece para cambiar la
 * cita?» la respuesta fue «El teléfono para cambiar la cita es el
 * número de emergencia» — afirma qué es el dato sin darlo, mientras
 * la fuente traía impreso «…llame al 520-555-0147». Ninguna puerta
 * juzgaba el hueco: la de cifras itera las cifras DE LA RESPUESTA
 * (cero cifras → verdad vacua) y la de contradicciones solo contrasta
 * cifras presentes en ambos lados. La falsedad por sustitución sin
 * cifras no tenía puerta; esta es la suya.
 *
 * La regla del dato pedido: si la pregunta pide un dato que se da en
 * cifras (doble condición: señal en la pregunta Y cifra temática en
 * la evidencia), una frase conservada que afirma la identidad de ese
 * dato sin dar ninguna cifra se sustituye por la frase fuente que lo
 * trae (el precedente de sustitución verbatim de 0.1.59) y las
 * demás que hagan lo mismo se retiran. Si alguna frase conservada YA
 * da el dato, la regla no toca nada: afirmar junto al dato dado es
 * hablar del dato, no sustituirlo.
 */

// Señales de «la pregunta pide un dato»: la base de NUMBER_CUES
// (packFacts.ts: teléfono, número, llamar…) ampliada con
// cuánto/cuándo/hora/día/sala. Sobre el texto plegado (sin acentos).
const DATUM_QUESTION_RE =
  /\b(numero|numeros|telefono|telefonos|tel|llamo|llamar|llamas|llama|marco|marcar|linea|number|numbers|phone|call|dial|hotline|telefone|telefones|ligo|ligar|discar|disco|contacto|contact|cuanto|cuanta|cuantos|cuantas|cuando|hora|horas|dia|dias|sala)\b/;

// La categoría del dato en la RESPUESTA (de qué dato afirma ser).
const DATUM_CATEGORY_RE =
  /\b(telefono|telefonos|numero|numeros|phone|phones|number|numbers|telefone|telefones|linea|line|dosis|dose|hora|horas|hour|hours|dia|dias|day|fecha|date|sala|room)\b/;

// La cópula que convierte la mención en afirmación de identidad
// («es el número de…»). Sobre texto plegado «é» se vuelve «e», que
// queda fuera a propósito: la «e» suelta portuguesa es «y», no
// cópula, y casaría de más.
const DATUM_COPULA_RE = /\b(es|son|era|eran|fue|fueron|is|are|was|were|foi|foram|sao)\b/;

// Preguntas «de teléfono» a efectos de la forma del dato (un teléfono
// es una ristra larga de dígitos, no una cifra con unidad). SOLO
// señales de teléfono o de llamada: «número/number» a secas NO está
// (adversaria H-02) — cualquier pregunta por un número (el de la
// tarjeta, el de la sala) activaba la forma telefónica, y la regla
// podía entregar un teléfono como si fuera ese otro dato.
const PHONE_QUESTION_RE =
  /\b(telefono|telefonos|phone|phones|telefone|telefones|llamar|llama|llamo|call|dial|ligar|ligo|discar|disco|linea|hotline)\b/;

function foldForCues(text: string): string {
  return stripAccents((text ?? "").toLowerCase());
}

/** ¿Trae la frase alguna cifra juzgable? (La vara de evidenceNumbers: 2+ dígitos o parte decimal.) */
function hasJudgedDigit(sentence: string): boolean {
  return numberTokens(sentence).some((t) => {
    const digits = t.replace(/[.,]/g, "");
    return digits.length >= 2 || /[.,]\d/.test(t);
  });
}

/** ¿Trae el texto una ristra de ≥ 7 dígitos (la forma de un teléfono)? «9:30» o «2026» no lo son. */
function hasPhoneCluster(text: string): boolean {
  const clusters = text.match(/\d[\d .-]*\d/g) ?? [];
  return clusters.some((c) => c.replace(/\D/g, "").length >= 7);
}

/** Cuántas raíces de contenido comparte la frase con la pregunta. */
function sharedStemCount(sentence: string, queryStems: Set<string>): number {
  let shared = 0;
  for (const w of new Set(contentStems(sentence))) if (queryStems.has(w)) shared++;
  return shared;
}

/**
 * Las raíces-etiqueta del dato (número, teléfono y familia): prueban
 * que una frase HABLA de un dato, no de CUÁL. Como «tema sustantivo
 * compartido» no cuentan (adversaria H-02: la frase del 911 comparte
 * «número» con «¿cuál es el número de la tarjeta?» y no por eso trae
 * el dato de la tarjeta). Se derivan con el propio stem() para que
 * las formas es/en/pt caigan en la misma raíz que produce el conteo.
 */
const GENERIC_DATUM_STEMS = new Set(
  ["numero", "numeros", "number", "numbers", "telefono", "telefonos", "phone", "phones", "telefone", "telefones"].map(
    stem,
  ),
);

/** Raíces compartidas con la pregunta que son tema sustantivo (no la etiqueta del dato). */
function substantiveStemCount(sentence: string, queryStems: Set<string>): number {
  let shared = 0;
  for (const w of new Set(contentStems(sentence)))
    if (queryStems.has(w) && !GENERIC_DATUM_STEMS.has(w)) shared++;
  return shared;
}

/**
 * Cuánto casa una frase con la pregunta a efectos del dato: 2 por
 * raíz de contenido compartida, +3 si la pregunta es de teléfono y la
 * frase trae la ristra telefónica (la forma del dato también es tema:
 * es lo único que empareja pregunta y fuente entre idiomas).
 */
function datumScore(sentence: string, queryStems: Set<string>, phoneQuestion: boolean): number {
  return 2 * sharedStemCount(sentence, queryStems) + (phoneQuestion && hasPhoneCluster(sentence) ? 3 : 0);
}

/**
 * La frase fuente que trae EL dato que la pregunta pide: la de mayor
 * datumScore entre las ELEGIBLES. Elegible = lleva cifras juzgables
 * y es el mismo tipo de dato que se pide (adversaria H-02): comparte
 * al menos una raíz sustantiva con la pregunta, o trae la forma
 * telefónica ante una pregunta de teléfono de verdad (la vía que
 * empareja entre idiomas, donde puede no haber raíces que
 * compartir). «Algún dígito temático» ya no basta: sin elegible, la
 * evidencia no contiene ese dato y no hay sustitución que hacer —
 * y menos con el dato de otro. Null si no hay elegible.
 */
function pickDatumSentence(query: string, recs: SourceSentenceRec[]): SourceSentenceRec | null {
  const queryStems = new Set(contentStems(query));
  const phoneQuestion = PHONE_QUESTION_RE.test(foldForCues(query));
  let best: SourceSentenceRec | null = null;
  let bestScore = 0;
  for (const rec of recs) {
    if (!hasJudgedDigit(rec.text)) continue;
    const phoneForm = phoneQuestion && hasPhoneCluster(rec.text);
    if (substantiveStemCount(rec.text, queryStems) === 0 && !phoneForm) continue;
    const score = datumScore(rec.text, queryStems, phoneQuestion);
    if (score >= 2 && score > bestScore) {
      bestScore = score;
      best = rec;
    }
  }
  return best;
}

/** ¿Afirma la frase qué es el dato (categoría + cópula) sin dar ninguna cifra? */
function assertsDatumIdentity(sentence: string): boolean {
  if (hasJudgedDigit(sentence)) return false;
  const folded = foldForCues(sentence);
  return DATUM_CATEGORY_RE.test(folded) && DATUM_COPULA_RE.test(folded);
}

/**
 * Aplica la regla del dato pedido sobre las frases conservadas (kept
 * y prov caminan juntos): sustituye al primer infractor por la frase
 * fuente del dato y retira los demás infractores. Devuelve cuántas
 * frases se retiraron de más y si hubo sustitución. Sin pregunta, sin
 * señal en ella o sin el dato en la evidencia: no toca nada.
 */
export function applyDatumRule(
  kept: string[],
  prov: SentenceProvenance[],
  query: string,
  recs: SourceSentenceRec[],
): { removedExtra: number; replaced: boolean } {
  const none = { removedExtra: 0, replaced: false };
  if (!query || !DATUM_QUESTION_RE.test(foldForCues(query))) return none;
  const datum = pickDatumSentence(query, recs);
  if (!datum) return none;
  const queryStems = new Set(contentStems(query));
  const phoneQuestion = PHONE_QUESTION_RE.test(foldForCues(query));
  const delivered = kept.some(
    (s, i) => prov[i].origin.kind !== "abstain" && hasJudgedDigit(s) && datumScore(s, queryStems, phoneQuestion) >= 2,
  );
  if (delivered) return none;
  const offenders: number[] = [];
  kept.forEach((s, i) => {
    if (prov[i].origin.kind !== "abstain" && assertsDatumIdentity(s)) offenders.push(i);
  });
  if (offenders.length === 0) return none;
  const first = offenders[0];
  const fixed = addCitation(datum.text, datum.chunk + 1);
  kept[first] = fixed;
  prov[first] = { text: fixed, origin: { kind: "source", n: datum.chunk + 1, support: 1 } };
  let removedExtra = 0;
  for (const i of offenders.slice(1).reverse()) {
    kept.splice(i, 1);
    prov.splice(i, 1);
    removedExtra++;
  }
  return { removedExtra, replaced: true };
}

export function verifyGroundedAnswer(
  answer: string,
  chunks: GroundingChunk[],
  lang: GroundingLang,
  /** La pregunta del usuario (R-05: la regla del dato pedido la necesita; sin ella, la regla no actúa). */
  query = "",
): GroundingResult {
  const trimmed = (answer ?? "").trim();
  if (!trimmed) return { text: trimmed, status: "skipped", removed: 0, kept: 0 };
  if (chunks.length === 0) {
    // Sin fuentes: todo lo que dice es del modelo, salvo que diga no saber.
    const sentences = splitSentences(trimmed).map((s) => ({
      text: s,
      origin: isAbstention(s) ? ({ kind: "abstain" } as const) : ({ kind: "model", reason: "no-sources" } as const),
    }));
    return { text: trimmed, status: "skipped", removed: 0, kept: 0, sentences };
  }
  // Modelos razonadores (bloques <think>): la UI los trata aparte; no se tocan.
  if (/<think>/i.test(trimmed)) {
    return { text: trimmed, status: "skipped", removed: 0, kept: 0 };
  }

  const cleaned = stripInvalidCitations(trimmed, chunks.length);
  const sentences = splitSentences(cleaned);
  const chunkTexts = chunks.map((c) => `${c.title}. ${c.body}`);

  // Idioma de la respuesta vs. idioma de las fuentes.
  const answerLang = detectTextLang(cleaned);
  const sourceLang = detectTextLang(chunkTexts.join(" "));
  const sameLanguage = answerLang === null || sourceLang === null || answerLang === sourceLang;

  const evidenceNums = evidenceNumberValues(chunkTexts);

  // Las frases de las fuentes, por chunk (la negación de 0.1.59 las usa
  // por chunk; la regla de idioma de R-04 las recorre todas con su chunk).
  const chunkSentences = chunks.map((c) => splitSentences(c.body.trim()).map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean));
  const sourceRecs: SourceSentenceRec[] = [];
  chunkSentences.forEach((ss, i) => {
    for (const text of ss) sourceRecs.push({ text, chunk: i });
  });

  if (!sameLanguage) {
    // Sin comparación léxica válida: solo cifras (independientes del idioma).
    // Tanda 1 del programa bounty: la comparación ya no es por dígitos
    // exactos — «16,4 millones» es la misma cifra que «16,431,599» —
    // sino por valor con redondeo y escala (evidenceNumbers.ts).
    // R-04: la copia literal en el idioma equivocado SÍ se puede juzgar
    // en esta rama (copia y gemela no necesitan comparación léxica
    // general), y se juzga: sustituida por su gemela o retirada. Si al
    // final no queda ninguna frase «del modelo», el estado ya no es
    // «unverified»: lo que queda es verbatim de las fuentes.
    let removed = 0;
    let sourceFixed = 0;
    const kept: string[] = [];
    const langProv: SentenceProvenance[] = [];
    for (const s of sentences) {
      if (isAbstention(s)) {
        kept.push(s);
        langProv.push({ text: s, origin: { kind: "abstain" } });
        continue;
      }
      if (!sentenceNumbersSupported(s, evidenceNums)) {
        removed++;
        continue;
      }
      const fix = foreignCopyFix(s, sourceRecs, lang);
      if (fix?.kind === "remove") {
        removed++;
        continue;
      }
      if (fix?.kind === "replace") {
        const fixed = addCitation(fix.text, fix.chunk + 1);
        kept.push(fixed);
        langProv.push({ text: fixed, origin: { kind: "source", n: fix.chunk + 1, support: 1 } });
        sourceFixed++;
        continue;
      }
      kept.push(s);
      langProv.push({ text: s, origin: { kind: "model", reason: "unverified-language" } });
    }
    // R-05: la regla del dato pedido también manda en esta rama — la
    // puerta de cifras sola no basta contra una falsedad sin cifras.
    const datumFix = applyDatumRule(kept, langProv, query, sourceRecs);
    removed += datumFix.removedExtra;
    if (datumFix.replaced) sourceFixed++;
    if (kept.length === 0) {
      return abstainedResult(chunks, lang, removed);
    }
    let text = kept.join(" ");
    if (removed > 0) {
      const note = NOTE.removed[lang].split("{{n}}").join(String(removed));
      text += `\n\n${note}`;
      langProv.push({ text: note, origin: { kind: "fixed" } });
    }
    const anyModel = langProv.some((p) => p.origin.kind === "model");
    const status: GroundingStatus = anyModel ? "unverified" : sourceFixed > 0 ? (removed > 0 ? "partial" : "grounded") : "unverified";
    return { text, status, removed, kept: kept.length, sentences: langProv };
  }

  const chunkStemSets = chunkTexts.map((t) => new Set(contentStems(t)));
  let removed = 0;
  let negationFixed = 0; // counted for tests and logs; replaced sentences are verbatim, so still "grounded"
  let languageFixed = 0; // R-04: copias sustituidas por su gemela en el idioma de la pregunta
  let abstained = false;
  let judgedKept = 0;
  const kept: string[] = [];
  const prov: SentenceProvenance[] = [];
  for (const s of sentences) {
    if (isAbstention(s)) {
      abstained = true;
      kept.push(s);
      prov.push({ text: s, origin: { kind: "abstain" } });
      continue;
    }
    const sup = sentenceSupport(s, chunkStemSets);
    // Tanda 1 del programa bounty (post-chequeo de citas de Commonplace):
    // una cifra que no sale de la evidencia tumba la frase aunque sus
    // palabras estén apoyadas — «fundada en 1904» contra la fuente
    // «1804» pasaba con el apoyo léxico solo, porque la cifra errónea
    // contaba como una palabra nueva más. Vale el redondeo honesto:
    // «26,5» por 26,52 y «16,4 millones» por 16.431.599 no se tocan.
    if (!sentenceNumbersSupported(s, evidenceNums)) {
      removed++;
      continue;
    }
    if (!isSupported(sup)) {
      removed++;
      continue;
    }
    // R-04: una copia literal en el idioma equivocado pasa el apoyo
    // (la frase ESTÁ en el chunk, en su bloque de otro idioma). Antes
    // de la negación: la gemela trae la negación de la fuente, así que
    // sustituir por ella es estrictamente mejor que comparar negaciones.
    const langFix = foreignCopyFix(s, sourceRecs, lang);
    if (langFix?.kind === "remove") {
      removed++;
      continue;
    }
    if (langFix?.kind === "replace") {
      if (sup.total >= MIN_JUDGED_TERMS) judgedKept++;
      languageFixed++;
      const fixed = addCitation(langFix.text, langFix.chunk + 1);
      kept.push(fixed);
      prov.push({ text: fixed, origin: { kind: "source", n: langFix.chunk + 1, support: 1 } });
      continue;
    }
    if (sup.total >= MIN_JUDGED_TERMS) judgedKept++;
    // 0.1.59: a sentence that copies a source sentence but flips a negation
    // is replaced by the source sentence itself, word for word.
    if (sup.total >= MIN_JUDGED_TERMS && sup.bestChunk >= 0) {
      const src = closestSourceSentence(s, chunkSentences[sup.bestChunk]);
      if (src && negationCount(s.replace(/\[\d+\]/g, "")) !== negationCount(src)) {
        negationFixed++;
        const fixed = addCitation(src, sup.bestChunk + 1);
        kept.push(fixed);
        prov.push({ text: fixed, origin: { kind: "source", n: sup.bestChunk + 1, support: 1, negationFixed: true } });
        continue;
      }
    }
    // Enlace afirmación → fuente: si la frase no cita, se le pone la [n] de
    // la fuente que más palabras comparte con ella.
    const out =
      !hasCitation(s) && sup.total >= MIN_JUDGED_TERMS && sup.bestChunk >= 0
        ? addCitation(s, sup.bestChunk + 1)
        : s;
    kept.push(out);
    prov.push({
      text: out,
      origin:
        sup.total >= MIN_JUDGED_TERMS && sup.bestChunk >= 0
          ? { kind: "source", n: sup.bestChunk + 1, support: sup.support }
          : { kind: "model", reason: "too-short-to-check" },
    });
  }

  // R-05: la regla del dato pedido sobre lo conservado — la falsedad
  // por sustitución sin cifras pasó todas las puertas de arriba
  // (cifras vacua, apoyo por unión de chunks). El recuento de
  // juzgadas se rehace si la regla tocó algo: una sustitución cuenta
  // como conservada de la fuente; una retirada, como retirada.
  const datumFix = applyDatumRule(kept, prov, query, sourceRecs);
  removed += datumFix.removedExtra;
  if (datumFix.removedExtra > 0 || datumFix.replaced) {
    judgedKept = kept.reduce(
      (acc, s, i) => acc + (prov[i].origin.kind !== "abstain" && new Set(contentStems(s)).size >= MIN_JUDGED_TERMS ? 1 : 0),
      0,
    );
  }

  // Nada verificable sobrevivió (todo inventado, o solo "no lo sé"):
  // "no lo sé" honesto + lo que la fuente sí dice.
  if (judgedKept === 0 && (removed > 0 || abstained)) {
    return abstainedResult(chunks, lang, removed);
  }

  let text = kept.join(" ").replace(/\s+\n/g, "\n").trim();
  if (removed > 0) {
    const note = NOTE.removed[lang].split("{{n}}").join(String(removed));
    text += `\n\n${note}`;
    prov.push({ text: note, origin: { kind: "fixed" } });
    return { text, status: "partial", removed, kept: kept.length, sentences: prov };
  }
  return { text, status: "grounded", removed: 0, kept: kept.length, sentences: prov };
}

/** «No lo sé» honesto + lo que la fuente sí dice, con su procedencia. */
function abstainedResult(chunks: GroundingChunk[], lang: GroundingLang, removed: number): GroundingResult {
  const sentences: SentenceProvenance[] = [{ text: IDK_TEXT[lang], origin: { kind: "abstain" } }];
  if (chunks.length > 0) {
    sentences.push({ text: EXTRACT_INTRO[lang].split("{{title}}").join(chunks[0].title), origin: { kind: "fixed" } });
    sentences.push({ text: extractiveSnippet(chunks[0], 0, 320, lang), origin: { kind: "source", n: 1, support: 1 } });
  }
  return { text: honestAbstention(chunks, lang), status: "abstained", removed, kept: 0, sentences };
}

// ------------------------------------------- "no lo sé" antes de generar

const FACTUAL_QUESTION_RE = new RegExp(
  [
    // es («qué día»/«qué fecha» añadidos por R-06-P3: la pregunta de la
    // ronda —«¿Qué día y a qué hora es la cita?»— no era "de hechos" para
    // esta red y el «no lo sé» determinista no habría disparado ni en la
    // rama protegida)
    "^[¿¡]?\\s*(qu[eé] (es|son|fue|fueron|significa|causa|hace)|qu[eé] (d[ií]a|fecha)|qui[eé]n(es)? (es|son|fue|fueron|invent[oó]|descubri[oó]|escribi[oó])|cu[aá]ndo|d[oó]nde|cu[aá]l(es)? (es|son|fue)|cu[aá]nt[oa]s?|por qu[eé]|c[oó]mo (funciona|funcionan|se (forma|hace|produce))|expl[ií]ca(me)?|define)(?![\\p{L}\\p{N}])",
    // en
    "^\\s*(what (is|are|was|were|does|causes)|who (is|was|were|invented|discovered|wrote)|when (is|was|were|did)|where (is|are|was|were)|which|how (many|much|does|do|is)|why|explain|define)(?![\\p{L}\\p{N}])",
    // pt
    "^\\s*(o que (é|e|são|sao|foi)|quem (é|e|foi|inventou|descobriu|escreveu)|quando|onde|qual|quais|quant[oa]s?|por que|como (funciona|se forma)|explique|explica|defina)(?![\\p{L}\\p{N}])",
  ].join("|"),
  "iu",
);

/** ¿Es una pregunta de hechos (no una petición creativa ni de opinión)? */
export function isFactualQuestion(query: string): boolean {
  const q = (query ?? "").trim();
  if (!q || q.length > 300) return false;
  // Creativo / opinión: el modelo puede contestar sin fuentes.
  if (/\b(poema|poem|poesia|cuento|story|historia corta|chiste|joke|piada|opini[oó]n|opinion|opini[aã]o|imagina|imagine|escribe|write|escreva|redacta|traduce|translate|traduza|resume|summari[sz]e|resuma)\b/i.test(q)) {
    return false;
  }
  return FACTUAL_QUESTION_RE.test(q);
}

const NO_SOURCES_TEXT: Record<GroundingLang, string> = {
  es:
    "No encontré información sobre esto en las fuentes offline de NIDO, así que prefiero no inventar una respuesta. " +
    "Puedes reformular la pregunta, añadir tus propios documentos o descargar un paquete de conocimiento más grande en Ajustes.",
  en:
    "I couldn't find anything about this in NIDO's offline sources, so I'd rather not make up an answer. " +
    "You can rephrase the question, add your own documents, or download a larger knowledge pack in Settings.",
  pt:
    "Não encontrei informação sobre isso nas fontes offline do NIDO, então prefiro não inventar uma resposta. " +
    "Você pode reformular a pergunta, adicionar seus próprios documentos ou baixar um pacote de conhecimento maior nas Configurações.",
};

/** Respuesta determinista cuando la recuperación no trajo nada para una pregunta de hechos. */
export function noSourcesAnswer(lang: GroundingLang): string {
  return NO_SOURCES_TEXT[lang];
}
