/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.105 (carril atragantamiento-01105) — la guía equivocada por
 * arrastre: foto del dueño (Tab A9+, 2026-11-16 05:31 MST, ya con la
 * 0.1.105): tras los turnos de RCP, repetir «Que hago si un niño se
 * esta atragantando» coronó la guía de RCP y la sirvió literal («sin
 * modelo»), sin que ninguna puerta cazara que esa guía no responde a
 * la pregunta.
 *
 * Causa (a) medida en este carril: la pregunta es fina (2 términos de
 * contenido: «nino», «atragantando»), así que R-03/H-08 (sellado) le
 * añade la pregunta anterior como ancla y la recuperación corre con
 * «…atragantando Como hago rcp a un adulto?»; la elección por coseno
 * de pickGuideChunk juzga sobre ESA lista arrastrada y la guía del
 * ancla gana, sin ninguna comprobación contra la pregunta tal cual.
 * La llanta (3 términos) no arrastra: por eso su turno gemelo no se
 * volteó. Y la vara léxica de la casa no puede arbitrar aquí: medida
 * sobre el pack real construido, los fragmentos de la guía de
 * atragantamiento cubren 0 de los 2 términos por palabras (la
 * morfología española y las claves generadas no alinean); la guía se
 * encuentra por coseno, que es la vara sellada de la 0.1.87.
 *
 * Contrato fijado: la guía servida literalmente es función de la
 * pregunta, no del ancla. Cuando la búsqueda corrió con una pregunta
 * distinta de la hecha (hubo arrastre), la corrida elige también
 * sobre la pregunta tal cual, con su propia búsqueda, y si esa
 * elección clara es OTRA guía, se sirve esa. Si la pregunta tal cual
 * no elige guía (la continuación elíptica legítima de R-03), se
 * sirve la elección arrastrada como siempre. Sin arrastre, el
 * comportamiento es el de siempre, byte a byte.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievedChunk } from "./retrieve.types";
import type { PackSourceDoc } from "./packSource";
import { MULTILINGUAL_E5_SMALL_PROFILE } from "./embeddingProfile";

const retrieveMock = vi.fn();
const readPackSourceMock = vi.fn();
const verifiedImportedPacksMock = vi.fn();
vi.mock("./retrieve", () => ({
  retrieve: (...a: unknown[]) => retrieveMock(...a),
  activeRetrievalProfile: () => MULTILINGUAL_E5_SMALL_PROFILE,
}));
vi.mock("./packs", () => ({ readPackSource: (...a: unknown[]) => readPackSourceMock(...a) }));
vi.mock("../services/packImporter", () => ({
  verifiedImportedPacks: (...a: unknown[]) => verifiedImportedPacksMock(...a),
}));

import { answerFromGuide } from "./guideAnswerRun";

const Q = "Que hago si un niño se esta atragantando";
const Q_RCP = "Como hago rcp a un adulto?";
const Q_QUIJOTE = "Quien escribio don Quijote";

const CPR_BODY =
  "Si una persona se desploma, no responde y no respira normal (o solo boquea), su corazón probablemente se ha parado. " +
  "Cada minuto sin RCP baja mucho la posibilidad de sobrevivir.\n\n" +
  "Antes de empezar\n- Comprueba que el lugar es seguro.\n- Toca sus hombros y háblale fuerte. " +
  "Si no responde, mira si respira normal (no más de 10 segundos).";

const ATRAG_BODY =
  "Si no sale o pierde el conocimiento\n" +
  "- Llama a emergencias, túmbalo en el suelo y empieza la RCP. Cada vez que abras la vía aérea para respirar, mira si se ve el objeto.";

function ch(chunkId: string, title: string, body: string, rawScore: number): RetrievedChunk {
  return { chunkId, docId: chunkId, title, body, score: rawScore, rawScore, matchType: "semantic" } as unknown as RetrievedChunk;
}

const CPR_CHUNK = (rawScore: number) =>
  ch("pack:nido-esencial-e5:12", "RCP (reanimación) en adultos y niños mayores — Antes de empezar", CPR_BODY, rawScore);
const ATRAG_CHUNK = (rawScore: number) =>
  ch("pack:nido-esencial-e5:57", "Atragantamiento por edades: bebés y niños — Si no sale o pierde el conocimiento", ATRAG_BODY, rawScore);

const CPR_DOC: PackSourceDoc = {
  title: "RCP (reanimación) en adultos y niños mayores",
  source: "AHA, Guías de RCP 2025",
  parts: [
    { id: 1, body: "Si una persona se desploma, no responde y no respira normal (o solo boquea), su corazón probablemente se ha parado. Cada minuto sin RCP baja mucho la posibilidad de sobrevivir. Empezar rápido es lo más importante.", used: false },
    { id: 2, body: "Antes de empezar\n- Comprueba que el lugar es seguro.\n- Toca sus hombros y háblale fuerte. Si no responde, mira si respira normal (no más de 10 segundos).\n- Pide a alguien que llame al número de emergencias y que traiga un desfibrilador (DEA).", used: true },
    { id: 3, body: "Compresiones en el pecho\n1. Tumba a la persona boca arriba sobre una superficie dura (el suelo).\n2. Pon el talón de una mano en el centro del pecho y la otra mano encima.\n3. Profundidad: unos 5 cm en adultos. Ritmo: 100 a 120 por minuto.", used: false },
  ],
};

