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
  fitChunksToBudget,
  serializeEmbedding,
  deserializeEmbedding,
} from "./pure";
import { assertPromptBudget, estimatePromptTokens } from "../agent/loop/agentLoop";
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
      // FIX 2026-10-09 (Phase 3): stronger instruction - do NOT invent facts,
      // say honestly that you don't know for factual questions without sources.
      expect(prompt).toMatch(/do NOT invent facts/i);
      expect(prompt).toMatch(/say honestly that you don't know/i);
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
    // RAG-GROUNDING 2026-10-11: con fuentes, el turno actual es
    // "Sources … Question: q" y el recordatorio de estilo sigue al final.
    expect(messages[messages.length - 1].content.endsWith("Question: q\n\n(Response style: Be thorough.)")).toBe(true);
    expect(messages[1].content).toBe("earlier");
    expect(messages[0].content).not.toContain("Response style:");
  });

  it("leaves the question alone without a reminder", () => {
    const messages = assembleChatMessages("q", [], "You are Nido.");
    expect(messages[messages.length - 1].content).toBe("q");
    const withSources = assembleChatMessages("q", chunks, "You are Nido.");
    expect(withSources[withSources.length - 1].content.endsWith("Question: q")).toBe(true);
    expect(withSources[withSources.length - 1].content).not.toContain("Response style:");
  });

  it("uses the default instruction when no system prompt is given", () => {
    const messages = assembleChatMessages("hi", []);
    expect(messages[0].content).toContain("You are an offline research assistant.");
  });

  // RAG-GROUNDING 2026-10-11: la regla de citar sigue en el sistema, pero
  // las fuentes van en el turno del usuario, pegadas a la pregunta.
  it("puts the grounding rule in the system message and the sources right before the question", () => {
    const messages = assembleChatMessages("What is X?", chunks);
    expect(messages[0].content).toContain("cite sources as [n]");
    expect(messages[0].content).not.toContain("Body one.");
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("[1] Doc One");
    expect(last.content).toContain("Body one.");
    expect(last.content.indexOf("Body one.")).toBeLessThan(last.content.indexOf("Question: What is X?"));
  });

  it("never tells the model to fall back on general knowledge when there are sources (fotosíntesis evidence)", () => {
    const messages = assembleChatMessages("What is X?", chunks);
    const all = messages.map((m) => m.content).join("\n");
    expect(all).not.toMatch(/general knowledge/i);
    expect(all).toContain("Answer ONLY with facts written in those sources");
    expect(all).toContain("say that you don't know");
    expect(assemblePrompt("What is X?", chunks)).not.toMatch(/answer from general knowledge/i);
  });

  it("keeps sources next to the question even with long history in between", () => {
    const history = {
      turns: [
        { role: "user" as const, text: "earlier question" },
        { role: "assistant" as const, text: "earlier answer" },
      ],
    };
    const messages = assembleChatMessages("What is X?", chunks, "sys", history);
    expect(messages[1].content).toBe("earlier question");
    expect(messages[messages.length - 1].content).toContain("Body one.");
    expect(messages[1].content).not.toContain("Body one.");
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

  it("P2.3: without a budget, long history is appended unbounded (legacy behavior)", () => {
    const big = "x".repeat(5000);
    const history = {
      turns: [
        { role: "user" as const, text: big },
        { role: "assistant" as const, text: big },
        { role: "user" as const, text: big },
      ],
    };
    const messages = assembleChatMessages("q", [], "sys", history);
    // system + 3 history + current = 5 messages, nothing cut.
    expect(messages).toHaveLength(5);
  });

  it("P2.3: with a budget, history is cut recent-first and the invariant holds", () => {
    const big = "x".repeat(5000); // ~1716 tokens each by the conservative counter
    const history = {
      turns: [
        { role: "user" as const, text: big },
        { role: "assistant" as const, text: big },
        { role: "user" as const, text: big },
        { role: "assistant" as const, text: big },
      ],
    };
    const messages = assembleChatMessages("q", [], "sys", history, undefined, false, {
      nCtx: 4096,
      reserveGeneration: 512,
    });
    // Fewer than the unbounded 6 messages; system first, current query last.
    expect(messages.length).toBeLessThan(6);
    expect(messages[0].role).toBe("system");
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "q" });
    // No orphaned assistant turn at the start of the kept history.
    const firstHistory = messages[1];
    if (messages.length > 2) expect(firstHistory.role).not.toBe("assistant");
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

describe("0.1.61: prefijo estable del mensaje de sistema (caché de llama.rn)", () => {
  it("con y sin fuentes, el sistema empieza igual: identidad, estilo y límites antes de lo que cambia", () => {
    const sys = "You are Nido.";
    const withSources = assembleChatMessages("q", [{ chunkId: "a", docId: "a", title: "T", body: "Body.", score: 1, matchType: "semantic" } as never], sys)[0].content;
    const without = assembleChatMessages("q", [], sys)[0].content;
    const noSources = assembleChatMessages("q", [], sys, undefined, undefined, true)[0].content;
    let common = 0;
    while (common < without.length && withSources[common] === without[common] && noSources[common] === without[common]) common++;
    expect(withSources.slice(0, common)).toContain("no ability to control real-world devices");
    expect(common).toBeGreaterThanOrEqual(without.length - 1);
  });
});

// ---------------------------------------------------------------------------
// R-01 (ronda física 0.1.68): presupuesto de contexto en la ruta fija.
// El escenario de la ronda: chat con una respuesta de guía larga en el
// historial + el documento importado; la pregunta de la cita moría con
// «prompt excede el contexto del modelo (estimado 3565 tokens + 512 a
// generar > nCtx 3072) en chat-directo» porque la ruta fija ensamblaba
// sin presupuesto y applyContextBudget no sabe recortar fuentes.
// ---------------------------------------------------------------------------

const R01_NCTX = 3072;
const R01_RESERVE = 512;

/** Cuerpo de frases completas y repetibles, ~71 caracteres por frase. */
function sentenceBody(marker: string, sentences: number): string {
  return `El dato ${marker} queda en la sala doscientos catorce del segundo piso. `.repeat(sentences);
}

function r01Chunk(id: string, title: string, body: string): RetrievedChunk {
  return { chunkId: id, docId: id, title, body, score: 1, matchType: "hybrid" };
}

/** Render de las entradas tal como lo hacen los dos ensambladores. */
function renderedEntries(chunks: RetrievedChunk[]): string {
  return chunks.map((c, i) => `[${i + 1}] ${c.title}\n${c.body}`).join("\n\n");
}

describe("fitChunksToBudget (R-01)", () => {
  it("no toca la lista cuando todo cabe", () => {
    const fixedText = "F".repeat(600);
    const chunks = [r01Chunk("1", "Doc 1", sentenceBody("a", 6)), r01Chunk("2", "Doc 2", sentenceBody("b", 6))];
    const out = fitChunksToBudget(chunks, fixedText, R01_NCTX, R01_RESERVE);
    expect(out).toHaveLength(2);
    expect(out[0].body).toBe(chunks[0].body);
    expect(out[1].body).toBe(chunks[1].body);
  });

  it("descarta fragmentos desde el final (menor rango primero) hasta que cabe", () => {
    const fixedText = "F".repeat(1500);
    const chunks = [1, 2, 3, 4].map((n) =>
      r01Chunk(String(n), `Doc ${n}`, sentenceBody(`m${n}`, 34))
    );
    const out = fitChunksToBudget(chunks, fixedText, R01_NCTX, R01_RESERVE);
    expect(out.map((c) => c.title)).toEqual(["Doc 1", "Doc 2"]);
    expect(out[0].body).toBe(chunks[0].body);
    expect(out[1].body).toBe(chunks[1].body);
    expect(
      estimatePromptTokens(fixedText + renderedEntries(out)) + R01_RESERVE
    ).toBeLessThanOrEqual(R01_NCTX);
  });

  it("con un solo fragmento gigante, trunca el cuerpo por la última frase completa que cabe", () => {
    const fixedText = "F".repeat(1500);
    const big = r01Chunk("1", "Doc Grande", sentenceBody("g", 120));
    const out = fitChunksToBudget([big], fixedText, R01_NCTX, R01_RESERVE);
    expect(out).toHaveLength(1);
    expect(out[0].body.length).toBeLessThan(big.body.length);
    expect(big.body.startsWith(out[0].body)).toBe(true);
    expect(out[0].body.endsWith(".")).toBe(true);
    // El fragmento original no se muta.
    expect(big.body).toBe(sentenceBody("g", 120));
    expect(
      estimatePromptTokens(fixedText + renderedEntries(out)) + R01_RESERVE
    ).toBeLessThanOrEqual(R01_NCTX);
  });

  it("devuelve [] cuando ni un fragmento mínimo cabe (manda el «sin fuentes»)", () => {
    const fixedText = "F".repeat(9000);
    const chunks = [r01Chunk("1", "Doc 1", sentenceBody("a", 6))];
    expect(fitChunksToBudget(chunks, fixedText, R01_NCTX, R01_RESERVE)).toEqual([]);
  });
});

describe("ruta fija con presupuesto (R-01): el escenario de la ronda", () => {
  const query = "¿Qué día y a qué horas es la cita?";
  const chunks: RetrievedChunk[] = [
    r01Chunk("1", "Documento de la cita", sentenceBody("cita", 25)),
    r01Chunk("2", "Doc 2", sentenceBody("dos", 25)),
    r01Chunk("3", "Doc 3", sentenceBody("tres", 25)),
    r01Chunk("4", "Doc 4", sentenceBody("cuatro", 25)),
  ];
  const history = {
    turns: [
      { role: "user" as const, text: "Quiero la guía completa del tema" },
      { role: "assistant" as const, text: sentenceBody("GUIA", 36) },
      { role: "user" as const, text: "Vale, gracias" },
      { role: "assistant" as const, text: "De nada, aquí estoy." },
    ],
  };

  it("sin presupuesto reproduce el fallo: la aserción lanza el error de la ronda", () => {
    const messages = assembleChatMessages(query, chunks, undefined, history);
    const joined = messages.map((m) => m.content).join("\n");
    expect(() =>
      assertPromptBudget([{ role: "user", content: joined }], R01_NCTX, R01_RESERVE, "chat-directo")
    ).toThrow(/prompt excede el contexto/);
  });

  it("con presupuesto responde dentro de la ventana, conserva el rango 1 y el turno reciente", () => {
    const messages = assembleChatMessages(query, chunks, undefined, history, undefined, false, {
      nCtx: R01_NCTX,
      reserveGeneration: R01_RESERVE,
    });
    const joined = messages.map((m) => m.content).join("\n");
    expect(() =>
      assertPromptBudget([{ role: "user", content: joined }], R01_NCTX, R01_RESERVE, "chat-directo")
    ).not.toThrow();
    // La fuente principal (el documento) sobrevive al recorte.
    expect(joined).toContain("Documento de la cita");
    // El fragmento de menor rango es el que se sacrifica.
    expect(joined).not.toContain("Doc 4");
    // El historial viejo (la guía) se corta antes que las fuentes; el
    // turno más reciente se conserva.
    expect(joined).not.toContain("GUIA");
    expect(joined).toContain("De nada, aquí estoy.");
  });

  it("la vía sin plantilla (assemblePrompt) con presupuesto también cabe y conserva el rango 1", () => {
    const prompt = assemblePrompt(query, chunks, undefined, history, undefined, false, {
      nCtx: R01_NCTX,
      reserveGeneration: R01_RESERVE,
    });
    expect(estimatePromptTokens(prompt) + R01_RESERVE).toBeLessThanOrEqual(R01_NCTX);
    expect(prompt).toContain("Documento de la cita");
    expect(prompt).not.toContain("Doc 4");
  });

  it("regresión: con ventana amplia y conversación corta, el resultado es idéntico al de sin presupuesto", () => {
    const shortChunks = [r01Chunk("1", "Doc 1", sentenceBody("a", 2))];
    const shortHistory = {
      turns: [
        { role: "user" as const, text: "hola" },
        { role: "assistant" as const, text: "hola, ¿qué tal?" },
      ],
    };
    const withBudget = assembleChatMessages("¿qué es X?", shortChunks, "You are Nido.", shortHistory, undefined, false, {
      nCtx: 4096,
      reserveGeneration: 512,
    });
    const withoutBudget = assembleChatMessages("¿qué es X?", shortChunks, "You are Nido.", shortHistory);
    expect(withBudget).toEqual(withoutBudget);
    expect(
      assemblePrompt("¿qué es X?", shortChunks, "You are Nido.", shortHistory, undefined, false, {
        nCtx: 4096,
        reserveGeneration: 512,
      })
    ).toBe(assemblePrompt("¿qué es X?", shortChunks, "You are Nido.", shortHistory));
  });
});
