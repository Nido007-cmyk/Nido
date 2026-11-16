/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.102 (foto del dueño, 2026-11-15): un intento anterior enseñaba el
 * error crudo «el prompt solo (~3354 tokens estimados) no cabe en el
 * contexto de 1024». La ruta adaptativa ensamblaba el prompt contra el
 * defaultNCtx DEL CATÁLOGO (4096) aunque el motor tuviera el modelo
 * cargado a 1024 (peldaño de emergencia de la escalera de RAM): el
 * prompt nacía imposible, el motor lo rechazaba y el turno caía a la
 * ruta fija o al error visible. El presupuesto de ensamblado debe ser
 * la ventana CARGADA (getModelInfo().nCtx), no la del catálogo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let mockResidentFilename: string | null = null;
const loadMock = vi.fn(async (filename: string) => {
  mockResidentFilename = filename;
});
const generateMock = vi.fn(async (_opts: any) => "mock answer");
const retrieveMock = vi.fn(async (_query: string) => [] as any[]);
const getModelInfoMock = vi.fn(() =>
  mockResidentFilename ? { filename: mockResidentFilename, nCtx: 1024, nThreads: 4 } : null
);

vi.mock("../inference/LlamaEngine", () => ({
  llamaEngine: {
    load: (filename: string) => loadMock(filename),
    generate: (opts: any) => generateMock(opts),
    getModelInfo: () => getModelInfoMock(),
    hasEmbeddedChatTemplate: () => false,
  },
}));

vi.mock("../rag/retrieve", () => ({
  retrieve: (query: string) => retrieveMock(query),
}));

import { executeRoutingPlan, ExecutableModel } from "./executor";
import { RoutingPlan } from "./router";
import { estimateTokens } from "../agent/loop/contextBudget";

const MODELS: Record<string, ExecutableModel> = {
  qwen: {
    id: "qwen",
    filename: "models/qwen.gguf",
    usesChatTemplate: true,
    defaultNCtx: 4096,
  },
};
const resolveModel = (id: string) => MODELS[id];

const PARRAFO =
  "El mantenimiento preventivo de un vehículo incluye revisar el aceite del motor, la presión de las llantas, el nivel del líquido de frenos y el estado de la batería con regularidad. " +
  "Cada revisión debe anotarse en una libreta con la fecha y el kilometraje para llevar un control ordenado del historial del carro y anticipar la siguiente visita al taller. ";

function chunkGrande(n: number) {
  return {
    chunkId: `c${n}`,
    docId: `d${n}`,
    title: `Doc ${n}`,
    body: PARRAFO.repeat(3),
    score: 1,
    matchType: "hybrid" as const,
  };
}

beforeEach(() => {
  loadMock.mockClear();
  generateMock.mockClear();
  retrieveMock.mockClear();
  mockResidentFilename = null;
  generateMock.mockResolvedValue("mock answer");
});

describe("executor: el presupuesto de ensamblado es la ventana cargada, no la del catálogo", () => {
  it("con el modelo cargado a 1024 y catálogo a 4096, el prompt generado cabe en 1024", async () => {
    retrieveMock.mockResolvedValue([chunkGrande(1), chunkGrande(2), chunkGrande(3), chunkGrande(4)]);
    const p: RoutingPlan = {
      steps: [
        { id: "retrieve-0", type: "retrieve", required: false },
        { id: "generate-1", type: "generate", modelId: "qwen", required: true },
      ],
      selectedModelIds: ["qwen"],
      estimatedCost: { modelSwitches: 0 },
      fallbackPolicy: "use-default",
      reasonCodes: [],
    };
    await executeRoutingPlan(p, { query: "Como cambio la llanta de un carro" }, resolveModel);
    expect(generateMock).toHaveBeenCalledTimes(1);
    const opts = generateMock.mock.calls[0][0];
    const mensajes = opts.messages as { content: string }[];
    const total = mensajes.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    // La ventana cargada es 1024: el prompt no puede nacer por encima
    // de ella (el núcleo es pequeño en esta prueba; el ajuste deja el
    // total dentro de la ventana menos la reserva suelo).
    expect(total).toBeLessThanOrEqual(1024);
  });
});
