/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { llamaEngine } from "../inference/LlamaEngine";
import { retrieve, assemblePrompt, RetrievedChunk, ConversationHistory } from "../rag/retrieve";
import { assembleChatMessages } from "../rag/pure";

/**
 * "Deep Research Mode" — a sequential multi-pass pipeline over the SAME
 * single loaded model, not literally multiple specialist models running
 * concurrently. Three frontier-agent-inspired ideas (running 3 models at
 * once, a planner model, a critic model) genuinely don't fit in the 12GB
 * RAM budget alongside everything else this app already loads — so this
 * decomposes the request into sequential llama.cpp calls on one context
 * instead: decompose -> research each sub-question (with its own
 * retrieval pass) -> synthesize. Slower than the normal single-pass chat
 * (several LLM calls instead of one), not "multiple AI agents." The UI
 * badge for this mode says "Deep Research (multi-pass)", not "multi-agent",
 * to avoid overclaiming what's actually happening.
 */

export type ResearchStage = "decomposing" | "researching" | "synthesizing";

export interface ResearchProgress {
  stage: ResearchStage;
  subQuestionIndex?: number;
  subQuestionCount?: number;
}

export interface ResearchResult {
  answer: string;
  subQuestions: string[];
  citations: RetrievedChunk[];
  /** True if any stage hit STAGE_TIMEOUT_MS and was cut off early. */
  timedOut?: boolean;
  /**
   * Honest no-result signal (2026-09-28): true when every sub-question's
   * retrieval pass returned zero chunks. The UI renders a deterministic
   * note; the synthesis prompt also gets nudged via researchSubQuestion.
   */
  noSourcesFound?: boolean;
}

/**
 * One sub-question's research output, paired with how many local source
 * chunks its retrieval pass actually found. The count travels with the
 * answer so the final synthesis can tell sourced perspectives apart from
 * ones the model generated with no local sources at all (D/F5).
 */
export interface ResearchSubResult {
  subQuestion: string;
  answer: string;
  sourceCount: number;
}

/**
 * Deterministic honest answer for the all-zero-evidence case (D/F5): every
 * sub-question's retrieval pass returned nothing, so there is no sourced
 * research to synthesize. Returning this instead of calling the synthesis
 * LLM guarantees the model is never invited to fabricate a "well-reasoned,
 * cited" answer from empty perspectives.
 */
export function noSourcesResearchAnswer(): string {
  return (
    "I couldn't find any relevant sources in the offline index, so I can't " +
    "produce a sourced research answer for this question. You can import " +
    "relevant documents into the knowledge base, or try rephrasing the question."
  );
}

/**
 * Structural citation renumbering (R2): rewrite perspective-relative
 * citations [1..k] of ONE sub-question's research answer into global
 * offsets across the concatenated footnote list the UI renders
 * (SourceFootnotes numbers chips i+1 over allChunks, in sub-question
 * order). Citations outside 1..perspectiveChunkCount are left untouched —
 * they are either invented (stripped later by cleanCitations, which keeps
 * only 1..allChunks.length) or belong to another namespace entirely.
 *
 * This is structural, not a prompt nudge: the synthesis LLM never sees a
 * perspective-relative citation, so it cannot emit a "[1]" that mislinks
 * to another perspective's chunk. Offsets come from each perspective's
 * sourceCount (=== its retrieval pass's chunk count), computed
 * deterministically in buildSynthesisPrompt — the model does no
 * renumbering at all.
 */
export function renumberPerspectiveCitations(
  answer: string,
  globalOffset: number,
  perspectiveChunkCount: number
): string {
  if (globalOffset === 0 || perspectiveChunkCount <= 0) return answer;
  return answer.replace(/\[(\d+)\]/g, (match, digits) => {
    const n = Number(digits);
    return n >= 1 && n <= perspectiveChunkCount ? `[${globalOffset + n}]` : match;
  });
}

/**
 * Pure prompt builder for the final synthesis (D/F5, R2). Each perspective
 * is labeled with its own retrieval result so the model cannot mistake
 * general-knowledge prose for sourced research:
 * - a perspective that had sources keeps its citations — RESTRUCTURED by
 *   renumberPerspectiveCitations into GLOBAL offsets across the
 *   concatenated footnote list, cited ONLY for claims it itself sourced —
 *   citation numbers are never to be invented or renumbered by the model;
 * - a perspective marked [sources: none] must never be presented as backed
 *   by local sources.
 * When NO perspective has sources, the citation framing is omitted entirely
 * (an empty "cite sources" instruction is exactly the dangling framing that
 * nudges a small model toward inventing content to fill it).
 */
