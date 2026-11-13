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
import { evidenceNumberValues, evidenceRanges, numberTokens, parseNumberToken, sentenceNumbersSupported } from "./evidenceNumbers";
import { dateConflictForSentence, parseSourceDateSentences } from "./dates";

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
  /**
   * Adversaria H-07: este fragmento es un resto truncado por el
   * presupuesto de contexto (fitChunksToBudget). El verificador juzga
   * contra el cuerpo que recibe — que en la ruta fija ya es el resto
   * que el modelo vio, no la fuente entera — y la marca queda visible
   * en su entrada para que ningún consumidor lo trate como completo.
   */
  truncated?: boolean;
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

/**
 * C2-H1 (barrido 0.1.96): la abstención no puede servir de contrabando.
 * «No lo sé, pero la dosis recomendada es de 25 ml» se conservaba entera
 * como abstención, sin pasar por cifras, dosis ni dato, y salía
 * «grounded» con el dato inventado dentro. Una frase que se abstiene Y
 * afirma algo se juzga por lo que afirma, como cualquier otra frase del
 * modelo. Afirma cuando, quitada la abstención:
 *  - queda una conjunción de contraste con contenido detrás («pero…»,
 *    «aunque…», «but…», «however…», «mas…», «porém…»), en cualquier
 *    orden respecto de la abstención;
 *  - o una cópula seguida de una cifra («es de 25 ml», «is 25 ml»,
 *    «é de 25 ml») que no sea la de una pregunta indirecta («no sé cuál
 *    es la dosis para 2 años» sigue siendo abstención pura).
 * La abstención pura («no lo sé», «las fuentes no lo mencionan») se
 * conserva como hasta ahora.
 */
const ABSTENTION_CONTRAST_RE =
  /(?:^|[\s,;:—–-])(?:pero|sin embargo|aunque|no obstante|but|however|though|although|yet|mas|por[eé]m|contudo|entretanto|embora|todavia)\s+(?:\S+\s+){0,2}\p{L}{3,}/iu;
// Límites por letra, no \b: «é» no es carácter de palabra para \b en JS.
const ABSTENTION_COPULA_DIGIT_RE =
  /(?<!(?<![\p{L}])(?:cu[aá]l(?:es)?|qu[eé]|cu[aá]nt[oa]s?|what|which|how much|how many|qual|quais|quant[oa]s?|o que)\s)(?<![\p{L}])(?:es|son|era|ser[aá]|is|are|was|will be|é|são)(?![\p{L}])[^.!?\d]{0,40}\d/iu;

