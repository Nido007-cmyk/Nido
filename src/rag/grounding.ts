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
 *  - Si la respuesta está en otro idioma que las fuentes (pregunta en
 *    español, corpus en inglés), la comparación léxica no es válida: no se
 *    inventa un veredicto. Solo se comprueban cifras (iguales en todos los
 *    idiomas) y citas; el estado queda "unverified" y la UI lo dice.
 *
 * Limitación honesta: es una heurística léxica (sin modelo de NLI, que no
 * cabe en el presupuesto de RAM). Detecta afirmaciones con vocabulario
 * ajeno a las fuentes —el patrón de la evidencia— pero no una frase que
 * reordene palabras de la fuente para decir algo falso.
 *
 * Puro, sin dependencias, 100% testeable.
 */

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
    "\\bno (lo )?s[eé](?![\\p{L}])",
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
export function extractiveSnippet(chunk: GroundingChunk, index: number, maxChars = 320): string {
  const sentences = splitSentences(chunk.body.trim());
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
  return `${IDK_TEXT[lang]}\n\n${intro}\n${extractiveSnippet(chunks[0], 0)}`;
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

/** Cifras de 2+ dígitos que aparecen en un texto (años, cantidades). */
function numbersIn(text: string): Set<string> {
  return new Set((text.match(/\d[\d.,]*\d|\d{2,}/g) ?? []).map((n) => n.replace(/[.,]/g, "")));
}

export function verifyGroundedAnswer(
  answer: string,
  chunks: GroundingChunk[],
  lang: GroundingLang,
): GroundingResult {
  const trimmed = (answer ?? "").trim();
  if (chunks.length === 0 || !trimmed) {
    return { text: trimmed, status: "skipped", removed: 0, kept: 0 };
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

  if (!sameLanguage) {
    // Sin comparación léxica válida: solo cifras (independientes del idioma).
    const sourceNumbers = numbersIn(chunkTexts.join(" "));
    let removed = 0;
    const kept = sentences.filter((s) => {
      if (isAbstention(s)) return true;
      const nums = [...numbersIn(s)];
      const ok = nums.every((n) => sourceNumbers.has(n));
      if (!ok) removed++;
      return ok;
    });
    if (kept.length === 0) {
      return { text: honestAbstention(chunks, lang), status: "abstained", removed, kept: 0 };
    }
    let text = kept.join(" ");
    if (removed > 0) text += `\n\n${NOTE.removed[lang].split("{{n}}").join(String(removed))}`;
    return { text, status: "unverified", removed, kept: kept.length };
  }

  const chunkStemSets = chunkTexts.map((t) => new Set(contentStems(t)));
  let removed = 0;
  let abstained = false;
  let judgedKept = 0;
  const kept: string[] = [];
  for (const s of sentences) {
    if (isAbstention(s)) {
      abstained = true;
      kept.push(s);
      continue;
    }
    const sup = sentenceSupport(s, chunkStemSets);
    if (!isSupported(sup)) {
      removed++;
      continue;
    }
    if (sup.total >= MIN_JUDGED_TERMS) judgedKept++;
    // Enlace afirmación → fuente: si la frase no cita, se le pone la [n] de
    // la fuente que más palabras comparte con ella.
    kept.push(
      !hasCitation(s) && sup.total >= MIN_JUDGED_TERMS && sup.bestChunk >= 0
        ? addCitation(s, sup.bestChunk + 1)
        : s,
    );
  }

  // Nada verificable sobrevivió (todo inventado, o solo "no lo sé"):
  // "no lo sé" honesto + lo que la fuente sí dice.
  if (judgedKept === 0 && (removed > 0 || abstained)) {
    return { text: honestAbstention(chunks, lang), status: "abstained", removed, kept: 0 };
  }

  let text = kept.join(" ").replace(/\s+\n/g, "\n").trim();
  if (removed > 0) {
    text += `\n\n${NOTE.removed[lang].split("{{n}}").join(String(removed))}`;
    return { text, status: "partial", removed, kept: kept.length };
  }
  return { text, status: "grounded", removed: 0, kept: kept.length };
}

// ------------------------------------------- "no lo sé" antes de generar

const FACTUAL_QUESTION_RE = new RegExp(
  [
    // es
    "^[¿¡]?\\s*(qu[eé] (es|son|fue|fueron|significa|causa|hace)|qui[eé]n(es)? (es|son|fue|fueron|invent[oó]|descubri[oó]|escribi[oó])|cu[aá]ndo|d[oó]nde|cu[aá]l(es)? (es|son|fue)|cu[aá]nt[oa]s?|por qu[eé]|c[oó]mo (funciona|funcionan|se (forma|hace|produce))|expl[ií]ca(me)?|define)(?![\\p{L}\\p{N}])",
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
