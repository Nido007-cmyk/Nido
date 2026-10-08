/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// R2 — Deep Research citation renumbering.
//
// INVARIANT: a citation [n] in a synthesized answer must resolve to the
// exact source chunk of the perspective that produced it, never to another
// perspective's chunk.
//
// PRE-FIX BROKEN BEHAVIOR (reproduced on baseline f536c79, then fixed):
// each sub-question's research pass cited its own chunks as [1], [2] (the
// assemblePrompt context numbers chunks relative to that pass), while the
// UI footnote list is the concatenated allChunks numbered globally. So
// sub-question 2's "[1]" rendered as sub-question 1's chunk 1 — conflicting
// perspectives ("Yes, shipped [1]" vs "No, cancelled [1]") rendered the
// SAME footnote.
//
// FIX: renumberPerspectiveCitations() rewrites each perspective's citations
// into global offsets across the concatenated footnote list, structurally,
// before the synthesis LLM ever sees them. The model is instructed to copy
// the (already global) numbers exactly — it does no renumbering.

const generateMock = vi.fn();
const retrieveMock = vi.fn();

vi.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    generate: (opts: any) => generateMock(opts),
    hasEmbeddedChatTemplate: () => false,
  },
}));

vi.mock("../rag/retrieve", () => ({
  retrieve: (query: string) => retrieveMock(query),
  assemblePrompt: () => "mock sub-question prompt",
}));

import { runDeepResearch, renumberPerspectiveCitations, buildSynthesisPrompt } from "./orchestrator";
import { cleanCitations } from "./citations";

import type { RetrievedChunk } from "../rag/retrieve.types";
function chunk(chunkId: string): RetrievedChunk {
  return { chunkId, docId: `doc-${chunkId}`, title: `Title ${chunkId}`, body: `Body ${chunkId}`, score: 1, matchType: "semantic" as const };
}

const SYNTH_MARKER = "synthesizing multiple research perspectives";

beforeEach(() => {
  generateMock.mockReset();
  retrieveMock.mockReset();
});

/** Decompose -> sub-question answers from a script; synthesis echoes the prompt. */
function scriptRun(subQuestions: string[], answers: string[], chunkPlans: RetrievedChunk[][]) {
  let researchCall = 0;
  generateMock.mockImplementation(async (opts: { prompt: string }) => {
    if (opts.prompt.startsWith("Break this research question")) {
      return subQuestions.join("\n");
    }
    if (opts.prompt.includes(SYNTH_MARKER)) return opts.prompt; // echo
    // Sequential research calls map 1:1 to answers in order (the
    // assemblePrompt mock returns a fixed string, so we count calls).
    return answers[Math.min(researchCall++, answers.length - 1)];
  });
  const plans = [...chunkPlans];
  retrieveMock.mockImplementation(async () => plans.shift() ?? []);
}

/**
 * Mirror of the UI's footnote-render path: SourceFootnotes renders chip
 * i+1 for citations[i]; ChatScreen runs cleanCitations(answer,
 * citations.length) on the answer text before display. Resolve every
 * remaining [n] in the displayed answer to its footnote chunk.
 */
function resolveDisplayedCitations(answer: string, citations: RetrievedChunk[]) {
  const displayed = cleanCitations(answer, citations.length);
  const out: { n: number; chunkId: string }[] = [];
  for (const m of displayed.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    out.push({ n, chunkId: citations[n - 1]?.chunkId ?? "<missing>" });
  }
  return { displayed, out };
}

describe("R2 — renumberPerspectiveCitations unit", () => {
  it("offset 0 leaves the answer byte-identical", () => {
    expect(renumberPerspectiveCitations("Yes [1] and [2].", 0, 2)).toBe("Yes [1] and [2].");
  });

  it("shifts 1..chunkCount by the global offset", () => {
    expect(renumberPerspectiveCitations("No, cancelled [1] after [2].", 2, 2)).toBe(
      "No, cancelled [3] after [4]."
    );
  });

  it("leaves out-of-range / invented citations untouched for cleanCitations", () => {
    expect(renumberPerspectiveCitations("Says [1] and [9].", 2, 1)).toBe("Says [3] and [9].");
  });

  it("zero-source perspective: nothing renumbered", () => {
    expect(renumberPerspectiveCitations("Claims [1].", 2, 0)).toBe("Claims [1].");
  });

  it("does not touch non-citation brackets", () => {
    expect(renumberPerspectiveCitations("version [v2] released", 5, 1)).toBe("version [v2] released");
  });
});

