/**
 * Tanda T-04 de la 0.1.99 — juez: negación y polaridad.
 * Regresión de las sondas del acta del carril 02 de la auditoría
 * (H-01/H-02/H-06/H-12 → asientos M-01/M-02/M-06/P-06 del acta
 * consolidada), con sus gemelas trilingües y los controles fieles que
 * no deben caer (el freno del dueño: ninguna estrechez nueva puede
 * cortar una respuesta fiel).
 */
import { describe, expect, it } from "vitest";
import {
  verifyGroundedAnswer,
  isPureAbstention,
  type GroundingChunk,
} from "./grounding";

const REF = new Date(2026, 10, 14); // 14 de noviembre de 2026, como las sondas
const J = (answer: string, chunks: GroundingChunk[], lang: "es" | "en" | "pt", query = "") =>
  verifyGroundedAnswer(answer, chunks, lang, query, REF);

const JARABE: GroundingChunk[] = [
  { title: "Jarabe para la tos", body: "Tome 5 ml dos veces al día. No dupliques la dosis. Si la tos sigue, consulta al médico." },
];

const RCP: GroundingChunk[] = [
  {
    title: "RCP (reanimación) en adultos y niños mayores",
    body:
      "Tumba a la persona boca arriba sobre una superficie dura (el suelo). Pon el talón de una mano en el centro del pecho y la otra mano encima. " +
      "Empuja hacia abajo con el peso del cuerpo. Profundidad: unos 5 cm (no más de 6 cm) en adultos. Ritmo: 100 a 120 por minuto. " +
      "Deja que el pecho suba del todo entre compresión y compresión, sin despegar las manos. Interrumpe lo menos posible. " +
      "Si estás entrenado y dispuesto: 30 compresiones y 2 respiraciones, y repite. Para respirar: inclina la cabeza hacia atrás y eleva el mentón, tapa la nariz, sella tu boca sobre la suya y sopla 1 segundo hasta ver que el pecho sube. " +
      "Si no sabes o no quieres, haz solo compresiones sin parar: en adultos funciona bien.",
  },
];

const RCP_PT: GroundingChunk[] = [
  {
    title: "RCP em adultos",
    body:
      "Para respirar: inclina a cabeça para trás, tapa o nariz e sopra 1 segundo até ver o peito subir. " +
      "Se não sabes ou não queres, faz só compressões sem parar: em adultos funciona bem.",
  },
];

const RCP_EN: GroundingChunk[] = [
  {
    title: "CPR in adults",
    body:
      "To breathe: tilt the head back, pinch the nose and blow for 1 second until you see the chest rise. " +
      "If you don't know how or don't want to, do only compressions without stopping: in adults it works well.",
  },
];

describe("M-01 · la abstención con afirmación sin cópula, sin cifra y sin contraste (H-01)", () => {
  it("P-02 pt: «Não sei, a dose dobra em crianças» ya no se sirve", () => {
    const r = J("Não sei, a dose dobra em crianças.", JARABE, "pt", "Como se toma o xarope?");
    expect(r.text).not.toContain("dobra em crianças");
  });
  it("P-01 es: la gemela muere también con otra frase fiel delante (no por colapso)", () => {
    const r = J("Tome 5 ml dos veces al día. No lo sé, la dosis se duplica en niños.", JARABE, "es", "¿Cómo se toma el jarabe?");
    expect(r.text).toContain("Tome 5 ml dos veces al día");
    expect(r.text).not.toContain("se duplica en niños");
  });
  it("en cruzado: «I don't know, the dose doubles in children» tampoco se sirve", () => {
    const r = J("I don't know, the dose doubles in children.", JARABE, "en", "How do I take the syrup?");
    expect(r.text).not.toContain("doubles in children");
  });
  it("control fiel: la abstención con el dato fiel anclado tras «mas» se conserva (pt, rama cruzada)", () => {
    const r = J("Não sei, mas são 5 ml duas vezes ao dia.", JARABE, "pt", "Como se toma o xarope?");
    expect(r.text).toContain("5 ml");
  });
  it("isPureAbstention: la cláusula declarativa tras la coma ya no es pura; lo demás no cambia", () => {
    for (const s of [
      "Não sei, a dose dobra em crianças.",
      "No lo sé, la dosis se duplica en niños.",
      "I don't know, the dose doubles in children.",
    ]) {
      expect(isPureAbstention(s), s).toBe(false);
    }
    for (const s of [
      "No lo sé.",
      "Não sei qual é a dose.",
      "As fontes não falam disso.",
      "No tengo información sobre la dosis para menores de 2 años.",
      "The sources don't mention the dose for children under 2.",
      "No sé si la dosis se duplica en niños.",
      "Não sei, sobre a dose para crianças.",
    ]) {
      expect(isPureAbstention(s), s).toBe(true);
    }
  });
});

