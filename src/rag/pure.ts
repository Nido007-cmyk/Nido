/**
 * MIT License
 * Copyright (c) 2026 aoair contributors (original BOAR code)
 * Copyright (c) 2026 NIDO contributors (modifications)
 * See LICENSE file for details.
 */

/**
 * Pure, native-module-free RAG helpers, kept separate from db.ts/embed.ts
 * (which pull in expo-sqlite/llama.rn) so they're unit-testable under plain
 * Node/vitest without an RN runtime.
 */
import type { RetrievedChunk } from "./retrieve.types";
// P2.3: pure context-budget manager (no native deps — safe for this module).
import {
  applyContextBudget,
  budgetConfigFor,
  defaultTokenCounter,
} from "../agent/loop/contextBudget";

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Cosine similarity against an int8-quantized vector as stored in a knowledge
 * pack (raw bytes). The per-vector scale cancels out of the cosine, so it's
 * not needed here.
 */
export function cosineSimilarityInt8(query: Float32Array, bytes: Uint8Array): number {
  const v = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dot = 0;
  let normQ = 0;
  let normV = 0;
  for (let i = 0; i < v.length; i++) {
    dot += query[i] * v[i];
    normQ += query[i] * query[i];
    normV += v[i] * v[i];
  }
  if (normQ === 0 || normV === 0) return 0;
  return dot / (Math.sqrt(normQ) * Math.sqrt(normV));
}

/**
 * P-01 paso 1: cuantiza UN vector para ALMACENARLO con la convención de
 * los packs de conocimiento (quantizeInt8 de
 * scripts/lib/knowledge-pack-lib.mjs): escala simétrica por vector
 * max|v| / 127 (1 si el vector es cero, que así no divide por cero) y
 * componentes redondeadas con Math.round. La escala NO se guarda: se
 * cancela en el coseno, que es lo único para lo que los vectores
 * almacenados se usan (cosineSimilarityInt8). Devuelve bytes nuevos de
 * longitud = dimensión: una cuarta parte de los dim*4 del float32.
 * Espejo exacto de la convención de packs — la fixture
 * pure.quantizeInt8.test.ts exige acuerdo byte a byte con aquella.
 */
export function quantizeVectorInt8(vec: Float32Array): Uint8Array {
  let max = 0;
  for (let i = 0; i < vec.length; i++) {
    const a = Math.abs(vec[i]);
    if (a > max) max = a;
  }
  const scale = max > 0 ? max / 127 : 1;
  const out = new Uint8Array(vec.length);
  const codes = new Int8Array(out.buffer);
  for (let i = 0; i < vec.length; i++) {
    codes[i] = Math.round(vec[i] / scale);
  }
  return out;
}

// bge-small-en-v1.5 cosine similarity heuristic: below this, a chunk isn't
// actually about the query, it's just whatever happened to be "closest" out
// of everything in the knowledge base - brute-force top-K with no floor
// means even a query with nothing relevant on-device always gets K chunks
// back, which then get force-fed into the prompt as "Context" the model is
// told to answer from. Not a precise cutoff (no real device/embedding
// runtime available to measure this corpus's actual score distribution -
// see retrieve.relevance.test.ts), just cheap, evidence-informed-as-far-as-
// BUG-2-2026-10-06: umbral elevado de 0.45 a 0.60 basado en evidencia
// física del dispositivo. En el APK 939cfc0, contenido irrelevante
// (Blockchain, GrapheneOS, Mental health, Promotion League) puntuó
// 0.49-0.55 en cosine similarity y pasó el filtro de 0.45. El test
// original asumía que "gibberish" puntuaría bien por debajo de 0.45,
// pero el modelo de embeddings real produce scores más altos para
// contenido no relacionado. 0.60 elimina todos los falsos positivos
// observados en dispositivo físico.
export const MIN_SEMANTIC_SIMILARITY = 0.60;

/**
 * H1-2026-10-06: umbral para queries de un solo término. Un solo token
 * fuera del idioma del corpus puede puntuar 0.56 por azar ("hola" →
 * pueblo esloveno); exigir más evidencia en ese caso.
 */
export const MIN_SEMANTIC_SIMILARITY_SINGLE_TERM = 0.70;

/**
 * Chunks given to the model for a chat answer. Each chunk adds prompt
 * processing before the first token (the main wait on a phone). In the
 * 2026-09-24 device benchmark every expected article was retrieved at rank
 * 1 or 2, and ranks 3-6 were mostly unrelated, so 4 keeps a margin for
 * three-topic questions. Deep Research keeps the default 6 per sub-question.
 */
export const ANSWER_CONTEXT_CHUNKS = 4;

/**
 * Excludes chunks whose raw score is below a minimum confidence floor.
 * Applied to a SINGLE source's raw scores, before fuseRetrievalResults's
 * max-relative normalization - normalizing first would make a floor
 * meaningless, since that normalization rescales each result set so its
 * own best match always looks "confident" (~1.0) relative to itself,
 * regardless of how weak that best match actually is in absolute terms.
 */
export function filterByMinScore<T extends { score: number }>(chunks: T[], minScore: number): T[] {
  return chunks.filter((c) => c.score >= minScore);
}

// Question framing and instruction words: they say what kind of answer is
// wanted, not what it's about, so matching on them only pulls in noise.
// Includes "work"/"mean"/"happen" because of "how does X work", "what
// does X mean", "why did X happen". English only, matching the corpus.
const LEXICAL_STOPWORDS = new Set([
  "a", "about", "after", "all", "also", "am", "an", "and", "any", "are", "as", "at",
  "be", "because", "been", "before", "being", "best", "better", "between", "both", "but", "by",
  "can", "could", "compare", "comparison", "describe", "detail", "details", "did",
  "difference", "differences", "do", "does", "doing", "during", "each", "explain",
  "for", "from", "give", "had", "has", "have", "having", "he", "her", "here", "him",
  "his", "how", "i", "if", "in", "into", "is", "it", "its", "just", "know", "like",
  "me", "mean", "means", "meant", "more", "most", "much", "my", "no", "not", "of",
  "on", "or", "other", "our", "overview", "please", "same", "she", "should", "show",
  "so", "some", "something", "such", "summarize", "summary", "tell", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "thing", "things", "this",
  "those", "through", "to", "too", "under", "up", "us", "very", "versus", "vs", "want",
  "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "whose",
  "why", "will", "with", "work", "works", "would", "you", "your", "happen", "happened",
  "happens", "cause", "caused", "causes",
  // M7-2026-10-06: stopwords en español (misma familia que C4).
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "en", "y", "o",
  "que", "qué", "como", "cómo", "por", "para", "con", "sin", "sobre", "entre", "hacia",
  "hasta", "desde", "durante", "mediante", "según", "contra", "ante", "bajo", "tras",
  "es", "son", "está", "están", "fue", "fueron", "ser", "estar", "tiene", "tienen",
  "hay", "esto", "esta", "estos", "estas", "ese", "esa", "esos", "esas", "aquel",
  "mi", "mis", "tu", "tus", "su", "sus", "nuestro", "nuestra", "se", "me", "te",
  "le", "les", "nos", "lo", "los", "la", "las", "al", "más", "menos", "muy", "tan",
  "tanto", "todo", "toda", "todos", "todas", "cada", "otro", "otra", "otros", "otras",
  "mismo", "misma", "donde", "dónde", "cuando", "cuándo", "cual", "cuál", "cuales",
  "quien", "quién", "porque", "porqué", "pues", "pero", "sino", "aunque", "si",
  "también", "tampoco", "ya", "todavía", "aún", "siempre", "nunca", "jamás",
  // 0.1.59: question verbs and fillers ("¿cómo HAGO la RCP…?", "o que FAÇO…",
  // "if SOMEONE is choking") carry no topic; as required terms they let a
  // section that merely shares them win (the CPR question got the chest-pain
  // guide). Tokens are accent-free here, so "faço" is "faco".
  "hago", "hace", "hacer", "haces", "haga", "hagan", "hacemos", "puedo", "puede", "debo",
  "debe", "deberia", "alguien", "algo", "someone", "somebody", "anyone",
  "faco", "faz", "fazer", "faca", "posso", "pode", "devo", "deve", "alguem",
  // Portuguese function words (the list above had none).
  "um", "uma", "uns", "umas", "em", "com", "na", "nas", "da", "das", "dos", "ao", "aos",
  "os", "e", "quando", "onde", "qual", "quais", "sem", "mais", "muito",
]);

const MAX_LEXICAL_TERMS = 12;

export interface LexicalTerm {
  /**
   * Exact word forms that count as this term: the query word, plus its
   * singular when it looks plural ("vaccines" → "vaccine"), because the FTS
   * index has no stemmer.
   */
  forms: string[];
  /**
   * 0.1.59: word start that also counts ("adult" for "adulto" → "adultos",
   * "atragan" for "atraganta" → "atragantamiento"): the index has no stemmer
   * for Spanish, so exact forms alone missed the right guide.
   */
  prefix?: string;
}

export interface LexicalQuery {
  /** FTS5 MATCH expression: every quoted form OR-ed together, BM25-ranked by FTS5 itself. */
  match: string;
  terms: LexicalTerm[];
  /** Idioma detectado de la pregunta (las mismas pistas que el juez); null sin veredicto. */
  lang: LexicalLang | null;
}

export type LexicalLang = "en" | "es" | "pt";

/**
 * Las palabras pista por idioma — las mismas de detectTextLang en
 * grounding.ts, sobre los tokens de esta capa (tokenize ya pliega
 * tildes). Dos detectores con las mismas pistas a propósito: pure.ts
 * no puede importar grounding.ts (es la base sin dependencias).
 */
