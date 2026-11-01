/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Auditoría completa 2026-10-31 (F6-09): el envoltorio que de
// verdad recupera y lee la guía no tenía prueba (su lógica pura
// hermana sí). Aquí se prueba el pegamento: recupera una vez,
// elige con las reglas de guideAnswer, lee la fuente del pack,
// compone con ella y devuelve también los trozos recuperados
// para que el camino normal los reutilice. Y nunca lanza.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievedChunk } from "./retrieve.types";
import type { PackSourceDoc } from "./packSource";

const retrieveMock = vi.fn();
const readPackSourceMock = vi.fn();
vi.mock("./retrieve", () => ({ retrieve: (...a: unknown[]) => retrieveMock(...a) }));
vi.mock("./packs", () => ({ readPackSource: (...a: unknown[]) => readPackSourceMock(...a) }));

import { answerFromGuide } from "./guideAnswerRun";

const chunk = (id: string, title: string, body: string, rawScore?: number): RetrievedChunk =>
  ({ chunkId: id, docId: id, title, body, score: 1, rawScore, matchType: "semantic" }) as RetrievedChunk;

const DOC: PackSourceDoc = {
  title: "Dolor en el pecho",
  source: "https://example.org/fuente",
  parts: [
    { id: 1, body: "Qué hacer\n1. Llama de inmediato al número de emergencias.\n2. Sienta a la persona semirrecostada.", used: true },
    { id: 2, body: "Qué no hacer\nNo le des de comer ni de beber.", used: false },
  ],
};

const BEST = chunk("pack:nido-esencial:5", "Dolor en el pecho", "Llama de inmediato al número de emergencias.", 0.95);
const SAME_GUIDE = chunk("pack:nido-esencial:6", "Dolor en el pecho", "No le des de comer ni de beber.", 0.9);
const OTHER = chunk("pack:wiki-vital5:9", "Otra cosa", "Texto ajeno.", 0.8);

describe("answerFromGuide (F6-09)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sin trozo de guía claro: answer null y los recuperados se devuelven para reutilizar", async () => {
    retrieveMock.mockResolvedValue([OTHER]);
    const out = await answerFromGuide("qué es el corazón", "es");
    expect(out.answer).toBeNull();
    expect(out.retrieved).toEqual([OTHER]);
    expect(readPackSourceMock).not.toHaveBeenCalled();
  });

  it("con guía clara pero sin fuente legible: answer null, sin lanzar", async () => {
    retrieveMock.mockResolvedValue([BEST]);
    readPackSourceMock.mockResolvedValue(null);
    const out = await answerFromGuide("dolor en el pecho", "es");
    expect(out.answer).toBeNull();
    expect(out.retrieved).toEqual([BEST]);
  });

  it("camino feliz: compone desde la fuente y las fuentes son solo las de esa guía", async () => {
    retrieveMock.mockResolvedValue([BEST, SAME_GUIDE, OTHER]);
    readPackSourceMock.mockResolvedValue(DOC);
    const out = await answerFromGuide("dolor en el pecho", "es");
    expect(out.answer).not.toBeNull();
    expect(out.answer?.text).toContain("Llama de inmediato");
    expect(out.answer?.chunks).toEqual([BEST, SAME_GUIDE]);
    expect(readPackSourceMock).toHaveBeenCalledWith(BEST.chunkId);
  });

  it("si la recuperación falla, devuelve null y null y no lanza", async () => {
    retrieveMock.mockRejectedValue(new Error("db cerrada"));
    const out = await answerFromGuide("dolor en el pecho", "es");
    expect(out).toEqual({ answer: null, retrieved: null });
  });
});

describe("answerFromGuide: la consulta contextualizada (R-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recupera con la consulta contextualizada que pasa el llamador, no con la cruda", async () => {
    retrieveMock.mockResolvedValue([OTHER]);
    const contextualizada = "¿En qué sala? ¿Qué día y a qué horas es la cita?";
    const out = await answerFromGuide("¿En qué sala?", "es", contextualizada);
    expect(retrieveMock).toHaveBeenCalledWith(contextualizada, 4);
    expect(out.retrieved).toEqual([OTHER]);
  });

  it("sin consulta contextualizada, recupera con la pregunta tal cual (comportamiento previo)", async () => {
    retrieveMock.mockResolvedValue([OTHER]);
    await answerFromGuide("qué es el corazón", "es");
    expect(retrieveMock).toHaveBeenCalledWith("qué es el corazón", 4);
  });
});
