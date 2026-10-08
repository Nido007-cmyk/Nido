/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("expo-speech", () => ({
  speak: vi.fn(),
  stop: vi.fn().mockResolvedValue(undefined),
  getAvailableVoicesAsync: vi.fn().mockResolvedValue([]),
}));

import { cleanForSpeech } from "./tts";

describe("cleanForSpeech", () => {
  it("elimina bloques de código", () => {
    const out = cleanForSpeech("Mira:\n```js\nconst x = 1;\n```\nListo.");
    expect(out).not.toContain("const x");
    expect(out).toContain("Mira");
    expect(out).toContain("Listo");
  });

  it("limpia markdown en línea", () => {
    expect(cleanForSpeech("**negrita** y *cursiva*")).toBe("negrita y cursiva");
    expect(cleanForSpeech("[NIDO](https://ejemplo.com)")).toBe("NIDO");
    expect(cleanForSpeech("`código` inline")).toBe("código inline");
  });

  it("recorta a 2000 caracteres", () => {
    const out = cleanForSpeech("a".repeat(3000));
    expect(out.length).toBe(2000);
  });

  it("devuelve vacío si no hay texto útil", () => {
    expect(cleanForSpeech("   ")).toBe("");
    expect(cleanForSpeech("```\n```")).toBe("");
  });
});
