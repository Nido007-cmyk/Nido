/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// D/F5 source-honesty — Deep Research final synthesis.
//
// INVARIANT: final synthesis must never present missing/empty source
// evidence as sourced factual claims.
// The pre-fix failure condition (reproduced on baseline 40359b0: 6 of these
// tests failed) was that synthesize() received sub-results with no evidence
// metadata, labeled every perspective identically, and told the model to
// "Cite sources as [n] where the perspectives did" — inviting fabrication of
// cited claims from perspectives whose retrieval pass returned zero chunks.
// These tests now assert the post-fix behavior.

const generateMock = vi.fn();
const retrieveMock = vi.fn();
let mockHasTemplate = false;

vi.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    generate: (opts: any) => generateMock(opts),
    hasEmbeddedChatTemplate: () => mockHasTemplate,
  },
}));

vi.mock("../rag/retrieve", () => ({
  retrieve: (query: string) => retrieveMock(query),
  assemblePrompt: () => "mock sub-question prompt",
}));

import { runDeepResearch, buildSynthesisPrompt, noSourcesResearchAnswer } from "./orchestrator";

interface Chunk {
  id: string;
  title: string;
  body: string;
}
function chunk(i: number): Chunk {
  return { id: `c${i}`, title: `Title ${i}`, body: `Body ${i}` };
}

const SYNTH_MARKER = "synthesizing multiple research perspectives";

/** Script the pipeline: decompose -> 3 sub-questions -> "mock answer" each. */
function scriptPipeline(chunkPlan: Chunk[][]) {
  const prompts: string[] = [];
  generateMock.mockImplementation(async (opts: { prompt: string }) => {
    prompts.push(opts.prompt);
    if (opts.prompt.startsWith("Break this research question")) {
      return "What are the benefits?\nWhat are the risks?\nWhat are the costs?";
    }
    return "mock answer";
  });
  retrieveMock.mockImplementation(async () => chunkPlan.shift() ?? []);
  return prompts;
}

function synthesisPrompts(prompts: string[]) {
  return prompts.filter((p) => p.includes(SYNTH_MARKER));
}

beforeEach(() => {
  generateMock.mockReset();
  retrieveMock.mockReset();
});

describe("D/F5 — zero evidence", () => {
  it("the synthesis LLM is never called; a deterministic honest answer is returned", async () => {
    const prompts = scriptPipeline([[], [], []]);
    const result = await runDeepResearch("query", undefined, undefined, 200);
    expect(synthesisPrompts(prompts)).toHaveLength(0);
    expect(result.noSourcesFound).toBe(true);
    expect(result.answer).toBe(noSourcesResearchAnswer());
    expect(result.answer.length).toBeGreaterThan(0);
  });

  it("attempted unsupported synthesis: even a fabricating model cannot surface invented citations", async () => {
    // Adversarial: the model WOULD have fabricated "[7]" had it been asked.
    generateMock.mockImplementation(async (opts: { prompt: string }) => {
      if (opts.prompt.startsWith("Break this research question")) {
        return "What are the benefits?\nWhat are the risks?\nWhat are the costs?";
      }
      return "According to [7], the answer is definitely X.";
    });
    retrieveMock.mockResolvedValue([]);
    const result = await runDeepResearch("query", undefined, undefined, 200);
    expect(result.noSourcesFound).toBe(true);
    expect(result.answer).not.toContain("[7]");
    expect(result.answer).toBe(noSourcesResearchAnswer());
  });
});

describe("D/F5 — partial evidence", () => {
  it("the prompt marks which perspectives had sources and forbids inventing citations", async () => {
    const prompts = scriptPipeline([[chunk(1), chunk(2)], [], []]);
    const result = await runDeepResearch("query", undefined, undefined, 200);
    expect(result.noSourcesFound).toBe(false);
    const synthesisPrompt = synthesisPrompts(prompts)[0];
    expect(synthesisPrompt).toMatch(/sources:\s*2/i);
    expect(synthesisPrompt).toMatch(/sources:\s*none/i);
    expect(synthesisPrompt).toMatch(/never invent/i);
    expect(synthesisPrompt).toContain("Cite sources as [n] ONLY");
  });

  it("attempted unsupported synthesis: source-less perspectives must not be presented as sourced", async () => {
    const prompt = buildSynthesisPrompt("q", [
      { subQuestion: "sq1", answer: "a1 [1]", sourceCount: 1 },
      { subQuestion: "sq2", answer: "a2", sourceCount: 0 },
    ],
      undefined
    );
    expect(prompt).toMatch(/never present its claims as backed by local sources/i);
  });
});

