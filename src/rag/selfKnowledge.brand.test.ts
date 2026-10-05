import { describe, it, expect, vi } from "vitest";

/**
 * Brand-swappability test (owner directive 2026-09-28): the public product
 * name is UNDECIDED, so the knowledge base must render through a single
 * source of truth. Mocking ../brand with a different display name must
 * change BOTH the rendered answers AND the detection patterns — proving
 * a future rename is a one-place change.
 */
vi.mock("../brand", () => ({
  APP_DISPLAY_NAME: "Testonia",
  APP_TAGLINE: {
    en: "Test tagline.",
    es: "Eslogan de prueba.",
    pt: "Slogan de teste.",
  },
}));

// Imported AFTER vi.mock so the module under test reads the mocked brand.
import { answerKnowledgeQuery, isIdentityQuestion } from "./selfKnowledge";

describe("knowledge base under a renamed brand", () => {
  it("renders the mocked display name, not the old hardcoded one", () => {
    const answer = answerKnowledgeQuery("what is testonia?", "en");
    expect(answer).not.toBeNull();
    expect(answer!).toContain("Testonia");
    expect(answer!).toContain("Test tagline.");
    expect(answer!).not.toContain("Nido");
  });

  it("re-keys detection off the normalized brand token", () => {
    expect(isIdentityQuestion("what is testonia")).toBe(true);
    expect(isIdentityQuestion("tell me about testonia")).toBe(true);
    // The old codename no longer routes to identity under the new brand.
    expect(isIdentityQuestion("what is nido")).toBe(false);
  });

  it("applies the renamed brand across categories and locales", () => {
    expect(answerKnowledgeQuery("qué puedes hacer", "es")).toContain("Testonia");
    expect(answerKnowledgeQuery("por que devo usar", "pt")).toContain("Testonia");
    expect(answerKnowledgeQuery("roadmap", "en")).toContain("Testonia");
  });
});
