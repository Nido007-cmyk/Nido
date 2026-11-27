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

import { chooseVoice, cleanForSpeech, speechLocaleFor } from "./tts";

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


describe("bloque 3 (0.1.112): chooseVoice descarta las voces de red y prefiere las locales", () => {
  const V = (identifier: string, language: string, name = identifier) => ({ identifier, name, language });

  it("con las dos variantes del motor de Google elige la local", () => {
    const voices = [V("es-us-x-esd-network", "es-US"), V("es-us-x-esd-local", "es-US"), V("en-us-x-sfg-network", "en-US")];
    expect(chooseVoice(voices, "es-MX")).toBe("es-us-x-esd-local");
  });

  it("nunca elige una voz marcada de red, aunque sea la del locale exacto", () => {
    const voices = [V("pt-br-x-afs-network", "pt-BR"), V("pt-pt-x-sfs-local", "pt-PT")];
    expect(chooseVoice(voices, "pt-BR")).toBe("pt-pt-x-sfs-local");
  });

  it("si todas las del idioma son de red, no pasa voz (null)", () => {
    expect(chooseVoice([V("en-us-x-iom-network", "en-US")], "en-US")).toBeNull();
  });

  it("un motor sin marca (otro fabricante) sigue eligiendo por idioma, como antes", () => {
    const voices = [V("SMTl01", "es-ES"), V("SMTm02", "es-MX")];
    expect(chooseVoice(voices, "es-MX")).toBe("SMTm02");
  });
});

describe("speakAloud con onEnd (0.1.117, botón «Escuchar»)", () => {
  it("pasa los avisos de fin a expo-speech y llama a onEnd una sola vez", async () => {
    const Speech = await import("expo-speech");
    const { speakAloud } = await import("./tts");
    const speak = Speech.speak as unknown as ReturnType<typeof vi.fn>;
    speak.mockClear();
    const onEnd = vi.fn();
    await speakAloud("Hola, esto es una prueba.", onEnd);
    expect(speak).toHaveBeenCalledTimes(1);
    const opts = speak.mock.calls[0][1] as { onDone: () => void; onStopped: () => void; onError: () => void };
    opts.onDone();
    opts.onStopped();
    opts.onError();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("sin nada que leer avisa del fin sin llamar a expo-speech", async () => {
    const Speech = await import("expo-speech");
    const { speakAloud } = await import("./tts");
    const speak = Speech.speak as unknown as ReturnType<typeof vi.fn>;
    speak.mockClear();
    const onEnd = vi.fn();
    await speakAloud("```\ncódigo\n```", onEnd);
    expect(speak).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
