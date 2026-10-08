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
import { applyContextBudget, budgetConfigFor } from "../agent/loop/contextBudget";

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
]);

const MAX_LEXICAL_TERMS = 12;

export interface LexicalTerm {
  /**
   * Exact word forms that count as this term: the query word, plus its
   * singular when it looks plural ("vaccines" → "vaccine"), because the FTS
   * index has no stemmer.
   */
  forms: string[];
}

export interface LexicalQuery {
  /** FTS5 MATCH expression: every quoted form OR-ed together, BM25-ranked by FTS5 itself. */
  match: string;
  terms: LexicalTerm[];
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
    terms.push({ forms });
    if (terms.length >= MAX_LEXICAL_TERMS) break;
  }
  if (terms.length === 0) return null;
  const match = terms.flatMap((t) => t.forms.map((f) => `"${f}"`)).join(" OR ");
  return { match, terms };
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
  const tokens = new Set(tokenize(text));
  return terms.filter((term) => term.forms.some((f) => tokens.has(f))).length;
}

/**
 * The lexical relevance gate: keeps only BM25 hits covering enough of the
 * query's content terms, in their original BM25 order.
 */
export function filterByTermCoverage<T extends { title: string; body: string }>(
  hits: T[],
  terms: LexicalTerm[]
): T[] {
  const required = requiredTermMatches(terms.length);
  return hits.filter((h) => countMatchedTerms(`${h.title} ${h.body}`, terms) >= required);
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
  weights: { lexical: number; semantic: number } = { lexical: 0.5, semantic: 0.5 }
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

  // At most MAX_CHUNKS_PER_ARTICLE per title, so one article's chunks can't crowd out a
  // second topic (knowledge packs store up to 3 chunks per article).
  const perTitle = new Map<string, number>();
  const out: RetrievedChunk[] = [];
  for (const c of Array.from(byId.values()).sort((a, b) => b.score - a.score)) {
    const key = c.title.trim().toLowerCase();
    const n = perTitle.get(key) ?? 0;
    if (n >= MAX_CHUNKS_PER_ARTICLE) continue;
    perTitle.set(key, n + 1);
    out.push(c);
    if (out.length >= topK) break;
  }
  // H2-2026-10-06: gate absoluto post-fusión. La fusión es re-ranking
  // relativo; un chunk semántico con rawScore bajo (pero "mejor de un mal
  // lote") no debe llegar al prompt del modelo.
  return out.filter((c) => c.rawScore === undefined || c.rawScore >= MIN_SEMANTIC_SIMILARITY);
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
  noSourcesFoundNote: boolean = false
): string {
  const instruction =
    systemPrompt && systemPrompt.trim().length > 0
      ? systemPrompt.trim()
      : "You are an offline research assistant.";

  const summarySection =
    history?.summary && history.summary.trim().length > 0
      ? `Summary of earlier conversation:\n${history.summary.trim()}\n\n`
      : "";

  const turnsSection =
    history?.turns && history.turns.length > 0
      ? `Recent conversation:\n${history.turns
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
  const hasContext = chunks.length > 0;
  const contextInstruction = hasContext
    ? " Use the context below when relevant, and cite sources as [n]. " +
      "If the context doesn't cover the question, say so and answer from general knowledge."
    : "";
  // Honest no-result behavior: retrieval ran and found nothing relevant.
  // Tell the model to say so briefly rather than letting it answer from
  // general knowledge while the UI implies sources backed it. (The UI also
  // renders a deterministic "no sources" note - this is the prompt half.)
  const noSourcesInstruction =
    noSourcesFoundNote && !hasContext
      ? " No relevant sources were found in the offline index for this question. " +
        "If you answer from general knowledge, say so briefly instead of implying that local sources support your answer."
      : "";
  const contextSection = hasContext
    ? `Context:\n${chunks.map((c, i) => `[${i + 1}] ${c.title}\n${c.body}`).join("\n\n")}\n\n`
    : "";

  return `${instruction}${contextInstruction}${noSourcesInstruction} ${GROUNDING_INSTRUCTION}\n\n` +
    `${summarySection}${turnsSection}` +
    `${contextSection}` +
    `Question: ${userQuery}${styleSection(styleReminder)}\n\nAnswer:`;
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
  budget?: { nCtx: number; reserveGeneration: number }
): ChatMessage[] {
  const instruction =
    systemPrompt && systemPrompt.trim().length > 0
      ? systemPrompt.trim()
      : "You are an offline research assistant.";

  const hasContext = chunks.length > 0;
  const contextInstruction = hasContext
    ? " Use the context below when relevant, and cite sources as [n]. " +
      "If the context doesn't cover the question, say so and answer from general knowledge."
    : "";
  // Honest no-result behavior - see assemblePrompt for the rationale.
  const noSourcesInstruction =
    noSourcesFoundNote && !hasContext
      ? " No relevant sources were found in the offline index for this question. " +
        "If you answer from general knowledge, say so briefly instead of implying that local sources support your answer."
      : "";
  const contextSection = hasContext
    ? `\n\nContext:\n${chunks.map((c, i) => `[${i + 1}] ${c.title}\n${c.body}`).join("\n\n")}`
    : "";
  const summarySection =
    history?.summary && history.summary.trim().length > 0
      ? `\n\nSummary of earlier conversation:\n${history.summary.trim()}`
      : "";

  const systemMessage: ChatMessage = {
    role: "system",
    content:
      `${instruction}${contextInstruction}${noSourcesInstruction} ${GROUNDING_INSTRUCTION}${summarySection}${contextSection}`,
  };

  const historyMessages: ChatMessage[] = (history?.turns ?? []).map((t) => ({
    role: t.role,
    content: t.text,
  }));

  const currentUser: ChatMessage = { role: "user", content: userQuery + styleSection(styleReminder) };

  // P2.3: when a budget is provided, cut history recent-first instead of
  // hoping it fits. System stays pinned; generation headroom is reserved.
  let keptHistory = historyMessages;
  if (budget) {
    const budgeted = applyContextBudget(
      systemMessage,
      historyMessages,
      currentUser,
      budgetConfigFor(budget.nCtx, budget.reserveGeneration)
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
