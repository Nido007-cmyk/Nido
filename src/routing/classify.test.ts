/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { classifyTask, isRetrievalIrrelevant } from "./classify";

describe("classifyTask", () => {
  it("returns unknown for empty input", () => {
    expect(classifyTask("")).toBe("unknown");
    expect(classifyTask("   ")).toBe("unknown");
  });

  it("detects pure social greetings as a distinct type from chat", () => {
    expect(classifyTask("wake up!")).toBe("greeting");
    expect(classifyTask("hi")).toBe("greeting");
    expect(classifyTask("Hello!")).toBe("greeting");
    expect(classifyTask("hey there")).toBe("greeting");
    expect(classifyTask("good morning")).toBe("greeting");
    expect(classifyTask("thanks!")).toBe("greeting");
    expect(classifyTask("bye")).toBe("greeting");
  });

  it("does not misclassify an informational request phrased as a command as a greeting", () => {
    // "chat" is a broad fallback bucket that also catches real information
    // needs that don't match the wh-question/research heuristics - only
    // pure social small talk (nothing else in the message) is "greeting".
    expect(classifyTask("Tell me about black holes")).toBe("chat");
    expect(classifyTask("hi, can you compare Rust and Go?")).toBe("compare");
  });

  // Regression for the exact real-device inputs that produced hallucinated
  // actions ("morning alarm set", "room temperature adjusted") - these are
  // correctly classified as "greeting" already (retrieval skip was fixed in
  // ad96592); the hallucination itself was a prompt-grounding gap, fixed in
  // assemblePrompt (see rag/pure.ts's GROUNDING_INSTRUCTION and its tests).
  it('regression: "hey!", "what\'s up?!", and "wake up" all classify as greeting', () => {
    expect(classifyTask("hey!")).toBe("greeting");
    expect(classifyTask("what's up?!")).toBe("greeting");
    expect(classifyTask("wake up")).toBe("greeting");
  });

  it('regression: "turn on the lights" is a real action request, not a greeting', () => {
    // Must NOT be classified as greeting (that would skip retrieval and
    // treat it as small talk) - it's an action request the upstream app has no tool for.
    // The "don't fabricate having done it" guarantee comes from
    // assemblePrompt's GROUNDING_INSTRUCTION, not from classification.
    expect(classifyTask("turn on the lights")).not.toBe("greeting");
  });

  // T-saludo-2026-10-06: la app es español-primero; "Hola" caía a "chat"
  // y disparaba retrieval contra el índice offline ("Dol, Krško" 56% para
  // un simple saludo). Los saludos en español deben clasificar "greeting".
  it("detects Spanish greetings (T-saludo-2026-10-06)", () => {
    expect(classifyTask("Hola")).toBe("greeting");
    expect(classifyTask("¡Hola!")).toBe("greeting");
    expect(classifyTask("hola")).toBe("greeting");
    expect(classifyTask("hola, ¿qué tal?")).toBe("greeting");
    expect(classifyTask("buenos días")).toBe("greeting");
    expect(classifyTask("buen día")).toBe("greeting");
    expect(classifyTask("buenas tardes")).toBe("greeting");
    expect(classifyTask("buenas noches")).toBe("greeting");
    expect(classifyTask("buenas")).toBe("greeting");
    expect(classifyTask("¿cómo estás?")).toBe("greeting");
    expect(classifyTask("qué pasa")).toBe("greeting");
    expect(classifyTask("saludos")).toBe("greeting");
    expect(classifyTask("gracias")).toBe("greeting");
    expect(classifyTask("muchas gracias")).toBe("greeting");
    expect(classifyTask("mil gracias")).toBe("greeting");
    expect(classifyTask("de nada")).toBe("greeting");
    expect(classifyTask("adiós")).toBe("greeting");
    expect(classifyTask("adios")).toBe("greeting");
    expect(classifyTask("hasta luego")).toBe("greeting");
    expect(classifyTask("nos vemos")).toBe("greeting");
    expect(classifyTask("hasta pronto")).toBe("greeting");
    expect(classifyTask("hola y gracias")).toBe("greeting");
  });

  it("does not misclassify Spanish informational queries as greetings", () => {
    expect(classifyTask("hola, ¿qué hora es?")).not.toBe("greeting");
    expect(classifyTask("gracias por la información sobre Roma")).not.toBe("greeting");
    expect(classifyTask("hola, explícame la fotosíntesis")).not.toBe("greeting");
  });

  it("Spanish greetings skip knowledge retrieval", () => {
    expect(isRetrievalIrrelevant(classifyTask("Hola"))).toBe(true);
    expect(isRetrievalIrrelevant(classifyTask("buenos días"))).toBe(true);
  });

  // Regression: "hey, what's up?" (real device report, post-ad96592) was
  // classified as "chat" - the single-literal-phrase greeting regex never
  // matched a COMPOUND greeting (two phrases joined by a comma) - so
  // retrieve() still ran, and its no-relevance-floor top-K search surfaced
  // essentially random corpus chunks (Pikachu, Deadmau5, Weezer) into the
  // response. Fixed by classifying per-segment (split on comma/semicolon/
  // "and") rather than the whole query as one literal phrase.
  it('regression: compound greetings like "hey, what\'s up?" classify as greeting', () => {
    expect(classifyTask("hey, what's up?")).toBe("greeting");
    expect(classifyTask("hi, how are you?")).toBe("greeting");
    expect(classifyTask("hey there, what's up?")).toBe("greeting");
  });

  it('regression: "whats up?" (no apostrophe, exact real-device input) classifies as greeting', () => {
    expect(classifyTask("whats up?")).toBe("greeting");
  });

  it("compound-greeting segmentation does not swallow a real request tacked onto a greeting", () => {
    // "hi, can you compare Rust and Go?" already covered above (stays
    // "compare") - this covers the same guarantee from the segmentation
    // helper's own angle: a non-greeting segment anywhere disqualifies the
    // whole query from being classified as pure small talk.
    expect(classifyTask("hey, turn on the lights")).not.toBe("greeting");
    expect(classifyTask("hi, tell me about black holes")).not.toBe("greeting");
  });

  it("detects compare", () => {
    expect(classifyTask("Compare Rust and Go for backend services")).toBe("compare");
    expect(classifyTask("What's the difference between TCP and UDP?")).toBe("compare");
  });

  it("detects summarize", () => {
    expect(classifyTask("Summarize this article for me")).toBe("summarize");
  });

  it("detects translate", () => {
    expect(classifyTask("Translate 'good morning' to Portuguese")).toBe("translate");
  });

  it("detects calculate", () => {
    expect(classifyTask("What is 42 * 17?")).toBe("calculate");
    expect(classifyTask("Calculate the compound interest on $500")).toBe("calculate");
  });

  it("detects code", () => {
    expect(classifyTask("Write some code to reverse a linked list")).toBe("code");
    expect(classifyTask("```js\nconst x = 1;\n```")).toBe("code");
  });

  it("detects extract", () => {
    expect(classifyTask("Extract all the dates mentioned in this text")).toBe("extract");
  });

  it("detects lookup for short wh-questions", () => {
    expect(classifyTask("What is the capital of France?")).toBe("lookup");
    expect(classifyTask("Who wrote Don Quixote?")).toBe("lookup");
  });

  it("detects research for long or explicitly research-flavored queries", () => {
    expect(
      classifyTask(
        "Research the long-term environmental and economic implications of large-scale nuclear power adoption over the next two decades"
      )
    ).toBe("research");
  });

  it("classifies a query as compare rather than research when it explicitly compares two things, even if research-flavored too", () => {
    // Specific patterns (compare/summarize/translate/calculate/code/extract)
    // deliberately win over the broader "research" catch-all - a query
    // that names two things being weighed against each other is shaped like
    // a comparison task regardless of how long or research-y it also reads.
    expect(
      classifyTask("Research the environmental tradeoffs of nuclear versus solar power at grid scale")
    ).toBe("compare");
  });

  it("classifies chit-chat as conversation", () => {
    expect(classifyTask("tell me a joke")).toBe("conversation");
    expect(classifyTask("who are you")).toBe("conversation");
    expect(classifyTask("what time is it")).toBe("conversation");
  });

  it("falls back to chat for everything else", () => {
    expect(classifyTask("tell me about black holes")).toBe("chat");
  });

  it("isRetrievalIrrelevant is true for greeting/conversation/calculate/translate/code", () => {
    expect(isRetrievalIrrelevant("greeting")).toBe(true);
    expect(isRetrievalIrrelevant("conversation")).toBe(true);
    expect(isRetrievalIrrelevant("calculate")).toBe(true);
    expect(isRetrievalIrrelevant("translate")).toBe(true);
    expect(isRetrievalIrrelevant("code")).toBe(true);
    expect(isRetrievalIrrelevant("chat")).toBe(false);
    expect(isRetrievalIrrelevant("lookup")).toBe(false);
    expect(isRetrievalIrrelevant("research")).toBe(false);
  });

  it("is deterministic", () => {
    const q = "Compare Rust and Go";
    expect(classifyTask(q)).toBe(classifyTask(q));
  });
});
