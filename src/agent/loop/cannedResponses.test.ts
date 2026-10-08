/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { matchCanned } from "./cannedResponses";

describe("matchCanned — greetings", () => {
  it.each(["hola", "¡Hola!", "hey", "hey, what's up?", "buenos días", "gracias", "hi, hello"])(
    "matches pure greeting %p",
    (text) => {
      const hit = matchCanned(text);
      expect(hit).not.toBeNull();
      expect(hit!.kind).toBe("greeting");
      expect(hit!.deterministic).toBe(true);
    }
  );

  it("responds in English to English greetings", () => {
    expect(matchCanned("hey")!.lang).toBe("en");
    expect(matchCanned("good morning")!.lang).toBe("en");
  });

  it("responds in Spanish to Spanish greetings (default)", () => {
    expect(matchCanned("hola")!.lang).toBe("es");
    expect(matchCanned("buenas tardes")!.lang).toBe("es");
  });

  it("does NOT match greetings with extra content", () => {
    expect(matchCanned("hola, recuérdame comprar pan")).toBeNull();
    expect(matchCanned("hey, can you compare X and Y")).toBeNull();
    expect(matchCanned("hola quiero saber la hora")).toBeNull();
  });
});

describe("matchCanned — identity", () => {
  it.each(["quién eres", "¿Cómo te llamas?", "who are you", "what's your name"])(
    "matches identity question %p",
    (text) => {
      const hit = matchCanned(text);
      expect(hit).not.toBeNull();
      expect(hit!.kind).toBe("identity");
      expect(hit!.deterministic).toBe(true);
    }
  );

  it("does NOT match identity inside a longer message", () => {
    expect(matchCanned("dime quién eres y qué hora es")).toBeNull();
    expect(matchCanned("who are you and what can you do")).toBeNull();
  });

  it("identity answer mentions offline/privacy", () => {
    expect(matchCanned("quién eres")!.text).toMatch(/sin internet|offline/i);
  });
});

describe("matchCanned — help", () => {
  it.each(["ayuda", "help", "¿qué puedes hacer?", "what can you do"])(
    "matches help request %p",
    (text) => {
      const hit = matchCanned(text);
      expect(hit).not.toBeNull();
      expect(hit!.kind).toBe("help");
      expect(hit!.deterministic).toBe(true);
    }
  );

  it("does NOT match help inside a longer message", () => {
    expect(matchCanned("ayúdame a recordar esto")).toBeNull();
    expect(matchCanned("help me remember this")).toBeNull();
  });
});

describe("matchCanned — fall-through", () => {
  it("returns null for empty/blank input", () => {
    expect(matchCanned("")).toBeNull();
    expect(matchCanned("   ")).toBeNull();
  });

  it("returns null for normal queries", () => {
    expect(matchCanned("recuérdame comprar pan")).toBeNull();
    expect(matchCanned("cuánto es 24 por 17")).toBeNull();
    expect(matchCanned("capital de Australia")).toBeNull();
  });
});
