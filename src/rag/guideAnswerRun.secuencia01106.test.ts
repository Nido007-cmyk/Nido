/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.106 (carril atragantamiento-01106) — la primera vez cae al
 * texto seguro: foto del dueño (Tab A9+, 2026-11-16 07:39 MST,
 * secuencia RCP → llanta → «Que hago si un niño se esta
 * atragantando»). La vía literal no sirvió la guía y el turno
 * degradó al texto seguro de salud, con la guía de atragantamiento
 * en la lista en el nº 2 al 87 %, empatada con la crecida en el
 * nº 1. A la segunda, la misma pregunta sirvió su guía literal,
 * sola al 89 %: la diferencia está en la recuperación de ESE turno.
 *
 * Causa raíz probada en el código: el rescate de la 0.1.106 (la
 * segunda elección sobre la pregunta tal cual cuando hubo arrastre)
 * solo corre si la elección arrastrada YA produjo un pick. Con el
 * pick arrastrado en null hay un `return` antes de ese bloque: la
 * pregunta literal nunca se elige en ese flujo. Y el pick puede ser
 * null con la guía correcta empatada arriba: la regla sellada de
 * pickGuideChunk exige a una guía integrada ser la mejor global, o
 * estar a ≤0,03 de un mejor global que también sea literal; un
 * fragmento NO literal como mejor global (0,88) veta a todas las
 * integradas (elegibles ∅ → la vía léxica de reserva excluye a las
 * integradas por diseño → null). En ESTA conversación un fragmento
 * de glosario («Cauterization») ya coronó una lista para esta misma
 * pregunta: precedente, no hipótesis.
 *
 * Contrato fijado: la elección limpia corre TAMBIÉN cuando el flujo
 * arrastrado va a devolver null (pick null o documento ilegible):
 * si la pregunta tal cual elige con claridad una guía y no está
 * negada por signo, se sirve esa. Todos los caminos que hoy sirven
 * quedan byte a byte; sin arrastre no cambia nada; si la elección
 * limpia tampoco elige, null como hoy — el suelo no baja jamás.
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
const Q_LLANTA = "Como cambio la llanta de un carro";

const ATRAG_BODY =
  "Si no sale o pierde el conocimiento\n" +
  "- Llama a emergencias, túmbalo en el suelo y empieza la RCP. Cada vez que abras la vía aérea para respirar, mira si se ve el objeto.";

const CRECIDA_BODY =
  "Antes de la crecida\n- Conoce las rutas de evacuación de tu zona y el punto más alto seguro. " +
  "Si el agua sube, no intentes cruzar corrientes: bastan pocos centímetros para arrastrar a una persona.";

const VETO_BODY =
  "Cauterización: procedimiento que sella un tejido o un vaso sanguíneo aplicando calor o una sustancia química. " +
  "Entrada de glosario, sin pasos de actuación para la persona que pregunta.";

function ch(chunkId: string, title: string, body: string, rawScore: number): RetrievedChunk {
  return { chunkId, docId: chunkId, title, body, score: rawScore, rawScore, matchType: "semantic" } as unknown as RetrievedChunk;
}

const ATRAG_CHUNK = (rawScore: number) =>
  ch("pack:nido-esencial-e5:57", "Atragantamiento por edades: bebés y niños — Si no sale o pierde el conocimiento", ATRAG_BODY, rawScore);
const CRECIDA_CHUNK = (rawScore: number) =>
  ch("pack:nido-esencial-e5:63", "Crecidas e inundaciones — Antes de la crecida", CRECIDA_BODY, rawScore);
/** El fragmento NO literal que veta: no es fragmento de guía alguna. */
const VETO_CHUNK = (rawScore: number) => ch("glosario:cauterizacion", "Cauterización", VETO_BODY, rawScore);

const ATRAG_DOC: PackSourceDoc = {
  title: "Atragantamiento por edades: bebés y niños",
  source: "IFRC, Directrices de primeros auxilios 2020",
  parts: [
    { id: 1, body: "Atragantamiento leve\nSi el niño tose con fuerza, anímalo a seguir tosiendo: la tos es la mejor forma de expulsar el objeto.", used: false },
    { id: 2, body: "Si no sale o pierde el conocimiento\n- Llama a emergencias, túmbalo en el suelo y empieza la RCP. Cada vez que abras la vía aérea para respirar, mira si se ve el objeto.", used: true },
  ],
};

