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
