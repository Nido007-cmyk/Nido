/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Barrido sellado de la 0.1.96, clase 2 (el juez atacado con pares
 * adversarios), paquete NIDO-ARREGLOS-BARRIDO-0196, candidato 4a99c5a7.
 * Cada bloque lleva el ID del hallazgo y sus frases-sonda exactas; la
 * casa repite esas sondas sobre el candidato corregido.
 */
import { describe, expect, it } from "vitest";
import { parseDateMentions } from "./dates";
import { isAbstention, isPureAbstention, verifyGroundedAnswer, type GroundingChunk } from "./grounding";

const chunk = (body: string, title = "Fuente"): GroundingChunk => ({ title, body });

// ------------------------------------------------------------ C2-H1

const SYRUP_ES = chunk("Jarabe para la tos. La dosis recomendada es de 10 ml cada ocho horas. Agita el frasco antes de usarlo.", "Jarabe");
const SYRUP_EN = chunk("Cough syrup. The recommended dose is 10 ml every eight hours. Shake the bottle before use.", "Syrup");
const SYRUP_PT = chunk("Xarope para tosse. A dose recomendada é de 10 ml a cada oito horas. Agite o frasco antes de usar.", "Xarope");

describe("C2-H1: la abstención no sirve de contrabando (es/en/pt)", () => {
  it("las sondas del barrido: el dato inventado tras «no lo sé, pero…» ya no se sirve", () => {
    const cases: Array<[string, GroundingChunk, "es" | "en" | "pt", string]> = [
      ["Agita el frasco antes de usarlo. No lo sé, pero la dosis recomendada es de 25 ml.", SYRUP_ES, "es", "¿Cuánto jarabe le doy?"],
      ["Shake the bottle before use. I don't know, but the recommended dose is 25 ml.", SYRUP_EN, "en", "How much syrup do I give?"],
      ["Agite o frasco antes de usar. Não sei, mas a dose recomendada é de 25 ml.", SYRUP_PT, "pt", "Quanto xarope eu dou?"],
    ];
    for (const [answer, src, lang, q] of cases) {
      const r = verifyGroundedAnswer(answer, [src], lang, q);
      expect(r.text, answer).not.toContain("25 ml");
      expect(r.status, answer).not.toBe("grounded");
      expect(r.sentences?.some((p) => p.origin.kind === "abstain" && /25 ml/.test(p.text)), answer).toBe(false);
    }
  });

  it("también en la rama cruzada de idioma (respuesta en otro idioma que las fuentes)", () => {
    const r = verifyGroundedAnswer("Shake the bottle before use. I don't know, but the recommended dose is 25 ml.", [SYRUP_ES], "es", "¿Cuánto jarabe le doy?");
    expect(r.text).not.toContain("25 ml");
    expect(r.sentences?.some((p) => p.origin.kind === "abstain" && /25 ml/.test(p.text))).toBe(false);
  });

  it("y sin fuentes: la procedencia no la etiqueta como abstención", () => {
    const r = verifyGroundedAnswer("No lo sé, pero la dosis recomendada es de 25 ml.", [], "es", "¿Cuánto jarabe?");
    expect(r.sentences?.[0].origin.kind).toBe("model");
  });

  it("la abstención pura sigue conservándose como hasta ahora", () => {
    for (const [answer, src, lang] of [
      ["Agita el frasco antes de usarlo. No lo sé.", SYRUP_ES, "es"],
      ["Shake the bottle before use. I don't know.", SYRUP_EN, "en"],
      ["Agite o frasco antes de usar. Não sei.", SYRUP_PT, "pt"],
    ] as const) {
      const r = verifyGroundedAnswer(answer, [src], lang, "?");
      expect(r.sentences?.some((p) => p.origin.kind === "abstain"), answer).toBe(true);
    }
  });

  it("un «no lo sé, pero» con el dato fiel se juzga por el dato y pasa", () => {
    const r = verifyGroundedAnswer("No lo sé con certeza, pero la dosis recomendada es de 10 ml cada ocho horas.", [SYRUP_ES], "es", "¿Cuánto jarabe le doy?");
    expect(r.text).toContain("10 ml");
    expect(r.status).not.toBe("abstained");
  });

  it("isPureAbstention: abstención sin afirmación sí; con contraste o cópula con cifra, no", () => {
    for (const s of [
      "No lo sé.",
      "No tengo información sobre la dosis para menores de 2 años.",
      "No sé cuál es la dosis para 2 años.",
      "I don't know.",
      "The sources don't mention the dose for children under 2.",
      "Não sei qual é a dose.",
      "As fontes não falam disso.",
    ]) {
      expect(isAbstention(s), s).toBe(true);
      expect(isPureAbstention(s), s).toBe(true);
    }
    for (const s of [
      "No lo sé, pero la dosis recomendada es de 25 ml.",
      "I don't know, but the recommended dose is 25 ml.",
      "Não sei, mas a dose recomendada é de 25 ml.",
      "La dosis es de 25 ml, aunque no lo sé seguro.",
      "I don't know for sure; the dose is 25 ml.",
    ]) {
      expect(isAbstention(s), s).toBe(true);
      expect(isPureAbstention(s), s).toBe(false);
    }
  });
});

