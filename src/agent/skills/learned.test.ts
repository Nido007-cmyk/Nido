/**
 * Tests for Learned Skills (DR-4)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LearnedSkillStore } from "./learned";

describe("LearnedSkillStore", () => {
  let store: LearnedSkillStore;

  beforeEach(() => {
    store = new LearnedSkillStore();
  });

  it("learns a new skill", () => {
    const result = store.learn({
      name: "summarize-pdf",
      description: "Summarize a PDF document",
      instructions: "1. Extract text\n2. Identify key points\n3. Write summary",
      learnedFrom: "User asked to summarize report.pdf",
    });
    expect(result).toBe(true);
    const skill = store.get("summarize-pdf");
    expect(skill).not.toBeNull();
    expect(skill!.useCount).toBe(0);
  });

  it("rejects duplicate skill names", () => {
    store.learn({
      name: "test-skill",
      description: "Test",
      instructions: "Do test",
      learnedFrom: "test",
    });
    const result = store.learn({
      name: "Test-Skill", // Case-insensitive duplicate
      description: "Another",
      instructions: "Do other",
      learnedFrom: "test",
    });
    expect(result).toBe(false);
  });

  it("tracks usage and success rate", () => {
    store.learn({
      name: "test",
      description: "Test",
      instructions: "Test",
      learnedFrom: "test",
    });
    store.recordSuccess("test");
    store.recordSuccess("test");
    store.recordFailure("test");
    expect(store.successRate("test")).toBeCloseTo(2 / 3);
  });

  it("returns null success rate for unused skills", () => {
    store.learn({
      name: "test",
      description: "Test",
      instructions: "Test",
      learnedFrom: "test",
    });
    expect(store.successRate("test")).toBeNull();
  });

  it("adds refinements", () => {
    store.learn({
      name: "test",
      description: "Test",
      instructions: "Test",
      learnedFrom: "test",
    });
    const result = store.refine("test", "Also check the appendix");
    expect(result).toBe(true);
    const skill = store.get("test");
    expect(skill!.refinements).toContain("Also check the appendix");
  });

  it("deletes skills", () => {
    store.learn({
      name: "test",
      description: "Test",
      instructions: "Test",
      learnedFrom: "test",
    });
    expect(store.delete("test")).toBe(true);
    expect(store.get("test")).toBeNull();
  });

  it("lists by usefulness", () => {
    store.learn({
      name: "rare",
      description: "Rarely used",
      instructions: "Rare",
      learnedFrom: "test",
    });
    store.learn({
      name: "popular",
      description: "Often used",
      instructions: "Popular",
      learnedFrom: "test",
    });
    store.recordSuccess("popular");
    store.recordSuccess("popular");
    store.recordSuccess("rare");

    const list = store.list();
    expect(list[0].name).toBe("popular");
    expect(list[1].name).toBe("rare");
  });

  it("suggests relevant skills", () => {
    store.learn({
      name: "summarize-pdf",
      description: "Summarize PDF documents",
      instructions: "Summarize",
      learnedFrom: "test",
    });
    store.learn({
      name: "translate-text",
      description: "Translate text between languages",
      instructions: "Translate",
      learnedFrom: "test",
    });

    const suggestions = store.suggestFor("Can you summarize this PDF?");
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].name).toBe("summarize-pdf");
  });
});