const LEXICAL_LANG_HINTS: Record<LexicalLang, Set<string>> = {
  en: new Set("the and is are was were of to in that it with for this which by from have has not".split(" ")),
  es: new Set("el la los las y es son del que en por para con una un se su lo como pero mas".split(" ")),
  pt: new Set("o os as e sao do da dos das que em por para com uma um se seu sua como mas nao".split(" ")),
};

/**
 * El idioma de un texto para la pata léxica, con los umbrales del
 * juez: menos de 4 tokens, señal débil (<8 % de pistas) o empate
 * es/pt → sin veredicto (null), y sin veredicto no hay disciplina.
 */
export function detectLexicalLang(text: string): LexicalLang | null {
  const ws = tokenize(text);
  if (ws.length < 4) return null;
  let best: LexicalLang | null = null;
  let bestScore = 0;
  let second = 0;
  for (const lang of ["en", "es", "pt"] as LexicalLang[]) {
    const score = ws.filter((w) => LEXICAL_LANG_HINTS[lang].has(w)).length / ws.length;
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = lang;
    } else if (score > second) {
      second = score;
    }
  }
  if (bestScore < 0.08 || bestScore - second < 0.03) return null;
  return best;
}

// "-es" is ambiguous ("viruses" → "virus" but "cases" → "case"), so both
// candidates are kept; a form that isn't a real word simply never matches.
function singularsOf(token: string): string[] {
  if (token.length < 4 || !token.endsWith("s") || /(ss|is|us)$/.test(token)) return [];
  if (token.endsWith("ies")) return [`${token.slice(0, -3)}y`];
  if (/(s|x|z|o|ch|sh)es$/.test(token)) return [token.slice(0, -1), token.slice(0, -2)];
  return [token.slice(0, -1)];
}

function tokenize(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/**
 * Turns a natural-language question into an FTS5 query of its content
 * words, OR-ed so a document doesn't have to contain the question verbatim.
 * Returns null when nothing meaningful is left ("tell me something"), so
 * the caller skips lexical search instead of matching on filler words.
 * Every term is double-quoted, so FTS5 operators typed by the user are
 * treated as plain text.
 */
export function buildLexicalQuery(query: string): LexicalQuery | null {
  const seen = new Set<string>();
  const terms: LexicalTerm[] = [];
  for (const token of tokenize(query)) {
    if (token.length < 2 || LEXICAL_STOPWORDS.has(token)) continue;
    const forms = [token, ...singularsOf(token)];
    if (forms.some((f) => seen.has(f))) continue;
    forms.forEach((f) => seen.add(f));
    const prefix = lexicalPrefixOf(token);
    terms.push(prefix ? { forms, prefix } : { forms });
    if (terms.length >= MAX_LEXICAL_TERMS) break;
  }
  if (terms.length === 0) return null;
  const match = terms.flatMap((t) => [...t.forms.map((f) => `"${f}"`), ...(t.prefix ? [`"${t.prefix}"*`] : [])]).join(" OR ");
  return { match, terms, lang: detectLexicalLang(query) };
}

/**
 * How many content terms a lexical hit must contain. OR-matching alone
 * would accept a document that shares one incidental word with the
 * question ("black" → "Black Sea" for "black holes"), so short queries
 * need every term and longer ones at least half.
 */
export function requiredTermMatches(termCount: number): number {
  return termCount <= 2 ? termCount : Math.ceil(termCount / 2);
}

export function countMatchedTerms(text: string, terms: LexicalTerm[]): number {
  const list = tokenize(text);
  const tokens = new Set(list);
  return terms.filter((term) => term.forms.some((f) => tokens.has(f)) || (!!term.prefix && list.some((t) => t.startsWith(term.prefix!)))).length;
}

/** Los términos casados SOLO por forma exacta (sin crédito de prefijo). */
export function countExactMatchedTerms(text: string, terms: LexicalTerm[]): number {
  const tokens = new Set(tokenize(text));
  return terms.filter((term) => term.forms.some((f) => tokens.has(f))).length;
}

/**
 * Word start used as a prefix match for long words: everything but the last
 * two letters, at least four ("adulto" → "adult", "quemadura" → "quemadu").
 * Short words keep exact matching (a 4-letter prefix matches too much).
 * C-03: five-letter words join in ("quemo" → "quem"), because a family's
 * first-person verb ("me quemo") must reach the guide's noun ("quemaduras");
 * measured in the C-03 preparation, the wider step (floor 4 at ≥4 letters)
 * widened the one-term gate and is not taken.
 */
export function lexicalPrefixOf(token: string): string | undefined {
  if (token.length < 5 || /\d/.test(token)) return undefined;
  return token.slice(0, Math.max(4, token.length - 2));
}

/**
 * The lexical relevance gate: keeps only BM25 hits covering enough of the
 * query's content terms, in their original BM25 order.
 */
export function filterByTermCoverage<T extends { title: string; body: string; keys?: string }>(
  hits: T[],
  terms: LexicalTerm[],
  queryLang?: LexicalLang | null
): T[] {
  const required = requiredTermMatches(terms.length);
  // 0.1.55: packs v2 index the real questions each section answers (`keys`);
  // a term found there counts like one in the text.
  return hits.filter((h) => {
    const text = h.keys ? `${h.title} ${h.body} ${h.keys}` : `${h.title} ${h.body}`;
    if (countMatchedTerms(text, terms) < required) return false;
    // CL-12 (caza 0.1.97): disciplina de idioma de la pata léxica.
    // El prefijo de una pregunta en español («camb*», «llan*»,
    // «carr*») casaba tokens ingleses («cambodia», «carried»,
    // «llanidloes») y un artículo extranjero alcanzaba la cobertura
    // sin contener ni una palabra de la pregunta: así entraron
    // «Cambodia» y «River Severn» tras la guía de la llanta en el
    // aparato del dueño. La pata léxica es INTRA-idioma — el puente
    // entre idiomas es la semántica, exenta de esta puerta por
    // diseño —: un acierto en otro idioma solo pasa con cobertura
    // TOTAL por formas exactas (los cognados de verdad), nunca por
    // prefijos. Sin veredicto de idioma en cualquiera de los dos
    // lados, manda la regla de siempre.
    if (queryLang) {
      const hitLang = detectLexicalLang(text);
      if (hitLang && hitLang !== queryLang) {
        return countExactMatchedTerms(text, terms) === terms.length;
      }
    }
    return true;
  });
}

/**
 * C-05: folded forms of the datum types the offline corpora do not carry
 * by editorial design (C-09: Local stores numbers and phases, not postal
 * addresses or prices). "mail" is the form "e-mail" leaves after
 * tokenizing. This closed list grows ONLY by adding a word here together
 * with its fixture — never by silent analogy.
 */
const ABSENT_DATUM_TYPE_FORMS = new Set([
  "direccion", "direcciones", "address", "endereco", "enderecos",
  "correo", "email", "mail",
  "precio", "precios", "price", "preco", "precos",
]);

/**
 * C-05b: filler tokens a sentence may open with before its frame —
 * conjunctions, the preposition of "¿A qué…?" and spoken openers
 * ("Oye,…"). At most MAX_FRAME_FILLER_SKIP of them are skipped: the
 * frame must sit at the sentence's opening, never anywhere in its
 * text — that is the written bound of signal B's frame hunt.
 */
const FRAME_FILLER_TOKENS = new Set([
  "y", "e", "and", "a",
  "oye", "oiga", "mira", "bueno", "hola", "hey", "olha", "oi",
]);
const MAX_FRAME_FILLER_SKIP = 3;

function frameTokens(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length && i < MAX_FRAME_FILLER_SKIP && FRAME_FILLER_TOKENS.has(tokens[i])) i++;
  return tokens.slice(i);
}

/**
 * C-05c: what follows "qué" classifies the frame BY STRUCTURE, not by
 * a verb inventory. C-05b's veto enumerated the procedure verbs it
 * knew ({hago, hacer, debo, puedo, tengo…}) and adversaria-9 (A9-01)
 * showed the family outgrows any such list: "¿Qué pasa / ocurre /
 * sucede / debería / hay…?" fell exactly like A8-03. The datum form
 * is told apart by what "qué" carries:
 * - the datum TYPE itself right after "qué" ("¿Qué dirección es…?",
 *   "¿Qué precio tiene…?"): the type is the thing being asked for;
 * - the copula ("es"/"son") followed — past its article — by the
 *   type ("¿Qué es la dirección…?"): datum again. What follows the
 *   copula decides, not the copula: "¿Qué es necesario hacer…?"
 *   carries an obligation adjective there, not the type, and is a
 *   procedure question.
 * Anything else after "qué" — any verb, in any tense or mood
 * ("pasa", "hago", "toca", "se produce", "hay", "haría falta") —
 * makes the sentence ask what HAPPENS or what is DONE; a type term
 * inside it rides along, mentioned, not asked for. The only literals
 * here are frame words (the copula, the articles), never event
 * verbs: a sixth event verb needs no edit, because it is read the
 * same way as the five adversaria-9 named.
 */
const COPULA_AFTER_QUE = new Set(["es", "son"]);
const ARTICLES_AFTER_COPULA = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas", "lo"]);

function queFrameIsDatum(tokens: string[]): boolean {
  const b = tokens[1];
  if (b === undefined) return false;
  if (ABSENT_DATUM_TYPE_FORMS.has(b)) return true;
  if (!COPULA_AFTER_QUE.has(b)) return false;
  let i = 2;
  while (i < tokens.length && ARTICLES_AFTER_COPULA.has(tokens[i])) i++;
  return i < tokens.length && ABSENT_DATUM_TYPE_FORMS.has(tokens[i]);
}

