/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// G-1 (partida del móvil): la fila del modelo en el gestor enseña la
// velocidad MEDIDA en este aparato — la mediana de sus generaciones
// reales, leída de la telemetría persistida — junto al veredicto de
// ajuste. Sin historia (o con una sola muestra: la regla de las 2
// muestras deja la velocidad en null) la fila no enseña ningún objeto
// de ceros: el «sin datos» es ausencia, no un 0,0 inventado. La
// memoria medida al cargar no se pinta: el gestor del móvil no
// guarda ninguna medición de carga por modelo (acto 0 del paso; lo
// que existe es la estimación del pre-flight, y pintarla como
// medida sería la mentira que la pieza cura).
import { jest, describe, it, expect } from "@jest/globals";
import React from "react";
import { render, screen } from "@testing-library/react-native";

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { cardElevated: "#111", subtle: "#222", modalOverlay: "rgba(0,0,0,0.5)", terminal: "#333" },
      text: { heading: "#fff", primary: "#eee", secondary: "#bbb", dim: "#888", accentEmerald: "#0f0", accentAmber: "#fa0", accentCyan: "#0ff" },
      border: { default: "#333", subtle: "#444" },
      emerald: { 400: "#0f0", border: "#0a0", bgSubtle: "#021" },
      crimson: { 400: "#f66", border: "#a00", bgSubtle: "#200" },
      amber: { border: "#a80", bgSubtle: "#220" },
      cyan: { border: "#088", bgSubtle: "#022" },
    },
    typography: {
      ui: { titleSm: { fontSize: 15 }, caption: { fontSize: 12 }, body: { fontSize: 14 } },
      mono: { xs: { fontSize: 10 } },
    },
  }),
}));

jest.mock("../services/haptics", () => ({
  impact: () => {},
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Interpola rate/count para que la tasa pintada sea observable.
    t: (k: string, opts?: { defaultValue?: string; rate?: string; count?: number; ctx?: string }) =>
      opts?.defaultValue ??
      (opts?.rate != null ? `${k}:${opts.rate}` : opts?.count != null ? `${k}:${opts.count}` : opts?.ctx != null ? `${k}:${opts.ctx}` : k),
    i18n: { language: "es" },
  }),
}));

jest.mock("ram-monitor", () => ({
  // La Tab A9+ del dueño: su RAM total real (3416 MiB).
  getDeviceTotalRamBytes: () => 3416 * 1024 * 1024,
}));

jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));

jest.mock("../rag/corpusIndexStatus", () => ({
  getCorpusIndexStatus: () => ({}),
  onCorpusIndexStatus: () => () => {},
}));

jest.mock("../utils/safeFormat", () => ({
  displayLang: () => "es",
  formatInt: (n: number) => String(n),
}));

const { CatalogItemCard } = require("./CatalogItemCard");
const { MODEL_CATALOG } = require("../models/manifest");
const byId = (id: string) => MODEL_CATALOG.find((m: { id: string }) => m.id === id);

const baseProps = {
  isActive: false,
  onDownload: () => {},
  onUse: () => {},
  onRemove: () => {},
};

describe("CatalogItemCard: la velocidad medida junto al modelo (G-1)", () => {
  const item = () => byId("qwen3-0.6b-q4km");

  it("con historia: pinta su velocidad mediana y su base (el conteo)", async () => {
    const speedSummary = { modelId: "qwen3-0.6b-q4km.gguf", medianTokPerSec: 12.34, sampleCount: 5, lastTs: 99 };
    await render(<CatalogItemCard item={item()} row={undefined} {...baseProps} speedSummary={speedSummary} />);
    expect(await screen.findByText("catalogItemCard.measuredRowSpeed:12.3")).toBeTruthy();
    expect(screen.getByText("catalogItemCard.measuredBasis:5")).toBeTruthy();
  });

  it("sin velocidad que enseñar (sin historia, o una sola muestra): no pinta ningún objeto de ceros", async () => {
    const view = await render(<CatalogItemCard item={item()} row={undefined} {...baseProps} />);
    expect(screen.queryByText(/measuredRowSpeed/)).toBeNull();
    expect(screen.queryByText(/measuredBasis/)).toBeNull();
    const oneSample = { modelId: "qwen3-0.6b-q4km.gguf", medianTokPerSec: null, sampleCount: 1, lastTs: 99 };
    await view.rerender(<CatalogItemCard item={item()} row={undefined} {...baseProps} speedSummary={oneSample} />);
    expect(screen.queryByText(/measuredRowSpeed/)).toBeNull();
    expect(screen.queryByText(/measuredBasis/)).toBeNull();
  });

  it("tras una generación nueva, la mediana pintada se mueve en la dirección medida", async () => {
    const before = { modelId: "qwen3-0.6b-q4km.gguf", medianTokPerSec: 10, sampleCount: 3, lastTs: 99 };
    const view = await render(<CatalogItemCard item={item()} row={undefined} {...baseProps} speedSummary={before} />);
    expect(await screen.findByText("catalogItemCard.measuredRowSpeed:10.0")).toBeTruthy();
    const after = { modelId: "qwen3-0.6b-q4km.gguf", medianTokPerSec: 20, sampleCount: 4, lastTs: 100 };
    await view.rerender(<CatalogItemCard item={item()} row={undefined} {...baseProps} speedSummary={after} />);
    expect(await screen.findByText("catalogItemCard.measuredRowSpeed:20.0")).toBeTruthy();
    expect(screen.queryByText("catalogItemCard.measuredRowSpeed:10.0")).toBeNull();
  });

  it("0.1.122: «probado en este aparato» con el contexto con que respondió; sin prueba, nada", async () => {
    const view = await render(<CatalogItemCard item={item()} row={undefined} {...baseProps} provenCtx={2048} />);
    expect(await screen.findByText("catalogItemCard.provenHere:2048")).toBeTruthy();
    await view.rerender(<CatalogItemCard item={item()} row={undefined} {...baseProps} provenCtx={null} />);
    expect(screen.queryByText(/provenHere/)).toBeNull();
  });
});