export function isPureAbstention(sentence: string): boolean {
  if (!IDK_RE.test(sentence)) return false;
  // Lo que queda al quitar la frase de abstención.
  const rest = sentence.replace(new RegExp(IDK_RE.source, "giu"), " ");
  if (ABSTENTION_CONTRAST_RE.test(rest)) return false;
  if (ABSTENTION_COPULA_DIGIT_RE.test(rest)) return false;
  return true;
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

/**
 * C2-H4 (barrido 0.1.96): el nombre compuesto inglés del teléfono es UN
 * término. «teléfono» (es) y «telefone» (pt) son una palabra; «phone
 * number» eran dos raíces, y la frase fiel inglesa «The phone number to
 * change the appointment is 520-555-0147» contra «To change the
 * appointment call 520-555-0147» quedaba en 5/7 = 0,714, bajo
 * STRICT_SUPPORT, cuando sus gemelas es/pt dan 5/6 = 0,83. La vara no se
 * mueve: solo se cuenta el término inglés como lo cuentan es y pt.
 */
const EN_PHONE_COMPOUND_RE = /\b(tele)?phone[\s-]+numbers?\b/gi;

export function sentenceSupport(sentence: string, chunkStemSets: Set<string>[]): SentenceSupport {
  const stems = [...new Set(contentStems(sentence.replace(EN_PHONE_COMPOUND_RE, "$1phone")))];
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

/**
 * Auditoría 0.1.79: el apartado de cierre de una guía («… — Importante»:
 * en qué fuentes se basa, haz un curso) no dice nada de la pregunta. Si es
 * la primera fuente, el extracto «Esto es lo que sí dice…» usa la
 * siguiente; si no hay otra, la de siempre.
 */
const CLOSING_TITLE_RE = /\s[—–-]\s*(?:Importante|Important)\s*$/i;

/** La fuente que se enseña primero: la mejor que no sea un apartado de cierre (o la primera). */
export function primarySourceIndex(chunks: readonly { title?: string }[]): number {
  const i = chunks.findIndex((c) => !CLOSING_TITLE_RE.test(c.title ?? ""));
  return i < 0 ? 0 : i;
}

export function honestAbstention(chunks: GroundingChunk[], lang: GroundingLang): string {
  if (chunks.length === 0) return IDK_TEXT[lang];
  const i = primarySourceIndex(chunks);
  const intro = EXTRACT_INTRO[lang].split("{{title}}").join(chunks[i].title);
  return `${IDK_TEXT[lang]}\n\n${intro}\n${extractiveSnippet(chunks[i], i, 320, lang)}`;
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

/**
 * La copia corta (T-J7, barrido «revisa todo» J7): la gemela breve
 * de closestSourceSentence para la pierna de negación. Una frase de
 * 2 raíces nunca llega a la vía principal (exige ≥3 aciertos y el
 * 85 %), así que «El paciente está sangrando.» contra «El paciente
 * no está sangrando.» salía TAL CUAL, sellada y sin cita. La copia
 * corta exige la copia entera: TODAS las raíces de la respuesta
 * están en la frase fuente, y esa frase no es mucho más larga (las
 * raíces de la respuesta son al menos la mitad de las suyas). Un
 * tema compartido dentro de una frase larga no es una copia y no
 * se toca; una raíz sola es demasiado poco y queda fuera.
 */
export function closestShortCopySentence(sentence: string, candidates: string[]): string | null {
  const want = new Set(contentStems(sentence));
  if (want.size < 2) return null;
  let best: string | null = null;
  let bestRatio = 0;
  for (const cand of candidates) {
    const have = new Set(contentStems(cand));
    let hits = 0;
    for (const s of want) if (have.has(s)) hits++;
    if (hits < want.size) continue;
    const ratio = hits / Math.max(1, have.size);
    if (ratio < 0.5) continue;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = cand;
    }
  }
  return best;
}

/**
 * La copia corta de UNA cláusula de una frase fuente larga (auditoría
 * de la 0.1.70, punto 5b). closestShortCopySentence exige que la frase
 * de la respuesta cubra la mitad de las raíces de su fuente, así que
 * «El paciente está sangrando.» contra «El paciente no está sangrando
 * y respira con normalidad tras la caída.» salía tal cual. Aquí la
 * frase fuente se trocea en cláusulas (comas, punto y coma, dos
 * puntos, los cierres de frase que el troceo de frases no vio, como
 * «seguridad.** Muchas…», y las conjunciones «y/e/and»,
 * «pero/but/mas», «o/or/ou») y
 * la vara es la cláusula: todas las raíces de la respuesta caben en
 * una cláusula, y su recuento de negaciones difiere del de la
 * respuesta. Solo frases cortas (2 raíces, por debajo de
 * MIN_JUDGED_TERMS; las largas siguen su vía, sin cambio). Se
 * devuelve la frase fuente entera, palabra por palabra, como hace la
 * capa desde 0.1.59; y nunca cuando alguna cláusula de cualquier
 * frase de las fuentes contiene esas raíces con la misma polaridad
 * que la respuesta (hay una lectura fiel, así que no se toca), ni
 * cuando dos frases fuente candidatas discrepan entre sí.
 */
const CLAUSE_SPLIT_RE = /[,;:.!?]|\s(?:y|e|and|pero|but|mas|o|or|ou)\s/iu;

export function negatedClauseSource(
  sentence: string,
  candidates: string[],
  allSources: string[],
): string | null {
  const bare = sentence.replace(/\[\d+\]/g, "");
  const want = new Set(contentStems(bare));
  if (want.size < 2 || want.size >= MIN_JUDGED_TERMS) return null;
  const neg = negationCount(bare);
  const holds = (clause: string) => {
    const have = new Set(contentStems(clause));
    for (const w of want) if (!have.has(w)) return false;
    return true;
  };
  for (const src of allSources) {
    for (const clause of src.split(CLAUSE_SPLIT_RE)) {
      if (holds(clause) && negationCount(clause) === neg) return null;
    }
  }
  const hits = candidates.filter((src) => src.split(CLAUSE_SPLIT_RE).some((c) => holds(c) && negationCount(c) !== neg));
  return hits.length === 1 ? hits[0]! : null;
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
 *
 * T-J1 (barrido «revisa todo»): la doble condición sigue mandando
 * en esta pierna de identidad sin cifras. La pierna tipada (la
 * afirmación CON cifras que no casan con su tipo) ya no depende de
 * la señal de la pregunta: su perímetro nuevo está asentado en el
 * docstring de applyDatumRule.
 */

// Señales de «la pregunta pide un dato»: la base de NUMBER_CUES
// (packFacts.ts: teléfono, número, llamar…) ampliada con
// cuánto/cuándo/hora/día/sala. Sobre el texto plegado (sin acentos).
// ADV2-A: entran room/hora/fecha/dosis en sus formas en/pt además de
// las es — la lista era española y una pregunta inglesa de sala
// («what room…») ni siquiera llegaba a la regla. Añadir una señal
// solo deja que la regla CONSIDERE la pregunta: la sustitución
// sigue necesitando infractor y dato del tipo en la evidencia.
const DATUM_QUESTION_RE =
  /\b(numero|numeros|telefono|telefonos|tel|llamo|llamar|llamas|llama|marco|marcar|linea|number|numbers|phone|call|dial|hotline|telefone|telefones|ligo|ligar|discar|disco|contacto|contact|cuanto|cuanta|cuantos|cuantas|cuando|hora|horas|hour|hours|dia|dias|sala|room|rooms|dosis|dose|doses|fecha|fechas|date|dates|data)\b/;

// La categoría del dato en la RESPUESTA (de qué dato afirma ser).
const DATUM_CATEGORY_RE =
  /\b(telefono|telefonos|numero|numeros|phone|phones|number|numbers|telefone|telefones|linea|line|dosis|dose|hora|horas|hour|hours|dia|dias|day|fecha|date|sala|room)\b/;

// La cópula que convierte la mención en afirmación de identidad
// («es el número de…»). Sobre texto plegado «é» se vuelve «e», que
// queda fuera a propósito: la «e» suelta portuguesa es «y», no
// cópula, y casaría de más.
const DATUM_COPULA_RE = /\b(es|son|era|eran|fue|fueron|is|are|was|were|foi|foram|sao)\b/;

/**
 * T-J2 (barrido «revisa todo», J2): la cópula de la afirmación,
 * con la portuguesa «é» leída ANTES del pliegue. La lista de arriba
 * corre sobre texto plegado, donde «é» ya es «e» — la conjunción
 * —, y por esa exclusión deliberada TODA afirmación tipada en
 * portugués quedaba exenta de la pierna: la dosis falsa de un
 * dígito se sellaba fundada en pt mientras su gemela es se retiraba
 * desde A3-03. La salida no es meter «e» en la lista (abriría la
 * conjunción), sino mirar el token acentuado en el texto sin
 * plegar: «é» suelto, con fronteras de no-letra, es cópula en pt y
 * no existe como palabra en es. Dentro de palabra («café») no
 * caza: la letra anterior lo cierra.
 */
function hasDatumCopula(sentence: string): boolean {
  if (DATUM_COPULA_RE.test(foldForCues(sentence))) return true;
  return /(?:^|[^\p{L}])é(?![\p{L}])/u.test((sentence ?? "").toLowerCase());
}

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

/**
 * ¿Es la ristra una TARJETA y no un teléfono? (segunda adversaria,
 * ADV2-01): 15–16 dígitos agrupados como se imprimen las tarjetas
 * (4-4-4-4, 4-6-5 o la ristra corrida) casan el conteo de dígitos
 * de «forma telefónica», y la regla servía el número de la tarjeta
 * como teléfono de la clínica. Un teléfono no se imprime así.
 */
export function isCardCluster(cluster: string): boolean {
  const digits = cluster.replace(/\D/g, "");
  if (digits.length !== 15 && digits.length !== 16) return false;
  const groups = cluster
    .trim()
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map((g) => g.replace(/\D/g, "").length);
  if (groups.length === 1) return true;
  const key = groups.join("-");
  return key === "4-4-4-4" || key === "4-6-5";
}

/** La forma telefónica de verdad: ristra de ≥7 dígitos que NO es una tarjeta. */
function hasPhoneForm(text: string): boolean {
  const clusters = text.match(/\d[\d .-]*\d/g) ?? [];
  return clusters.some((c) => c.replace(/\D/g, "").length >= 7 && !isCardCluster(c));
}

/** ¿Trae el texto una ristra con forma de tarjeta? */
function hasCardForm(text: string): boolean {
  const clusters = text.match(/\d[\d .-]*\d/g) ?? [];
  return clusters.some((c) => isCardCluster(c));
}

// ---------------------------------------------------------------
// El TIPO del dato (segunda adversaria ADV2-01 + corrida de Grok
// ADV-G1/G2). La regla comparaba CIFRAS, no tipos: el empate entre
// dos datos se rompía por el orden de la fuente, y una afirmación
// con las cifras de OTRO dato (el teléfono servido como número de
// tarjeta; el 911 servido como teléfono de la cita) pasaba sellada
// porque «las cifras están en la fuente». Desde esta tanda, cuando
// la pregunta nombra un tipo concreto, el dato servido y las
// cifras afirmadas han de ser DE ESE TIPO.

type DatumType = "phone" | "card" | "room" | "hour" | "date" | "dose";

/**
 * Palabra → tipo, sobre texto plegado. «número/number» NO está: es
 * la etiqueta genérica, no un tipo — «¿cuál es el número de…?» solo
 * gana tipo cuando nombra el dato (tarjeta, sala, hora…). El tipo
 * de un texto es el de su PRIMERA palabra de tipo: «el teléfono de
 * la sala» pide un teléfono; «la sala del teléfono», una sala.
 */
const DATUM_TYPE_BY_WORD = new Map<string, DatumType>();
for (const w of ["tarjeta", "tarjetas", "cartao", "cartoes", "card", "cards"]) DATUM_TYPE_BY_WORD.set(w, "card");
for (const w of ["sala", "salas", "room", "rooms"]) DATUM_TYPE_BY_WORD.set(w, "room");
for (const w of ["hora", "horas", "hour", "hours"]) DATUM_TYPE_BY_WORD.set(w, "hour");
for (const w of ["fecha", "fechas", "date", "dates", "data", "dia", "dias", "day", "days"])
  DATUM_TYPE_BY_WORD.set(w, "date");
for (const w of ["dosis", "dose", "doses"]) DATUM_TYPE_BY_WORD.set(w, "dose");
for (const w of [
  "telefono", "telefonos", "telefone", "telefones", "phone", "phones", "linea", "line", "hotline",
  "llamar", "llama", "llamo", "call", "dial", "ligar", "ligo", "discar", "disco",
])
  DATUM_TYPE_BY_WORD.set(w, "phone");

/** El tipo de dato que el texto nombra primero, o null si solo usa la etiqueta genérica. */
function datumTypeOfText(text: string): DatumType | null {
  for (const w of foldForCues(text).split(/[^a-zñ0-9]+/)) {
    const t = DATUM_TYPE_BY_WORD.get(w);
    if (t) return t;
  }
  return null;
}

/** Las palabras que nombran cada tipo junto a su cifra (la forma sola no basta: sala, fecha, dosis). */
const TYPE_NEAR_WORDS: Record<Exclude<DatumType, "phone">, readonly string[]> = {
  card: ["tarjeta", "tarjetas", "cartao", "cartoes", "card", "cards"],
  room: ["sala", "salas", "room", "rooms"],
  hour: ["hora", "horas", "hour", "hours"],
  date: ["fecha", "fechas", "date", "dates", "data", "dia", "dias", "day", "days"],
  dose: ["dosis", "dose", "doses"],
};

/** Tokens de un texto plegado, palabras y cifras en orden (para la cercanía palabra↔cifra). */
function foldedTokens(text: string): string[] {
  return foldForCues(text).match(/[a-zñ]+|\d+(?:[.,]\d+)?/g) ?? [];
}

/** ¿Nombra la frase el tipo a ≤5 palabras antes (o ≤2 después) de una cifra? */
function namesTypeNearDigit(sentence: string, typeWords: readonly string[]): boolean {
  const set = new Set(typeWords);
  const toks = foldedTokens(sentence);
  for (let i = 0; i < toks.length; i++) {
    if (!/\d/.test(toks[i])) continue;
    for (let j = Math.max(0, i - 5); j <= Math.min(toks.length - 1, i + 2); j++) {
      if (j !== i && set.has(toks[j])) return true;
    }
  }
  return false;
}

const DATE_NAME_RE =
  /\b(lunes|martes|miercoles|jueves|viernes|sabado|sabados|domingo|domingos|monday|tuesday|wednesday|thursday|friday|saturday|sunday|segunda|terca|quarta|quinta|sexta|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/;

/**
 * Las unidades que unen una cifra a la dosis. T-J2 trajo
 * «colher(es)» pt: sin ella, la dosis fiel portuguesa (G08) solo se
 * salvaba por la exclusión de «é», no por juicio. T-J6 completa la
 * tabla con las unidades en y las formas métricas escritas: sin
 * «tablets» la dosis CORRECTA en inglés (G06) se retiraba, porque
 * ninguna frase de la fuente ligaba su dígito y el dato quedaba
 * sin portador. La caja ya normalizaba estas unidades; esta tabla
 * solo aprende a reconocerlas junto a la cifra (es/pt/en).
 * ADV-J-C1 completa la familia del inhalador: «puffs» y «sprays»
 * no estaban en ninguna de las dos tablas y la dosis fiel de un
 * inhalador o un spray nasal se seguía retirando, con la infiel
 * ciega en la otra dirección; la pt las escribe igual.
 * ADV-R-C1 (adversaria del carril de restos): la palabra de la
 * dosis en sí quedó fuera en las tres lenguas — es «inhalación/
 * inhalaciones», pt «inalação/inalações», en «inhalation/
 * inhalations» (las claves van plegadas, como todo lo que se
 * compara contra la frase plegada): la fiel es se retiraba igual
 * que la infiel y la caja daba [] ante la dosis cambiada. El
 * censo de familia se cerró sobre el paradigma nombrado: las
 * guías servidas no dosifican el inhalador con ninguna otra
 * palabra de esta familia (grep cero sobre el corpus es/en/pt).
 * RES-R1: la regex se exporta porque la caja la consume — la
 * rama «dose» de sourceCarriesCategory tenía una tercera lista
 * propia, solo-es, ciega al enseñar omisiones; desde esta tanda
 * la familia es una sola y vive aquí.
 */
export const DOSE_MEASURE_RE =
  /\d+(?:[.,]\d+)?\s*(ml|mg|mcg|kg|g|miligramos?|gramos?|comprimidos?|pastillas?|cucharadas?|cucharaditas?|colheres?|gotas|tabletas?|capsulas?|unidades?|teaspoons?|tablespoons?|tablets?|pills?|capsules?|drops?|puffs?|sprays?|inhalaciones|inhalacion|inalacoes|inalacao|inhalations?|units?|milligrams?|grams?|milliliters?|millilitres?)\b/;

/**
 * Auditoría de la 0.1.70 (2026-11-03): la DOSIS MEDIDA en una frase
 * que no es la afirmación tipada («Toma 5 comprimidos cada 8 horas»,
 * «Give 6 puffs», «Que mastique 8 aspirinas infantiles»). La pierna
 * tipada de A3-03 solo mira la frase con categoría y cópula («la dosis
 * es…»), y la vara general de cifras (hasJudgedDigit: 2+ dígitos)
 * deja fuera el dígito único, que es justo como se escribe casi toda
 * dosis. Medido sobre be4ed9d: «Take 5 tablets» contra «Take 2
 * tablets», «Give 6 puffs» contra «2 puffs» y «5 ml» contra «10 ml»
 * salían FUNDADAS con su [1]; con la guía real del dolor de pecho,
 * «8 aspirinas infantiles» contra «2 a 4» también. La caja las
 * marcaba (salvo las aspirinas); el juez las sellaba.
 *
 * Esta pierna vive al lado de la vara y no la toca (MIN_*, isSupported
 * intactos): une cada cifra a su unidad de dosis (la siguiente palabra
 * de unidad a ≤ 3 palabras, sin cruzar otra cifra suelta ni una
 * palabra de tiempo o tamaño), con rangos «2 a 4 / 2 to 4 / 2–4» y los
 * números en letra del 1 al 10, en las fuentes y en la frase. La frase
 * se retira si trae una dosis de una unidad que la evidencia SÍ dosifica
 * y la cifra no cae en ninguna de las de la evidencia para esa unidad.
 * Si la evidencia no dosifica esa unidad, no juzga (no hay contra qué).
 */
const MEASURE_UNIT_KEY: Record<string, string> = {};
for (const [key, words] of Object.entries({
  ml: ["ml", "mililitro", "mililitros", "milliliter", "milliliters", "millilitre", "millilitres"],
  mg: ["mg", "miligramo", "miligramos", "milligram", "milligrams", "miligrama", "miligramas"],
  mcg: ["mcg"],
  g: ["g", "gramo", "gramos", "gram", "grams", "grama", "gramas"],
  tab: ["comprimido", "comprimidos", "pastilla", "pastillas", "tableta", "tabletas", "tablet", "tablets", "pill", "pills", "tablete", "tabletes"],
  cap: ["capsula", "capsulas", "capsule", "capsules"],
  tsp: ["cucharadita", "cucharaditas", "teaspoon", "teaspoons"],
  tbsp: ["cucharada", "cucharadas", "tablespoon", "tablespoons"],
  colher: ["colher", "colheres"],
  drop: ["gota", "gotas", "drop", "drops"],
  puff: ["puff", "puffs", "inhalacion", "inhalaciones", "inhalation", "inhalations", "inalacao", "inalacoes", "jato", "jatos", "pulsacion", "pulsaciones"],
  spray: ["spray", "sprays"],
  aspirin: ["aspirina", "aspirinas", "aspirin", "aspirins"],
})) {
  for (const w of words) MEASURE_UNIT_KEY[w] = key;
}

const MEASURE_NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, um: 1, uma: 1, one: 1,
  dos: 2, two: 2, dois: 2, duas: 2,
  tres: 3, three: 3,
  cuatro: 4, four: 4, quatro: 4,
  cinco: 5, five: 5,
  seis: 6, six: 6,
  siete: 7, seven: 7, sete: 7,
  ocho: 8, eight: 8, oito: 8,
  nueve: 9, nine: 9, nove: 9,
  diez: 10, ten: 10, dez: 10,
};

/** Palabras que cortan la unión cifra→unidad: la cifra es de tiempo, tamaño o frecuencia. */
const MEASURE_STOP_WORDS = new Set([
  "minuto", "minutos", "minute", "minutes", "hora", "horas", "hour", "hours", "segundo", "segundos", "second", "seconds",
  "dia", "dias", "day", "days", "semana", "semanas", "week", "weeks", "mes", "meses", "month", "months",
  "ano", "anos", "year", "years", "cm", "centimetro", "centimetros", "centimeter", "centimeters", "metro", "metros",
  "meter", "meters", "litro", "litros", "liter", "liters", "litre", "litres", "kg", "veces", "vez", "times", "vezes",
  "por", "per", "cada", "every", "each", "x",
]);

const MEASURE_RANGE_WORDS = new Set(["a", "to", "y", "and", "e", "o", "ou", "or"]);

interface DoseMeasure {
  unit: string;
  lo: number;
  hi: number;
}

/** Las dosis medidas de una frase (cifra o número en letra unido a su unidad, con rangos). */
export function doseMeasuresOf(text: string): DoseMeasure[] {
  const folded = foldForCues(text.replace(/\[\d+\]/g, " "));
  const toks: { t: string; start: number; end: number }[] = [];
  for (const m of folded.matchAll(/[a-z]+|\d+(?:[.,]\d+)?/g)) {
    toks.push({ t: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  const valueOf = (t: string): number | null => {
    if (/^\d/.test(t)) return Number(t.replace(",", "."));
    return MEASURE_NUMBER_WORDS[t] ?? null;
  };
  const isUnit = (t: string): boolean => MEASURE_UNIT_KEY[t] !== undefined;
  // La unidad de la cifra en i: la siguiente palabra de unidad a ≤ 3
  // palabras, saltando como mucho un par «cifra unidad» intercalado
  // («2 to 4 low-dose 81 mg aspirins»); una cifra suelta o una palabra
  // de tiempo/tamaño cortan.
  const unitAfter = (i: number, maxSkip = 3): string | null => {
    let skipped = 0;
    for (let j = i + 1; j < toks.length && skipped <= maxSkip; j++) {
      const t = toks[j].t;
      if (isUnit(t)) return MEASURE_UNIT_KEY[t];
      if (MEASURE_STOP_WORDS.has(t)) return null;
      if (valueOf(t) !== null && /^\d/.test(t)) {
        if (j + 1 < toks.length && isUnit(toks[j + 1].t)) {
          j++;
          continue;
        }
        return null;
      }
      skipped++;
    }
    return null;
  };
  const out: DoseMeasure[] = [];
  const used = new Set<number>();
  for (let i = 0; i < toks.length; i++) {
    if (used.has(i)) continue;
    const v = valueOf(toks[i].t);
    if (v === null) continue;
    // Un número en letra solo cuenta junto a su unidad, con como mucho
    // una palabra entre medias («una aspirina», «one adult aspirin»):
    // «una vez», «un vaso» no son dosis.
    const isWord = !/^\d/.test(toks[i].t);
    if (isWord && !unitAfter(i, 1)) continue;
    // ¿Inicio de rango? «N a M unidad», «N–M unidad».
    let hiIdx = i;
    if (i + 2 < toks.length && MEASURE_RANGE_WORDS.has(toks[i + 1].t) && valueOf(toks[i + 2].t) !== null) hiIdx = i + 2;
    else if (i + 1 < toks.length && valueOf(toks[i + 1].t) !== null && /^\s*[-–]\s*$/.test(folded.slice(toks[i].end, toks[i + 1].start))) hiIdx = i + 1;
    const unit = unitAfter(hiIdx, isWord && hiIdx === i ? 1 : 3);
    if (!unit) continue;
    const hiV = valueOf(toks[hiIdx].t)!;
    out.push({ unit, lo: Math.min(v, hiV), hi: Math.max(v, hiV) });
    used.add(hiIdx);
  }
  return out;
}

/**
 * ¿Trae la frase una dosis medida que la evidencia contradice? Solo
 * juzga las unidades que la evidencia dosifica; la frase tipada («la
 * dosis es…») queda para su pierna (A3-03), que además sabe sustituir.
 */
function measuredDoseConflict(sentence: string, evidence: DoseMeasure[]): boolean {
  if (evidence.length === 0) return false;
  if (DATUM_CATEGORY_RE.test(foldForCues(sentence)) && hasDatumCopula(sentence)) return false;
  const mine = doseMeasuresOf(sentence);
  if (mine.length === 0) return false;
  return mine.some((m) => {
    const same = evidence.filter((e) => e.unit === m.unit);
    if (same.length === 0) return false;
    return !same.some((e) => m.lo >= e.lo - 1e-9 && m.hi <= e.hi + 1e-9);
  });
}

/** ¿Trae la frase un dato DEL TIPO (su forma, o su nombre junto a la cifra)? */
function carriesDatumOfType(sentence: string, type: DatumType): boolean {
  switch (type) {
    case "phone":
      return hasPhoneForm(sentence);
    case "card":
      return hasCardForm(sentence) || namesTypeNearDigit(sentence, TYPE_NEAR_WORDS.card);
    case "room":
      return namesTypeNearDigit(sentence, TYPE_NEAR_WORDS.room);
    case "hour":
      return /\d{1,2}:\d{2}/.test(sentence) || namesTypeNearDigit(sentence, TYPE_NEAR_WORDS.hour);
    case "date":
      return (
        (DATE_NAME_RE.test(foldForCues(sentence)) && /\d/.test(sentence)) ||
        /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/.test(sentence) ||
        namesTypeNearDigit(sentence, TYPE_NEAR_WORDS.date)
      );
    case "dose":
      return DOSE_MEASURE_RE.test(foldForCues(sentence)) || namesTypeNearDigit(sentence, TYPE_NEAR_WORDS.dose);
  }
}

/**
 * Los grupos de dígitos significativos de un texto, normalizados
 * (sin ceros a la izquierda). De un decimal solo cuenta la parte
 * entera: la fracción es el territorio del redondeo honesto (la
 * doctrina de la tanda 1), y un grupo suelto de un dígito no juzga
 * (la vara de hasJudgedDigit).
 */
function significantDigitGroups(text: string): string[] {
  const out: string[] = [];
  for (const tok of text.replace(/\[\d+\]/g, " ").match(/\d+(?:[.,]\d+)?/g) ?? []) {
    if (/[.,]/.test(tok)) out.push(tok.split(/[.,]/)[0].replace(/^0+(?=\d)/, ""));
    else if (tok.length >= 2) out.push(tok.replace(/^0+(?=\d)/, ""));
  }
  return out;
}

/**
 * A3-03 (decisión de FV-1): la normalización de UNA cifra sin la
 * vara de longitud de significantDigitGroups — de un decimal solo
 * cuenta la parte entera (la misma doctrina) y se quitan los ceros
 * a la izquierda, pero el dígito único SÍ produce grupo. La consume
 * SOLO la pierna tipada DOSIS dentro de digitsMatchType: en una
 * afirmación tipada dosis el dígito único es el dato entero («9 ml»
 * contra «5 ml»), y la razón de la exención — el ruido de cifras
 * sueltas en prosa — no aplica dentro de una frase que la propia
 * regla ya tipó. La vara general no se toca: fuera de esa pierna,
 * significantDigitGroups y hasJudgedDigit siguen mandando.
 * C2-H3 (barrido 0.1.96) extiende la misma pierna a todo tipo cuando
 * la afirmación nombra el tipo junto a su única cifra («sala 9»).
 */
function digitGroupKeepingSingle(tok: string): string {
  const intPart = /[.,]/.test(tok) ? tok.split(/[.,]/)[0] : tok;
  return intPart.replace(/^0+(?=\d)/, "");
}

/** Los grupos de cifra de un texto con la normalización de A3-03 (el dígito único cuenta). */
function digitGroupsKeepingSingle(text: string): string[] {
  return (text.replace(/\[\d+\]/g, " ").match(/\d+(?:[.,]\d+)?/g) ?? []).map(digitGroupKeepingSingle);
}

/**
 * Los tokens de cifra de una frase UNIDOS al tipo (ADV3, A3-01), en
 * orden de aparición: una cifra de una frase portadora cuenta como
 * cifra DEL TIPO solo si está unida a un ancla del tipo dentro de
 * la misma frase. Las anclas, sobre los tokens plegados (la misma
 * tokenización de foldedTokens, aquí con posición en el texto):
 * - De forma (se unen a sí mismas, sin ventana): la ristra
 *   telefónica (los grupos de hasPhoneForm) a phone; la ristra de
 *   tarjeta (isCardCluster) a card; el token H:MM a hour; la forma
 *   d/m[/aaaa] a date.
 * - De medida (dosis): la unidad de DOSE_MEASURE_RE une el token
 *   numérico inmediatamente anterior (distancia 1: «5 ml»).
 * - De palabra: cada palabra de TYPE_NEAR_WORDS[T] (y, para date,
 *   cada nombre de DATE_NAME_RE) une los grupos cuyo ancla cae en
 *   la ventana [i−3, i+2] alrededor del grupo — más estrecha que la
 *   del portador ([i−5, i+2]): la unión juzga identidad, el
 *   portador solo presencia, y la identidad exige más cercanía.
 * La unión es por tipo e independiente: un grupo puede unirse a
 * dos tipos si cae en las ventanas de dos anclas, y unirse a un
 * tipo no lo desune de otro.
 */
function boundDigitTokens(sentence: string, type: DatumType): string[] {
  const folded = foldForCues(sentence);
  const toks: { text: string; index: number }[] = [];
  for (const m of folded.matchAll(/[a-zñ]+|\d+(?:[.,]\d+)?/g)) toks.push({ text: m[0], index: m.index ?? 0 });

  // Tramos que se unen a sí mismos, sobre el texto plegado.
  const formSpans: { start: number; end: number }[] = [];
  const spanOf = (m: RegExpMatchArray): { start: number; end: number } => {
    const start = m.index ?? 0;
    return { start, end: start + m[0].length };
  };
  if (type === "phone" || type === "card") {
    for (const m of folded.matchAll(/\d[\d .-]*\d/g)) {
      if (type === "phone" && m[0].replace(/\D/g, "").length >= 7 && !isCardCluster(m[0])) formSpans.push(spanOf(m));
      if (type === "card" && isCardCluster(m[0])) formSpans.push(spanOf(m));
    }
  }
  if (type === "hour") for (const m of folded.matchAll(/\d{1,2}:\d{2}/g)) formSpans.push(spanOf(m));
  if (type === "date") for (const m of folded.matchAll(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g)) formSpans.push(spanOf(m));
  // La medida une su número: el tramo del número dentro de cada
  // caza de DOSE_MEASURE_RE.
  if (type === "dose") {
    for (const m of folded.matchAll(new RegExp(DOSE_MEASURE_RE.source, "g"))) {
      const num = /^\d+(?:[.,]\d+)?/.exec(m[0]);
      if (num) formSpans.push({ start: m.index ?? 0, end: (m.index ?? 0) + num[0].length });
    }
  }

  const nearWords = type === "phone" ? null : new Set(TYPE_NEAR_WORDS[type]);
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!/\d/.test(t.text)) continue;
    const end = t.index + t.text.length;
    let bound = formSpans.some((s) => t.index < s.end && s.start < end);
    if (!bound && nearWords) {
      for (let j = Math.max(0, i - 3); j <= Math.min(toks.length - 1, i + 2) && !bound; j++) {
        if (j === i) continue;
        if (nearWords.has(toks[j].text)) bound = true;
        else if (type === "date" && DATE_NAME_RE.test(toks[j].text)) bound = true;
      }
    }
    if (bound) out.push(t.text);
  }
  return out;
}

/**
 * Los grupos significativos de la frase unidos al tipo, en orden de
 * aparición (ADV3, A3-01): la materia de digitsMatchType desde esta
 * tanda. Sin deduplicar: la deduplicación la hace el llamador donde
 * hoy la hace.
 */
function boundDigitGroups(sentence: string, type: DatumType): string[] {
  return boundDigitTokens(sentence, type).flatMap((t) => significantDigitGroups(t));
}

/** La firma de cifras de una frase (para el empate: mismo dato repetido, o datos distintos). */
function digitSignature(text: string): string {
  return [...new Set(significantDigitGroups(text))].sort().join(",");
}

/**
 * ¿Casan las cifras significativas de la frase con un dato DEL TIPO
 * en la evidencia? (ADV-G1/G2: estar en la fuente no basta — el 911
 * está en la fuente y no es el teléfono de la cita.)
 */
function digitsMatchType(
  sentence: string,
  type: DatumType,
  recs: SourceSentenceRec[],
  queryStems?: Set<string>,
  keepSingle = false,
): boolean {
  if (type === "phone" && queryStems && shortPhoneMatches(sentence, recs, queryStems)) return true;
  const carriers = recs.filter((r) => carriesDatumOfType(r.text, type));
  if (carriers.length === 0) return false;
  // A3-03: en la pierna DOSIS los grupos se computan con la
  // normalización que conserva el dígito único (en la afirmación y
  // en las portadoras): sin ella, «mine» salía vacío ante «9 ml» y
  // la comparación ni distinguía la dosis falsa de la fiel.
  // C2-H3: la misma normalización para la afirmación tipada de un
  // dígito de cualquier tipo (keepSingle, que solo pone
  // isTypedDatumOffender cuando la frase no trae cifra juzgable).
  const single = type === "dose" || keepSingle;
  const mine = [...new Set(single ? digitGroupsKeepingSingle(sentence) : significantDigitGroups(sentence))];
  if (mine.length === 0) return false;
  // ADV3 (A3-01): el conjunto del tipo ya no es «todas las cifras
  // de la frase portadora», sino solo las UNIDAS al tipo dentro de
  // cada portadora (boundDigitGroups): en una frase compuesta, la
  // sala ya no hereda el día ni la dosis hereda la sala. Si ninguna
  // cifra juzgable se une al tipo, el conjunto es vacío y la
  // afirmación con cifras de otro dato es infractora.
  const typeGroups = new Set(
    carriers.flatMap((r) =>
      single ? boundDigitTokens(r.text, type).map(digitGroupKeepingSingle) : boundDigitGroups(r.text, type),
    ),
  );
  if (mine.every((g) => typeGroups.has(g))) {
    // C2-H2: el teléfono largo con el dueño cambiado.
    if (type === "phone" && !phoneOwnerAgrees(sentence, carriers.filter((r) => mine.some((g) => boundDigitGroups(r.text, type).includes(g))), recs)) return false;
    return true;
  }
  // La misma cifra con otro agrupamiento («1.234» por «1234») o el
  // dato a medias («termina en 4417»): concatenación igual o sufijo.
  // La ristra del portador se construye SOLO con sus tokens unidos
  // al tipo (en orden); la de la afirmación no cambia: la
  // afirmación es de un solo dato y su concatenación entera es su
  // dato.
  const concat = (t: string) => (t.replace(/\[\d+\]/g, " ").match(/\d+/g) ?? []).join("").replace(/^0+(?=\d)/, "");
  const myConcat = concat(sentence);
  const concatCarriers = carriers.filter((r) => {
    const c = boundDigitTokens(r.text, type).join("").replace(/^0+(?=\d)/, "");
    return c === myConcat || c.endsWith(myConcat);
  });
  if (myConcat.length < 4 || concatCarriers.length === 0) return false;
  // C2-H2: también por esta vía, el dueño tiene que casar.
  return type !== "phone" || phoneOwnerAgrees(sentence, concatCarriers, recs);
}

/**
 * C2-H2 (barrido 0.1.96): el dueño del teléfono. «El teléfono de
 * emergencias es el 520-555-0147» se sellaba fundado con cita cuando, en
 * la fuente, ese número es el de la CLÍNICA: el tipo y las cifras casaban
 * con el tipo y nadie miraba de quién era. La guarda de dueño solo
 * existía para el teléfono corto (shortPhoneMatches) y para el puente
 * pregunta-respuesta (phoneDatumBridge).
 *
 * La regla: el dato no es del dueño de la afirmación cuando TODAS las
 * frases de la fuente que traen esas cifras nombran otro dueño sin
 * mencionar el suyo Y la fuente da a ese dueño su propio número en otra
 * frase («Para emergencias, llama al 911»). Si la fuente no dice de quién
 * es el número, o lo dice y casa, o el dueño de la afirmación no tiene
 * número propio en la fuente («la cita» no lo tiene: su teléfono es el
 * de la clínica, doctrina de genericDatum), todo sigue como antes. La
 * sustituta, cuando la hay, es la frase del número propio de ese dueño
 * (phoneOwnRec). Los dueños se leen con
 * phoneOwnerStems (gobierno «teléfono de X», posesivo inglés «X's
 * phone») más el sustantivo delante del nombre en inglés («emergency
 * phone», «clinic number»), que esa función no ve.
 */
function phoneDatumOwners(sentence: string): Set<string> {
  const owners = phoneOwnerStems(sentence);
  const toks = foldedTokens(sentence);
  for (let k = 1; k < toks.length; k++) {
    if (!PHONE_NAME_WORDS.has(toks[k])) continue;
    const prev = toks[k - 1];
    if (!/^[a-z]+$/.test(prev) || prev === "s") continue;
    const stems = contentStems(prev);
    if (stems.length > 0 && !GENERIC_DATUM_STEMS.has(stems[0])) owners.add(stems[0]);
  }
  return owners;
}

/** La frase de la fuente que da al dueño de la afirmación su propio número, o null. */
function phoneOwnRec(sentence: string, recs: SourceSentenceRec[], exclude: SourceSentenceRec[] = []): SourceSentenceRec | null {
  const mine = phoneDatumOwners(sentence);
  if (mine.size === 0) return null;
  return (
    recs.find((r) => {
      if (exclude.includes(r) || !/\d/.test(r.text)) return false;
      if (!hasPhoneForm(r.text) && !CALL_CUE_RE.test(r.text)) return false;
      const stems = new Set(contentStems(r.text));
      return [...mine].some((o) => stems.has(o));
    }) ?? null
  );
}

function phoneOwnerAgrees(sentence: string, carriers: SourceSentenceRec[], recs: SourceSentenceRec[]): boolean {
  const mine = phoneDatumOwners(sentence);
  if (mine.size === 0 || carriers.length === 0) return true;
  const agrees = carriers.some((r) => {
    const theirs = phoneDatumOwners(r.text);
    if (theirs.size === 0) return true;
    const stems = new Set(contentStems(r.text));
    return [...mine].some((o) => stems.has(o));
  });
  if (agrees) return true;
  // Otro dueño en todas las portadoras: solo es infractora si el suyo
  // tiene número propio en la fuente.
  return phoneOwnRec(sentence, recs, carriers) === null;
}

/**
 * La afirmación CON cifras del tipo pedido pero con las cifras de
 * otro dato (ADV-G1/G2): nombra el tipo con cópula, trae cifras
 * juzgables y ninguna casa con un dato de ese tipo en la evidencia.
 * La pierna que faltaba: la regla solo juzgaba la afirmación SIN
 * cifras, y la de cifras se fiaba del chequeo de presencia.
 */
function isTypedDatumOffender(sentence: string, type: DatumType, recs: SourceSentenceRec[], queryStems?: Set<string>): boolean {
  const folded = foldForCues(sentence);
  if (!hasDatumCopula(sentence)) return false;
  // ADV-G1-R (auditoría del tip f96e473): la afirmación con la
  // etiqueta GENÉRICA («El número es 520-555-0147», «Es el
  // 520-555-0147») no nombra tipo, y la regla la dejaba pasar sellada
  // con las cifras de otro dato ante una pregunta de tarjeta. Sin tipo
  // propio, se juzga con el tipo pedido (el único que llega aquí sin
  // nombrarse); con tipo propio distinto, no es de esta pierna, como
  // hasta hoy. La afirmación genérica cuenta si trae la etiqueta del
  // dato o es una identidad desnuda corta (≤ 5 palabras).
  // El teléfono queda fuera de la forma genérica: su tipo se ata por
  // la forma de ≥7 dígitos, así que un número corto fiel («Es el
  // 112») se leería como de otro dato y se retiraría.
  const own = datumTypeOfText(sentence);
  if (own !== null && own !== type) return false;
  if (own === null && type === "phone") return false;
  if (!DATUM_CATEGORY_RE.test(folded) && !(own === null && isBareIdentity(sentence))) return false;
  // A3-03 (decisión de FV-1): la clase DOSIS no hereda la exención
  // de un dígito de hasJudgedDigit. Sin esta pierna, «La dosis es
  // 9 ml» contra «Tome 5 ml…» salía sellada fundada: la regla ni
  // miraba la frase porque su única cifra no era «juzgable». En la
  // afirmación tipada dosis cualquier cifra cuenta; fuera de ella
  // (prosa, y sala/hora/fecha/teléfono/tarjeta) la vara general de
  // hasJudgedDigit queda intacta.
  // C2-H3 (barrido 0.1.96): la misma razón vale para todo dato tipado.
  // «La consulta es en la sala 9» contra «sala 4» salía sellada: el
  // dígito único de la sala no era «juzgable» y la pierna ni miraba.
  // Cuando la frase NOMBRA el tipo junto a su cifra (carriesDatumOfType:
  // «sala 9», «día 9», «9 ml»), esa cifra es el dato entero y se juzga.
  // Lo que la exención protege queda intacto: el dígito suelto en prosa
  // sin dato tipado («repite el paso 3»), la frase sin cópula de dato, y
  // toda frase que ya trae cifra juzgable (su vara no cambia).
  const singleTyped = !hasJudgedDigit(sentence) && /\d/.test(sentence) && (type === "dose" || carriesDatumOfType(sentence, type));
  if (!hasJudgedDigit(sentence) && !singleTyped) return false;
  return !digitsMatchType(sentence, type, recs, queryStems, singleTyped);
}

/** «Es el 520-555-0147.» / «It's 520-555-0147.»: identidad corta, cópula y cifra, sin más tema. */
function isBareIdentity(sentence: string): boolean {
  const words = sentence.replace(/\[\d+\]/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length <= 5 && hasJudgedDigit(sentence);
}

/** Verbos y palabras que atan un número corto a «llamar» (es/en/pt). */
const CALL_CUE_RE =
  /(?<![\p{L}])(?:llam[ae]\w*|llamar|marc[ae]\w*|telefone\w*|tel[eé]fono\w*|n[uú]mero\w*|emergencias?|emerg[eê]ncias?|call\w*|dial\w*|phone\w*|number\w*|emergenc(?:y|ies)|lig[ue]\w*|ligar|disqu\w*|disc[ae]\w*)(?![\p{L}])/iu;

/**
 * El teléfono CORTO (3–4 cifras: 112, 911, 190) que la fuente da junto a un
 * verbo de llamar (pruebas adversarias del 2026-11-03: «El teléfono es el
 * 112» ante «Llama al 112 en caso de emergencia» se retiraba porque el tipo
 * teléfono solo se ataba por la forma de ≥7 cifras). Cuenta solo si la frase
 * fuente trae ESE número junto a un verbo o una palabra de llamar, y si las
 * raíces de tema de la afirmación (fuera de las etiquetas del dato) están en
 * esa misma frase: «El teléfono de la clínica es el 911» ante «llama al 911
 * en caso de emergencia» sigue siendo infractora (ADV-G2), porque «clínica»
 * no está en la frase del 911.
 */
function shortPhoneMatches(sentence: string, recs: SourceSentenceRec[], queryStems: Set<string>): boolean {
  const mine = [...new Set((sentence.replace(/\[\d+\]/g, " ").match(/\d+/g) ?? []))];
  if (mine.length !== 1 || !/^\d{3,4}$/.test(mine[0])) return false;
  const num = mine[0];
  // El tema es el de la afirmación Y el de la pregunta: «El teléfono es el
  // 911» ante «¿cuál es el teléfono de la cita?» trae el tema «cita», que
  // la frase del 911 no tiene (ADV-G2).
  const topic = [...new Set([...contentStems(sentence), ...queryStems])].filter((w) => !GENERIC_DATUM_STEMS.has(w) && !/^\d+$/.test(w));
  return recs.some((r) => {
    const toks: string[] = r.text.match(/\d+/g) ?? [];
    if (!toks.includes(num) || !CALL_CUE_RE.test(r.text)) return false;
    const have = new Set(contentStems(r.text));
    return topic.every((w) => have.has(w));
  });
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
  // La bonificación de forma es de la forma TELEFÓNICA (ADV2-01):
  // una ristra de tarjeta ya no suma como si fuera un teléfono.
  return 2 * sharedStemCount(sentence, queryStems) + (phoneQuestion && hasPhoneForm(sentence) ? 3 : 0);
}

/**
 * La frase fuente que trae EL dato DEL TIPO pedido: la de mayor
 * datumScore entre las portadoras del tipo. Elegible = lleva
 * cifras juzgables y es el mismo tipo de dato que se pide
 * (adversaria H-02): comparte al menos una raíz sustantiva con la
 * pregunta, o trae la forma telefónica ante una pregunta de
 * teléfono de verdad (la vía que empareja entre idiomas, donde
 * puede no haber raíces que compartir). «Algún dígito temático» ya
 * no basta: sin elegible, la evidencia no contiene ese dato y no
 * hay sustitución que hacer — y menos con el dato de otro. Null si
 * no hay elegible.
 *
 * ADV2-A (segunda adversaria, ADV2-01): con TIPO pedido, la
 * elegibilidad es traer un dato DE ESE TIPO — la frase del teléfono
 * ya no compite en una pregunta de sala por compartir «cambiar» y
 * «cita». Y el empate en la cima entre datos DISTINTOS se resuelve
 * a favor de «sin sustitución» en las dos vías: antes ganaba el
 * primero en la fuente y el dato servido lo decidía el orden del
 * papel, no la pregunta (la acotación que la adversaria sugirió y
 * Grok midió en su corrida: desempate por tipo, no por aparición).
 *
 * T-J1 extrae esta pierna de pickDatumSentence para que la regla
 * pueda pedir el dato de un tipo que no viene de la pregunta sino
 * de la propia afirmación juzgada (el tipo se pasa, no se lee).
 */
function pickTypedDatumSentence(
  type: DatumType,
  queryStems: Set<string>,
  phoneQuestion: boolean,
  recs: SourceSentenceRec[],
): SourceSentenceRec | null {
  const digitRecs = recs.filter((r) => hasJudgedDigit(r.text));
  const carriers = digitRecs.filter((r) => carriesDatumOfType(r.text, type));
  if (carriers.length === 0) return null;
  let bestScore = -1;
  let best: SourceSentenceRec[] = [];
  for (const rec of carriers) {
    const score = datumScore(rec.text, queryStems, phoneQuestion);
    if (score > bestScore) {
      bestScore = score;
      best = [rec];
    } else if (score === bestScore) {
      best.push(rec);
    }
  }
  if (best.length > 1 && best.some((r) => digitSignature(r.text) !== digitSignature(best[0].text))) return null;
  if (bestScore >= 2) return best[0];
  // Sin puntuación léxica (pregunta y fuente sin idioma común), el
  // tipo es el único puente: vale si el portador es único; con
  // varios y sin desempate honesto, no se sustituye.
  return carriers.length === 1 ? best[0] : null;
}

function pickDatumSentence(query: string, recs: SourceSentenceRec[]): SourceSentenceRec | null {
  const queryStems = new Set(contentStems(query));
  const phoneQuestion = PHONE_QUESTION_RE.test(foldForCues(query));
  const askedType = datumTypeOfText(query);
  const digitRecs = recs.filter((r) => hasJudgedDigit(r.text));

  if (askedType) return pickTypedDatumSentence(askedType, queryStems, phoneQuestion, recs);

  let best: SourceSentenceRec | null = null;
  let bestScore = 0;
  const tops: SourceSentenceRec[] = [];
  for (const rec of digitRecs) {
    const phoneForm = phoneQuestion && hasPhoneForm(rec.text);
    if (substantiveStemCount(rec.text, queryStems) === 0 && !phoneForm) continue;
    const score = datumScore(rec.text, queryStems, phoneQuestion);
    if (score >= 2) {
      if (score > bestScore) {
        bestScore = score;
        tops.length = 0;
        tops.push(rec);
        best = rec;
      } else if (score === bestScore) {
        tops.push(rec);
      }
    }
  }
  if (tops.length > 0) {
    if (tops.some((r) => digitSignature(r.text) !== digitSignature(tops[0].text))) return null;
    return best;
  }
  return phoneDatumBridge(query, recs, digitRecs, queryStems, phoneQuestion);
}

/**
 * Las raíces-dueño de un teléfono nombradas en su frase (ADV3,
 * A3-04): de quién dice la frase que es el teléfono, leído con
 * medios cerrados sobre los tokens plegados:
 * - Gobierno tras el nombre del dato: tras una palabra-nombre
 *   (teléfono/numero/phone/line…), si dentro de los 2 tokens
 *   siguientes aparece una preposición de posesión (de, del, da,
 *   do, das, dos, of — el «the» de «number of the X» es el
 *   artículo que se salta, no la preposición), las raíces de
 *   contenido de las 3 palabras de contenido siguientes son
 *   dueño: «el teléfono de la clínica San Rafael» →
 *   {clinica, san, rafael}.
 * - Posesivo inglés delante del nombre: «the clinic's phone»
 *   deja tokens clinic, s, phone — la raíz 2 tokens antes del
 *   nombre es dueño.
 * Las etiquetas genéricas (GENERIC_DATUM_STEMS) nunca son dueño.
 * Sin construcción de dueño, el conjunto es vacío.
 */
const PHONE_NAME_WORDS = new Set([
  "telefono", "telefonos", "telefone", "telefones", "phone", "phones",
  "linea", "line", "hotline", "numero", "numeros", "number", "numbers",
]);
const PHONE_OWNER_PREPS = new Set(["de", "del", "da", "do", "das", "dos", "of"]);

function phoneOwnerStems(sentence: string): Set<string> {
  const toks = foldedTokens(sentence);
  const owners = new Set<string>();
  const addContentStem = (tok: string): boolean => {
    if (!/^[a-zñ]+$/.test(tok)) return false;
    const stems = contentStems(tok);
    if (stems.length === 0) return false;
    if (!GENERIC_DATUM_STEMS.has(stems[0])) owners.add(stems[0]);
    return true;
  };
  for (let k = 0; k < toks.length; k++) {
    if (!PHONE_NAME_WORDS.has(toks[k])) continue;
    // Posesivo inglés: «… clinic s phone …».
    if (k >= 2 && toks[k - 1] === "s") addContentStem(toks[k - 2]);
    // Gobierno: preposición dentro de los 2 tokens siguientes.
    let prep = -1;
    for (let m = k + 1; m <= Math.min(toks.length - 1, k + 2); m++) {
      if (PHONE_OWNER_PREPS.has(toks[m])) {
        prep = m;
        break;
      }
    }
    if (prep === -1) continue;
    let collected = 0;
    for (let j = prep + 1; j < toks.length && collected < 3; j++) {
      if (/\d/.test(toks[j])) break;
      if (addContentStem(toks[j])) collected++;
    }
  }
  return owners;
}

/**
 * El puente de ADV2-02 (segunda adversaria): «¿Cuál es el número de
 * la clínica?» no trae palabra-señal de teléfono ni comparte raíces
 * con la frase del teléfono, y la sustitución moría en los tres
 * idiomas — el rodeo quedaba sellado o la app declaraba no saber
 * con el número impreso en la fuente. La forma humana de pedir un
 * teléfono es «el número de <entidad>»: si la pregunta pide «el
 * número» de una entidad que la evidencia nombra, no nombra ningún
 * tipo concreto, ningún candidato con cifras comparte tema con
 * ella y la evidencia trae UN solo dato con forma telefónica, ese
 * es el dato pedido. Cualquier competencia lo cierra (la tarjeta
 * que comparte «tarjeta», la sala que comparte «sala»): es la
 * orilla estrecha que no reabre H-02.
 */
function phoneDatumBridge(
  query: string,
  recs: SourceSentenceRec[],
  digitRecs: SourceSentenceRec[],
  queryStems: Set<string>,
  phoneQuestion: boolean,
): SourceSentenceRec | null {
  if (phoneQuestion) return null;
  if (!/\b(numero|numeros|number|numbers)\b/.test(foldForCues(query))) return null;
  const substantive = [...queryStems].filter((s) => !GENERIC_DATUM_STEMS.has(s));
  if (substantive.length === 0) return null;
  if (digitRecs.some((r) => substantiveStemCount(r.text, queryStems) > 0)) return null;
  const phoneRecs = digitRecs.filter((r) => hasPhoneForm(r.text));
  if (phoneRecs.length !== 1) return null;
  const evidenceStems = new Set(recs.flatMap((r) => contentStems(r.text)));
  if (!substantive.some((s) => evidenceStems.has(s))) return null;
  // ADV3 (A3-04): si la frase del teléfono nombra como dueño a una
  // entidad y ninguna de sus raíces es la pedida, el teléfono es
  // de OTRA entidad: el puente no lo sirve como respuesta (servía
  // el de la clínica ante la pregunta por la farmacia). Sin dueño
  // nombrado — la forma de ADV2-02 — la guardia no bloquea nada, y
  // cualquier solape basta para dejarlo disparar.
  const owners = phoneOwnerStems(phoneRecs[0].text);
  if (owners.size > 0 && ![...owners].some((s) => substantive.includes(s))) return null;
  return phoneRecs[0];
}

/** ¿Afirma la frase qué es el dato (categoría + cópula) sin dar ninguna cifra? */
function assertsDatumIdentity(sentence: string): boolean {
  if (hasJudgedDigit(sentence)) return false;
  const folded = foldForCues(sentence);
  return DATUM_CATEGORY_RE.test(folded) && hasDatumCopula(sentence);
}

/**
 * Aplica la regla del dato pedido sobre las frases conservadas (kept
 * y prov caminan juntos): sustituye al primer infractor por la frase
 * fuente del dato y retira los demás infractores. Devuelve cuántas
 * frases se retiraron de más y si hubo sustitución. Sin pregunta o
 * sin el dato en la evidencia: no toca nada.
 *
 * ADV2-A añade la segunda pierna (ADV-G1/G2): la afirmación CON
 * cifras del tipo pedido pero con las cifras de otro dato también
 * es infractora — se sustituye por el dato del tipo, o se retira si
 * la evidencia no trae ese tipo o si otra frase ya lo entregó bien.
 *
 * T-J1 (barrido «revisa todo», J1) — EL PERÍMETRO NUEVO, decidido
 * con su demostración: hasta esta tanda la regla entera estaba
 * cerrada por la pregunta — sin señal de dato en ella
 * (DATUM_QUESTION_RE), la pierna tipada ni corría, y el par de
 * A3-03 volvía a sellarse fundado en cuanto la pregunta era «¿Cómo
 * se toma el jarabe?» en vez de «¿Cuál es la dosis?» (la forma
 * natural de preguntar por una dosis). La vara del juez no se
 * mueve; se mueve su ALCANCE, y solo en la pierna tipada: una
 * afirmación que ya viene tipada en la propia frase (categoría +
 * cópula + tipo nombrables por ella misma) y cuyas cifras no casan
 * con ningún dato de ese tipo en la evidencia es infractora la
 * pregunte lo que pregunte — la cuádruple condición de
 * isTypedDatumOffender (nombra su tipo, afirma identidad con
 * cópula, trae cifras, y esas cifras FALLAN contra el tipo) es tan
 * estrecha como la señal que antes se exigía a la pregunta. La
 * pierna de identidad SIN cifras conserva la doble condición de
 * R-05 intacta (señal en la pregunta Y cifra temática en la
 * evidencia): afirmar sin dar ningún número es otra clase de
 * falsedad, con otro riesgo, y su puerta no se abre aquí. Sin
 * pregunta (las llamadas antiguas de 3 argumentos), la regla sigue
 * sin actuar: no hay turno al que responder.
 */
export function applyDatumRule(
  kept: string[],
  prov: SentenceProvenance[],
  query: string,
  recs: SourceSentenceRec[],
): { removedExtra: number; replaced: boolean } {
  const none = { removedExtra: 0, replaced: false };
  if (!query) return none;
  const querySignal = DATUM_QUESTION_RE.test(foldForCues(query));
  const askedType = datumTypeOfText(query);
  const queryStems = new Set(contentStems(query));
  const phoneQuestion = PHONE_QUESTION_RE.test(foldForCues(query));
  let removedExtra = 0;
  let replaced = false;

  // La pierna tipada (ADV-G1/G2), generalizada por tipo: cada
  // afirmación infractora se sustituye por el dato DE SU TIPO si
  // ninguna frase lo entregó bien, o se retira. Con un solo tipo
  // en juego (el de la pregunta, el camino de siempre) el desenlace
  // es el de antes, frase a frase.
  const runTypedLeg = (
    resolveType: (s: string) => DatumType | null,
    datumForType: (t: DatumType) => SourceSentenceRec | null,
  ): void => {
    const offenders: { i: number; type: DatumType }[] = [];
    kept.forEach((s, i) => {
      if (prov[i].origin.kind === "abstain") return;
      const t = resolveType(s);
      if (t && isTypedDatumOffender(s, t, recs, queryStems)) offenders.push({ i, type: t });
    });
    if (offenders.length === 0) return;
    const offenderIdx = new Set(offenders.map((o) => o.i));
    const typesInOrder: DatumType[] = [];
    for (const o of offenders) if (!typesInOrder.includes(o.type)) typesInOrder.push(o.type);
    const replaceAt = new Map<number, SourceSentenceRec>();
    const removeIdx = new Set<number>();
    for (const t of typesInOrder) {
      const group = offenders.filter((o) => o.type === t);
      const deliveredNow = kept.some(
        (s, i) =>
          !offenderIdx.has(i) &&
          prov[i].origin.kind !== "abstain" &&
          hasJudgedDigit(s) &&
          digitsMatchType(s, t, recs, queryStems) &&
          (carriesDatumOfType(s, t) || datumTypeOfText(s) === t),
      );
      // C2-H2: si la fuente da al dueño de la afirmación su propio número
      // («el de emergencias»), la sustituta es esa frase, no el teléfono de
      // otro dueño («el de la clínica»).
      const ownT = t === "phone" ? phoneOwnRec(kept[group[0].i], recs) : null;
      const datumT = deliveredNow ? null : (ownT ?? datumForType(t));
      if (!deliveredNow && datumT) {
        replaceAt.set(group[0].i, datumT);
        for (const o of group.slice(1)) removeIdx.add(o.i);
      } else {
        for (const o of group) removeIdx.add(o.i);
      }
    }
    for (const [i, datumT] of replaceAt) {
      const fixed = addCitation(datumT.text, datumT.chunk + 1);
      kept[i] = fixed;
      prov[i] = { text: fixed, origin: { kind: "source", n: datumT.chunk + 1, support: 1 } };
      replaced = true;
    }
    for (const i of [...removeIdx].sort((a, b) => b - a)) {
      kept.splice(i, 1);
      prov.splice(i, 1);
      removedExtra++;
    }
  };

  // Sin señal en la pregunta, solo corre la pierna tipada, con el
  // tipo que cada afirmación nombra de sí misma (T-J1).
  if (!querySignal) {
    runTypedLeg(
      (s) => datumTypeOfText(s),
      (t) => pickTypedDatumSentence(t, queryStems, phoneQuestion, recs),
    );
    return replaced || removedExtra > 0 ? { removedExtra, replaced } : none;
  }

  const datum = pickDatumSentence(query, recs);

  const typedOffender = (s: string): boolean => askedType !== null && isTypedDatumOffender(s, askedType, recs, queryStems);

  // «Ya entregado»: una frase conservada con cifras que casa con la
  // pregunta. Cuando la pregunta pide un tipo, la afirmación con las
  // cifras de OTRO dato («el teléfono es el 911») no cuenta como
  // entrega: es el infractor, no el testigo que apaga la regla.
  const delivered = kept.some(
    (s, i) =>
      prov[i].origin.kind !== "abstain" &&
      hasJudgedDigit(s) &&
      datumScore(s, queryStems, phoneQuestion) >= 2 &&
      !typedOffender(s),
  );
  if (!delivered && datum) {
    const offenders: number[] = [];
    kept.forEach((s, i) => {
      if (prov[i].origin.kind !== "abstain" && assertsDatumIdentity(s)) offenders.push(i);
    });
    if (offenders.length > 0) {
      const first = offenders[0];
      const fixed = addCitation(datum.text, datum.chunk + 1);
      kept[first] = fixed;
      prov[first] = { text: fixed, origin: { kind: "source", n: datum.chunk + 1, support: 1 } };
      replaced = true;
      for (const i of offenders.slice(1).reverse()) {
        kept.splice(i, 1);
        prov.splice(i, 1);
        removedExtra++;
      }
    }
  }

  // La afirmación CON cifras del tipo equivocado (ADV-G1/G2). Con
  // tipo pedido, ese y solo ese; con señal pero sin tipo («¿cuánto
  // jarabe…?»), el de cada afirmación, como en la vía sin señal.
  if (askedType) {
    runTypedLeg(
      () => askedType,
      () => datum,
    );
  } else {
    runTypedLeg(
      (s) => datumTypeOfText(s),
      (t) => pickTypedDatumSentence(t, queryStems, phoneQuestion, recs),
    );
  }

  return replaced || removedExtra > 0 ? { removedExtra, replaced } : none;
}

export function verifyGroundedAnswer(
  answer: string,
  chunks: GroundingChunk[],
  lang: GroundingLang,
  /** La pregunta del usuario (R-05: la regla del dato pedido la necesita; sin ella, la regla no actúa). */
  query = "",
  /**
   * C-07: la fecha del turno contra la que se juzgan las fechas de la
   * respuesta (R1–R5 de dates.ts). Opcional: sin ella, el día de hoy.
   * ChatScreen pasa la marca temporal del mensaje del usuario cuando
   * el mensaje la lleva; si no, el instante de finalización. Las
   * relativas («ayer», «mañana») se juzgan contra ese día, que es lo
   * que el humano quiso decir.
   */
  referenceDate: Date = new Date(),
): GroundingResult {
  const trimmed = (answer ?? "").trim();
  if (!trimmed) return { text: trimmed, status: "skipped", removed: 0, kept: 0 };
  if (chunks.length === 0) {
    // Sin fuentes: todo lo que dice es del modelo, salvo que diga no saber.
    const sentences = splitSentences(trimmed).map((s) => ({
      text: s,
      origin: isPureAbstention(s) ? ({ kind: "abstain" } as const) : ({ kind: "model", reason: "no-sources" } as const),
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
  // C-08: los rangos de la evidencia sostienen su interior («39 °C»
  // contra «entre 37 y 40 °C»): sin esto, la respuesta exacta de la
  // guía abstenía por no ser ni el mínimo ni el máximo.
  const chunkRanges = evidenceRanges(chunkTexts);
  // Auditoría 0.1.70: las dosis medidas de toda la evidencia.
  const evidenceDoses = chunks.flatMap((ch) => doseMeasuresOf(ch.body));

  // Las frases de las fuentes, por chunk (la negación de 0.1.59 las usa
  // por chunk; la regla de idioma de R-04 las recorre todas con su chunk).
  const chunkSentences = chunks.map((c) => splitSentences(c.body.trim()).map((x) => x.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean));
  const sourceRecs: SourceSentenceRec[] = [];
  chunkSentences.forEach((ss, i) => {
    for (const text of ss) sourceRecs.push({ text, chunk: i });
  });
  // C-07: las menciones de fecha de las fuentes, parseadas una sola
  // vez: la pierna de fechas juzga cada frase contra ellas (dates.ts).
  const sourceDateSentences = parseSourceDateSentences(chunkSentences.flat(), referenceDate);

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
      // C2-H1: solo la abstención pura se conserva sin juicio.
      if (isPureAbstention(s)) {
        kept.push(s);
        langProv.push({ text: s, origin: { kind: "abstain" } });
        continue;
      }
      if (!sentenceNumbersSupported(s, evidenceNums, chunkRanges)) {
        removed++;
        continue;
      }
      // Auditoría 0.1.70: la dosis medida de un dígito (o en letra).
      if (measuredDoseConflict(s, evidenceDoses)) {
        removed++;
        continue;
      }
      // C-07: las fechas son independientes del idioma, como las
      // cifras — la pierna de fechas también juzga en esta rama.
      if (dateConflictForSentence(s, sourceDateSentences, referenceDate)) {
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
    // C2-H1: solo la abstención pura se conserva sin juicio; la que afirma
    // un dato se juzga por ese dato, como cualquier frase del modelo.
    if (isPureAbstention(s)) {
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
    if (!sentenceNumbersSupported(s, evidenceNums, chunkRanges)) {
      removed++;
      continue;
    }
    // Auditoría 0.1.70: la dosis medida que la vara de cifras no ve
    // (el dígito único, el número en letra pegado a su unidad).
    if (measuredDoseConflict(s, evidenceDoses)) {
      removed++;
      continue;
    }
    // C-07: la pierna de fechas, cosida tras el juicio de cifras de la
    // frase — una mención falsa por calendario (R1) o contradicha por
    // la fuente (R4/R5) retira la frase como una cifra falsa, porque
    // es una cifra falsa con nombre de día. Vive AL LADO de la
    // maquinaria de cifras y no depende de sus interiores
    // (digitsMatchType / carriesDatumOfType, terreno de ADV3): su
    // único juez es dates.ts, y ni el apoyo léxico ni la tolerancia
    // ±1 de las cifras la salvan ni la condenan.
    if (dateConflictForSentence(s, sourceDateSentences, referenceDate)) {
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
    // T-J7: la vía principal exige el umbral de juzgadas y deja
    // fuera a la copia corta por construcción; la gemela corta
    // (closestShortCopySentence) la alcanza sin bajar la vara: solo
    // entra cuando la copia está demostrada raíz a raíz.
    if (sup.bestChunk >= 0) {
      const src =
        (sup.total >= MIN_JUDGED_TERMS ? closestSourceSentence(s, chunkSentences[sup.bestChunk]) : null) ??
        closestShortCopySentence(s, chunkSentences[sup.bestChunk]);
      if (src && negationCount(s.replace(/\[\d+\]/g, "")) !== negationCount(src)) {
        negationFixed++;
        const fixed = addCitation(src, sup.bestChunk + 1);
        kept.push(fixed);
        prov.push({ text: fixed, origin: { kind: "source", n: sup.bestChunk + 1, support: 1, negationFixed: true } });
        continue;
      }
      // Auditoría de la 0.1.70 (5b): la corta que quita (o pone) la
      // negación de una cláusula de una frase fuente larga.
      const clauseSrc = src ? null : negatedClauseSource(s, chunkSentences[sup.bestChunk], chunkSentences.flat());
      if (clauseSrc) {
        negationFixed++;
        const fixed = addCitation(clauseSrc, sup.bestChunk + 1);
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
    const i = primarySourceIndex(chunks);
    sentences.push({ text: EXTRACT_INTRO[lang].split("{{title}}").join(chunks[i].title), origin: { kind: "fixed" } });
    sentences.push({ text: extractiveSnippet(chunks[i], i, 320, lang), origin: { kind: "source", n: i + 1, support: 1 } });
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
