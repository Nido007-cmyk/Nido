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
vi.mock("../i18n", () => ({ default: { language: "es" } }));

import { cleanForSpeech, speechLocaleFor } from "./tts";

describe("speechLocaleFor (F1 M-3)", () => {
  it("cada idioma de la app lee con su variante regional", () => {
    expect(speechLocaleFor("es")).toBe("es-MX");
    expect(speechLocaleFor("en")).toBe("en-US");
    expect(speechLocaleFor("pt")).toBe("pt-BR");
    expect(speechLocaleFor("pt-BR")).toBe("pt-BR");
    expect(speechLocaleFor("de")).toBe("en-US");
    expect(speechLocaleFor(undefined)).toBe("en-US");
  });
});

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

describe("cleanForSpeech: el razonamiento no se lee (auditoría 0.1.93)", () => {
  it("lee solo la respuesta de un turno que razonó", () => {
    const out = cleanForSpeech("<think>\nOkay, 3 boxes of 12 is 36, minus 7 is 29.\n</think>\n\nMe quedan 29 huevos.");
    expect(out).toBe("Me quedan 29 huevos.");
  });

  it("plantillas que abren el bloque en el prompt: solo llega el cierre", () => {
    expect(cleanForSpeech("3 x 12 = 36; 36 - 7 = 29.</think>Quedan 29.")).toBe("Quedan 29.");
  });

  it("un razonamiento que no terminó no se lee", () => {
    expect(cleanForSpeech("<think>\nLet me see, the user asks")).toBe("");
  });

  it("una respuesta sin razonamiento se lee igual que antes", () => {
    expect(cleanForSpeech("Hola. **Todo** bien.")).toBe("Hola. Todo bien.");
  });
});

