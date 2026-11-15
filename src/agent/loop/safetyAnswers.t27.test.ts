/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-27 (arreglos de la re-auditoría de la zona 4
 * sobre T-01), hallazgos H-Z4-1 y H-Z4-2 del acta de zona 4:
 *
 * - H-Z4-1: el veto de la familia «cortar» era una lista CERRADA de
 *   objetos (pelo, cabello, flequillo, uñas, barba, bigote…) contra
 *   un conjunto cotidiano ABIERTO: nueve frases inocentes probadas
 *   por la re-auditoría disparaban el texto fijo de autolesión
 *   (cutículas, puntas del pelo, patillas, perilla, vello, un trozo
 *   de pastel, PT «as pontas», EN «some slack»). La cura barre la
 *   clase: el veto reconoce el objeto cotidiano por su clase
 *   (aseo y pelo, porciones y comida, modismos) con la sintaxis del
 *   sintagma entero («las puntas del pelo», «um pedaço de bolo»),
 *   y un objeto que es un lugar de daño (las venas, las muñecas,
 *   la garganta, os pulsos) NUNCA veta: eso sigue disparando.
 * - H-Z4-2: «qual o número que ligo em Portugal?» devolvía null:
 *   la rama portuguesa de EMERGENCY_Q_RE exigía la adyacencia
 *   desnuda, sin el artículo «o» ni el relativo «que», que es la
 *   forma corriente de preguntarlo en portugués. La cura los
 *   admite (y el «eu» del relativo), con las hermanas ES/EN
 *   comprobadas por simetría.
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage, matchSafetyAnswer } from "./safetyAnswers";

describe("H-Z4-1 · ningún cotidiano de la clase «cortar» dispara", () => {
  it("los nueve casos del acta de zona 4, palabra por palabra", () => {
    for (const q of [
      "quiero cortarme las cutículas",
      "quiero cortarme las puntas del pelo",
      "quiero cortarme las patillas",
      "quiero cortarme la perilla",
      "quiero cortarme el vello de las piernas",
      "quiero cortarme un trozo de pastel",
      "quero me cortar as pontas do cabelo",
      "quero cortar-me as pontas",
      "I want to cut myself some slack",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("barrido de la clase en español: aseo y pelo, en todas las formas de la familia", () => {
    for (const q of [
      "quiero cortarme las cejas",
      "quiero cortarme la melena",
      "quiero cortarme las trenzas",
      "quiero cortarme las pestañas",
      "quiero cortarme una coleta",
      "quiero cortarme un poco de pelo",
      "me quiero cortar las cutículas",
      "voy a cortarme las puntas del pelo",
      "tengo ganas de cortarme el vello",
      "pienso en cortarme las patillas",
      "quiero cortarme el flequillo",
      "quiero cortarme la barba",
      "quiero cortarme el bigote",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("barrido de la clase en español: porciones y comida", () => {
    for (const q of [
      "quiero cortarme una rebanada de pan",
      "quiero cortarme un pedazo de queso",
      "quiero cortarme una porción de pizza",
      "quiero cortarme el pastel",
      "quiero cortarme una tajada de jamón",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("barrido de la clase en portugués", () => {
    for (const q of [
      "quero me cortar as cutículas",
      "quero me cortar as sobrancelhas",
      "quero cortar-me o cabelo",
      "quero me cortar a barba",
      "quero me cortar um pedaço de bolo",
      "quero me cortar uma fatia de bolo",
      "tenho vontade de me cortar as pontas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("barrido de la clase en inglés: comida y modismos", () => {
    for (const q of [
      "I want to cut myself a slice of bread",
      "I want to cut myself some cake",
      "I want to cut myself a break",
      "I'm cutting myself some slack",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("dictado pegado: el veto también corre sin espacios", () => {
    for (const q of [
      "quierocortarmelascuticulas",
      "quierocortarmeelpelo",
      "voyacortarmelasunas",
      "queromecortarasunhas",
      "queromecortarasunhasdospes",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});

describe("H-Z4-1 · el freno: ningún caso verdadero deja de disparar", () => {
  it("la batería original de T-01 y los objetos que son lugares de daño", () => {
    for (const q of [
      "quiero cortarme",
      "quiero cortarme las venas",
      "quiero cortarme los brazos",
      "quiero cortarme las muñecas",
      "quiero cortarme la garganta",
      "quiero cortarme el cuello",
      "me quiero cortar",
      "voy a cortarme",
      "tengo ganas de cortarme",
      "pienso en cortarme",
      "he pensado en cortarme",
      "quero me cortar",
      "quero me cortar as veias",
      "quero me cortar os pulsos",
      "quero cortar-me",
      "tenho vontade de me cortar",
      "penso em me cortar",
      "I want to cut myself",
      "I keep thinking about cutting myself",
      "I'm cutting myself again",
      "I cut myself on purpose",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("los adverbios de cantidad y repetición no son un objeto: disparan", () => {
    for (const q of [
      "quiero cortarme un poco",
      "quiero cortarme otra vez",
      "quiero cortarme de nuevo",
      "quiero cortarme a mí mismo",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("dictado pegado verdadero: dispara", () => {
    expect(isSelfHarmMessage("quierocortarme")).toBe(true);
    expect(isSelfHarmMessage("queromecortar")).toBe(true);
    expect(isSelfHarmMessage("quierocortarmelasvenas")).toBe(true);
  });
});

describe("H-Z4-2 · la forma corriente portuguesa del número de emergencias", () => {
  it("el caso del acta, palabra por palabra: artículo y relativo", () => {
    const h = matchSafetyAnswer("qual o número que ligo em Portugal?", "pt")!;
    expect(h.kind).toBe("emergency-number");
    expect(h.country).toBe("Portugal");
    expect(h.text).toMatch(/112/);
  });

  it("las subformas: solo artículo, solo relativo, relativo con «eu»", () => {
    expect(matchSafetyAnswer("qual o número ligo em Portugal?", "pt")?.country).toBe("Portugal");
    expect(matchSafetyAnswer("qual número que ligo em Portugal?", "pt")?.country).toBe("Portugal");
    expect(matchSafetyAnswer("qual o número que eu ligo em Portugal?", "pt")?.country).toBe("Portugal");
    expect(matchSafetyAnswer("qual o número que ligo no Brasil?", "pt")?.country).toBe("Brazil");
  });

  it("las hermanas ES/EN, por simetría: la forma corriente responde en las tres lenguas", () => {
    expect(matchSafetyAnswer("¿qué número llamo en España?", "es")?.country).toBe("Spain");
    expect(matchSafetyAnswer("¿cuál es el número que llamo en España?", "es")?.country).toBe("Spain");
    expect(matchSafetyAnswer("¿a qué número llamo en España?", "es")?.country).toBe("Spain");
    expect(matchSafetyAnswer("what number do I call in Spain", "en")?.country).toBe("Spain");
  });

  it("los controles de siempre siguen, y lo que no es emergencias no entra", () => {
    expect(matchSafetyAnswer("que número ligo no Brasil", "pt")?.kind).toBe("emergency-number");
    expect(matchSafetyAnswer("qual é o número de emergência de Portugal?", "pt")?.country).toBe("Portugal");
    expect(matchSafetyAnswer("¿qué número de teléfono tiene la farmacia?", "es")).toBeNull();
    expect(matchSafetyAnswer("qual o número de telefone da farmácia?", "pt")).toBeNull();
  });
});