/**
 * Procedure openers. A sentence governed by one of these asks what
 * to DO or what HAPPENS; a datum type mentioned inside it rides
 * along — it is not the datum being asked for (adversaria-8, A8-03:
 * "¿Qué hago si no me llega el correo de confirmación?" carries
 * "correo" past a procedure frame and C-05's bare "¿qué…?" frame
 * fired on it). Since C-05c the "qué" branch is the structural
 * negative of queFrameIsDatum — a "qué" sentence that does not
 * carry its datum in datum position IS the procedure/event frame —
 * and the remaining branches are the non-"qué" openers ("cómo",
 * "how", "o que fazer/faço", "what do/should"), frame literals
 * whose settled prices (B-1) this tanda does not renegotiate.
 */
function opensProcedureFrame(tokens: string[]): boolean {
  const a = tokens[0];
  const b = tokens[1];
  const c = tokens[2];
  return (
    a === "como" ||
    a === "how" ||
    (a === "que" && tokens.length >= 2 && !queFrameIsDatum(tokens)) ||
    (a === "o" && b === "que" && (c === "fazer" || c === "faco")) ||
    (a === "what" && (b === "do" || b === "should"))
  );
}

/**
 * C-05b: spoken need openers — the dictated form of asking for a
 * datum ("Necesito la dirección del consulado…", adversaria-8 A8-02).
 */
const NEED_FRAME_TOKENS = new Set(["necesito", "quiero", "busco", "preciso"]);

function opensDatumFrame(tokens: string[]): boolean {
  const a = tokens[0];
  const b = tokens[1];
  return (
    (a === "que" && queFrameIsDatum(tokens)) ||
    (a === "cual" && b === "es") ||
    (a === "cuales" && b === "son") ||
    (a === "what" && (b === "is" || b === "are")) ||
    (a === "qual" && b === "e") ||
    (a === "quais" && b === "sao") ||
    NEED_FRAME_TOKENS.has(a as string) ||
    (a === "i" && b === "need") ||
    (a === "eu" && b === "preciso")
  );
}

/**
 * C-05: the datum-question frame of signal B ("¿cuál es…?", "¿qué…?",
 * "what is…?", "qual é…?"), read on folded tokens so accents and
 * punctuation can't hide it.
 *
 * C-05b re-seats it after adversaria-8 showed the first form missing
 * the settled game's inventory in both directions. The frame is now
 * hunted PER SENTENCE, in the sentence that carries the type term —
 * never across the whole text at once (A8-02: under dictation an
 * opener rides first and the type lands in a second sentence, where
 * its own sentence does open as a datum request). The inventory
 * gains the forms the game demonstrates: "¿A qué + tipo…?" behaves
 * exactly like its "¿Cuál es…?" twin (A8-01) and the spoken need
 * form counts as asking. And a procedure opener VETOES the signal
 * even with a type term riding along (A8-03) — the datum has to be
 * ASKED, not mentioned; a procedure opening in the first sentence
 * makes the whole question a procedure question.
 *
 * C-05c re-seats the "qué" frame after adversaria-9 (A9-01): the
 * bare "¿qué…?" datum frame plus an enumerated procedure veto read
 * the INVENTORY, not the class — the veto covered exactly the verbs
 * it listed and every other event verb fell. The frame is now
 * structural (queFrameIsDatum): a "¿qué…?" sentence is a datum
 * question only when the type itself follows "qué" or follows its
 * copula; any other "qué" opening is the event/procedure frame, in
 * the per-sentence hunt and in the first-sentence veto alike. The
 * settled prices stand as measured: "cómo"/"how" stay on the veto
 * side (B-1), the veto stays positional (B-2) and the need frame
 * still counts only inside its own sentence (B-3).
 */
function isDatumQuestion(query: string): boolean {
  const sentences = query
    .split(/[.!?;\n]+/)
    .map((s) => tokenize(s))
    .filter((t) => t.length > 0);
  if (sentences.length === 0) return false;
  if (opensProcedureFrame(frameTokens(sentences[0]))) return false;
  return sentences.some((tokens) => {
    if (!tokens.some((t) => ABSENT_DATUM_TYPE_FORMS.has(t))) return false;
    const start = frameTokens(tokens);
    return !opensProcedureFrame(start) && opensDatumFrame(start);
  });
}

interface TokenizedText {
  list: string[];
  set: Set<string>;
}

function termMatchesTokens(tok: TokenizedText, term: LexicalTerm): boolean {
  // The same match countMatchedTerms makes, over pre-tokenized text.
  if (term.forms.some((f) => tok.set.has(f))) return true;
  const prefix = term.prefix;
  return prefix !== undefined && tok.list.some((t) => t.startsWith(prefix));
}

export interface UnfoundedCorpusOptions {
  /** Raw question, for signal B's datum frame; without it, signal B cannot form. */
  query?: string;
  /** Aligned with `served`: true when that hit comes from the user's own corpus (signal B exemption). */
  servedFromUser?: readonly boolean[];
}

/**
 * C-05: the presence signals behind ChatScreen's honest no-source fall.
 * The coverage gate above keeps any hit covering most of the question's
 * terms, without asking whether the matched terms are the ones that
 * matter — so a question with no source in the corpus still got a
 * plausible neighbour as its citation, and the fall (which needs zero
 * chunks) was never reached. This post-filter runs after the gate at
 * both lexical call sites; the decision is PER CORPUS (each corpus falls
 * or serves on its own, and the fusion only receives what survives):
 *
 * - Signal A, "this corpus does not contain the topic": with a pool of
 *   ≥ 8 candidates and a question of ≥ 3 terms, if some term does not
 *   exist in the pool (df 0) and no served hit matches any DISCRIMINATIVE
 *   term (0 < df ≤ pool/2), the corpus falls whole. Guards: a small pool
 *   is not enough statistics, and with < 3 terms an absent term carries
 *   no signature. A term that exists but was buried by the ranking
 *   (df > 0, unmatched) does NOT fire it — that is C-02/C-03 territory.
 * - Signal B, "the datum type asked for does not exist here": a datum
 *   question (isDatumQuestion) whose type term (ABSENT_DATUM_TYPE_FORMS)
 *   has df 0 in this corpus's pool makes the corpus fall. Since C-05b
 *   the frame is hunted per sentence and a procedure opener vetoes it
 *   — see isDatumQuestion. Exemption: if
 *   any served hit is from the user's own corpus, signal B drops
 *   nothing — a personal document can carry the datum without naming
 *   its type ("Consulado de España, Calle Zanja 123…" matches like the
 *   guide does), and the house already prefers the personal corpus
 *   (R-03). If a future pack DOES carry the type, its df rises above 0
 *   and the signal switches itself off.
 *
 * The semantic leg is exempt by design: its absolute floor is its
 * guard, and lexical coverage would break the pt↔es rescue it exists
 * for. Nothing here touches BM25 ranking or C-02's normalization —
 * presence per corpus is decided before either sees the list.
 */
export function dropUnfoundedCorpus<T extends { title: string; body: string; keys?: string }>(
  pool: T[],
  served: T[],
  terms: LexicalTerm[],
  options: UnfoundedCorpusOptions = {}
): T[] {
  if (served.length === 0) return served;
  const textOf = (h: T) => (h.keys ? `${h.title} ${h.body} ${h.keys}` : `${h.title} ${h.body}`);
  const tokenized = new Map<T, TokenizedText>();
  const tokOf = (h: T): TokenizedText => {
    let tok = tokenized.get(h);
    if (!tok) {
      const list = tokenize(textOf(h));
      tok = { list, set: new Set(list) };
      tokenized.set(h, tok);
    }
    return tok;
  };
  const dfOf = (term: LexicalTerm): number => pool.reduce((n, h) => n + (termMatchesTokens(tokOf(h), term) ? 1 : 0), 0);

  // Signal A — "this corpus does not contain the topic".
  if (pool.length >= 8 && terms.length >= 3) {
    const dfs = terms.map(dfOf);
    if (dfs.some((d) => d === 0)) {
      const half = pool.length / 2;
      const discriminativeMatched = served.some((h) =>
        terms.some((term, i) => dfs[i] > 0 && dfs[i] <= half && termMatchesTokens(tokOf(h), term))
      );
      if (!discriminativeMatched) return [];
    }
  }

  // Signal B — "the datum type asked for does not exist here".
  if (options.query !== undefined && isDatumQuestion(options.query)) {
    const typeTerm = terms.find((t) => t.forms.some((f) => ABSENT_DATUM_TYPE_FORMS.has(f)));
    if (typeTerm && dfOf(typeTerm) === 0 && !(options.servedFromUser?.some(Boolean) ?? false)) {
      return [];
    }
  }
  return served;
}

// Demonstratives (accent-free tokens, as `tokenize` produces them): a
// question built around one of these points at the conversation, not at
// itself ("¿y eso cuánto cuesta?").
const DEMONSTRATIVE_TOKENS = new Set([
  "eso", "ese", "esa", "esto", "este", "esta", "ello", "esos", "esas", "estos", "estas", "aquel", "aquella",
  "that", "this",
  "isso", "isto", "esse", "essa",
]);

// H-08: vocabulary of the inheritance guard. POINTING adds the anaphoric
// family to the demonstratives ("¿y el otro?", "what is IT?"): a question
// built around one of these refers to the conversation by construction.
// WH carries the interrogative frame of an attribute question ("¿cuánto
// cuesta?", "which room?") — checked on folded tokens, so most of these
// are stopwords for term purposes and live here separately.
const POINTING_TOKENS = new Set([
  ...DEMONSTRATIVE_TOKENS,
  "otro", "otra", "otros", "otras",
  "outro", "outra", "outros", "outras",
  "other", "another", "it",
]);
const WH_TOKENS = new Set([
  "que", "cual", "cuales", "cuanto", "cuantos", "cuanta", "cuantas", "cuando", "donde", "como", "quien", "quienes",
  "qual", "quais", "quanto", "quantos", "quando", "onde", "quem",
  "what", "when", "where", "which", "who", "whom", "whose", "why", "how",
]);

