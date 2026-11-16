/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Regresión del defecto cazado en dispositivo por el dueño
 * (Tab A9+, 0.1.104, 2026-11-15 22:23 MST): a «Que hago si un niño se
 * esta atragantando» la respuesta servida se fundamentó en la fuente
 * [2] («Si un niño se está atragantando, llama al número de
 * emergencias inmediatamente [2]», pie «1 de las fuentes») pero la
 * tarjeta «Fuente principal» enseñó la [1], la guía de la crecida que
 * la recuperación había rankeado primera, y «Leer la guía entera»
 * abría esa guía equivocada en plena emergencia.
 *
 * La tarjeta tiene que enseñar LA fuente en la que la respuesta
 * servida se basa — la que la procedencia del turno nombra —, no la
 * de mayor rango de la recuperación.
 */

import { describe, expect, it } from "vitest";
import { buildEvidenceCard, servedSourceIndex } from "./evidenceCard";
import { isPureRefusal, verifyGroundedAnswer } from "./grounding";
import { summarizeProvenance } from "./provenance";
import type { RetrievedChunk } from "./retrieve";

const QUERY = "Que hago si un niño se esta atragantando";

const FLOOD_BODY =
  "Si el coche queda atrapado en agua que se mueve rápido, quédate dentro del coche. " +
  "Si el agua sube dentro del coche, sube al techo y pide ayuda desde allí. " +
  "No intentes cruzar a pie una corriente que te llega a las rodillas: te puede derribar y arrastrar.";

const CHOKING_BODY =
  "Si un niño se está atragantando, llama al número de emergencias inmediatamente. " +
  "Dale cinco golpes firmes en la espalda, entre los omóplatos, con el talón de la mano. " +
  "Si el objeto no sale, haz compresiones abdominales y repite la serie hasta que respire.";

function chunk(chunkId: string, title: string, body: string, score: number): RetrievedChunk {
  return { chunkId, docId: chunkId, title, body, score } as RetrievedChunk;
}

/** La recuperación de la foto: la crecida rankea primera; el atragantamiento, segundo. */
function photoChunks(): RetrievedChunk[] {
  return [
    chunk("pack:nido-esencial:crecida", "Atrapado en una crecida — Si el agua te atrapa en el coche", FLOOD_BODY, 0.91),
    chunk("pack:nido-esencial:atragantamiento", "Atragantamiento en niños — Qué hacer", CHOKING_BODY, 0.87),
  ];
}

describe("fuente principal: el escenario exacto de la foto del dueño", () => {
  const chunks = photoChunks();
  const verified = verifyGroundedAnswer(
    "Si un niño se está atragantando, llama al número de emergencias inmediatamente.",
    chunks,
    "es",
    QUERY,
    new Date("2026-11-15T22:23:00"),
  );

  it("el juez fundamenta la frase servida en la fuente [2] y el pie cuenta esa misma frase", () => {
    expect(verified.text).toContain("[2]");
    const sourceSentences = (verified.sentences ?? []).filter((s) => s.origin.kind === "source");
    expect(sourceSentences).toHaveLength(1);
    expect(sourceSentences[0]?.origin).toMatchObject({ kind: "source", n: 2 });
    expect(summarizeProvenance(verified.sentences ?? [], "es")).toBe("1 de las fuentes");
  });

  it("la tarjeta «Fuente principal» enseña la fuente de la respuesta servida, no la de rango 1", () => {
    // Como la construye ChatScreen al cerrar el turno: con la fuente
    // que la procedencia del turno nombra.
    expect(servedSourceIndex(verified.sentences, chunks)).toBe(1);
    const card = buildEvidenceCard(chunks, QUERY, servedSourceIndex(verified.sentences, chunks));
    expect(card?.chunkId).toBe("pack:nido-esencial:atragantamiento");
    expect(card?.title).toContain("Atragantamiento");
    // Su número en la lista es el de su cita: la [2], no la [1].
    expect(card?.index).toBe(1);
  });

  it("sin procedencia que nombre fuentes, la tarjeta conserva el rango de la recuperación", () => {
    expect(servedSourceIndex(undefined, chunks)).toBeNull();
    expect(servedSourceIndex([{ text: "x", origin: { kind: "model", reason: "too-short-to-check" } }], chunks)).toBeNull();
    const card = buildEvidenceCard(chunks, QUERY, servedSourceIndex(undefined, chunks));
    expect(card?.chunkId).toBe("pack:nido-esencial:crecida");
    expect(card?.index).toBe(0);
  });
});

