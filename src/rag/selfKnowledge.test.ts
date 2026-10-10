/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import {
  answerIdentityQuestion,
  answerKnowledgeQuery,
  classifyKnowledgeQuery,
  identityCard,
  isIdentityQuestion,
  toIdentityLocale,
} from "./selfKnowledge";
import { APP_DISPLAY_NAME, APP_TAGLINE } from "../brand";

/**
 * Regression tests for the deterministic NIDO knowledge base
 * (2026-09-28). Live evidence from the owner's Tab A9+: chat answered
 * "What's Nido app" with a hallucinated academic-management app, and Deep
 * Research answered "Nido app" with a Fate/Zero anime character backed by
 * "OFFLINE VERIFIED SOURCES". These tests prove identity/capability/
 * advantage/roadmap/usage questions are caught deterministically and
 * answered from the bundled canonical base — in en/es/pt — with zero
 * model or retrieval involvement.
 */

describe("toIdentityLocale", () => {
  it("maps BCP-47 tags to the closest supported locale", () => {
    expect(toIdentityLocale("en")).toBe("en");
    expect(toIdentityLocale("en-US")).toBe("en");
    expect(toIdentityLocale("es")).toBe("es");
    expect(toIdentityLocale("es-MX")).toBe("es");
    expect(toIdentityLocale("pt-BR")).toBe("pt");
    expect(toIdentityLocale(undefined)).toBe("en");
    expect(toIdentityLocale(null)).toBe("en");
    expect(toIdentityLocale("fr")).toBe("en");
  });
});

describe("classifyKnowledgeQuery", () => {
  it.each([
    ["What is Nido?", "identity"],
    ["What's Nido app", "identity"], // live-evidence case 1 (chat)
    ["Nido app", "identity"], // live-evidence case 2 (Deep Research)
    ["who are you", "identity"],
    ["tell me about nido", "identity"],
    ["qué es Nido", "identity"],
    ["quién eres", "identity"],
    ["o que é o Nido", "identity"],
    ["quem é você", "identity"],
    ["what can you do", "capabilities"],
    ["what are your features", "capabilities"],
    ["qué puedes hacer", "capabilities"],
    ["o que você pode fazer", "capabilities"],
    ["why should I use Nido", "advantages"],
    ["why use you", "advantages"],
    ["cuáles son las ventajas", "advantages"],
    ["quais são as vantagens", "advantages"],
    ["what is the product roadmap", "roadmap"],
    ["what's next", "roadmap"],
    ["qué viene", "roadmap"],
    ["o que vem por aí", "roadmap"],
    ["how do I use deep research", "usage"],
    ["how to use this app", "usage"],
    ["cómo se usa", "usage"],
    ["como usar", "usage"],
    ["what is deep research", "usage"],
  ] as Array<[string, string]>)("classifies %j as %s", (query, expected) => {
    expect(classifyKnowledgeQuery(query)).toBe(expected);
  });

  it("does not match bare 'nido' alone — it may be a research query", () => {
    expect(classifyKnowledgeQuery("nido")).toBeNull();
  });

  it("avoids false positives on unrelated questions", () => {
    expect(classifyKnowledgeQuery("what is doginme")).toBeNull();
    expect(classifyKnowledgeQuery("who are you voting for")).toBeNull();
    expect(classifyKnowledgeQuery("tell me about photosynthesis")).toBeNull();
    expect(classifyKnowledgeQuery("how does photosynthesis work")).toBeNull();
    expect(classifyKnowledgeQuery("")).toBeNull();
  });

  it("handles diacritics and punctuation variants", () => {
    expect(classifyKnowledgeQuery("¿Qué es Nido?")).toBe("identity");
    expect(classifyKnowledgeQuery("¿Quién eres?")).toBe("identity");
    expect(classifyKnowledgeQuery("O QUE É O NIDO")).toBe("identity");
  });

  // FIX 2026-10-09: privacy patterns were too narrow and missed common
  // variations, letting privacy questions fall through to the general model
  // which hallucinated false answers (live evidence: Tab A9+).
  it.each([
    ["donde se guardan mis datos", "advantages"],
    ["¿dónde están mis datos?", "advantages"],
    ["quien puede ver mis datos", "advantages"],
    ["¿quién tiene acceso a mis datos?", "advantages"],
    ["mis datos son privados", "advantages"],
    ["¿mis datos están seguros?", "advantages"],
    ["envias mis datos", "advantages"],
    ["¿compartes mi información?", "advantages"],
    ["qué haces con mis datos", "advantages"],
    ["where is my data stored", "advantages"],
    ["where are my chats stored", "advantages"],
    ["who can see my data", "advantages"],
    ["is my data private", "advantages"],
    ["are my messages secure", "advantages"],
    ["do you send my data", "advantages"],
    ["do you share my information", "advantages"],
    ["what do you do with my data", "advantages"],
  ] as Array<[string, string]>)("classifies privacy %j as %s", (query, expected) => {
    expect(classifyKnowledgeQuery(query)).toBe(expected);
  });
});