/** Shared content for buildSynthesisPrompt / buildSynthesisMessages (P1.4). */
function synthesisParts(
  originalQuery: string,
  subResults: ResearchSubResult[],
  systemPrompt: string | undefined
): { system: string; user: string } {
  const anySources = subResults.some((r) => r.sourceCount > 0);
  // R2: cumulative global offset per perspective — footnote [n] in the UI
  // is allChunks[n-1], i.e. perspective i's chunk k sits at
  // (sum of previous perspectives' sourceCounts) + k.
  let globalOffset = 0;
  const perspectives = subResults
    .map((r, i) => {
      const renumbered = renumberPerspectiveCitations(r.answer, globalOffset, r.sourceCount);
      const text =
        `Perspective ${i + 1} (${r.subQuestion}) ` +
        (r.sourceCount > 0
          ? `[sources: ${r.sourceCount}]`
          : `[sources: none — generated without local sources]`) +
        `:\n${renumbered}`;
      globalOffset += r.sourceCount;
      return text;
    })
    .join("\n\n");
  const instruction =
    systemPrompt && systemPrompt.trim().length > 0
      ? systemPrompt.trim()
      : "You are an offline research assistant.";
  const citationInstruction = anySources
    ? ` Cite sources as [n] ONLY for claims that a perspective itself ` +
      `sourced — copy each citation number exactly as it appears in that ` +
      `perspective (citation numbers are already global across all ` +
      `perspectives): never invent citation numbers and never renumber ` +
      `them. A perspective ` +
      `marked [sources: none] was generated without any local sources: ` +
      `never present its claims as backed by local sources; attribute them ` +
      `to general knowledge, or say the local index had nothing on that part.`
    : ` No perspective had any local sources, so write the answer without ` +
      `citations and without implying that local sources support it.`;
  const system =
    `${instruction} You are synthesizing multiple research perspectives into one answer.` +
    citationInstruction;
  const user =
    `Original question: ${originalQuery}\n\n${perspectives}\n\n` +
    `Compare these perspectives, reconcile any conflicts, and write one unified, ` +
    `well-reasoned answer.`;
  return { system, user };
}

export function buildSynthesisPrompt(
  originalQuery: string,
  subResults: ResearchSubResult[],
  systemPrompt: string | undefined
): string {
  const { system, user } = synthesisParts(originalQuery, subResults, systemPrompt);
  return `${system}\n\n${user}\n\nAnswer:`;
}

