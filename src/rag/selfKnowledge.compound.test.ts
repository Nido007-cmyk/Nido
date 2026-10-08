import { describe, expect, it } from "vitest";
import { classifyKnowledgeQuery, debugClassify } from "./selfKnowledge";

describe("COMPOUND-2026-10-08: preguntas compuestas sobre la app", () => {
  it("clasifica la pregunta exacta del screenshot", () => {
    const q = "Explain how you work without internet. Where is my data stored and who can see it?";
    const cat = classifyKnowledgeQuery(q);
    // "Explain how you work without internet" -> capabilities (offline)
    expect(cat).toBe("capabilities");
  });

  it("segunda cláusula también clasifica si la primera no hace match", () => {
    const q = "Tell me a story. Where is my data stored?";
    expect(classifyKnowledgeQuery(q)).toBe("advantages");
  });

  it("pregunta simple sigue funcionando", () => {
    expect(classifyKnowledgeQuery("Where is my data stored?")).toBe("advantages");
    expect(classifyKnowledgeQuery("Do you work offline?")).toBe("capabilities");
  });

  it("no clasifica preguntas no relacionadas", () => {
    expect(classifyKnowledgeQuery("What is the weather today? Tell me a joke.")).toBeNull();
  });

  it("debugClassify marca attributed en match por cláusula", () => {
    const d = debugClassify("Explain how you work without internet. Where is my data stored?");
    expect(d).not.toBeNull();
    expect(d!.attributed).toBe(true);
  });
});
