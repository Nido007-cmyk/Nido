import { describe, expect, it } from "vitest";
import { normalizeFactText, factSimilarity } from "./memoryStore";

describe("DEDUP-2026-10-08: deduplicación de facts", () => {
  it("normaliza texto", () => {
    expect(normalizeFactText("My Mom's Birthday!")).toBe("my mom s birthday");
    expect(normalizeFactText("  hola   mundo  ")).toBe("hola mundo");
  });

  it("detecta facts idénticos", () => {
    expect(factSimilarity("my mom's birthday is March 15th", "my mom's birthday is March 15th")).toBe(1);
  });

  it("detecta facts casi idénticos (caso del screenshot)", () => {
    const a = "my mom's birthday is March 15th and she loves orchids";
    const b = "my mom's birthday is March 15th and she loves orchids. Save it so you can remind me in time.";
    // b contiene a normalizado -> findSimilarFact lo detecta por inclusión
    const na = normalizeFactText(a);
    const nb = normalizeFactText(b);
    expect(nb.includes(na)).toBe(true);
    expect(factSimilarity(a, b)).toBeGreaterThan(0.5);
  });

  it("no confunde facts distintos", () => {
    expect(factSimilarity("my mom's birthday is March 15th", "I like pizza")).toBeLessThan(0.3);
  });
});