describe("R2 — conflicting perspectives resolve to their own chunks", () => {
  it("[1] from sub-question 2 can never resolve to sub-question 1's chunk", async () => {
    // The audit's canonical collision: "Yes, shipped [1]" vs "No, cancelled [1]".
    scriptRun(
      ["Did it ship?", "Was it cancelled?"],
      ["Yes, shipped [1].", "No, cancelled [1]."],
      [[chunk("a1"), chunk("a2")], [chunk("b1")]]
    );
    const result = await runDeepResearch("q", undefined, undefined, 200);

    // Footnotes are the concatenated allChunks: [a1, a2, b1].
    expect(result.citations.map((c) => c.chunkId)).toEqual(["a1", "a2", "b1"]);

    const { out } = resolveDisplayedCitations(result.answer, result.citations);
    const byChunk = new Map(out.map((r) => [r.chunkId, r.n]));
    // Sub-Q1's claim still cites its own chunk; sub-Q2's claim now cites
    // footnote 3 — ITS chunk — never footnote 1.
    expect(byChunk.get("a1")).toBe(1);
    expect(byChunk.get("b1")).toBe(3);
    expect(out.filter((r) => r.n === 1).map((r) => r.chunkId)).toEqual(["a1"]);
  });

  it("multi-citation later perspectives shift every citation", async () => {
    scriptRun(
      ["What are the main benefits?", "What are the main risks?", "What does it cost?"],
      ["First [1].", "Second [1] and [2].", "Third [2]."],
      [[chunk("a1")], [chunk("b1"), chunk("b2")], [chunk("c1"), chunk("c2")]]
    );
    const result = await runDeepResearch("q", undefined, undefined, 200);
    expect(result.citations.map((c) => c.chunkId)).toEqual(["a1", "b1", "b2", "c1", "c2"]);

    const { out } = resolveDisplayedCitations(result.answer, result.citations);
    const ids = out.map((r) => r.chunkId);
    // [1] -> a1, [2]/[3] -> b1/b2, [5] -> c2 (Q3's perspective-relative [2]
    // sits at offset 3: 1 + 2 prior chunks)
    expect(ids).toEqual(["a1", "b1", "b2", "c2"]);
  });

  it("no-source perspective keeps its text; its invented citations are not promoted into range", async () => {
    scriptRun(
      ["What are the main benefits?", "What are the main risks?"],
      ["Sourced claim [1].", "Unsourced musing [1]."],
      [[chunk("a1"), chunk("a2")], []]
    );
    const result = await runDeepResearch("q", undefined, undefined, 200);
    expect(result.citations.map((c) => c.chunkId)).toEqual(["a1", "a2"]);

    // The synthesis prompt must still mark the perspective as sourceless…
    const prompt = buildSynthesisPrompt("q", [
      { subQuestion: "Q1?", answer: "Sourced claim [1].", sourceCount: 2 },
      { subQuestion: "Q2?", answer: "Unsourced musing [1].", sourceCount: 0 },
    ], undefined);
    expect(prompt).toMatch(/sources:\s*none/i);
    // …and its [1] must NOT have been shifted to a "valid-looking" global
    // number — it stays [1] so the model-facing instruction (never present
    // no-source claims as backed) and cleanCitations stay the arbiters.
    expect(prompt).toContain("Unsourced musing [1].");
  });

  it("perspective-relative collisions are structurally impossible in the synthesis prompt", async () => {
    // Direct unit check on the prompt builder: after renumbering, no two
    // perspectives may contribute the same citation number.
    const prompt = buildSynthesisPrompt("q", [
      { subQuestion: "sq1", answer: "Yes [1] and [2].", sourceCount: 2 },
      { subQuestion: "sq2", answer: "No [1].", sourceCount: 1 },
      { subQuestion: "sq3", answer: "Maybe [1] [2] [3].", sourceCount: 3 },
    ], undefined);
    const numbers = [...prompt.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    // Footnotes: [sq1c1, sq1c2, sq2c1, sq3c1, sq3c2, sq3c3] -> numbers 1..6,
    // each exactly once across the perspective bodies (the source-count
    // labels contain no citation brackets).
    const perspectiveNumbers = numbers.filter((n) => n >= 1 && n <= 6);
    expect(perspectiveNumbers).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("R2 — integration: synthesis -> footnote render path", () => {
  it("every [n] in the displayed answer resolves to the perspective that produced it", async () => {
    scriptRun(
      ["Did it ship?", "Was it cancelled?"],
      ["Yes, shipped [1] per the manifest [2].", "No, cancelled [1]."],
      [[chunk("a1"), chunk("a2")], [chunk("b1")]]
    );
    const result = await runDeepResearch("q", undefined, undefined, 200);

    // Full chain exactly as ChatScreen renders it: cleanCitations with the
    // concatenated footnote count, then chip i+1 -> citations[i].
    const { displayed, out } = resolveDisplayedCitations(result.answer, result.citations);
    expect(displayed).toContain("[3]");
    expect(out).toHaveLength(3);
    expect(out.map((r) => `${r.n}:${r.chunkId}`)).toEqual(["1:a1", "2:a2", "3:b1"]);
  });

  it("invented citations still cannot survive the render path", async () => {
    scriptRun(
      ["What are the main benefits?"],
      ["Real [1], invented [9]."],
      [[chunk("a1")]]
    );
    const result = await runDeepResearch("q", undefined, undefined, 200);
    const { displayed } = resolveDisplayedCitations(result.answer, result.citations);
    expect(displayed).toContain("[1]");
    expect(displayed).not.toContain("[9]");
  });
});
