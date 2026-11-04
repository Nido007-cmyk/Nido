// ADV-G1-R (auditoría del tip f96e473): la afirmación con la etiqueta
// genérica («El número es…», «Es el…») se juzga con el tipo pedido.
// Pares: el dato de otro tipo se retira en es/en/pt; el genérico fiel
// se conserva; el teléfono corto fiel («Es el 112») no se toca.
import { describe, expect, it } from "vitest";
import { verifyGroundedAnswer, type GroundingChunk } from "./grounding";

const CLINIC: GroundingChunk = { title: "nota", body: "Datos de la clínica. El teléfono de la clínica es 520-555-0147. La cita es el martes." };

describe("ADV-G1-R: la etiqueta genérica no sella el dato de otro tipo", () => {
  it("«El número es…» y «Es el…» con el teléfono ante una pregunta de tarjeta se retiran", () => {
    for (const a of ["El número es 520-555-0147.", "Es el 520-555-0147."]) {
      const r = verifyGroundedAnswer(a, [CLINIC], "es", "¿Cuál es el número de mi tarjeta?");
      expect(r.status, a).toBe("abstained");
      // La abstención puede citar la frase de la fuente, que dice que es el teléfono; la afirmación no se sella.
      expect(r.text).not.toContain(a.replace(/\.$/, ""));
    }
  });

  it("par: el genérico fiel se conserva (tarjeta, sala, hora, fecha, dosis)", () => {
    const cases: [string, string, string, "es" | "en" | "pt"][] = [
      ["El número de tu tarjeta termina en 4417.", "El número es 4417.", "¿Cuál es el número de mi tarjeta?", "es"],
      ["La consulta es en la sala 12 del hospital.", "Es la 12.", "¿En qué sala es la consulta?", "es"],
      ["The appointment is at 10:30 at the clinic.", "It is 10:30.", "What time is the appointment?", "en"],
      ["La cita es el 15 de marzo en la clínica.", "Es el 15 de marzo.", "¿Qué día es la cita?", "es"],
      ["A consulta é às 10:30 na clínica.", "É às 10:30.", "A que horas é a consulta?", "pt"],
      ["Tome 10 ml cada 8 horas.", "Son 10 ml.", "¿Cuál es la dosis?", "es"],
    ];
    for (const [src, a, q, lang] of cases) {
      const r = verifyGroundedAnswer(a, [{ title: "nota", body: `Nota. ${src}` }], lang, q);
      expect(r.status, a).toBe("grounded");
    }
  });

  it("par: el teléfono corto fiel no se toca", () => {
    const ch: GroundingChunk = { title: "nota", body: "Nota. Llama al 112 en caso de emergencia." };
    for (const a of ["Es el 112.", "El número es el 112."]) {
      expect(verifyGroundedAnswer(a, [ch], "es", "¿A qué número llamo en una emergencia?").status, a).toBe("grounded");
    }
    expect(verifyGroundedAnswer("El número es 520-555-0147.", [CLINIC], "es", "¿Cuál es el teléfono de la clínica?").status).toBe("grounded");
  });
});

// Arreglos «todo es todo» (2026-11-03): el teléfono corto (112, 911, 190)
// que la fuente da junto a un verbo de llamar es dato de tipo teléfono si
// el tema de la afirmación y de la pregunta está en esa frase. Par: el 911
// servido como teléfono de la clínica o de la cita se sigue sustituyendo.
describe("teléfono corto junto a «llamar»", () => {
  it("«El teléfono de emergencias es el 112» ante «Llama al 112 en caso de emergencia» se conserva", () => {
    const ch: GroundingChunk = { title: "nota", body: "Nota. Llama al 112 en caso de emergencia." };
    const r = verifyGroundedAnswer("El teléfono de emergencias es el 112.", [ch], "es", "¿Cuál es el teléfono de emergencias?");
    expect(r.status).toBe("grounded");
    expect(r.text).toContain("112");
  });
  it("par: el 911 como teléfono de la clínica o de la cita se sustituye por el de la clínica", () => {
    const ch: GroundingChunk = { title: "nota", body: "Nota. La cita es el martes. Para emergencias llama al 911. El teléfono de la clínica es 520-555-0147." };
    for (const [a, q] of [
      ["El teléfono de la clínica es el 911.", "¿Cuál es el teléfono de la clínica?"],
      ["El teléfono de la cita es el 911.", "¿Cuál es el teléfono de la cita?"],
    ]) {
      const r = verifyGroundedAnswer(a, [ch], "es", q);
      expect(r.text, a).toContain("520-555-0147");
      expect(r.text, a).not.toContain("911");
    }
  });
});