/** Folded, punctuation-free rendering for frame matching ("¿Qué es…?" → "que es …"). */
function foldedText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A definitional frame names its own subject and stands alone ("¿Qué es
 * la fotosíntesis?", "o que é…?", "what is…?"): inheriting the previous
 * topic into it can only contaminate. es/pt share the folded "que es/e"
 * shape (pt folds é→e, são→sao).
 */
function isDefinitionalFrame(query: string): boolean {
  const s = foldedText(query);
  if (/^(y |e |and )?(o )?que (es|son|significa|significan|e|sao)\b/.test(s)) return true;
  if (/^(and )?what (is|are)\b/.test(s)) return true;
  if (/^what does\b/.test(s) && /\bmean\b/.test(s)) return true;
  return false;
}

/**
 * A capitalized content token past the first word that the anchor never
 * mentioned is a new proper entity ("¿Y en PORTUGAL?" after the dentist):
 * the follow-up opens its own topic. Sentence-initial capitalization is
 * orthography, not a name, so the first token is exempt; the comparison
 * is on folded tokens, so case and accents can't smuggle the entity in
 * or out.
 */
function introducesNewEntity(query: string, anchor: string): boolean {
  const anchorTokens = new Set(tokenize(anchor));
  const raw = query.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
  for (let i = 1; i < raw.length; i++) {
    if (!/^\p{Lu}/u.test(raw[i])) continue;
    const folded = tokenize(raw[i])[0];
    if (!folded || folded.length < 3 || LEXICAL_STOPWORDS.has(folded)) continue;
    if (!anchorTokens.has(folded)) return true;
  }
  return false;
}

/** Shared content stem between the thin question and the anchor, in the house's own forms/prefix machinery. */
function sharesContentStem(query: string, anchor: string): boolean {
  const qa = buildLexicalQuery(query);
  const qb = buildLexicalQuery(anchor);
  if (!qa || !qb) return false;
  const anchorForms = new Set(qb.terms.flatMap((t) => t.forms));
  const anchorPrefixes = qb.terms.map((t) => t.prefix).filter((p): p is string => !!p);
  return qa.terms.some(
    (t) =>
      t.forms.some((f) => anchorForms.has(f)) ||
      (!!t.prefix && [...anchorForms].some((f) => f.startsWith(t.prefix!))) ||
      anchorPrefixes.some((p) => t.forms.some((f) => f.startsWith(p)))
  );
}

/**
 * H-08 guard: may the thin question inherit the anchor's topic?
 *
 * The adversary's cheap guard — a shared stem or a demonstrative — is
 * necessary but not sufficient: the round's own follow-up ("¿En qué
 * sala?", no shared stem, no demonstrative) and the fragment chains
 * people actually type ("¿Y mañana?", "¿y para niños?") carry neither,
 * so those two legs alone would amputate R-03 (measured on the tip: 9
 * legitimate chains inherit today with neither leg). The guard therefore
 * inherits when ANY elliptical signal is present — pointing word
 * (anaphoric/demonstrative), shared stem, interrogative attribute frame,
 * or a bare fragment of at most one content term ("¿Y mañana?" cannot
 * name a new subject: it has no term to name it with) — and refuses when
 * the thin question brings its own topic instead: a new proper entity
 * (veto that also overrides a pointing word: "¿Y eso en Portugal?"
 * points at a place, not at the conversation) or a definitional frame
 * whose subject is neither pointed at nor the anchor's own.
 */
function inheritanceAllowed(query: string, anchor: string): boolean {
  const tokens = tokenize(query);
  const pointing = tokens.some((t) => POINTING_TOKENS.has(t));
  const stem = sharesContentStem(query, anchor);
  if (isDefinitionalFrame(query) && !pointing && !stem) return false;
  if (introducesNewEntity(query, anchor)) return false;
  if (pointing || stem) return true;
  if (tokens.some((t) => WH_TOKENS.has(t))) return true;
  return (buildLexicalQuery(query)?.terms.length ?? 0) <= 1;
}

/**
 * R-03 (physical round 0.1.68): deterministic query contextualization for
 * retrieval — no model, no invented terms.
 *
 * Retrieval used to receive the raw question only, so an elliptical
 * follow-up lost its anchor: after asking about an appointment, "¿En qué
 * sala?" searched for `sala` alone and BM25 crowned the Wikipedia article
 * "Sala Bosworth" over the user's imported note ("sala 214"). When the
 * question is THIN — at most 2 content terms, or built around a
 * demonstrative with at most 3 — the retrieval query becomes this
 * question + the previous user question: `buildLexicalQuery` unions and
 * dedupes their terms downstream (capped by MAX_LEXICAL_TERMS), and the
 * semantic side embeds the same string. The current question goes FIRST
 * so its own terms can never be evicted by that cap — with the anchor
 * first, a long previous question could fill all 12 slots and drop the
 * very term the user just asked about, recreating this bug. The original
 * question is still what the user sees and what the model answers; only
 * the search changes.
 *
 * A trailing user turn identical to the query is skipped: callers build
 * the history from the message list, which may already include the
 * question being asked.
 *
 * H-08: inheritance is guarded by `inheritanceAllowed` against the very
 * anchor that would be appended — a thin question that opens its own
 * topic (new entity, definition) searches alone instead of dragging the
 * previous subject into both retrieval and the literal guide.
 */
export function contextualizeQuery(query: string, history?: ConversationHistory | null): string {
  const termCount = buildLexicalQuery(query)?.terms.length ?? 0;
  const hasDemonstrative = tokenize(query).some((t) => DEMONSTRATIVE_TOKENS.has(t));
  const thin = termCount <= 2 || (hasDemonstrative && termCount <= 3);
  if (!thin) return query;
  const turns = history?.turns ?? [];
  const self = query.trim().toLowerCase();
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.role !== "user") continue;
    if (turn.text.trim().toLowerCase() === self) continue;
    if (!inheritanceAllowed(query, turn.text)) return query;
    return `${query} ${turn.text}`;
  }
  return query;
}

/**
 * C-02 (2026-11-01): per-corpus normalization of ONE source's raw BM25
 * scores, applied by each lexical source to its own candidate list
 * BEFORE the lists are merged for fuseRetrievalResults. BM25's scale is
 * a property of the corpus that produced it (index size, term
 * statistics), not of relevance: merging raw lists and normalizing by
 * the single merged maximum let whichever corpus happened to run "hot"
 * crown the answer — on the prep's judged battery the raw winner was
 * wrong in 4 of 18 queries (a cactus chunk over the right guide, a
 * volcano and a rugby guide likewise), and the merged maximum came from
 * a different corpus almost at random (device 7, Local 7, Esencial 4).
 *
 * The measured cure (prep C-02, clean + human-phrasing batteries):
 * z-score within the corpus, squashed by a sigmoid into (0,1). It
 * crowned the right source in 13/13 judged queries whose correct chunk
 * reached the fusion; the audit's own candidate, per-corpus maximum,
 * scored worse than raw (8/18 vs 9/18) because it hands every corpus's
 * best — including a weak corpus's best — the same full weight. The
 * sigmoid (vs plain z clipped at 0) keeps below-mean candidates
 * nonzero and internally ordered. `rawScore` is not touched: the fused
 * `score` remains an order-only relative rank (see the honesty contract
 * on fuseRetrievalResults).
 *
 * Guard for degenerate lists (the prep's guard, with its stated purpose
 * made arithmetically real): with fewer than 3 candidates, or a spread
 * of ~0, a z-score manufactures confidence out of noise (two nearly
 * tied scores would land at sigmoid(±1); a lone score would carry
 * almost full weight — the N1 pathology this guard exists to prevent).
 * Such a source is scaled by its own maximum CAPPED AT THE NEUTRAL
 * POINT (sigmoid(0) = 0.5): relative gaps survive proportionally, but
 * its best cannot outrank a genuine standout from a healthy corpus.
 * When the degenerate source is the only source, the fusion's own
 * max-normalization rescales the cap away, so lone-corpus behavior is
 * unchanged.
 */