describe("D/F5 — legitimate synthesis preserved", () => {
  it("evidence present: synthesis runs, returns the model answer, citations intact", async () => {
    const prompts = scriptPipeline([[chunk(1)], [chunk(2)], [chunk(3)]]);
    const result = await runDeepResearch("query", undefined, undefined, 200);
    expect(result.noSourcesFound).toBe(false);
    expect(synthesisPrompts(prompts)).toHaveLength(1);
    expect(result.answer).toBe("mock answer");
    expect(result.citations).toHaveLength(3);
  });

  it("conflicting evidence: perspectives are kept and conflicts reconciled", async () => {
    generateMock.mockImplementation(async (opts: { prompt: string }) => {
      if (opts.prompt.startsWith("Break this research question")) {
        return "Is it good?\nIs it bad?";
      }
      if (opts.prompt.includes(SYNTH_MARKER)) return opts.prompt; // echo
      return opts.prompt.includes("Perspective 1") ? "Yes, it is good [1]." : "No, it is bad [1].";
    });
    retrieveMock.mockResolvedValue([chunk(1)]);
    const result = await runDeepResearch("query", undefined, undefined, 200);
    expect(result.answer).toContain("Perspective 1");
    expect(result.answer).toContain("Perspective 2");
    expect(result.answer).toMatch(/reconcile/i);
  });

  it("empty perspective answers do not break synthesis", async () => {
    generateMock.mockImplementation(async (opts: { prompt: string }) => {
      if (opts.prompt.startsWith("Break this research question")) {
        return "Q1?\nQ2?\nQ3?";
      }
      return "";
    });
    retrieveMock.mockResolvedValue([chunk(1)]);
    const result = await runDeepResearch("query", undefined, undefined, 200);
    expect(result.noSourcesFound).toBe(false);
    expect(typeof result.answer).toBe("string");
  });
});

describe("D/F5 — buildSynthesisPrompt unit checks", () => {
  it("labels each perspective with its source count", () => {
    const prompt = buildSynthesisPrompt("q", [
      { subQuestion: "sq1", answer: "a1", sourceCount: 2 },
      { subQuestion: "sq2", answer: "a2", sourceCount: 0 },
    ],
      undefined
    );
    expect(prompt).toContain("sq1");
    expect(prompt).toContain("sq2");
    expect(prompt).toMatch(/sources:\s*2/i);
    expect(prompt).toMatch(/sources:\s*none/i);
    expect(prompt).toMatch(/never invent/i);
  });

  it("never promises citations when no perspective has sources", () => {
    const prompt = buildSynthesisPrompt("q", [
      { subQuestion: "sq1", answer: "a1", sourceCount: 0 },
    ],
      undefined
    );
    expect(prompt).not.toContain("Cite sources as [n]");
  });

  it("noSourcesResearchAnswer is deterministic, honest, and citation-free", () => {
    const a = noSourcesResearchAnswer();
    const b = noSourcesResearchAnswer();
    expect(a).toBe(b);
    expect(a).toMatch(/couldn't find any relevant sources/i);
    expect(a).not.toMatch(/\[\d+\]/);
  });
});

describe("P1.4 chat template on all paths", () => {
  beforeEach(() => {
    mockHasTemplate = false;
  });

  it("sin template: usa prompt hand-built (fallback)", async () => {
    const calls: unknown[] = [];
    generateMock.mockImplementation(async (opts: unknown) => {
      calls.push(opts);
      const p = (opts as { prompt?: string }).prompt ?? "";
      if (p.startsWith("Break this research question")) {
        return "What are the benefits?\nWhat are the risks?";
      }
      return "mock answer";
    });
    retrieveMock.mockResolvedValue([chunk(1)]);
    await runDeepResearch("query", undefined, undefined, 200);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c).toHaveProperty("prompt");
      expect(c).not.toHaveProperty("messages");
    }
  });

  it("con template: decompose/research/synthesize usan messages", async () => {
    mockHasTemplate = true;
    const calls: unknown[] = [];
    generateMock.mockImplementation(async (opts: unknown) => {
      calls.push(opts);
      const m = (opts as { messages?: { content: string }[] }).messages;
      const text = m ? m.map((x) => x.content).join("\n") : "";
      if (text.includes("Break this research question")) {
        return "What are the benefits?\nWhat are the risks?";
      }
      return "mock answer";
    });
    retrieveMock.mockResolvedValue([chunk(1)]);
    await runDeepResearch("query", undefined, undefined, 200);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c).toHaveProperty("messages");
      expect(c).not.toHaveProperty("prompt");
    }
    // Synthesis messages carry the perspectives and the question.
    const synth = calls.find((c) =>
      (c as { messages: { content: string }[] }).messages.some((m) =>
        m.content.includes("Original question")
      )
    ) as { messages: { role: string; content: string }[] };
    expect(synth.messages[0].role).toBe("system");
    expect(synth.messages[1].role).toBe("user");
  });

  it("buildSynthesisMessages preserva el contenido de buildSynthesisPrompt", async () => {
    const { buildSynthesisMessages } = await import("./orchestrator");
    const subResults = [
      { subQuestion: "sq1", answer: "a1 [1]", sourceCount: 1 },
      { subQuestion: "sq2", answer: "a2", sourceCount: 0 },
    ];
    const str = buildSynthesisPrompt("q", subResults, undefined);
    const msgs = buildSynthesisMessages("q", subResults, undefined);
    const joined = msgs.map((m) => m.content).join("\n");
    // Same key content in both forms.
    expect(joined).toContain("sq1");
    expect(joined).toContain("sq2");
    expect(joined).toMatch(/sources:\s*none/i);
    expect(joined).toMatch(/never present its claims as backed by local sources/i);
    expect(str).toContain("sq1");
  });
});