// ------------------------------------------------------------ C2-H2

const CLINIC_ES = chunk("Citas y teléfonos. El teléfono de la clínica es el 520-555-0147. Para emergencias, llama al 911.", "Clínica");
const CLINIC_EN = chunk("Appointments and phones. The clinic's phone number is 520-555-0147. For emergencies, call 911.", "Clinic");
const CLINIC_PT = chunk("Consultas e telefones. O telefone da clínica é 520-555-0147. Em emergências, ligue para 190.", "Clínica");

describe("C2-H2: el dato tipado se juzga también por su dueño (es/en, y pt por paridad)", () => {
  it("la sonda del barrido: el teléfono de la clínica no se sella como el de emergencias", () => {
    // Ya no sale la afirmación falsa. La fuente da a «emergencias» su
    // propio número: esa frase, literal y citada, ocupa su lugar.
    for (const [answer, src, lang, q, own] of [
      ["El teléfono de emergencias es el 520-555-0147.", CLINIC_ES, "es", "¿Cuál es el teléfono de emergencias?", "911"],
      ["The emergency phone number is 520-555-0147.", CLINIC_EN, "en", "What is the emergency phone number?", "911"],
      ["O telefone de emergência é 520-555-0147.", CLINIC_PT, "pt", "Qual é o telefone de emergência?", "190"],
    ] as const) {
      const r = verifyGroundedAnswer(answer, [src], lang, q);
      expect(r.text, answer).not.toContain(answer.replace(/\.$/, ""));
      expect(r.text, answer).not.toContain("520-555-0147");
      expect(r.text, answer).toContain(own);
      expect(r.sentences?.every((p) => p.origin.kind !== "model"), answer).toBe(true);
    }
  });

  it("el dueño correcto sigue fundado", () => {
    expect(verifyGroundedAnswer("El teléfono de la clínica es el 520-555-0147.", [CLINIC_ES], "es", "¿Cuál es el teléfono de la clínica?").status).toBe("grounded");
    expect(verifyGroundedAnswer("The clinic's phone number is 520-555-0147.", [CLINIC_EN], "en", "What is the clinic's phone number?").status).toBe("grounded");
    expect(verifyGroundedAnswer("O telefone da clínica é 520-555-0147.", [CLINIC_PT], "pt", "Qual é o telefone da clínica?").status).toBe("grounded");
  });

  it("si la fuente no dice de quién es el número, todo sigue como antes", () => {
    const src = chunk("Para pedir cita, llama al 520-555-0147 de lunes a viernes.", "Citas");
    expect(verifyGroundedAnswer("El teléfono para pedir cita es el 520-555-0147.", [src], "es", "¿Cuál es el teléfono para pedir cita?").status).toBe("grounded");
  });
});

// ------------------------------------------------------------ C2-H3

const ROOM_ES = chunk("Tu consulta es el martes. La consulta es en la sala 4 del segundo piso.", "Cita");
const ROOM_EN = chunk("Your appointment is on Tuesday. The appointment is in room 4 on the second floor.", "Appointment");
const ROOM_PT = chunk("Sua consulta é na terça. A consulta é na sala 4 do segundo andar.", "Consulta");