/** P1.4: messages form of the synthesis prompt for models with a chat template. */
export function buildSynthesisMessages(
  originalQuery: string,
  subResults: ResearchSubResult[],
  systemPrompt: string | undefined
): { role: string; content: string }[] {
  const { system, user } = synthesisParts(originalQuery, subResults, systemPrompt);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// Safety net, not a performance target — before this, no stage of this
// multi-call pipeline had any time ceiling at all (see
// docs/ADAPTIVE_ROUTING.md §14), so a single stuck stage on a slow/loaded
// device could hang the whole research pass indefinitely with no recovery
// but the user manually stopping it. 2 minutes is deliberately generous.
const STAGE_TIMEOUT_MS = 120_000;

async function decompose(query: string, onTimeout: () => void): Promise<string[]> {
  // P1.4-2026-10-08: real chat template when the GGUF ships one; the
  // hand-built "Question:/Sub-questions:" shape is the fallback for
  // models without an embedded template.
  const instruction =
    `Break this research question into 2-3 focused sub-questions that ` +
    `together cover it well (e.g. technical analysis, counter-arguments, ` +
    `practical implications — whichever fit this question). One per line, ` +
    `no numbering, no extra commentary.`;
  const promptParams = llamaEngine.hasEmbeddedChatTemplate()
    ? {
        messages: [
          { role: "system", content: instruction },
          { role: "user", content: `Question: ${query}` },
        ],
      }
    : {
        prompt: `${instruction}\n\nQuestion: ${query}\n\nSub-questions:`,
      };
  const text = await llamaEngine.generate({
    ...promptParams,
    nPredict: 150,
    temperature: 0.4,
    timeoutMs: STAGE_TIMEOUT_MS,
    onTimeout,
  });
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((l) => l.length > 8);
  return lines.slice(0, 3).length > 0 ? lines.slice(0, 3) : [query];
}

async function researchSubQuestion(
  subQuestion: string,
  systemPrompt: string | undefined,
  history: ConversationHistory | undefined,
  onTimeout: () => void
): Promise<{ answer: string; chunks: RetrievedChunk[] }> {
  const chunks = await retrieve(subQuestion);
  // Honest no-result: this sub-question's own retrieval pass found
  // nothing, so the model is told to say so briefly rather than answering
  // from general knowledge as if local sources backed it.
  // P1.4: messages+jinja when the model ships a template, else the
  // legacy hand-built prompt (same fallback pattern as executor.ts).
  const promptParams = llamaEngine.hasEmbeddedChatTemplate()
    ? {
        messages: assembleChatMessages(subQuestion, chunks, systemPrompt, history, undefined, chunks.length === 0),
      }
    : {
        prompt: assemblePrompt(subQuestion, chunks, systemPrompt, history, undefined, chunks.length === 0),
      };
  const answer = await llamaEngine.generate({
    ...promptParams,
    nPredict: 300,
    temperature: 0.6,
    timeoutMs: STAGE_TIMEOUT_MS,
    onTimeout,
  });
  return { answer, chunks };
}

async function synthesize(
  originalQuery: string,
  subResults: ResearchSubResult[],
  systemPrompt: string | undefined,
  maxTokens: number,
  onToken: (piece: string) => void,
  onTimeout: () => void
): Promise<string> {
  // P1.4: messages+jinja when the GGUF ships a template, else the legacy
  // hand-built string.
  const promptParams = llamaEngine.hasEmbeddedChatTemplate()
    ? { messages: buildSynthesisMessages(originalQuery, subResults, systemPrompt) }
    : { prompt: buildSynthesisPrompt(originalQuery, subResults, systemPrompt) };
  return llamaEngine.generate({
    ...promptParams,
    nPredict: maxTokens,
    temperature: 0.6,
    onToken,
    timeoutMs: STAGE_TIMEOUT_MS,
    onTimeout,
  });
}

export async function runDeepResearch(
  query: string,
  systemPrompt: string | undefined,
  history: ConversationHistory | undefined,
  maxTokens: number,
  onProgress?: (p: ResearchProgress) => void,
  onToken?: (piece: string) => void,
  shouldStop?: () => boolean
): Promise<ResearchResult> {
  let timedOut = false;
  const markTimedOut = () => {
    timedOut = true;
  };

  onProgress?.({ stage: "decomposing" });
  const subQuestions = await decompose(query, markTimedOut);

  const subResults: ResearchSubResult[] = [];
  const allChunks: RetrievedChunk[] = [];
  for (let i = 0; i < subQuestions.length; i++) {
    // llamaEngine.stop() only interrupts whichever single completion call is
    // in flight *right now* — with several sequential completions here
    // (decompose, each sub-question, synthesize), a stop request needs its
    // own check between stages or the pipeline just carries on to the next
    // one regardless of the user having asked it to stop.
    if (shouldStop?.()) return { answer: "", subQuestions, citations: allChunks, timedOut, noSourcesFound: allChunks.length === 0 };
    onProgress?.({ stage: "researching", subQuestionIndex: i, subQuestionCount: subQuestions.length });
    const { answer, chunks } = await researchSubQuestion(subQuestions[i], systemPrompt, history, markTimedOut);
    subResults.push({ subQuestion: subQuestions[i], answer, sourceCount: chunks.length });
    allChunks.push(...chunks);
  }

  if (shouldStop?.()) return { answer: "", subQuestions, citations: allChunks, timedOut, noSourcesFound: allChunks.length === 0 };

  // D/F5: no local source was found for ANY sub-question, so there is no
  // sourced research to synthesize. Answer deterministically instead of
  // asking the model to "write one unified, well-reasoned answer" with
  // citations from perspectives that had zero evidence — that framing is
  // exactly what invited fabrication. noSourcesFound stays true so the UI
  // renders its deterministic note as well.
  if (allChunks.length === 0) {
    return { answer: noSourcesResearchAnswer(), subQuestions, citations: allChunks, timedOut, noSourcesFound: true };
  }

  onProgress?.({ stage: "synthesizing" });
  // The final synthesized answer respects the user's Max Output Tokens
  // setting, same as a normal single-pass reply — the sub-question research
  // passes above use their own smaller fixed budgets since they're
  // intermediate working material, not what the user reads.
  const answer = await synthesize(
    query,
    subResults,
    systemPrompt,
    maxTokens,
    onToken ?? (() => {}),
    markTimedOut
  );

  return { answer, subQuestions, citations: allChunks, timedOut, noSourcesFound: allChunks.length === 0 };
}
