import { describe, it, expect } from "vitest";
import { cleanCitations } from "./citations";

describe("cleanCitations", () => {
  it("keeps valid citations untouched", () => {
    const text = "Black holes form when massive stars collapse [1]. They have an event horizon [2].";
    expect(cleanCitations(text, 6)).toBe(text);
  });

  it("removes the literal [n] placeholder", () => {
    expect(cleanCitations("He became Emperor of the French in 1804 [n].", 6)).toBe(
      "He became Emperor of the French in 1804."
    );
  });

  it("removes numbers that don't match a retrieved source", () => {
    expect(cleanCitations("The Industrial Revolution brought economic growth [7].", 6)).toBe(
      "The Industrial Revolution brought economic growth."
    );
    expect(cleanCitations("Resistance develops through mutation [1] and gene transfer [9].", 6)).toBe(
      "Resistance develops through mutation [1] and gene transfer."
    );
  });

  it("removes every number when nothing was retrieved", () => {
    expect(cleanCitations("The train arrives at 6:15 pm [1].", 0)).toBe("The train arrives at 6:15 pm.");
  });

  it("drops a trailing invented reference list", () => {
    const text =
      "The Amazon is a major carbon sink.\n\n\nReference:\n\n1. Amazon Rainforest - National Geographic\n\n2. The Importance of Biodiversity - World Wildlife Fund";
    expect(cleanCitations(text, 6)).toBe("The Amazon is a major carbon sink.");
    expect(cleanCitations("RAM tracks the active parameters.\n\nSources:\n[1], [2], [3]", 6)).toBe(
      "RAM tracks the active parameters."
    );
    expect(cleanCitations("Answer here.\n\n**References:**\n- [1] Vaccine", 6)).toBe("Answer here.");
  });

  it("keeps numbered citations when the source count is unknown (reopened chat)", () => {
    expect(cleanCitations("Vaccines train immunity [1] [n].", undefined)).toBe("Vaccines train immunity [1].");
  });

  it("doesn't touch a text that merely mentions sources mid-answer", () => {
    const text = "Rivers are sources of fresh water. Filter it before drinking.";
    expect(cleanCitations(text, 6)).toBe(text);
  });
});