export function normalizeCorpusScores<T extends { score: number }>(chunks: T[]): T[] {
  if (chunks.length === 0) return [];
  const scores = chunks.map((c) => c.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const spread = Math.sqrt(scores.reduce((a, b) => a + (b - mean) * (b - mean), 0) / scores.length);
  if (chunks.length < 3 || spread <= 1e-6) {
    const max = Math.max(...scores, 1e-9);
    return chunks.map((c) => ({ ...c, score: 0.5 * (c.score / max) }));
  }
  return chunks.map((c) => ({ ...c, score: 1 / (1 + Math.exp(-((c.score - mean) / spread))) }));
}

/**
 * Weighted-sum fusion of two already-scored, already-relevance-filtered
 * result sets into one ranked list. Each source is normalized to its own
 * max score before weighting so lexical (BM25, unbounded) and semantic
 * (cosine, bounded [-1,1]) scores combine meaningfully despite being on
 * completely different scales.
 *
 * This is a RELATIVE re-ranking step, not a second relevance gate - it has
 * no way to tell a genuinely strong match from "the best of a bad lot",
 * since normalizing to each set's own max erases that distinction by
 * construction. Absolute relevance must be decided by filterByMinScore
 * (or an equivalent gate, like lexicalSearch's filterByTermCoverage) on
 * the INPUTS, before this runs - see retrieve.ts.
 *
 * HONESTY CONTRACT (2026-09-28): `score` on the output is the fused
 * relative rank and must be used ONLY for sorting - never rendered as a
 * relevance percentage (a lone single-source chunk would otherwise always
 * display exactly weight*100%, a constant of the weighting scheme, not a
 * measurement). Absolute match strength is carried separately in
 * `rawScore`: the pre-fusion cosine for semantic/hybrid chunks (an
 * absolute, bounded measure); lexical-only chunks leave it undefined
 * because BM25 has no honest percentage scale. The UI renders rawScore.
 */
export function fuseRetrievalResults(
  lexical: RetrievedChunk[],
  semantic: RetrievedChunk[],
  topK: number,
  weights: { lexical: number; semantic: number } = { lexical: 0.5, semantic: 0.5 },
  /** Absolute floor for semantic raw scores (the embedding model's; bge's by default). */
  minRawScore: number = MIN_SEMANTIC_SIMILARITY
): RetrievedChunk[] {
  const byId = new Map<string, RetrievedChunk>();
  const normalize = (chunks: RetrievedChunk[], weight: number, isSemantic: boolean) => {
    if (chunks.length === 0) return;
    const max = Math.max(...chunks.map((c) => c.score), 1e-9);
    for (const c of chunks) {
      const norm = (c.score / max) * weight;
      const existing = byId.get(c.chunkId);
      if (existing) {
        existing.score += norm;
        existing.matchType = "hybrid";
        // Absolute strength wins for hybrids: the semantic cosine is the
        // bounded, interpretable measure; the BM25 component has none.
        if (isSemantic) existing.rawScore = c.score;
      } else {
        byId.set(c.chunkId, { ...c, score: norm, rawScore: isSemantic ? c.score : undefined });
      }
    }
  };

  normalize(lexical, weights.lexical, false);
  normalize(semantic, weights.semantic, true);

  const sorted = Array.from(byId.values()).sort((a, b) => b.score - a.score);

  // At most MAX_CHUNKS_PER_ARTICLE per title, so one article's chunks can't crowd out a
  // second topic (knowledge packs store up to 3 chunks per article).
  const perTitle = new Map<string, number>();
  const out: RetrievedChunk[] = [];
  for (const c of sorted) {
    const key = c.title.trim().toLowerCase();
    const n = perTitle.get(key) ?? 0;
    if (n >= MAX_CHUNKS_PER_ARTICLE) continue;
    perTitle.set(key, n + 1);
    out.push(c);
    if (out.length >= topK) break;
  }

  // R-03 (physical round 0.1.68): personal-corpus reserve. A chunk from
  // the user's own documents that passed its gates (it is in the fusion
  // inputs at all only because it did) must not be crowded out of the
  // top-K by the encyclopedia: if no user chunk made the cut, the best
  // one takes a slot, displacing the weakest non-user chunk when that
  // chunk's fused score is at most ×1.25 the user chunk's — scores are
  // normalized per source, so a modest fused gap is not evidence the
  // user's paper matters less to their own question. The per-article cap
  // still applies, and the absolute raw-score gate below still runs
  // after the reserve: a reserved chunk that fails it is dropped there.
  const PERSONAL_RESERVE_FACTOR = 1.25;
  if (topK > 0 && !out.some((c) => c.sourceKind === "user")) {
    const bestUser = sorted.find((c) => c.sourceKind === "user");
    if (bestUser) {
      const key = bestUser.title.trim().toLowerCase();
      const titleCount = perTitle.get(key) ?? 0;
      const insertAt = out.findIndex((c) => c.score <= bestUser.score);
      if (titleCount < MAX_CHUNKS_PER_ARTICLE) {
        if (out.length < topK) {
          out.splice(insertAt === -1 ? out.length : insertAt, 0, bestUser);
        } else if (out.length > 0 && out[out.length - 1].score <= bestUser.score * PERSONAL_RESERVE_FACTOR) {
          out.pop();
          const at = out.findIndex((c) => c.score <= bestUser.score);
          out.splice(at === -1 ? out.length : at, 0, bestUser);
        }
      }
    }
  }
  // H2-2026-10-06: gate absoluto post-fusión. La fusión es re-ranking
  // relativo; un chunk semántico con rawScore bajo (pero "mejor de un mal
  // lote") no debe llegar al prompt del modelo.
  // CL-12 (caza 0.1.97): el chunk SOLO léxico ya no está exento de
  // esta puerta. BM25 no tiene escala absoluta honesta, pero su
  // cobertura de términos sí: la fracción de términos de la pregunta
  // que el chunk trae de verdad (termCoverage, estampada por las
  // búsquedas léxicas) es su medida absoluta, y media cobertura —
  // el mínimo que la puerta de entrada tolera — no basta para
  // llegar al prompt: hace falta más de la mitad.
  // Auditoría de la 0.1.97: el documento PROPIO del usuario queda fuera
  // de esta vara, como de la señal B de dropUnfoundedCorpus y por la
  // misma razón: una nota personal puede traer el dato sin nombrar el
  // tipo ni el tema («Seguro Mapfre. Póliza 12345678» ante «¿cuál es el
  // número de póliza del seguro del coche?», 2 de 4 términos). Pasó ya
  // la puerta de entrada; la reserva R-03 le guarda sitio, y esta
  // puerta lo tiraba después. El ruido de CL-12 era del corpus de la
  // casa, que sigue bajo la vara.
  return out.filter((c) => {
    if (c.rawScore !== undefined) return c.rawScore >= minRawScore;
    return c.termCoverage === undefined || c.termCoverage > 0.5 || c.sourceKind === "user";
  });
}

/**
 * BUG-2-2026-10-06: poda por margen aplicada a candidatos semánticos
 * ANTES de la fusión. El gap en scores coseno crudos predice relevancia
 * mejor que el valor absoluto ("The Magnitude Mirage").
 *
 * Se usa en retrieve.ts sobre los resultados de semanticSearch antes de
 * fusionar con los léxicos.
 */
export function pruneSemanticByMargin<T extends { score: number }>(
  chunks: T[],
  margin = 0.4,
  minKeep = 1
): T[] {
  return pruneByScoreMargin(chunks, margin, minKeep);
}

export const MAX_CHUNKS_PER_ARTICLE = 2;

/**
 * BUG-2-2026-10-06 (structural fix): poda por margen de score.
 *
 * El research externo ("The Magnitude Mirage", arXiv 2609.15578) demostró
 * que el GAP entre el mejor score y los siguientes predice relevancia
 * mejor que el valor absoluto (AUROC 0.724 vs 0.583). Los docs de BAAI
 * confirman que BGE concentra similitud en [0.6, 1.0], así que un piso
 * absoluto solo es un instrumento burdo.
 *
 * Esta función descarta candidatos que caen más de `margin` (fracción del
 * rango max-min) por debajo del mejor score. Se aplica DESPUÉS del piso
 * absoluto, como señal estructural adicional.
 *
 * Ejemplo: scores [0.85, 0.82, 0.55, 0.52], margin=0.4:
 *   rango = 0.85-0.52 = 0.33, umbral = 0.85 - 0.4*0.33 = 0.718
 *   → conserva [0.85, 0.82], descarta [0.55, 0.52]
 *
 * @param chunks Ordenados por score descendente (como sale de la fusión).
 * @param margin Fracción del rango a tolerar bajo el top (0-1). Default 0.4.
 * @param minKeep Mínimo a conservar aunque caigan fuera del margen. Default 1.
 */
export function pruneByScoreMargin<T extends { score: number }>(
  chunks: T[],
  margin = 0.4,
  minKeep = 1
): T[] {
  if (chunks.length <= minKeep) return chunks;
  const scores = chunks.map((c) => c.score);
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const range = max - min;
  // Si todos puntúan igual, no hay señal de gap: conservar todo.
  if (range <= 1e-9) return chunks;
  const cutoff = max - margin * range;
  const kept = chunks.filter((c) => c.score >= cutoff);
  // minKeep: nunca devolver menos de lo pedido (el top siempre sobrevive
  // porque max >= cutoff por construcción).
  return kept.length >= minKeep ? kept : chunks.slice(0, minKeep);
}

/**
 * pruneByScoreMargin for hits from the native full vector search
 * (src/rag/vectorIndex.ts), which returns only the top `limit` ids plus how
 * many passed the floor and the lowest passing score. The margin must look
 * at the whole passing range, exactly like the in-JS search does, so the
 * lowest passing score joins the list as a sentinel and is dropped after.
 */
export function pruneVectorHits(
  hits: { ids: number[]; scores: number[]; gatedCount: number; gatedMin: number | null },
  margin: number
): Array<{ id: number; score: number }> {
  const scored = hits.ids.map((id, i) => ({ id, score: hits.scores[i] }));
  if (scored.length === 0) return [];
  const SENTINEL = Number.NaN;
  const withFloor =
    hits.gatedMin !== null && hits.gatedCount > scored.length
      ? [...scored, { id: SENTINEL, score: hits.gatedMin }]
      : scored;
  return pruneByScoreMargin(withFloor, margin).filter((h) => !Number.isNaN(h.id));
}

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ConversationHistory {
  /** Condensed summary of older turns (see src/services/summarize.ts). */
  summary?: string | null;
  /** Recent turns kept verbatim, oldest first. */
  turns?: ConversationTurn[];
}

/** How both assemblers render the chunk list inside the prompt. */
function renderChunkEntries(chunks: RetrievedChunk[]): string {
  return chunks.map((c, i) => `[${i + 1}] ${c.title}\n${c.body}`).join("\n\n");
}

/** Offsets just past the end of each complete sentence in `text`. */
function sentenceEndOffsets(text: string): number[] {
  const ends: number[] = [];
  const re = /[.!?…]+["»”')\]]*(?:\s+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    ends.push(m.index + m[0].length);
    if (m[0].length === 0) re.lastIndex++;
  }
  return ends;
}

/**
 * Puntos donde un resto puede terminar: fin de frase o fin de línea
 * (2026-11-11), ordenados y sin repetir.
 */
function cutOffsets(text: string): number[] {
  const ends = new Set(sentenceEndOffsets(text));
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    if (i > 0) ends.add(i);
  }
  return [...ends].sort((x, y) => x - y);
}