describe("C2-H3: el dato tipado de un dígito se juzga (es/en/pt)", () => {
  it("las sondas del barrido: «sala 9» contra «sala 4» ya no se sella", () => {
    for (const [answer, src, lang, q] of [
      ["La consulta es en la sala 9.", ROOM_ES, "es", "¿En qué sala es la consulta?"],
      ["The appointment is in room 9.", ROOM_EN, "en", "What room is the appointment in?"],
      ["A consulta é na sala 9.", ROOM_PT, "pt", "Em qual sala é a consulta?"],
    ] as const) {
      const r = verifyGroundedAnswer(answer, [src], lang, q);
      expect(r.text, answer).not.toMatch(/(sala|room) 9/);
      expect(r.status, answer).not.toBe("unverified");
    }
  });

  it("la variante de dos dígitos («sala 44») sigue bloqueada", () => {
    expect(verifyGroundedAnswer("La consulta es en la sala 44.", [ROOM_ES], "es", "¿En qué sala es la consulta?").text).not.toMatch(/sala 44/);
  });

  it("el dato fiel de un dígito sigue fundado, en los tres idiomas", () => {
    expect(verifyGroundedAnswer("La consulta es en la sala 4.", [ROOM_ES], "es", "¿En qué sala es la consulta?").status).toBe("grounded");
    expect(verifyGroundedAnswer("The appointment is in room 4.", [ROOM_EN], "en", "What room is the appointment in?").status).toBe("grounded");
    expect(verifyGroundedAnswer("A consulta é na sala 4.", [ROOM_PT], "pt", "Em qual sala é a consulta?").status).toBe("grounded");
  });

  it("otro tipo de un dígito: el día «9» contra «4» (es/en/pt)", () => {
    for (const [answer, body, lang, q] of [
      ["La cita es el día 9.", "La cita es el día 4 de diciembre, en la sala 12.", "es", "¿Qué día es la cita?"],
      ["The appointment is on day 9.", "The appointment is on day 4 of December, in room 12.", "en", "What day is the appointment?"],
      ["A consulta é no dia 9.", "A consulta é no dia 4 de dezembro, na sala 12.", "pt", "Que dia é a consulta?"],
    ] as const) {
      const r = verifyGroundedAnswer(answer, [chunk(body, "Cita")], lang, q);
      expect(r.text, answer).not.toMatch(/(dia|día|day) 9/);
    }
  });

  describe("la doctrina de la exención queda intacta fuera de la afirmación tipada", () => {
    it("(a) prosa sin dato tipado: el dígito suelto no juzga («repite el paso 3»)", () => {
      const src = chunk("Aplica presión firme durante 10 minutos. Si sigue sangrando, repite el paso 2 con una gasa limpia.", "Heridas");
      const r = verifyGroundedAnswer("Si sigue sangrando, repite el paso 3 con una gasa limpia.", [src], "es", "¿Qué hago si sigue sangrando?");
      expect(r.status).toBe("grounded");
    });

    it("(b) la cifra juzgable manda como siempre: la frase con dígito único y cifra de dos dígitos no cambia de vara", () => {
      const src = chunk("La consulta es en la sala 4, a las 10:30.", "Cita");
      expect(verifyGroundedAnswer("La consulta es en la sala 4, a las 10:30.", [src], "es", "¿Dónde y a qué hora es la consulta?").status).toBe("grounded");
    });

    it("(c) la dosis tipada de un dígito (A3-03) sigue juzgándose igual", () => {
      expect(verifyGroundedAnswer("La dosis es de 9 ml.", [chunk("Tome 5 ml cada ocho horas.")], "es", "¿Cuál es la dosis?").status).toBe("abstained");
      expect(verifyGroundedAnswer("La dosis es de 5 ml.", [chunk("La dosis es de 5 ml cada ocho horas.")], "es", "¿Cuál es la dosis?").status).toBe("grounded");
    });

    it("(d) el teléfono corto fiel («Es el 112») no cambia", () => {
      const src = chunk("Llama al 112 en caso de emergencia.", "Emergencias");
      expect(verifyGroundedAnswer("El teléfono es el 112.", [src], "es", "¿Cuál es el teléfono de emergencias?").status).toBe("grounded");
    });
  });
});

// ------------------------------------------------------------ C2-H4 / C2-H5
// Copia literal de las fixtures reales DOC_ES/DOC_EN/DOC_PT de grounding.test.ts.

const DOC_ES =
  "Su cita es el martes 10 de noviembre de 2026 a las 9:30 de la mañana, en la sala 214, segundo piso. " +
  "Traiga su tarjeta y la lista de medicamentos. " +
  "Tome el jarabe de 5 ml dos veces al día, después de comer. " +
  "Para cambiar la cita llame al 520-555-0147.";
