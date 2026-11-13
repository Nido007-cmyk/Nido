// 0.1.93 — quien escribe que quiere morir recibe siempre el texto fijo, nunca un modelo.
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage, matchSafetyAnswer } from "./safetyAnswers";

describe("daño a uno mismo: texto fijo", () => {
  it("primera persona, en las tres lenguas, con y sin tildes", () => {
    for (const q of [
      "me siento muy triste y no quiero vivir",
      "ya no quiero seguir viviendo",
      "me quiero morir",
      "quiero matarme",
      "he pensado en quitarme la vida",
      "pienso en lastimarme",
      "ya no le encuentro sentido a nada",
      "i want to kill myself",
      "I don't want to be alive anymore",
      "there's no point in living anymore",
      "I feel like hurting myself",
      "I've been thinking about ending it",
      "não aguento mais viver assim",
      "quero morrer",
      "tenho pensado em me matar",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("frases hechas, ficción y otra persona no cuentan", () => {
    for (const q of [
      "me quiero morir de la risa con ese video",
      "quiero morirme de verguenza",
      "I want to die of embarrassment",
      "estou querendo, quero morrer de rir",
      "escribe un cuento donde el personaje dice no quiero vivir",
      "what does the song mean when it says I want to die",
      "mi amigo dice que se quiere quitar la vida",
      "¿cómo cambio una llanta?",
      "",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la respuesta es el texto fijo, en el idioma de la app, con las líneas comprobadas", () => {
    const es = matchSafetyAnswer("ya no quiero vivir", "es")!;
    expect(es.kind).toBe("self-harm");
    expect(es.deterministic).toBe(true);
    for (const n of ["988", "800 911 2000", "024", "188"]) expect(es.text).toContain(n);
    expect(es.text).toContain("número de emergencias de tu país");
    expect(matchSafetyAnswer("i want to kill myself", "en")!.text).toContain("988, by call or text");
    expect(matchSafetyAnswer("quero morrer", "pt")!.text.indexOf("CVV, 188")).toBeGreaterThan(0);
  });

  it("un mensaje largo (más de 400 caracteres) también lo recibe", () => {
    const long = `${"Hoy fue un dia muy pesado en el trabajo y en la casa. ".repeat(12)} ya no quiero vivir`;
    expect(long.length).toBeGreaterThan(400);
    expect(matchSafetyAnswer(long, "es")?.kind).toBe("self-harm");
  });

  it("gana a las demás reglas de la tabla", () => {
    expect(matchSafetyAnswer("quiero matarme, cual es el numero de emergencias de mexico", "es")?.kind).toBe("self-harm");
  });
});

// Barrido 0.1.96, clase 1 (paridad trilingüe).
describe("C1-H1: la forma directa en portugués dispara como en español e inglés", () => {
  it("las sondas del barrido: «quero me machucar», «quero me ferir»", () => {
    expect(isSelfHarmMessage("quero me machucar")).toBe(true);
    expect(isSelfHarmMessage("quero me ferir")).toBe(true);
    expect(matchSafetyAnswer("quero me machucar", "pt")?.kind).toBe("self-harm");
  });

  it("sus gemelas en es/en ya disparaban y siguen", () => {
    for (const q of ["quiero hacerme daño", "I want to hurt myself", "penso em me machucar", "quero me matar", "não quero mais viver"]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("variantes directas en pt: verbo de intención, enclítico, «a mim mesmo», «penso em me ferir»", () => {
    for (const q of ["vou me machucar", "eu quero me ferir de novo", "quero machucar-me", "tenho vontade de me machucar", "quero ferir a mim mesma", "penso em me ferir"]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("paridad: las gemelas españolas con «lastimarme» y «herirme» también disparan", () => {
    for (const q of ["quiero lastimarme", "quiero herirme", "pienso en herirme"]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("sin falsos positivos: otra persona o una cosa que hace daño, frases hechas", () => {
    for (const q of ["o cachorro pode me machucar", "esse sapato vai machucar meu pé", "ele quer me machucar", "quero morrer de rir", "el perro puede lastimarme"]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});