/**
 * R-01 (ronda física 0.1.68): recorta la lista de fragmentos recuperados
 * hasta que el prompt cabe en la ventana con la reserva de generación.
 *
 * applyContextBudget (P2.3) solo sabe recortar HISTORIAL: las fuentes
 * viajan dentro del mensaje actual, que trata como atómico, así que con
 * una guía larga en el historial + un documento importado (4 fragmentos
 * de 2.000 caracteres ≈ 87 % de una ventana de 3072) el prompt desbordaba
 * y la ruta fija moría en assertPromptBudget con el error crudo.
 *
 * Política de recorte, en orden: se descartan fragmentos desde el final
 * (menor rango primero); el fragmento de mayor rango nunca se descarta
 * por rango — si es el único que queda y aún no cabe, se trunca su cuerpo
 * por la última frase completa que quepa; si ni un fragmento mínimo
 * cabe, se devuelve [] y manda el comportamiento «sin fuentes» del
 * llamador. Nunca se toca el sistema ni la pregunta (viven en
 * `fixedText`).
 *
 * Adversaria H-07 (2026-11-01): la política anterior era rango a ciegas
 * hasta el muñón — la sonda dejó un señuelo de 2.309 caracteres truncado
 * a 113 SIN MARCA mientras el fragmento bueno caía por rango, y el
 * resto pasaba por fuente completa ante la pantalla y el verificador.
 * Ahora: (1) todo truncado viaja marcado (`truncated: true` sobre la
 * copia devuelta; el original no se muta); (2) un resto solo entra si
 * conserva utilidad (isUsefulRemainder): mutilar un fragmento de miles
 * de caracteres a ~100 no es «entrar» — ese fragmento se sacrifica
 * TAMBIÉN y el siguiente de la lista tiene su oportunidad de entrar
 * entero o como resto útil. La protección de rango queda intacta donde
 * nació: el descarte desde el final nunca toca al primero de la lista
 * que se está ajustando; lo que cambia es que un primero que solo puede
 * entrar como muñón ya no bloquea a los demás.
 *
 * `fixedText` es todo el prompt EXCEPTO las entradas de fragmentos
 * renderizadas (sistema + historial + pregunta + marco): la estimación
 * es por longitud total, así que el orden de concatenación no importa.
 */
export function fitChunksToBudget(
  chunks: RetrievedChunk[],
  fixedText: string,
  nCtx: number,
  reserveGeneration: number,
  // 2026-11-11: quien arma el prompt en VARIOS mensajes pasa aquí su
  // propia medida (la misma suma que luego juzga applyContextBudget).
  // Sin ella se mide el texto concatenado, que solo cuenta UNA vez la
  // plantilla: correcto para assemblePrompt (un solo texto), no para
  // assembleChatMessages (sistema y mensaje actual se cuentan aparte).
  measure?: (list: RetrievedChunk[]) => number
): RetrievedChunk[] {
  if (chunks.length === 0) return chunks;
  const fits = (list: RetrievedChunk[]): boolean =>
    (measure ? measure(list) : defaultTokenCounter(fixedText + renderChunkEntries(list))) + reserveGeneration <= nCtx;
  if (fits(chunks)) return chunks;
  let candidates = chunks.slice();
  while (candidates.length > 0) {
    let kept = candidates.slice();
    while (kept.length > 1 && !fits(kept)) kept = kept.slice(0, -1);
    if (fits(kept)) return kept;
    // Queda un solo fragmento (el primero de los candidatos) y aún no
    // cabe entero: truncar su cuerpo por frases completas, de la más
    // larga a la más corta que quepa. El primer resto que cabe es el
    // más largo posible; si ni ese llega al suelo de utilidad, ningún
    // resto más corto lo hará (ambas medidas menguan juntas).
    const top = kept[0];
    // 2026-11-11: también se puede cortar al final de una línea. Una
    // tabla o una lista no tienen puntos: sin esto, un fragmento de
    // tabla que no cabía entero no tenía ningún corte posible y se
    // sacrificaba entero (lo hizo visible la estimación nueva, que ya no
    // cuenta 1.649 tokens reales como 717). En prosa sin saltos de línea
    // los cortes son los mismos de siempre.
    const ends = cutOffsets(top.body);
    let admitted: RetrievedChunk[] | null = null;
    for (let i = ends.length - 1; i >= 0; i--) {
      const body = top.body.slice(0, ends[i]).trimEnd();
      if (body.length === 0) continue;
      const candidate = [{ ...top, body, truncated: true }];
      if (fits(candidate)) {
        admitted = isUsefulRemainder(body, top.body) ? candidate : null;
        break;
      }
    }
    if (admitted) return admitted;
    // Este fragmento no puede entrar ni entero ni como resto útil: se
    // sacrifica y el ajuste se reintenta con los que quedan.
    candidates = candidates.slice(1);
  }
  return [];
}

/**
 * Suelo de utilidad de un resto truncado (H-07): conserva al menos
 * MIN_REMAINDER_CHARS caracteres — el tamaño del extracto literal que
 * la casa ya trata como «lo mínimo que se puede enseñar de una fuente»
 * (extractiveSnippet en grounding.ts, 320) — o al menos una cuarta
 * parte de su cuerpo original. Por debajo de ambas, el resto es un
 * muñón: no sostiene solo una respuesta fundada.
 */
const MIN_REMAINDER_CHARS = 320;

function isUsefulRemainder(keptBody: string, originalBody: string): boolean {
  return keptBody.length >= MIN_REMAINDER_CHARS || keptBody.length * 4 >= originalBody.length;
}

/**
 * R-01 / adversaria H-12: el suelo de generación degradable de la ruta
 * fija, como función pura para poder fixturarlo (ChatScreen es RN y no
 * se unit-testa en esta batería). Si tras el recorte el prompt no deja
 * 512 tokens, el suelo baja por peldaños (512 → 256 → 128 → 64) y se
 * genera con lo que cabe en vez de forzar 512 y morir en la aserción.
 * `spaceCut` dice la verdad que H-12 pide contar: la generación quedó
 * por debajo de lo que el turno pedía POR FALTA DE ESPACIO (no por el
 * ajuste del usuario, que vive dentro de desiredGen).
 */
export function degradableGenTokens(
  desiredGen: number,
  availableGen: number
): { genTokens: number; spaceCut: boolean } {
  const step = [512, 256, 128, 64].find((s) => s <= availableGen) ?? 64;
  const genTokens = Math.min(desiredGen, Math.max(step, availableGen));
  return { genTokens, spaceCut: genTokens < desiredGen };
}

/**
 * 0.1.90 (familia 5): la reserva EFECTIVA con la que se juzga el
 * presupuesto de un turno. Hasta aquí los ensambladores exigían la
 * reserva pedida ENTERA antes de componer: en el peldaño de emergencia
 * (nCtx 1024, el que la escalera sirve en un aparato de ≤4 GB cuando la
 * foto viva de RAM viene estrecha) el sistema fijo (436) + el mensaje
 * (101) + la reserva (512) sumaban 1049 > 1024 y el turno moría en
 * applyContextBudget «sin siquiera historial» — aunque el propio turno
 * habría generado de sobra con 256. El suelo degradable de H-12 ya
 * recortaba la GENERACIÓN después del ensamblado; llegaba tarde: el
 * ensamblado moría antes. Aquí la misma cuenta se hace ANTES, sobre el
 * núcleo irreducible del turno (sistema + mensaje actual, sin historial
 * ni fragmentos): la reserva baja por los mismos peldaños (512 → 256 →
 * 128 → 64) hasta que el núcleo cabe, y solo si ni con 64 cabe manda el
 * error honesto de siempre. El sistema no se toca jamás.
 */
export function effectiveReserveGeneration(
  reserveGeneration: number,
  nCtx: number,
  coreTokens: number
): number {
  return degradableGenTokens(reserveGeneration, nCtx - coreTokens).genTokens;
}

/**
 * `systemPrompt` sets the assistant's tone/style/length (see
 * src/constants/personalities.ts) - the citation instruction is always
 * appended on top so RAG citations keep working regardless of persona.
 *
 * `history` layers in prior conversation: a condensed summary of older
 * turns (once a chat exceeds the configured turn threshold - see
 * src/services/summarize.ts) plus the last few turns kept verbatim, so the
 * assistant doesn't lose context on the 7th+ message in a long chat.
 *
 * `noSourcesFoundNote`: set true ONLY when retrieval was actually attempted
 * and returned zero chunks (never for retrieval-irrelevant task types like
 * greetings, where no retrieval was tried). It adds an explicit instruction
 * for the model to say briefly that no local sources covered the question
 * instead of answering from general knowledge as if sources backed it -
 * the honest no-result behavior. The UI also shows a deterministic note
 * (see ChatScreen's noSourcesFound), so this instruction is a nudge, not
 * the only signal.
 */
