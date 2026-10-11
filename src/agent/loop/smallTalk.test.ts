/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { matchSmallTalk, smallTalkSessionTitle } from "./smallTalk";

describe("matchSmallTalk — evidencia física (Tab A9+, v0.1.6)", () => {
  it('"bien y tú como estás?" contesta la pregunta (no otro saludo)', () => {
    const hit = matchSmallTalk("bien y tú como estás?");
    expect(hit?.kind).toBe("fineAndYou");
    expect(hit?.lang).toBe("es");
    expect(hit?.text).toContain("Bien también");
    expect(hit?.deterministic).toBe(true);
  });
  it('"bien y tú?" igual', () => {
    expect(matchSmallTalk("bien y tú?")?.kind).toBe("fineAndYou");
  });
  it('"hola" → saludo determinista', () => {
    expect(matchSmallTalk("hola")?.kind).toBe("greeting");
  });
});

describe("matchSmallTalk — turnos naturales es / en / pt", () => {
  it.each([
    ["¿Cómo estás?", "howAreYou", "es"],
    ["hola, ¿cómo estás?", "howAreYou", "es"],
    ["qué tal", "howAreYou", "es"],
    ["muy bien, gracias, ¿y tú?", "fineAndYou", "es"],
    ["todo bien y tú qué tal", "fineAndYou", "es"],
    ["bien gracias", "fine", "es"],
    ["muchas gracias", "thanks", "es"],
    ["adiós", "bye", "es"],
    ["¿qué haces?", "whatsUp", "es"],
    ["how are you?", "howAreYou", "en"],
    ["hi, how's it going?", "howAreYou", "en"],
    ["I'm good, and you?", "fineAndYou", "en"],
    ["fine thanks, you?", "fineAndYou", "en"],
    ["thank you so much", "thanks", "en"],
    ["goodbye", "bye", "en"],
    ["olá, tudo bem?", "howAreYou", "pt"],
    ["tudo bem e você?", "fineAndYou", "pt"],
    ["estou bem, obrigado", "fine", "pt"],
    ["obrigada", "thanks", "pt"],
    ["tchau", "bye", "pt"],
  ])("%p → %s (%s)", (text, kind, lang) => {
    const hit = matchSmallTalk(text as string);
    expect(hit?.kind).toBe(kind);
    expect(hit?.lang).toBe(lang);
  });

  it("saludo + pregunta de estado saluda primero", () => {
    expect(matchSmallTalk("hola, ¿cómo estás?")!.text.startsWith("¡Hola! ")).toBe(true);
    expect(matchSmallTalk("hi, how are you?")!.text.startsWith("Hi! ")).toBe(true);
  });

  it('"ok" es acuse, no "estoy bien"; sin marcas de idioma usa el de la UI', () => {
    expect(matchSmallTalk("ok", "en")).toMatchObject({ kind: "ack", lang: "en" });
    expect(matchSmallTalk("ok", "pt")).toMatchObject({ kind: "ack", lang: "pt" });
    expect(matchSmallTalk("vale")?.kind).toBe("ack");
  });

  it("título de sesión determinista por idioma", () => {
    expect(smallTalkSessionTitle("es")).toBe("Charla");
    expect(smallTalkSessionTitle("en")).toBe("Chat");
    expect(smallTalkSessionTitle("pt")).toBe("Conversa");
  });
});

describe("matchSmallTalk — adversarial: lo mixto o con contenido NO es charla", () => {
  it.each([
    "hola, recuérdame comprar pan",
    "hola, ¿qué es la fotosíntesis?",
    "hi, can you compare X and Y",
    "bien, ahora llama a Ana",
    "gracias, ahora busca el contacto Ruben",
    "¿cómo estás programado?",
    "qué tal el clima en Madrid",
    "how are you different from ChatGPT?",
    "estoy bien pero me duele la cabeza, ¿qué hago?",
    "tudo bem se eu apagar meus dados?",
    "",
    "   ",
  ])("%p → null", (text) => {
    expect(matchSmallTalk(text)).toBeNull();
  });

  it("mensajes largos nunca son charla", () => {
    expect(matchSmallTalk("hola ".repeat(30))).toBeNull();
  });
});
