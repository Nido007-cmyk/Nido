// Auditoría de la 0.1.70, punto 5b: la frase corta que quita (o
// pone) la negación de UNA cláusula de una frase fuente larga salía
// tal cual. La capa de negación (negatedClauseSource) la sustituye
// por la frase fuente entera; las cortas fieles no se tocan; la vía
// de las frases largas no cambia. Las constantes selladas del juez
// e isSupported no cambian.
import { describe, it, expect } from "vitest";
import { verifyGroundedAnswer, negatedClauseSource, type GroundingChunk } from "./grounding";

const ES: GroundingChunk = { title: "nota", body: "Nota de urgencias. El paciente no está sangrando y respira con normalidad tras la caída." };
const EN: GroundingChunk = { title: "note", body: "ER note. The patient is not bleeding and is breathing normally after the fall." };
const PT: GroundingChunk = { title: "nota", body: "Nota de emergência. O paciente não está sangrando e respira normalmente depois da queda." };

describe("5b — la negación de una cláusula en la frase corta", () => {
  it("la corta con la negación quitada se sustituye por la frase fuente, en es/en/pt", () => {
    const cases: [string, GroundingChunk, string, "es" | "en" | "pt", string][] = [
      ["El paciente está sangrando.", ES, "¿El paciente está sangrando?", "es", "El paciente no está sangrando y respira con normalidad tras la caída"],
      ["The patient is bleeding.", EN, "Is the patient bleeding?", "en", "The patient is not bleeding and is breathing normally after the fall"],
      ["O paciente está sangrando.", PT, "O paciente está sangrando?", "pt", "O paciente não está sangrando e respira normalmente depois da queda"],
    ];
    for (const [a, ch, q, lang, src] of cases) {
      const r = verifyGroundedAnswer(a, [ch], lang, q);
      expect(r.text).toContain(src);
      expect(r.sentences?.[0].origin).toMatchObject({ kind: "source", negationFixed: true });
    }
  });

  it("la corta con la negación AÑADIDA contra una cláusula afirmativa se sustituye igual", () => {
    const ch: GroundingChunk = { title: "nota", body: "Nota de urgencias. El paciente está consciente y no tiene fiebre desde ayer por la tarde." };
    const r = verifyGroundedAnswer("El paciente no está consciente.", [ch], "es", "¿Está consciente?");
    expect(r.text).toContain("El paciente está consciente y no tiene fiebre");
    expect(r.sentences?.[0].origin).toMatchObject({ negationFixed: true });
  });

  it("las cortas fieles no se tocan, en es/en/pt", () => {
    expect(verifyGroundedAnswer("El paciente no está sangrando.", [ES], "es", "¿El paciente está sangrando?").text).toBe("El paciente no está sangrando.");
    expect(verifyGroundedAnswer("The patient is not bleeding.", [EN], "en", "Is the patient bleeding?").text).toBe("The patient is not bleeding.");
    expect(verifyGroundedAnswer("O paciente não está sangrando.", [PT], "pt", "O paciente está sangrando?").text).not.toMatch(/respira/);
  });

  it("la negación de OTRA cláusula no contamina: «Llame al 112» tras «No mueva al herido»", () => {
    const ch: GroundingChunk = { title: "guía", body: "Qué hacer. No mueva al herido y llame al 112 enseguida desde un lugar seguro." };
    expect(verifyGroundedAnswer("Llame al 112.", [ch], "es", "¿Qué hago?").text).toBe("Llame al 112.");
  });

  it("una lectura fiel en otra frase de las fuentes gana: no se sustituye", () => {
    const ch: GroundingChunk = { title: "nota", body: "Nota. El paciente no está sangrando y respira bien tras la caída. Horas después, el paciente está sangrando por la herida." };
    const r = negatedClauseSource("El paciente está sangrando.", ["El paciente no está sangrando y respira bien tras la caída."], [
      "El paciente no está sangrando y respira bien tras la caída.",
      "Horas después, el paciente está sangrando por la herida.",
    ]);
    expect(r).toBeNull();
    expect(verifyGroundedAnswer("El paciente está sangrando.", [ch], "es", "¿Sangra?").text).not.toContain("no está sangrando");
  });

  it("las frases largas no entran en esta pierna", () => {
    expect(negatedClauseSource("El paciente respira con normalidad.", ["El paciente no está sangrando y respira con normalidad tras la caída."], ["El paciente no está sangrando y respira con normalidad tras la caída."])).toBeNull();
  });

  it("el tema compartido de T-J7 sigue sin tocarse", () => {
    const ch: GroundingChunk = { title: "nota", body: "Nota de urgencias. El paciente está sangrando mucho y necesita ayuda urgente ahora mismo en la sala." };
    expect(verifyGroundedAnswer("El paciente está sangrando.", [ch], "es", "¿El paciente está sangrando?").text).toBe("El paciente está sangrando.");
  });
});