function stubRetrieve(byQuery: Record<string, RetrievedChunk[]>) {
  retrieveMock.mockImplementation(async (q: string) => byQuery[q] ?? []);
}

beforeEach(() => {
  retrieveMock.mockReset();
  readPackSourceMock.mockReset();
  verifiedImportedPacksMock.mockReset();
  verifiedImportedPacksMock.mockResolvedValue(null);
  readPackSourceMock.mockImplementation(async (chunkId: string) => {
    if (chunkId === "pack:nido-esencial-e5:57") return ATRAG_DOC;
    return null;
  });
});

describe("secuencia 01106 — la elección limpia también corre cuando el arrastre no eligió", () => {
  it("EL CASO 07:39: veto no literal sobre el empate 87/87 arrastrado; la pregunta tal cual corona su guía al 89 y se sirve", async () => {
    stubRetrieve({
      // La lista arrastrada (ancla = la llanta): el fragmento de
      // glosario corona al 0,88 y veta a las dos guías empatadas.
      [`${Q} ${Q_LLANTA}`]: [VETO_CHUNK(0.88), CRECIDA_CHUNK(0.87), ATRAG_CHUNK(0.87)],
      // La lista de la pregunta tal cual (el intento bueno de las
      // 07:41): su guía, sola y clara al 0,89.
      [Q]: [ATRAG_CHUNK(0.89)],
    });
    const r = await answerFromGuide(Q, "es", `${Q} ${Q_LLANTA}`);
    expect(r.answer).not.toBeNull();
    expect(r.answer?.text).toContain("Atragantamiento por edades: bebés y niños");
    expect(r.answer?.chunks[0]?.chunkId).toBe("pack:nido-esencial-e5:57");
  });

  it("control de suelo: si la elección limpia TAMPOCO elige (veto también en su lista), sigue null", async () => {
    stubRetrieve({
      [`${Q} ${Q_LLANTA}`]: [VETO_CHUNK(0.88), CRECIDA_CHUNK(0.87), ATRAG_CHUNK(0.87)],
      [Q]: [VETO_CHUNK(0.88), ATRAG_CHUNK(0.87)],
    });
    const r = await answerFromGuide(Q, "es", `${Q} ${Q_LLANTA}`);
    expect(r.answer).toBeNull();
  });

  it("control: sin arrastre, el veto sigue dando null como hoy (la elección limpia no corre sin arrastre)", async () => {
    stubRetrieve({
      [Q]: [VETO_CHUNK(0.88), CRECIDA_CHUNK(0.87), ATRAG_CHUNK(0.87)],
    });
    const r = await answerFromGuide(Q, "es", Q);
    expect(r.answer).toBeNull();
  });

  it("control: el pick arrastrado con documento ilegible ya lo rescata el bloque de la 0.1.106 (corre antes de leer el documento)", async () => {
    stubRetrieve({
      // La arrastrada elige la crecida (su documento no se lee en el
      // stub: readPackSource solo conoce la de atragantamiento).
      [`${Q} ${Q_LLANTA}`]: [CRECIDA_CHUNK(0.91), ATRAG_CHUNK(0.87)],
      [Q]: [ATRAG_CHUNK(0.89)],
    });
    const r = await answerFromGuide(Q, "es", `${Q} ${Q_LLANTA}`);
    expect(r.answer).not.toBeNull();
    expect(r.answer?.text).toContain("Atragantamiento por edades: bebés y niños");
  });

  it("control 05:31 intacto: pick arrastrado de OTRA guía y la limpia elige la suya → se sirve la de la pregunta", async () => {
    const CPR_BODY =
      "Si una persona se desploma, no responde y no respira normal (o solo boquea), su corazón probablemente se ha parado.";
    const CPR_CHUNK = (rawScore: number) =>
      ch("pack:nido-esencial-e5:12", "RCP (reanimación) en adultos y niños mayores — Antes de empezar", CPR_BODY, rawScore);
    stubRetrieve({
      [`${Q} Como hago rcp a un adulto?`]: [CPR_CHUNK(0.91), ATRAG_CHUNK(0.87)],
      [Q]: [ATRAG_CHUNK(0.91), CPR_CHUNK(0.87)],
    });
    const r = await answerFromGuide(Q, "es", `${Q} Como hago rcp a un adulto?`);
    expect(r.answer).not.toBeNull();
    expect(r.answer?.text).toContain("Atragantamiento por edades: bebés y niños");
    expect(r.answer?.chunks[0]?.chunkId).toBe("pack:nido-esencial-e5:57");
  });
});