describe("fuente principal: respuestas de varias fuentes y abstención", () => {
  const espalda = chunk(
    "pack:nido-esencial:atragantamiento-espalda",
    "Atragantamiento en niños — Golpes en la espalda",
    "Si el niño se está atragantando, dale cinco golpes firmes en la espalda, entre los omóplatos, con el talón de la mano. " +
      "Inclina al niño hacia adelante para que el objeto pueda salir con los golpes.",
    0.9,
  );
  const llamada = chunk(
    "pack:nido-esencial:atragantamiento-llamada",
    "Atragantamiento en niños — Llamar a emergencias",
    "Si un niño se está atragantando, llama al número de emergencias inmediatamente. " +
      "No dejes solo al niño mientras llega la ayuda.",
    0.88,
  );
  const pair = [espalda, llamada];

  it("empate de fuentes: gana la primera citada en la respuesta, no el rango 1", () => {
    const verified = verifyGroundedAnswer(
      "Si un niño se está atragantando, llama al número de emergencias inmediatamente. " +
        "Dale cinco golpes firmes en la espalda, entre los omóplatos, con el talón de la mano.",
      pair,
      "es",
      QUERY,
      new Date("2026-11-15T22:23:00"),
    );
    const cited = (verified.sentences ?? []).filter((s) => s.origin.kind === "source").map((s) => (s.origin as { n: number }).n);
    expect(cited).toEqual([2, 1]);
    expect(servedSourceIndex(verified.sentences, pair)).toBe(1);
    expect(buildEvidenceCard(pair, QUERY, servedSourceIndex(verified.sentences, pair))?.index).toBe(1);
  });

  it("mayoría de fuentes: gana la que sostiene más frases servidas", () => {
    const verified = verifyGroundedAnswer(
      "Dale cinco golpes firmes en la espalda, entre los omóplatos, con el talón de la mano. " +
        "Si un niño se está atragantando, llama al número de emergencias inmediatamente. " +
        "No dejes solo al niño mientras llega la ayuda.",
      pair,
      "es",
      QUERY,
      new Date("2026-11-15T22:23:00"),
    );
    const cited = (verified.sentences ?? []).filter((s) => s.origin.kind === "source").map((s) => (s.origin as { n: number }).n);
    expect(cited).toEqual([1, 2, 2]);
    expect(servedSourceIndex(verified.sentences, pair)).toBe(1);
  });

  it("abstención: la tarjeta enseña la misma fuente cuyo extracto se sirvió", () => {
    const chunks = photoChunks();
    const verified = verifyGroundedAnswer(
      "El atragantamiento se cura dándole al niño dos cucharadas de miel tibia.",
      chunks,
      "es",
      QUERY,
      new Date("2026-11-15T22:23:00"),
    );
    expect(verified.status).toBe("abstained");
    const extract = (verified.sentences ?? []).find((s) => s.origin.kind === "source");
    expect(extract?.origin).toMatchObject({ kind: "source", n: 1, replaced: true });
    const card = buildEvidenceCard(chunks, QUERY, servedSourceIndex(verified.sentences, chunks));
    expect(card?.chunkId).toBe(chunks[0]?.chunkId);
    expect(card?.index).toBe(0);
  });
});

