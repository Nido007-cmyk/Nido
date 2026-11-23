/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Espejo §1, pieza A (H-LOOP-1/3): el botón de Emergencia trae la
 * clave de SU guía y el turno la sirve tal cual, sin pasar por la
 * elección. La clase que cierra: con la pata semántica sin puntuar
 * (la rama de la pasada en vivo, medida en el paso 0) la elección
 * no elige y el turno caía a la ruta del modelo, donde la guía
 * vecina podía salir como respuesta con fundamentación verdadera.
 * Con clave, la guía servida es la de la pregunta por construcción.
 * Si la clave no resuelve, null: el turno sigue su camino normal
 * (degradación honesta, sin decir nada falso).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PackSourceDoc } from "./packSource";

const knowledgePacksMock = vi.fn();
const resolvePackGuideByKeyMock = vi.fn();
const readPackSourceMock = vi.fn();
vi.mock("./retrieve", () => ({
  retrieve: async () => [],
  activeRetrievalProfile: () => undefined,
}));
vi.mock("./packs", () => ({
  knowledgePacks: (...a: unknown[]) => knowledgePacksMock(...a),
  resolvePackGuideByKey: (...a: unknown[]) => resolvePackGuideByKeyMock(...a),
  readPackSource: (...a: unknown[]) => readPackSourceMock(...a),
}));
vi.mock("../services/packImporter", () => ({ verifiedImportedPacks: async () => new Map() }));

import { answerFromGuideKey } from "./guideAnswerRun";

const CPR_DOC: PackSourceDoc = {
  title: "RCP (reanimación) en adultos y niños mayores",
  source: "NIDO Esencial — RCP (reanimación) en adultos y niños mayores",
  parts: [
    { id: 191, body: "Antes de empezar\n- Comprueba que el lugar es seguro.\n- Llama al número de emergencias.", used: true },
    { id: 192, body: "Compresiones\nEmpuja fuerte y rápido en el centro del pecho, 100 a 120 veces por minuto.", used: false },
  ],
};

const HIT = {
  guideId: 12,
  title: "RCP (reanimación) en adultos y niños mayores",
  chunkId: "pack:nido-esencial-e5:191",
  chunk: {
    title: "RCP (reanimación) en adultos y niños mayores — Antes de empezar",
    body: "Antes de empezar\n- Comprueba que el lugar es seguro.",
    source: "NIDO Esencial",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  knowledgePacksMock.mockResolvedValue([{ id: "nido-esencial-e5" }, { id: "nido-ninos" }]);
  resolvePackGuideByKeyMock.mockResolvedValue(HIT);
  readPackSourceMock.mockResolvedValue(CPR_DOC);
});

describe("espejo §1 pieza A · la guía forzada por la clave del botón", () => {
  it("la clave sirve el texto literal de su guía, con su fragmento como fuente", async () => {
    const answer = await answerFromGuideKey("esencial-rcp-adultos", "es");
    expect(resolvePackGuideByKeyMock).toHaveBeenCalledWith("nido-esencial-e5", "esencial-rcp-adultos");
    expect(answer).not.toBeNull();
    expect(answer?.text).toContain("Empuja fuerte y rápido en el centro del pecho");
    expect(answer?.text).toContain("RCP (reanimación) en adultos y niños mayores");
    expect(answer?.chunks[0]?.chunkId).toBe("pack:nido-esencial-e5:191");
  });

  it("clave que ningún pack instalado resuelve → null, el turno sigue su camino", async () => {
    resolvePackGuideByKeyMock.mockResolvedValue(null);
    await expect(answerFromGuideKey("esencial-rcp-adultos", "es")).resolves.toBeNull();
  });

  it("la guía resuelve pero su lectura falla → null, sin servir nada a medias", async () => {
    readPackSourceMock.mockResolvedValue(null);
    await expect(answerFromGuideKey("esencial-rcp-adultos", "es")).resolves.toBeNull();
  });

  it("sin pack literal instalado, la clave no resuelve → null", async () => {
    knowledgePacksMock.mockResolvedValue([{ id: "nido-hogar" }]);
    await expect(answerFromGuideKey("esencial-rcp-adultos", "es")).resolves.toBeNull();
    expect(resolvePackGuideByKeyMock).not.toHaveBeenCalled();
  });
});