describe("M-06 · la volcada de una raíz (H-06)", () => {
  const MANGUERA: GroundingChunk[] = [{ title: "Manguera", body: "Purgue el aire de la manguera antes de usarla." }];
  it("P-12 es: «No lo purgue.» ya no se sella grounded", () => {
    const r = J("No lo purgue.", MANGUERA, "es", "¿Cómo preparo la manguera?");
    expect(r.status).not.toBe("grounded");
    expect(r.text).not.toContain("No lo purgue.");
  });
  it("pt: «Não o purgue.» tampoco se sella", () => {
    const src: GroundingChunk[] = [{ title: "Mangueira", body: "Purgue o ar da mangueira antes de usá-la." }];
    const r = J("Não o purgue.", src, "pt", "Como preparo a mangueira?");
    expect(r.status).not.toBe("grounded");
    expect(r.text).not.toContain("Não o purgue.");
  });
  it("control fiel: la guía que ya niega protege su copia corta", () => {
    const src: GroundingChunk[] = [{ title: "Manguera", body: "No purgue el aire con las manos mojadas. Seque la manguera antes de usarla." }];
    const r = J("No lo purgue.", src, "es", "¿Cómo preparo la manguera?");
    expect(r.text).toContain("No lo purgue.");
  });
  it("control fiel: si otra frase de la guía niega la misma raíz, el referente ambiguo protege", () => {
    const src: GroundingChunk[] = [{ title: "Manguera", body: "Purgue el aire de la manguera antes de usarla. No purgue el depósito sin guantes." }];
    const r = J("No lo purgue.", src, "es", "¿Cómo preparo la manguera?");
    expect(r.text).toContain("No lo purgue.");
  });
});

describe("M-02 · la RCP recombinada por la vía del modelo (H-02)", () => {
  it("P-16a control: el ritmo inventado sigue cortado", () => {
    const r = J("El ritmo correcto es de 60 compresiones por minuto.", RCP, "es", "¿Cómo hago la RCP a un adulto?");
    expect(r.text).not.toContain("60 compresiones");
  });
  it("P-16b es: «sin hacer compresiones» se opera y cae; lo fiel queda", () => {
    const r = J("Sopla 1 segundo hasta ver que el pecho suba, sin hacer compresiones.", RCP, "es", "¿Cómo hago la RCP a un adulto?");
    expect(r.text).not.toContain("sin hacer compresiones");
    expect(r.text).toContain("Sopla 1 segundo hasta ver que el pecho suba");
  });
  it("P-16c es: el objeto del «solo» trasplantado cae", () => {
    const r = J("Haz solo respiraciones sin parar: en adultos funciona bien.", RCP, "es", "¿Cómo hago la RCP a un adulto?");
    expect(r.text).not.toContain("solo respiraciones");
  });
  it("pt: «sem fazer compressões» cae igual", () => {
    const r = J("Sopra 1 segundo até ver o peito subir, sem fazer compressões.", RCP_PT, "pt", "Como faço a RCP a um adulto?");
    expect(r.text).not.toContain("sem fazer compressões");
    expect(r.text).toContain("Sopra 1 segundo até ver o peito subir");
  });
  it("en: «without doing compressions» cae igual", () => {
    const r = J("Blow for 1 second until you see the chest rise, without doing compressions.", RCP_EN, "en", "How do I do CPR on an adult?");
    expect(r.text).not.toContain("without doing compressions");
    expect(r.text).toContain("Blow for 1 second until you see the chest rise");
  });
  it("control fiel: la frase de la guía copiada tal cual, con su «solo» y su «sin parar», se sirve entera", () => {
    const r = J("Si no sabes o no quieres, haz solo compresiones sin parar: en adultos funciona bien.", RCP, "es", "¿Cómo hago la RCP a un adulto?");
    expect(r.text).toContain("haz solo compresiones sin parar");
  });
  it("control fiel: el «sin» de acompañamiento copiado de la guía no se toca", () => {
    const r = J("Deja que el pecho suba del todo entre compresión y compresión, sin despegar las manos.", RCP, "es", "¿Cómo hago la RCP a un adulto?");
    expect(r.text).toContain("sin despegar las manos");
  });
});

describe("P-06 · el condicional caído (H-12): ruta segura encontrada, sustitución verbatim", () => {
  const FIEBRE: GroundingChunk[] = [{ title: "Fiebre", body: "Si la fiebre pasa de 39 grados, busca atención médica." }];
  it("P-24 es: la copia sin el «si» se sustituye por la frase de la guía, con su «si»", () => {
    const r = J("La fiebre pasa de 39 grados, busca atención médica.", FIEBRE, "es", "¿Qué hago si la fiebre pasa de 39 grados?");
    expect(r.text).toContain("Si la fiebre pasa de 39 grados, busca atención médica");
    expect(r.status).toBe("grounded");
  });
  it("control fiel: la copia con el «si» se sirve tal cual, sin sustituir", () => {
    const r = J("Si la fiebre pasa de 39 grados, busca atención médica.", FIEBRE, "es", "¿Qué hago si la fiebre pasa de 39 grados?");
    expect(r.text).toContain("Si la fiebre pasa de 39 grados, busca atención médica");
    expect(r.sentences?.some((p) => p.origin.kind === "source" && "negationFixed" in p.origin && p.origin.negationFixed)).toBe(false);
  });
  it("frontera fijada: en pt la copia no alcanza la vara del 85 % (passar/atendimento) y el condicional sigue sin verse", () => {
    const src: GroundingChunk[] = [{ title: "Febre", body: "Se a febre passar de 39 graus, procure atendimento médico." }];
    const r = J("A febre passa de 39 graus, procure atendimento médico.", src, "pt", "O que faço se a febre passar de 39 graus?");
    // Comportamiento observado tras T-04: la ruta del condicional
    // exige la copia demostrada a la vara de closestSourceSentence;
    // la gemela portuguesa cae por raíces («passa» ≠ «passar»,
    // «atende» ≠ «atendimento») y queda fuera, como límite fijado.
    expect(r.text).toContain("A febre passa de 39 graus");
  });
});
