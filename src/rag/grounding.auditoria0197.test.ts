/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría de la 0.1.97 (main @ 983c0db3). Cada bloque lleva el ID del
 * hallazgo (AUD97-n) y falla sobre la 0.1.97 publicada.
 */
import { describe, expect, it } from "vitest";
import { detectTextLang, verifyGroundedAnswer, type GroundingChunk } from "./grounding";

const REF = new Date(2026, 10, 13);
const chunk = (body: string, title = "Notas"): GroundingChunk => ({ title, body });
const served = (r: { status: string; text: string }, ans: string) =>
  r.status === "grounded" && r.text.replace(/\s*\[\d+\]/g, "").includes(ans.replace(/\.$/, ""));

// ------------------------------------------------------------ AUD97-1

describe("AUD97-1: la fecha de OTRO evento de la fuente ya no se sella (es/en/pt)", () => {
  const CASES: Array<[string, string, string, "es" | "en" | "pt", string]> = [
    ["es", "La vacuna es el 12 de diciembre de 2026. La revisión es el 3 de enero de 2027.", "La revisión es el 12 de diciembre de 2026.", "es", "¿Cuándo es la revisión?"],
    ["en", "The vaccine is on December 12, 2026. The check-up is on January 3, 2027.", "The check-up is on December 12, 2026.", "en", "When is the check-up?"],
    ["pt", "A vacina é em 12 de dezembro de 2026. A revisão é em 3 de janeiro de 2027.", "A revisão é em 12 de dezembro de 2026.", "pt", "Quando é a revisão?"],
    ["es-compuesta", "La vacuna es el 12 de diciembre de 2026 y la revisión el 3 de enero de 2027.", "La revisión es el 12 de diciembre de 2026.", "es", "¿Cuándo es la revisión?"],
    ["en-compuesta", "The vaccine is on December 12, 2026 and the check-up on January 3, 2027.", "The check-up is on December 12, 2026.", "en", "When is the check-up?"],
    ["pt-compuesta", "A vacina é em 12 de dezembro de 2026 e a revisão em 3 de janeiro de 2027.", "A revisão é em 12 de dezembro de 2026.", "pt", "Quando é a revisão?"],
  ];
  for (const [id, src, ans, lang, q] of CASES) {
    it(`sonda ${id}: la fecha cambiada de evento no sale sellada`, () => {
      const r = verifyGroundedAnswer(ans, [chunk(src)], lang, q, REF);
      expect(served(r, ans), r.text).toBe(false);
    });
  }

  describe("controles que no cambian", () => {
    const OK: Array<[string, string, string, "es" | "en" | "pt", string]> = [
      ["la fecha fiel de cada evento (es)", "La vacuna es el 12 de diciembre de 2026. La revisión es el 3 de enero de 2027.", "La revisión es el 3 de enero de 2027.", "es", "¿Cuándo es la revisión?"],
      ["la otra fecha fiel (es)", "La vacuna es el 12 de diciembre de 2026. La revisión es el 3 de enero de 2027.", "La vacuna es el 12 de diciembre de 2026.", "es", "¿Cuándo es la vacuna?"],
      ["fiel en frase compuesta (en)", "The vaccine is on December 12, 2026 and the check-up on January 3, 2027.", "The check-up is on January 3, 2027.", "en", "When is the check-up?"],
      ["fiel en frase compuesta (pt)", "A vacina é em 12 de dezembro de 2026 e a revisão em 3 de janeiro de 2027.", "A vacina é em 12 de dezembro de 2026.", "pt", "Quando é a vacina?"],
      ["fecha delante del evento: tramo sin tema, frase entera (es)", "El 12 de diciembre de 2026 es la vacuna y el 3 de enero de 2027, la revisión.", "La revisión es el 3 de enero de 2027.", "es", "¿Cuándo es la revisión?"],
      ["la fecha fiel sin año (es)", "La vacuna es el 12 de diciembre de 2026. La revisión es el 3 de enero de 2027.", "La revisión es el 3 de enero.", "es", "¿Cuándo es la revisión?"],
    ];
    for (const [name, src, ans, lang, q] of OK) {
      it(name, () => {
        expect(verifyGroundedAnswer(ans, [chunk(src)], lang, q, REF).status).toBe("grounded");
      });
    }
  });

  // El evento elidido en la fuente («El de mi padre…»): el tramo
  // elíptico hereda el tema del anterior a medio peso (es/en/pt).
  describe("el evento elidido en la fuente", () => {
    const SRC = {
      es: "El cumpleaños de mi madre es el 4 de mayo. El de mi padre es el 9 de agosto.",
      en: "My mother's birthday is May 4. My father's is August 9.",
      pt: "O aniversário da minha mãe é 4 de maio. O do meu pai é 9 de agosto.",
      "es-compuesta": "El cumpleaños de mi madre es el 4 de mayo y el de mi padre el 9 de agosto.",
    } as const;
    const BAD: Array<[keyof typeof SRC, string, "es" | "en" | "pt", string]> = [
      ["es", "El cumpleaños de mi padre es el 4 de mayo.", "es", "¿Cuándo es el cumpleaños de mi padre?"],
      ["es", "El cumpleaños de mi madre es el 9 de agosto.", "es", "¿Cuándo es el cumpleaños de mi madre?"],
      ["en", "My father's birthday is May 4.", "en", "When is my father's birthday?"],
      ["en", "My mother's birthday is August 9.", "en", "When is my mother's birthday?"],
      ["pt", "O aniversário do meu pai é 4 de maio.", "pt", "Quando é o aniversário do meu pai?"],
      ["pt", "O aniversário da minha mãe é 9 de agosto.", "pt", "Quando é o aniversário da minha mãe?"],
      ["es-compuesta", "El cumpleaños de mi padre es el 4 de mayo.", "es", "¿Cuándo es el cumpleaños de mi padre?"],
    ];
    for (const [k, ans, lang, q] of BAD) {
      it(`sonda ${k}: «${ans}» no sale sellada`, () => {
        const r = verifyGroundedAnswer(ans, [chunk(SRC[k])], lang, q, REF);
        expect(served(r, ans), r.text).toBe(false);
      });
    }
    const OK: Array<[keyof typeof SRC, string, "es" | "en" | "pt", string]> = [
      ["es", "El cumpleaños de mi madre es el 4 de mayo.", "es", "¿Cuándo es el cumpleaños de mi madre?"],
      ["es", "El cumpleaños de mi padre es el 9 de agosto.", "es", "¿Cuándo es el cumpleaños de mi padre?"],
      ["en", "My father's birthday is August 9.", "en", "When is my father's birthday?"],
      ["pt", "O aniversário do meu pai é 9 de agosto.", "pt", "Quando é o aniversário do meu pai?"],
      ["es-compuesta", "El cumpleaños de mi padre es el 9 de agosto.", "es", "¿Cuándo es el cumpleaños de mi padre?"],
    ];
    for (const [k, ans, lang, q] of OK) {
      it(`fiel ${k}: «${ans}» sigue fundada`, () => {
        const r = verifyGroundedAnswer(ans, [chunk(SRC[k])], lang, q, REF);
        expect(r.status, r.text).toBe("grounded");
      });
    }
  });
});

