/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

// D/F3 deterministic titles — deterministic/self-knowledge responses.
//
// INVARIANT: if NIDO produces a deterministic self-knowledge response
// without invoking the model for the answer, creating or displaying that
// conversation must not invoke the model merely to generate its title.
//
// The pre-fix failure condition (reproduced on baseline 452be87) was:
// ChatScreen's deterministic self-knowledge branch (src/ui/ChatScreen.tsx)
// answered model-free via answerKnowledgeQuery, then called
// generateSessionTitle(query) -> llamaEngine.generate(...) purely for
// bookkeeping — a model invocation hidden behind new-session title
// creation. These tests assert the post-fix behavior: titles for the
// deterministic path come from the already-trusted classification
// category, with zero model calls anywhere on that path.

// Belt-and-braces: selfKnowledge.ts must never reach the model. If a future
// change routes any title/answer helper through llamaEngine.generate, these
// tests fail loudly instead of silently reintroducing the dependency.
const generateMock = vi.fn();
vi.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    generate: (opts: any) => generateMock(opts),
    hasEmbeddedChatTemplate: () => false,
  },
}));

import {
  answerKnowledgeQueryWithCategory,
  knowledgeSessionTitle,
  titleForKnowledgeCategory,
  classifyKnowledgeQuery,
} from "./selfKnowledge";
import { generateSessionTitle } from "../services/summarize";
import { APP_DISPLAY_NAME } from "../brand";

const CHAT_SCREEN_SRC = fs.readFileSync(
  path.join(__dirname, "..", "ui", "ChatScreen.tsx"),
  "utf8"
);

/** The deterministic self-knowledge branch of ChatScreen.send(), comments stripped. */
function kbSection(): string {
  const startMarker = "// --- Deterministic self-knowledge (2026-09-28) ---";
  const endMarker = "// --- NIDO agent path";
  const start = CHAT_SCREEN_SRC.indexOf(startMarker);
  const end = CHAT_SCREEN_SRC.indexOf(endMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const raw = CHAT_SCREEN_SRC.slice(start, end);
  // Strip comments: the explanatory comment legitimately names the old
  // function; only actual code references count as a model path.
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("D/F3 deterministic self-knowledge titles", () => {
  it("1. new self-knowledge session: answer + title with zero model calls", () => {
    const query = "what is nido app";
    const meta = answerKnowledgeQueryWithCategory(query, "en");
    expect(meta).not.toBeNull();
    expect(meta!.category).toBe("identity");
    expect(meta!.answer.length).toBeGreaterThan(0);

    const title = knowledgeSessionTitle(query, "en");
    expect(title.length).toBeGreaterThan(0);
    expect(title).toContain(APP_DISPLAY_NAME);

    expect(generateMock).not.toHaveBeenCalled();
  });

  it("1b. every self-knowledge category yields a deterministic title, zero model calls", () => {
    const queries: Array<[string, string]> = [
      ["what is nido app", "identity"],
      ["what can you do", "capabilities"],
      ["why should I use Nido", "advantages"],
      ["what is the product roadmap", "roadmap"],
      ["how do I use Nido", "usage"],
    ];
    for (const [query, category] of queries) {
      expect(classifyKnowledgeQuery(query)).toBe(category);
      const first = knowledgeSessionTitle(query, "en");
      const second = knowledgeSessionTitle(query, "en");
      expect(first).toBe(second); // deterministic
      expect(first.length).toBeGreaterThan(0);
    }
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("2. self-knowledge branch of ChatScreen never reaches the model title path", () => {
    const section = kbSection();
    // The deterministic branch must resolve titles without the model.
    expect(section).toContain("knowledgeSessionTitle");
    // No model-backed title generation, no llamaEngine, no background
    // retry task for titles on this path.
    expect(section).not.toContain("generateSessionTitle");
    expect(section).not.toContain("llamaEngine");
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("3. ordinary conversations keep existing model title behavior", () => {
    // summarize.ts still offers model-backed title generation...
    expect(typeof generateSessionTitle).toBe("function");
    // ...and the non-deterministic ChatScreen branches (agent + normal
    // chat) still use it: exactly the two remaining call sites.
    const calls = CHAT_SCREEN_SRC.match(/generateSessionTitle\(query\)/g) ?? [];
    expect(calls.length).toBe(2);
    // The model path itself is unchanged: it still invokes the model with
    // the user's first message.
    generateMock.mockResolvedValueOnce("Mocked Title");
    return expect(generateSessionTitle("hello world")).resolves.toBe(
      "Mocked Title"
    ).then(() => {
      expect(generateMock).toHaveBeenCalledTimes(1);
      const prompt = String(generateMock.mock.calls[0][0].prompt);
      expect(prompt).toContain("hello world");
    });
  });

  it("4. titles are coherent across en/es/pt", () => {
    const queries: Record<string, string> = {
      en: "what is nido app",
      es: "¿Qué es Nido?",
      pt: "o que é o Nido",
    };
    const locales = ["en", "es", "pt"] as const;
    for (const locale of locales) {
      const meta = answerKnowledgeQueryWithCategory(queries[locale], locale);
      expect(meta, locale).not.toBeNull();
      const title = knowledgeSessionTitle(queries[locale], locale);
      expect(title.length, locale).toBeGreaterThan(0);
      expect(title, locale).toContain(APP_DISPLAY_NAME);
      // Deterministic per locale.
      expect(knowledgeSessionTitle(queries[locale], locale), locale).toBe(title);
    }
    // Locales are not all identical (real localization, not a stub).
    const titles = locales.map((l) => titleForKnowledgeCategory("identity", l));
    expect(new Set(titles).size).toBe(3);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("5. malformed/unknown metadata falls back safely, never empty, never throws", () => {
    const fallbacks = { en: "New chat", es: "Nuevo chat", pt: "Nova conversa" } as const;
    for (const locale of ["en", "es", "pt"] as const) {
      for (const bad of ["bogus", "", null, undefined, 42, {}, []] as const) {
        const title = titleForKnowledgeCategory(bad, locale);
        expect(title, `${locale}/${String(bad)}`).toBe(fallbacks[locale]);
      }
      // A non-self-question has no category: still a safe fallback title.
      const plain = knowledgeSessionTitle("what is the weather today", locale);
      expect(plain, locale).toBe(fallbacks[locale]);
    }
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("6. failure/retry paths on the deterministic branch cannot invoke the model", () => {
    const section = kbSection();
    // The KB title is resolved synchronously and set directly: there is no
    // .then/.catch retry chain that could fall back to a model call, and
    // no background-task handle that a cancellation path could reuse.
    expect(section).toContain("await setSessionTitle(sid, kbTitle)");
    expect(section).not.toContain("generateSessionTitle");
    // Even the defensive fallback path is pure.
    expect(titleForKnowledgeCategory("bogus", "en")).toBe("New chat");
    expect(knowledgeSessionTitle("", "en")).toBe("New chat");
    expect(generateMock).not.toHaveBeenCalled();
  });
});