describe("answerKnowledgeQuery", () => {
  it("answers identity questions deterministically in en/es/pt", () => {
    for (const locale of ["en", "es", "pt"] as const) {
      const answer = answerKnowledgeQuery("What's Nido app", locale);
      expect(answer).not.toBeNull();
      // Renders through the single brand source of truth — no hardcoded literal.
      expect(answer!).toContain(APP_DISPLAY_NAME);
      expect(answer!).toContain(APP_TAGLINE[locale]);
    }
  });

  it("identity card is stable and canonical (no model phrasing drift)", () => {
    expect(answerKnowledgeQuery("what is nido?", "en")).toBe(identityCard("en"));
  });

  it("answers capabilities questions without inventing features", () => {
    const answer = answerKnowledgeQuery("what can you do", "en")!;
    expect(answer).toContain("Deep Research");
    expect(answer).toContain("Memory");
    // Phone-to-phone is labeled experimental, never claimed as proven.
    expect(answer).toMatch(/experimental/i);
    // Must not claim unavailable capabilities.
    expect(answer).not.toMatch(/military-grade/i);
  });

  it("answers advantages questions from the documented principles", () => {
    const answer = answerKnowledgeQuery("why should I use NIDO", "en")!;
    expect(answer).toMatch(/offline-first/i);
    expect(answer).toMatch(/no account/i);
    // GATE-1 honesty: encryption is stated as implemented design with an
    // explicit pending-verification qualifier, not as device-verified.
    expect(answer).toMatch(/verification.*pending|pending.*verification/i);
  });

  it("answers roadmap questions with no dates presented as promises", () => {
    const answer = answerKnowledgeQuery("what's the product roadmap", "en")!;
    expect(answer).toMatch(/planned/i);
    expect(answer).toMatch(/no dates/i);
    // Sanitized: no internal triage/security codenames leak into user copy.
    expect(answer).not.toMatch(/\bT-00\d\b/);
    expect(answer).not.toMatch(/\bM-[1-7]\b/);
  });

  it("answers usage questions for real features", () => {
    const answer = answerKnowledgeQuery("how do I use deep research", "en")!;
    expect(answer).toMatch(/Deep Research/);
    expect(answer).toMatch(/Settings/);
    expect(answer).toMatch(/Memory/);
  });

  it("returns null for non-self questions so they fall through to the normal path", () => {
    expect(answerKnowledgeQuery("what is the capital of France", "en")).toBeNull();
    expect(answerKnowledgeQuery("nido", "en")).toBeNull();
  });

  it("all categories have non-empty answers in all three locales", () => {
    const probes: Record<string, string> = {
      identity: "what is nido?",
      capabilities: "what can you do",
      advantages: "why should i use nido",
      roadmap: "roadmap",
      usage: "how do i use deep research",
    };
    for (const [category, probe] of Object.entries(probes)) {
      for (const locale of ["en", "es", "pt"] as const) {
        const answer = answerKnowledgeQuery(probe, locale);
        expect(answer, `${category}/${locale}`).not.toBeNull();
        expect(answer!.trim().length, `${category}/${locale}`).toBeGreaterThan(20);
        expect(answer, `${category}/${locale}`).toContain(APP_DISPLAY_NAME);
      }
    }
  });
});

describe("legacy identity API", () => {
  it("isIdentityQuestion/answerIdentityQuestion stay consistent with the router", () => {
    expect(isIdentityQuestion("What's Nido app")).toBe(true);
    expect(isIdentityQuestion("what is doginme")).toBe(false);
    expect(answerIdentityQuestion("qué es Nido", "es")).toBe(identityCard("es"));
    expect(answerIdentityQuestion("random question", "en")).toBeNull();
  });
});