describe("negativa sin fuente: el escenario exacto de la foto 2 de la pasada", () => {
  // La guía sellada del pack importado (su §1, fixture leída de la
  // foto del dueño en grounding.llanta0197.test.ts) y el ruido que la
  // acompañó en la recuperación de la foto: Incendio forestal e
  // Inundación (cuerpos genéricos: su papel aquí es solo existir como
  // fuentes recuperadas que no responden a la pregunta).
  const chunks: RetrievedChunk[] = [
    chunk(
      "pack:importado:averia-1",
      "Avería en carretera — 1. Para en un sitio seguro",
      "Enciende las luces de emergencia en cuanto notes el problema. " +
        "Reduce la velocidad poco a poco y aparta el coche fuera de la calzada " +
        "siempre que puedas: arcén amplio, apartadero, área de descanso o salida " +
        "cercana. No te detengas en un carril, en una curva, en un cambio de " +
        "rasante ni en un túnel si puedes evitarlo.",
      0.9,
    ),
    chunk(
      "pack:nido-esencial:incendio-forestal",
      "Incendio forestal — Qué hacer",
      "Aléjate del fuego en dirección contraria al viento y busca una zona sin vegetación. " +
        "Llama al número de emergencias en cuanto estés a salvo.",
      0.85,
    ),
    chunk(
      "pack:nido-esencial:inundacion",
      "Inundación — Qué hacer",
      "Sube a la planta más alta y no cruces nunca agua en movimiento. " +
        "Corta la corriente eléctrica si el agua entra en casa.",
      0.83,
    ),
  ];
  const verified = verifyGroundedAnswer(
    "No puedo ayudarte con eso.",
    chunks,
    "es",
    "Como cambio la llanta de un carro",
    new Date("2026-11-15T22:28:00"),
  );

  it("el turno cae a la abstención honesta: no se sirve la negativa del modelo", () => {
    expect(verified.status).toBe("abstained");
    expect(verified.text).not.toContain("No puedo ayudarte con eso");
    expect(summarizeProvenance(verified.sentences ?? [], "es")).not.toContain("del modelo sin fuente");
  });

  it("lo servido es el extracto literal de la fuente principal, citado a la [1]", () => {
    expect(verified.text).toContain("Enciende las luces de emergencia");
    expect(verified.text).toContain("[1]");
    const extract = (verified.sentences ?? []).find((s) => s.origin.kind === "source");
    expect(extract?.origin).toMatchObject({ kind: "source", n: 1, replaced: true });
  });

  it("la negativa que además afirma un dato no es pura: se juzga por lo que afirma", () => {
    const mixed = verifyGroundedAnswer(
      "No puedo ayudarte, pero la dosis es 9 ml.",
      [
        chunk(
          "pack:nido-esencial:jarabe",
          "Jarabe — Dosis",
          "Tome el jarabe de 5 ml dos veces al día, después de comer.",
          0.9,
        ),
      ],
      "es",
      "¿Cuál es la dosis del jarabe?",
      new Date("2026-11-15T22:28:00"),
    );
    // La afirmación falsa cae por su pierna (la dosis), no por la negativa.
    expect(mixed.text).not.toContain("9 ml");
    expect(mixed.status).toBe("abstained");
  });
});

describe("isPureRefusal: la familia de la negativa pura (es/en/pt)", () => {
  it("las negativas de capacidad sin afirmación son puras", () => {
    for (const s of [
      "No puedo ayudarte con eso.",
      "No te puedo ayudar con eso.",
      "Lo siento, no puedo ayudarte con eso.",
      "I can't help with that.",
      "I cannot help you with that.",
      "Não posso ajudar com isso.",
    ]) {
      expect(isPureRefusal(s), s).toBe(true);
    }
  });

  it("la negativa con afirmación detrás no es pura, y lo que no declina tampoco", () => {
    for (const s of [
      "No puedo ayudarte, pero la dosis es 5 ml.",
      "No puedo ayudarte, la dosis recomendada es de 25 ml.",
      "El paciente no está sangrando.",
      "No lo sé.",
    ]) {
      expect(isPureRefusal(s), s).toBe(false);
    }
  });
});
