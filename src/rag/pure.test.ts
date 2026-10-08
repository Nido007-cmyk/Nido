/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  assemblePrompt,
  assembleChatMessages,
  serializeEmbedding,
  deserializeEmbedding,
} from "./pure";
import { classifyTask, isRetrievalIrrelevant } from "../routing/classify";
import type { RetrievedChunk } from "./retrieve.types";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it("is 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  it("is -1 for opposite vectors", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1);
  });

  it("returns 0 for zero-norm vectors instead of NaN", () => {
    const a = new Float32Array([0, 0]);
    const b = new Float32Array([1, 1]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe("assemblePrompt", () => {
  const chunks: RetrievedChunk[] = [
    {
      chunkId: "1",
      docId: "1",
      title: "Doc One",
      body: "Body one.",
      score: 0.9,
      matchType: "hybrid",
    },
  ];

  it("includes the question and numbered citations", () => {
    const prompt = assemblePrompt("What is X?", chunks);
    expect(prompt).toContain("Question: What is X?");
    expect(prompt).toContain("[1] Doc One");
    expect(prompt).toContain("Body one.");
  });

  it("still produces a valid prompt with no context", () => {
    const prompt = assemblePrompt("What is X?", []);
    expect(prompt).toContain("Question: What is X?");
  });

  it("uses the default instruction when no system prompt is given", () => {
    const prompt = assemblePrompt("What is X?", []);
    expect(prompt).toContain("You are an offline research assistant.");
  });

  it("substitutes a custom system prompt for the default instruction", () => {
    const prompt = assemblePrompt("What is X?", [], "You are a pirate.");
    expect(prompt).toContain("You are a pirate.");
    expect(prompt).not.toContain("You are an offline research assistant.");
  });

  it("still appends the citation instruction with a custom system prompt, when there's context to cite", () => {
    const prompt = assemblePrompt("What is X?", chunks, "You are a pirate.");
    expect(prompt).toContain("cite sources as [n]");
  });

  // Regression: an empty-but-present "Context:\n\n" section (with the
  // "cite sources as [n]" instruction still attached) nudged a small model
  // toward inventing content to fill it instead of answering conversationally
  // - this is what let unrelated retrieved corpus chunks ("Pikachu",
  // "Deadmau5", "Weezer") leak into a "hey, what's up?" response even after
  // isRetrievalIrrelevant correctly gated retrieve() itself. With zero
  // chunks, the whole context/citation section must be absent, not empty.
  it("omits the entire context/citation section when there are no chunks", () => {
    const prompt = assemblePrompt("hey, what's up?", []);
    expect(prompt).not.toContain("Context:");
    expect(prompt).not.toContain("cite sources as [n]");
  });

  describe("noSourcesFoundNote (honest no-result, 2026-09-28)", () => {
    it("adds the no-sources instruction when retrieval ran and found nothing", () => {
      const prompt = assemblePrompt("What is X?", [], undefined, undefined, undefined, true);
      expect(prompt).toContain("No relevant sources were found in the offline index");
      expect(prompt).toMatch(/say so briefly/i);
    });

    it("omits the no-sources instruction by default", () => {
      const prompt = assemblePrompt("What is X?", []);
      expect(prompt).not.toContain("No relevant sources were found");
    });

    it("omits the no-sources instruction when chunks exist even if the flag is set", () => {
      const prompt = assemblePrompt("What is X?", chunks, undefined, undefined, undefined, true);
      expect(prompt).not.toContain("No relevant sources were found");
    });

    it("adds the no-sources instruction in chat-template messages too", () => {
      const messages = assembleChatMessages("What is X?", [], undefined, undefined, undefined, true);
      const system = messages.find((m) => m.role === "system");
      expect(system?.content).toContain("No relevant sources were found in the offline index");
    });

    it("omits the no-sources instruction in chat-template messages by default", () => {
      const messages = assembleChatMessages("What is X?", []);
      const system = messages.find((m) => m.role === "system");
      expect(system?.content).not.toContain("No relevant sources were found");
    });
  });

  it("falls back to the default instruction for an empty/whitespace system prompt", () => {
    const prompt = assemblePrompt("What is X?", [], "   ");
    expect(prompt).toContain("You are an offline research assistant.");
  });

  it("includes recent turns verbatim when history is given", () => {
    const prompt = assemblePrompt("What is X?", [], undefined, {
      turns: [
        { role: "user", text: "My name is Alex." },
        { role: "assistant", text: "Nice to meet you, Alex." },
      ],
    });
    expect(prompt).toContain("User: My name is Alex.");
    expect(prompt).toContain("Assistant: Nice to meet you, Alex.");
  });

  it("includes a conversation summary when history has one", () => {
    const prompt = assemblePrompt("What is X?", [], undefined, {
      summary: "User is planning a trip to Japan.",
    });
    expect(prompt).toContain("Summary of earlier conversation:");
    expect(prompt).toContain("User is planning a trip to Japan.");
  });

  it("omits history sections entirely when no history is given", () => {
    const prompt = assemblePrompt("What is X?", []);
    expect(prompt).not.toContain("Summary of earlier conversation:");
    expect(prompt).not.toContain("Recent conversation:");
  });

  it("omits history sections when history is given but empty", () => {
    const prompt = assemblePrompt("What is X?", [], undefined, { summary: null, turns: [] });
    expect(prompt).not.toContain("Summary of earlier conversation:");
    expect(prompt).not.toContain("Recent conversation:");
  });

  // Regression: "wake up" -> "morning alarm set / room temperature
  // adjusted" (a hallucinated action the upstream app has no ability to perform). The
  // grounding instruction is universal (not a hardcoded response to any
  // specific phrase) - always present regardless of query, persona, or
  // retrieval state.
  it("always includes the no-real-world-actions grounding instruction", () => {
    const prompt = assemblePrompt("wake up", []);
    expect(prompt).toContain("no ability to control real-world devices or take physical actions");
    expect(prompt).toContain("Never claim to have done something");
  });

  it("includes the grounding instruction regardless of persona", () => {
    const prompt = assemblePrompt("wake up", [], "You are a pirate.");
    expect(prompt).toContain("no ability to control real-world devices or take physical actions");
  });

  it("includes the grounding instruction even with retrieved context and history", () => {
    const prompt = assemblePrompt("wake up", chunks, undefined, {
      turns: [{ role: "user", text: "hi" }],
    });
    expect(prompt).toContain("no ability to control real-world devices or take physical actions");
  });

  // End-to-end regression mirroring ChatScreen.send()'s exact decision
  // logic (classifyTask -> isRetrievalIrrelevant gates whether retrieve()
  // is even called -> assemblePrompt) for the real-device report: "hey,
  // what's up?" produced a response with unrelated retrieved corpus chunks
  // (Pikachu, Deadmau5, Weezer) leaking in. The final prompt must contain
  // no retrieved-context/citation section at all for a greeting - but
  // conversation history is a SEPARATE mechanism (assemblePrompt's
  // summary/turns params, unconditional, untouched by the retrieval gate)
  // and must still work, so "what did I just tell you?" keeps functioning.
  it('regression: "hey, what\'s up?" produces a prompt with no retrieved context, but conversation history survives', () => {
    const query = "hey, what's up?";
    expect(classifyTask(query)).toBe("greeting");

    // Exactly ChatScreen.send()'s branch: retrieve() is never even called
    // when isRetrievalIrrelevant is true - chunks is [] by construction,
    // not because retrieve() happened to return nothing.
    const chunksForThisQuery = isRetrievalIrrelevant(classifyTask(query)) ? [] : chunks;
    expect(chunksForThisQuery).toEqual([]);

    const prompt = assemblePrompt(query, chunksForThisQuery, undefined, {
      turns: [
        { role: "user", text: "My favorite color is blue." },
        { role: "assistant", text: "Got it, blue it is." },
      ],
    });

    expect(prompt).not.toContain("Context:");
    expect(prompt).not.toContain("cite sources as [n]");
    expect(prompt).not.toContain("Doc One");
    expect(prompt).not.toContain("Body one.");
    // Conversation history is unaffected by the retrieval gate.
    expect(prompt).toContain("Recent conversation:");
    expect(prompt).toContain("My favorite color is blue.");
  });
});

describe("assemblePrompt style reminder", () => {
  it("goes right after the question", () => {
    const chunks: RetrievedChunk[] = [
      { chunkId: "1", docId: "1", title: "Doc One", body: "Body one.", score: 0.9, matchType: "hybrid" },
    ];
    const prompt = assemblePrompt("Why?", chunks, "You are Nido.", undefined, "Be brief.");
    expect(prompt).toContain("Body one.");
    expect(prompt.endsWith("Question: Why?\n\n(Response style: Be brief.)\n\nAnswer:")).toBe(true);
  });
});

describe("assembleChatMessages", () => {
  const chunks: RetrievedChunk[] = [
    { chunkId: "1", docId: "1", title: "Doc One", body: "Body one.", score: 0.9, matchType: "hybrid" },
  ];

  it("puts the instruction and grounding boundary in a single system message, and the query as the final user message", () => {
    const messages = assembleChatMessages("hey!", [], "You are a pirate.");
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[0].content).toContain("You are a pirate.");
    expect(messages[0].content).toContain("no ability to control real-world devices");
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "hey!" });
  });

  it("appends the tone's style reminder to the current question only", () => {
    const history = { turns: [{ role: "user" as const, text: "earlier" }, { role: "assistant" as const, text: "reply" }] };
    const messages = assembleChatMessages("q", chunks, "You are Nido.", history, "Be thorough.");
    expect(messages[messages.length - 1].content).toBe("q\n\n(Response style: Be thorough.)");
    expect(messages[1].content).toBe("earlier");
    expect(messages[0].content).not.toContain("Response style:");
  });

  it("leaves the question alone without a reminder", () => {
    const messages = assembleChatMessages("q", chunks, "You are Nido.");
    expect(messages[messages.length - 1].content).toBe("q");
  });

  it("uses the default instruction when no system prompt is given", () => {
    const messages = assembleChatMessages("hi", []);
    expect(messages[0].content).toContain("You are an offline research assistant.");
  });

  it("includes retrieved context and the citation instruction in the system message when there are chunks", () => {
    const messages = assembleChatMessages("What is X?", chunks);
    expect(messages[0].content).toContain("cite sources as [n]");
    expect(messages[0].content).toContain("Doc One");
    expect(messages[0].content).toContain("Body one.");
  });

  it("omits the context/citation framing entirely when there are no chunks", () => {
    const messages = assembleChatMessages("hey!", []);
    expect(messages[0].content).not.toContain("cite sources as [n]");
    expect(messages[0].content).not.toContain("Context:");
  });

  it("threads conversation history in as separate role-tagged messages, between system and the current query", () => {
    const messages = assembleChatMessages("What did I just tell you?", [], undefined, {
      turns: [
        { role: "user", text: "My favorite color is blue." },
        { role: "assistant", text: "Got it, blue it is." },
      ],
    });
    expect(messages).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "user", content: "My favorite color is blue." },
      { role: "assistant", content: "Got it, blue it is." },
      { role: "user", content: "What did I just tell you?" },
    ]);
  });

  it("includes a conversation summary in the system message when history has one", () => {
    const messages = assembleChatMessages("hi", [], undefined, { summary: "User is planning a trip to Japan." });
    expect(messages[0].content).toContain("Summary of earlier conversation:");
    expect(messages[0].content).toContain("User is planning a trip to Japan.");
  });
});

describe("serializeEmbedding/deserializeEmbedding", () => {
  it("round-trips a Float32Array", () => {
    const original = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const bytes = serializeEmbedding(original);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBe(16); // 4 floats * 4 bytes

    const restored = deserializeEmbedding(bytes, 4);
    expect(restored).toBeInstanceOf(Float32Array);
    expect(restored.length).toBe(4);
    // Float32 precision: compare with tolerance
    for (let i = 0; i < 4; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 6);
    }
  });

  it("throws on dimension mismatch", () => {
    const original = new Float32Array([0.1, 0.2, 0.3]);
    const bytes = serializeEmbedding(original);

    expect(() => deserializeEmbedding(bytes, 4)).toThrow(
      "Embedding dimension mismatch: expected 4, got 3"
    );
  });

  it("handles empty arrays", () => {
    const original = new Float32Array(0);
    const bytes = serializeEmbedding(original);
    expect(bytes.byteLength).toBe(0);

    const restored = deserializeEmbedding(bytes, 0);
    expect(restored.length).toBe(0);
  });
});