const ATRAG_DOC: PackSourceDoc = {
  title: "Atragantamiento por edades: bebés y niños",
  source: "IFRC, Directrices de primeros auxilios 2020",
  parts: [
    { id: 1, body: "Atragantamiento leve\nSi el niño tose con fuerza, anímalo a seguir tosiendo: la tos es la mejor forma de expulsar el objeto.", used: false },
    { id: 2, body: "Si no sale o pierde el conocimiento\n- Llama a emergencias, túmbalo en el suelo y empieza la RCP. Cada vez que abras la vía aérea para respirar, mira si se ve el objeto.", used: true },
  ],
};

/** La recuperación responde según la pregunta que de verdad corre. */
function stubRetrieve(byQuery: Record<string, RetrievedChunk[]>) {
  retrieveMock.mockImplementation(async (q: string) => byQuery[q] ?? []);
}

beforeEach(() => {
  retrieveMock.mockReset();
  readPackSourceMock.mockReset();
  verifiedImportedPacksMock.mockReset();
  verifiedImportedPacksMock.mockResolvedValue(null);
  readPackSourceMock.mockImplementation(async (chunkId: string) => {
    if (chunkId === "pack:nido-esencial-e5:12") return CPR_DOC;
    if (chunkId === "pack:nido-esencial-e5:57") return ATRAG_DOC;
    return null;
  });
});

describe("guía por arrastre 01105 — la elección de la pregunta manda sobre la del ancla", () => {
  it("EL CASO 05:31: tras el bloque de RCP, la misma pregunta sirve SU guía, no la del ancla", async () => {
    stubRetrieve({
      // La lista arrastrada: la guía del ancla gana el coseno y la de
      // la pregunta queda fuera de la banda de cercanía.
      [`${Q} ${Q_RCP}`]: [CPR_CHUNK(0.91), ATRAG_CHUNK(0.87)],
      // La lista de la pregunta tal cual: su guía es la clara.
      [Q]: [ATRAG_CHUNK(0.91), CPR_CHUNK(0.87)],
    });
    const r = await answerFromGuide(Q, "es", `${Q} ${Q_RCP}`);
    expect(r.answer).not.toBeNull();
    expect(r.answer?.text).toContain("Atragantamiento por edades: bebés y niños");
    expect(r.answer?.text).not.toContain("RCP (reanimación) en adultos y niños mayores");
    expect(r.answer?.chunks[0]?.chunkId).toBe("pack:nido-esencial-e5:57");
  });

  it("control: la pregunta de RCP, sin arrastre, sirve su guía como siempre (la pasada perfecta de las 05:28)", async () => {
    stubRetrieve({ [Q_RCP]: [CPR_CHUNK(0.91)] });
    const r = await answerFromGuide(Q_RCP, "es", Q_RCP);
    expect(r.answer).not.toBeNull();
    expect(r.answer?.text).toContain("RCP (reanimación) en adultos y niños mayores");
  });

  it("control: con arrastre pero la misma elección, se sirve como siempre", async () => {
    stubRetrieve({
      [`${Q} ${Q_QUIJOTE}`]: [ATRAG_CHUNK(0.91), CPR_CHUNK(0.87)],
      [Q]: [ATRAG_CHUNK(0.91), CPR_CHUNK(0.87)],
    });
    const r = await answerFromGuide(Q, "es", `${Q} ${Q_QUIJOTE}`);
    expect(r.answer).not.toBeNull();
    expect(r.answer?.text).toContain("Atragantamiento por edades: bebés y niños");
  });

  it("control: la pregunta en conversación nueva (sin arrastre) sirve su guía", async () => {
    stubRetrieve({ [Q]: [ATRAG_CHUNK(0.91)] });
    const r = await answerFromGuide(Q, "es", Q);
    expect(r.answer).not.toBeNull();
    expect(r.answer?.text).toContain("Atragantamiento por edades: bebés y niños");
  });

  it("control R-03: la continuación elíptica sin guía propia sigue sirviendo la del ancla", async () => {
    const followUp = "Y en bebes?";
    stubRetrieve({
      [`${followUp} ${Q}`]: [ATRAG_CHUNK(0.91)],
      [followUp]: [],
    });
    const r = await answerFromGuide(followUp, "es", `${followUp} ${Q}`);
    expect(r.answer).not.toBeNull();
    expect(r.answer?.text).toContain("Atragantamiento por edades: bebés y niños");
  });
});