export function assemblePrompt(
  userQuery: string,
  chunks: RetrievedChunk[],
  systemPrompt?: string,
  history?: ConversationHistory,
  styleReminder?: string,
  noSourcesFoundNote: boolean = false,
  // R-01: optional context budget, same shape as assembleChatMessages'.
  // When provided, turns are dropped oldest-first and then the chunks are
  // fitted (fitChunksToBudget) until the prompt + reserve fit nCtx; when
  // absent, behavior is exactly as before.
  budget?: { nCtx: number; reserveGeneration: number },
  // Adversaria H-07: cuando el presupuesto ajusta las fuentes, el
  // llamador recibe LA LISTA QUE ENTRÓ de verdad (con sus marcas de
  // truncado), para que quien juzga después — verificador, tarjeta de
  // evidencia, citas — juzgue lo que el modelo vio y no la lista
  // original de la recuperación. Sin ajuste, no se invoca.
  onFitted?: (fitted: RetrievedChunk[]) => void
): string {
  const buildPrompt = (
    cs: RetrievedChunk[],
    turns: ConversationTurn[] | undefined
  ): string => {
    const instruction =
      systemPrompt && systemPrompt.trim().length > 0
        ? systemPrompt.trim()
        : "You are an offline research assistant.";

    const summarySection =
      history?.summary && history.summary.trim().length > 0
        ? `Summary of earlier conversation:\n${history.summary.trim()}\n\n`
        : "";

    const turnsSection =
      turns && turns.length > 0
        ? `Recent conversation:\n${turns
            .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
            .join("\n")}\n\n`
        : "";

    // With zero retrieved chunks (a greeting/calculate/translate/code task
    // per isRetrievalIrrelevant, or a "chat"-type query retrieve() genuinely
    // found nothing relevant for), the whole context/citation framing is
    // omitted entirely rather than left as an empty "Context:\n\n" section -
    // an empty-but-present section still tells the model there's supposed to
    // be something there and to "cite sources as [n]", which is exactly the
    // kind of dangling framing that nudges a small model toward inventing
    // content to fill it instead of just answering conversationally.
    const hasContext = cs.length > 0;
    const contextInstruction = hasContext ? GROUNDED_CONTEXT_INSTRUCTION : "";
    // Honest no-result behavior: retrieval ran and found nothing relevant.
    // FIX 2026-10-09 (Phase 3): the 0.5B model hallucinates confidently when
    // permitted to answer from "general knowledge". Require honest "I don't
    // know" for factual questions without sources instead.
    const noSourcesInstruction =
      noSourcesFoundNote && !hasContext
        ? " No relevant sources were found in the offline index for this question. " +
          "Do NOT invent facts. If this is a factual question you cannot answer " +
          "reliably without sources, say honestly that you don't know the answer " +
          "and suggest what the user could check. Only answer from general knowledge " +
          "for non-factual requests (opinions, creative writing, simple calculations)."
        : "";
    const contextSection = hasContext
      ? `Context:\n${renderChunkEntries(cs)}\n\n`
      : "";

    // 0.1.61 (velocidad): lo que no cambia entre preguntas va primero
    // (identidad, estilo, límites), lo que cambia según haya fuentes, al
    // final. llama.rn reutiliza la caché del prefijo común con el turno
    // anterior: así ese prefijo no se vuelve a leer en cada pregunta.
    return `${instruction} ${GROUNDING_INSTRUCTION}${contextInstruction}${noSourcesInstruction}\n\n` +
      `${summarySection}${turnsSection}` +
      `${contextSection}` +
      `${hasContext ? `${GROUNDED_QUESTION_REMINDER}\n\n` : ""}` +
      `Question: ${userQuery}${styleSection(styleReminder)}\n\nAnswer:`;
  };

  let prompt = buildPrompt(chunks, history?.turns);
  if (!budget) return prompt;
  // 0.1.90 (familia 5): la reserva con la que se recorta es la EFECTIVA
  // (degradable sobre el núcleo irreducible: sistema + resumen +
  // pregunta, sin turnos ni fragmentos), no la pedida entera — ver
  // effectiveReserveGeneration.
  const effReserve = effectiveReserveGeneration(
    budget.reserveGeneration,
    budget.nCtx,
    defaultTokenCounter(buildPrompt([], undefined))
  );
  const fitsBudget = (p: string, reserve: number): boolean =>
    defaultTokenCounter(p) + reserve <= budget.nCtx;
  if (fitsBudget(prompt, effReserve)) return prompt;
  // R-01 cut order: oldest history first, then lowest-ranked chunks; the
  // system prompt and the question are never cut. The chunks are fitted
  // at the turn's effective reserve: if even that cannot make the core
  // fit, the prompt is returned as small as it gets and the caller's
  // budget assert remains the honest final guard (nearly unreachable).
  let turns = history?.turns ? [...history.turns] : undefined;
  while (turns && turns.length > 0 && !fitsBudget(prompt, effReserve)) {
    turns = turns.slice(1);
    prompt = buildPrompt(chunks, turns);
  }
  if (fitsBudget(prompt, effReserve)) return prompt;
  const fixedText = prompt.replace(renderChunkEntries(chunks), "");
  const fitted = fitChunksToBudget(chunks, fixedText, budget.nCtx, effReserve);
  onFitted?.(fitted);
  return buildPrompt(fitted, turns);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Same inputs and content as assemblePrompt, structured as a role-separated
 * messages array instead of one hand-built string - for models that need
 * their own real chat/instruction template applied (see
 * ModelCapabilities.usesChatTemplate, src/routing/types.ts) rather than the
 * app's generic "Question: ...\n\nAnswer:" completion shape. The caller
 * (executor.ts) passes this to LlamaEngine.generate()'s `messages` param,
 * which hands it to llama.rn/llama.cpp's own jinja chat-template engine -
 * this function never guesses at a specific template's literal syntax
 * (ChatML, Phi's format, etc.), it only decides message content/roles.
 *
 * Deliberately NOT used by assemblePrompt's callers by default - see that
 * function's own doc comment on why switching everything to a chat
 * template is a bigger, separate change than this fix attempts.
 */
export function assembleChatMessages(
  userQuery: string,
  chunks: RetrievedChunk[],
  systemPrompt?: string,
  history?: ConversationHistory,
  styleReminder?: string,
  noSourcesFoundNote: boolean = false,
  // P2.3-2026-10-08: optional context budget. When provided, history turns
  // are cut recent-first (never silently overflowing the native context);
  // when absent, behavior is exactly as before (all turns appended).
  budget?: { nCtx: number; reserveGeneration: number },
  // Adversaria H-07: ver el mismo parámetro en assemblePrompt — la lista
  // ajustada que entró en el prompt, para quien juzga después.
  onFitted?: (fitted: RetrievedChunk[]) => void
): ChatMessage[] {
  const instruction =
    systemPrompt && systemPrompt.trim().length > 0
      ? systemPrompt.trim()
      : "You are an offline research assistant.";

  const summarySection =
    history?.summary && history.summary.trim().length > 0
      ? `\n\nSummary of earlier conversation:\n${history.summary.trim()}`
      : "";

  // R-01: system and current-user are built from a chunk list so the
  // budget path can rebuild them with the fitted list. With the original
  // list the output is byte-identical to before.
  const buildSystemMessage = (cs: RetrievedChunk[]): ChatMessage => {
    const hasContext = cs.length > 0;
    const contextInstruction = hasContext ? GROUNDED_CONTEXT_INSTRUCTION : "";
    // Honest no-result behavior - see assemblePrompt for the rationale.
    // FIX 2026-10-09 (Phase 3): the 0.5B model hallucinates confidently when
    // permitted to answer from "general knowledge". Instead of allowing it,
    // require an honest "I don't know" for factual questions without sources.
    const noSourcesInstruction =
      noSourcesFoundNote && !hasContext
        ? " No relevant sources were found in the offline index for this question. " +
          "Do NOT invent facts. If this is a factual question you cannot answer " +
          "reliably without sources, say honestly that you don't know the answer " +
          "and suggest what the user could check. Only answer from general knowledge " +
          "for non-factual requests (opinions, creative writing, simple calculations)."
        : "";
    return {
      role: "system",
      content:
        // 0.1.61 (velocidad): ver assemblePrompt; prefijo estable primero.
        `${instruction} ${GROUNDING_INSTRUCTION}${contextInstruction}${noSourcesInstruction}${summarySection}`,
    };
  };

  const buildCurrentUser = (cs: RetrievedChunk[]): ChatMessage => {
    // RAG-GROUNDING 2026-10-11: las fuentes van en el turno del usuario,
    // PEGADAS a la pregunta, no al final del mensaje de sistema (donde el
    // historial las separaba de la pregunta). Un modelo pequeño atiende sobre
    // todo a lo último que lee ("Lost in the Middle", Liu et al. 2023): las
    // fuentes y la regla de ceñirse a ellas quedan justo antes de generar.
    const sourcesBlock =
      cs.length > 0
        ? `Sources:\n${renderChunkEntries(cs)}\n\n` +
          `${GROUNDED_QUESTION_REMINDER}\n\nQuestion: `
        : "";
    return {
      role: "user",
      content: `${sourcesBlock}${userQuery}${styleSection(styleReminder)}`,
    };
  };

  let systemMessage = buildSystemMessage(chunks);
  let currentUser = buildCurrentUser(chunks);

  const historyMessages: ChatMessage[] = (history?.turns ?? []).map((t) => ({
    role: t.role,
    content: t.text,
  }));

  // P2.3: when a budget is provided, cut history recent-first instead of
  // hoping it fits. System stays pinned; generation headroom is reserved.
  let keptHistory = historyMessages;
  if (budget) {
    // 0.1.90 (familia 5): la reserva con la que se juzga el turno es la
    // EFECTIVA — degradable con los peldaños de H-12, pero medida sobre
    // el núcleo IRREDUCIBLE (sistema + pregunta sin fuentes ni
    // historial), que es lo único que no se puede recortar: en el
    // peldaño de emergencia (nCtx 1024) ese núcleo (436 + 101) más la
    // reserva entera (512) no cabía «sin siquiera historial» y un
    // cuento moría antes de generar, aunque con menos generación cabía
    // de sobra. Cuando el núcleo sí deja la reserva entera (el caso
    // R-01: sobran fuentes e historial recortables), la reserva no se
    // degrada y el contrato de siempre manda. Ver
    // effectiveReserveGeneration.
    const effReserve = effectiveReserveGeneration(
      budget.reserveGeneration,
      budget.nCtx,
      defaultTokenCounter(systemMessage.content) +
        defaultTokenCounter(buildCurrentUser([]).content)
    );
    // R-01: applyContextBudget can only cut HISTORY — if system + current
    // + reserve overflow on their own it throws and the whole turn dies
    // (the round's raw "prompt excede el contexto" error: long guide in
    // history + imported document, sources alone ≈ 87% of a 3072
    // window). Only in that case, fit the chunks first — at the turn's
    // effective reserve, so the invariant prompt + reserve ≤ nCtx is
    // preserved whenever it is achievable; history then fills whatever
    // room is left, as before. If even a fitted core cannot fit,
    // applyContextBudget still throws, exactly as before: the honest
    // final guard.
    const coreOverflows =
      defaultTokenCounter(systemMessage.content) +
        defaultTokenCounter(currentUser.content) +
        effReserve >
      budget.nCtx;
    if (coreOverflows) {
      const fixedText =
        systemMessage.content +
        "\n" +
        currentUser.content.replace(renderChunkEntries(chunks), "");
      // 2026-11-11: el ajuste mide igual que el juez de abajo
      // (applyContextBudget suma sistema y mensaje actual por separado,
      // cada uno con su plantilla). Midiendo el texto concatenado, el
      // ajuste dejaba entrar un fragmento que luego no cabía por 50
      // tokens y el turno moría con «exceden nCtx … sin siquiera
      // historial» (nCtx 1024, documento importado).
      const fitted = fitChunksToBudget(
        chunks,
        fixedText,
        budget.nCtx,
        effReserve,
        (list) => defaultTokenCounter(buildSystemMessage(list).content) + defaultTokenCounter(buildCurrentUser(list).content)
      );
      onFitted?.(fitted);
      systemMessage = buildSystemMessage(fitted);
      currentUser = buildCurrentUser(fitted);
    }
    const budgeted = applyContextBudget(
      systemMessage,
      historyMessages,
      currentUser,
      budgetConfigFor(budget.nCtx, effReserve)
    );
    keptHistory = budgeted.history as ChatMessage[];
  }

  return [systemMessage, ...keptHistory, currentUser];
}

/**
 * Universal capability/tone boundary, appended for every request regardless
 * of persona or content - not a hardcoded response to any specific phrase.
 *
 * Root cause of the "wake up" -> "morning alarm set / room temperature
 * adjusted" hallucination: this prompt hand-builds a generic "Question: ...
 * Answer:" completion shape rather than a model's actual fine-tuned chat
 * template. Off that template, a small model given a short, ambiguous,
 * command-shaped fragment with no explicit "you're a chat assistant with
 * no real-world abilities" framing tends to free-associate into a
 * narrative completion (the classic sci-fi/smart-home assistant pattern,
 * or - as later real-device testing found with Qwen specifically - a
 * rambling multi-question FAQ ramble) instead of a real conversational
 * reply. `assembleChatMessages` (below) now gives models flagged
 * `usesChatTemplate` (currently just Qwen2.5-1.5B-Instruct) their own real
 * template via llama.rn's jinja support - but switching every model
 * (including Phi) and every caller (including Deep Research's per-stage
 * prompts, researchSubQuestion in orchestrator.ts) over is a bigger,
 * separate, deliberately not-yet-made decision. This instruction stays as
 * the universal, always-applied floor regardless of which prompt-building
 * path is used. It's a no-op for genuine questions (Deep Research's
 * decomposed sub-questions are always real questions, never action
 * requests), so it doesn't change that path's behavior in practice.
 */
/**
 * The tone's style reminder, appended to the current question (see
 * Personality.styleReminder). Only this turn carries it: history keeps the
 * user's own words, and retrieval searches the question alone.
 */
function styleSection(styleReminder: string | undefined): string {
  const s = styleReminder?.trim();
  return s ? `\n\n(Response style: ${s})` : "";
}

/**
 * RAG-GROUNDING 2026-10-11 (evidencia: fotosíntesis en la Tab A9+). La
 * instrucción anterior decía "If the context doesn't cover the question,
 * say so and answer from general knowledge": le daba PERMISO al 0.5B para
 * rellenar con lo que "sabe", y eso es exactamente lo que alucinaba
 * (fototropismo, luz que viaja a las raíces). Ahora: solo lo escrito en las
 * fuentes, citado; si no está, decir que no se sabe. Frases cortas y
 * literales: los modelos pequeños siguen mejor contratos breves.
 * El "no lo sé" final lo garantiza el código (src/rag/grounding.ts), no
 * esta frase: el prompt solo lo hace probable.
 */
const GROUNDED_CONTEXT_INSTRUCTION =
  " The user message contains numbered sources. Answer ONLY with facts written in those sources, " +
  "and cite sources as [n] after each sentence. Do not add facts from your own memory, even if you " +
  "think you know them. If the sources do not contain the answer, say that you don't know. " +
  "Answer in the same language as the question.";

/** Recordatorio corto pegado a la pregunta (lo último que lee el modelo). */
const GROUNDED_QUESTION_REMINDER =
  "Answer only from the sources above, citing [n], in the language of the question. " +
  // R-05: la orden que faltaba — el dato pedido se da tal cual, no se
  // habla de él («el teléfono es el número de emergencia» no es dar el
  // teléfono). R-04: el idioma de la respuesta se repite AQUÍ, pegado a
  // las fuentes, y no solo en el sistema.
  "If the question asks for a detail the sources give (a number, a date, an amount), give it exactly as it is written. " +
  "If they don't contain the answer, say you don't know.";

const GROUNDING_INSTRUCTION =
  "You have no ability to control real-world devices or take physical actions - no alarms, " +
  "lights, thermostats, timers, or any other device or system. You can only respond with text. " +
  "Treat greetings and casual small talk conversationally and briefly, not as a command or task. " +
  "Never claim to have done something (set, adjusted, turned on/off, scheduled, etc.) that you " +
  "don't actually have the ability to do.";

/**
 * Serialize a Float32Array embedding to bytes for SQLite BLOB storage.
 * Adapted from BOAR's serializeEmbedding (MIT).
 *
 * Pure function - no side effects, testable without a device.
 */
export function serializeEmbedding(embedding: Float32Array): Uint8Array {
  return new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/**
 * Deserialize bytes from SQLite BLOB back to a Float32Array embedding.
 * Validates that the byte length matches the expected dimension.
 * Adapted from BOAR's deserializeEmbedding (MIT).
 *
 * @param bytes - Raw bytes from the database
 * @param expectedDim - Expected embedding dimension (e.g., 384 for bge-small)
 * @throws Error if byte length doesn't match expected dimension
 *
 * Pure function - no side effects, testable without a device.
 */
export function deserializeEmbedding(bytes: Uint8Array, expectedDim: number): Float32Array {
  const actualDim = bytes.byteLength / 4;
  if (actualDim !== expectedDim) {
    throw new Error(
      `Embedding dimension mismatch: expected ${expectedDim}, got ${actualDim} ` +
      `(${bytes.byteLength} bytes)`
    );
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, actualDim);
}

/**
 * 0.1.36: fondo de una lista de puntuaciones ORDENADA de mayor a menor: la
 * media de los puestos 10–50 (o del último 3/4 si hay menos de 50). Igual
 * que `background()` de scripts/multilingual/e5_pipeline.py, que es donde
 * se calibró.
 */
export const DISTINCT_BG_FROM = 10;
export const DISTINCT_BG_TO = 50;

/**
 * 2026-11-06 (prueba física): justo después de actualizar NIDO Esencial a
 * la v14, «¿Qué hago durante un terremoto?» respondió con la introducción
 * de una guía de otro pack. El índice de vectores de Esencial se estaba
 * reconstruyendo en segundo plano y, mientras tanto, ese pack solo buscaba
 * por palabras. Un pack pequeño (cientos de trozos) se puede recorrer
 * entero en JS en milisegundos: este es el mismo contrato que la búsqueda
 * nativa del índice (ids y puntuaciones de mayor a menor por encima del
 * piso, cuántos pasaron el piso y el menor de ellos), sin índice.
 */
export const EXACT_SEARCH_MAX_ROWS = 5000;

export function exactVectorSearch(
  rows: ReadonlyArray<{ id: number; vec: Uint8Array }>,
  query: Float32Array,
  floor: number,
  limit: number,
): { ids: number[]; scores: number[]; gatedCount: number; gatedMin: number | null } {
  const above: Array<{ id: number; score: number }> = [];
  for (const r of rows) {
    const score = cosineSimilarityInt8(query, r.vec);
    if (Number.isFinite(score) && score >= floor) above.push({ id: r.id, score });
  }
  above.sort((a, b) => b.score - a.score || a.id - b.id);
  const top = above.slice(0, Math.max(0, limit));
  return {
    ids: top.map((h) => h.id),
    scores: top.map((h) => h.score),
    gatedCount: above.length,
    gatedMin: above.length ? above[above.length - 1].score : null,
  };
}
export function backgroundScore(sortedDesc: readonly number[]): number {
  const n = sortedDesc.length;
  if (n === 0) return 0;
  const from = n > DISTINCT_BG_TO ? DISTINCT_BG_FROM : Math.floor(n / 4);
  const to = n > DISTINCT_BG_TO ? DISTINCT_BG_TO : n;
  let sum = 0;
  for (let i = from; i < to; i++) sum += sortedDesc[i];
  return to > from ? sum / (to - from) : 0;
}

/** Piso efectivo: el del modelo, o el fondo + `gap` si es más alto. */
export function distinctFloor(floor: number, sortedDesc: readonly number[], gap: number): number {
  // Con pocos candidatos (un puñado de documentos propios) no hay fondo
  // fiable: se deja el piso del modelo tal cual.
  if (!(gap > 0) || sortedDesc.length <= DISTINCT_BG_TO) return floor;
  return Math.max(floor, backgroundScore(sortedDesc) + gap);
}