const DOC_EN =
  "Your appointment is on Tuesday, November 10, 2026 at 9:30 in the morning, in room 214, second floor. " +
  "Bring your card and your medication list. " +
  "Take 5 ml of the syrup twice a day, after meals. " +
  "To change the appointment call 520-555-0147.";
const DOC_PT =
  "A sua consulta é na terça-feira, 10 de novembro de 2026 às 9:30 da manhã, na sala 214, segundo andar. " +
  "Traga o seu cartão e a lista de medicamentos. " +
  "Tome 5 ml do xarope duas vezes ao dia, depois das refeições. " +
  "Para mudar a consulta ligue para 520-555-0147.";

describe("C2-H4: la frase fiel del teléfono en inglés ya no se retira", () => {
  it("la sonda del barrido se sirve fundada, como sus gemelas es/pt", () => {
    for (const [answer, body, lang, q] of [
      ["The phone number to change the appointment is 520-555-0147.", DOC_EN, "en", "What is the phone number to change the appointment?"],
      ["El teléfono para cambiar la cita es el 520-555-0147.", DOC_ES, "es", "¿Cuál es el teléfono para cambiar la cita?"],
      ["O telefone para mudar a consulta é 520-555-0147.", DOC_PT, "pt", "Qual é o telefone para mudar a consulta?"],
    ] as const) {
      const r = verifyGroundedAnswer(answer, [chunk(body, "doc")], lang, q);
      expect(r.status, answer).toBe("grounded");
      expect(r.text, answer).toContain("520-555-0147");
    }
  });

  it("la vara no baja: el número inventado sigue fuera", () => {
    const r = verifyGroundedAnswer("The phone number to change the appointment is 520-555-0199.", [chunk(DOC_EN, "doc")], "en", "What is the phone number to change the appointment?");
    expect(r.text).not.toContain("520-555-0199");
  });

  it("la vara no baja: la frase con dos términos ajenos de verdad sigue retirada", () => {
    // 4 de 6 raíces: «pharmacy» y «weekends» no están en la fuente.
    const r = verifyGroundedAnswer("The pharmacy phone number on weekends is 520-555-0147.", [chunk(DOC_EN, "doc")], "en", "What is the pharmacy phone number?");
    expect(r.status).not.toBe("grounded");
  });
});

describe("C2-H5: «de/por la mañana» no es la fecha relativa «mañana»", () => {
  it("la sonda del barrido: la frase fiel de la cita (DOC_ES) se sirve fundada, como en/pt", () => {
    for (const [answer, body, lang, q] of [
      ["Su cita es el martes 10 de noviembre de 2026 a las 9:30 de la mañana, en la sala 214, segundo piso.", DOC_ES, "es", "¿Cuándo es mi cita?"],
      ["Your appointment is on Tuesday, November 10, 2026 at 9:30 in the morning, in room 214, second floor.", DOC_EN, "en", "When is my appointment?"],
      ["A sua consulta é na terça-feira, 10 de novembro de 2026 às 9:30 da manhã, na sala 214, segundo andar.", DOC_PT, "pt", "Quando é a minha consulta?"],
    ] as const) {
      expect(verifyGroundedAnswer(answer, [chunk(body, "doc")], lang, q).status, answer).toBe("grounded");
    }
  });

  it("«por la mañana» con fecha de calendario tampoco choca", () => {
    const src = chunk("La vacuna es el 12 de diciembre de 2026 por la mañana, en el centro de salud.", "Vacuna");
    expect(verifyGroundedAnswer("La vacuna es el 12 de diciembre de 2026 por la mañana, en el centro de salud.", [src], "es", "¿Cuándo es la vacuna?").status).toBe("grounded");
  });

  it("el parser: el sustantivo no crea relativa; el adverbio sí, como antes", () => {
    const ref = new Date(2026, 10, 9);
    const rel = (t: string) => parseDateMentions(t, ref).filter((m) => m.kind === "relativa").length;
    expect(rel("a las 9:30 de la mañana")).toBe(0);
    expect(rel("por la mañana")).toBe(0);
    expect(rel("en las mañanas")).toBe(0);
    expect(rel("mañana a las 9")).toBe(1);
    expect(rel("mañana por la mañana")).toBe(1);
    expect(rel("amanhã de manhã")).toBe(1);
    expect(rel("tomorrow morning")).toBe(1);
  });
});