// ------------------------------------------------------------ AUD97-2

describe("AUD97-2: «dos veces al día» es español, no una copia portuguesa", () => {
  it("la frase fiel copiada de la fuente española se sirve fundada", () => {
    for (const s of ["Tome 5 ml dos veces al día.", "Tome 5 ml dos veces por día.", "Dele 5 ml, dos veces al día."]) {
      expect(verifyGroundedAnswer(s, [chunk(s, "Jarabe")], "es", "¿Cuánto jarabe le doy?", REF).status, s).toBe("grounded");
    }
  });

  it("el idioma de la frase ya no sale portugués", () => {
    expect(detectTextLang("Tome 5 ml dos veces al día.")).not.toBe("pt");
  });

  it("el portugués con «dos» sigue saliendo portugués, y la copia portuguesa sigue cayendo ante la pregunta española", () => {
    expect(detectTextLang("A dose dos comprimidos é de 2 por dia, depois das refeições.")).toBe("pt");
    const r = verifyGroundedAnswer(
      "Tome 5 ml do xarope duas vezes ao dia, depois das refeições.",
      [chunk("Tome 5 ml do xarope duas vezes ao dia, depois das refeições.", "Xarope")],
      "es",
      "¿Cuánto jarabe le doy?",
      REF,
    );
    expect(served(r, "Tome 5 ml do xarope duas vezes ao dia, depois das refeições.")).toBe(false);
  });
});
