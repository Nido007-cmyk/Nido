/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// 0.1.33: la pantalla de Telemetría muestra el coste del pre-router y
// adónde va cada mensaje — solo tiempos y cuentas, nunca texto.
import React from "react";
import { render, screen } from "@testing-library/react-native";

const mockRouter = { samples: [] as Array<{ ts: number; classifyMs: number; outcome: string }> };

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: new Proxy(
      {},
      { get: () => new Proxy({ toString: () => "#888" }, { get: (_t, k) => (k === "toString" ? () => "#888" : "#888") }) }
    ),
    typography: new Proxy({}, { get: () => new Proxy({}, { get: () => ({ fontSize: 12 }) }) }),
  }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "es" } }),
}));
jest.mock("../services/haptics", () => ({ impact: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));
jest.mock("./EvaluationScreen", () => ({ EvaluationScreen: () => null }));
jest.mock("../models/manifest", () => ({ MODEL_CATALOG: [] }));
jest.mock("../services/executionTelemetry", () => ({
  listRecentExecutions: async () => [],
  clearExecutionTelemetry: async () => {},
  exportExecutionTelemetry: async () => {},
}));
jest.mock("../services/routerStats", () => {
  const pure = jest.requireActual("../services/routerStats.pure");
  return {
    ...pure,
    listRouterSamples: async () => mockRouter.samples,
    clearRouterSamples: async () => {},
  };
});

describe("ExecutionTelemetryScreen · decisión de ruta", () => {
  it("sin mensajes medidos lo dice", async () => {
    mockRouter.samples = [];
    const { ExecutionTelemetryScreen } = require("./ExecutionTelemetryScreen");
    await render(<ExecutionTelemetryScreen onClose={() => {}} />);
    expect(await screen.findByText("executionTelemetry.router.empty")).toBeTruthy();
  });

  it("muestra mediana, máximo y el reparto de desenlaces", async () => {
    mockRouter.samples = [
      { ts: 1, classifyMs: 0.04, outcome: "router" },
      { ts: 2, classifyMs: 0.05, outcome: "router" },
      { ts: 3, classifyMs: 0.06, outcome: "chat" },
      { ts: 4, classifyMs: 2.5, outcome: "notUnderstood" },
    ];
    const { ExecutionTelemetryScreen } = require("./ExecutionTelemetryScreen");
    await render(<ExecutionTelemetryScreen onClose={() => {}} />);
    expect(await screen.findByText("executionTelemetry.router.title")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("0,050 ms")).toBeTruthy(); // mediana, coma decimal en es
    expect(screen.getAllByText("2,50 ms")).toHaveLength(2); // p95 y máximo
    expect(screen.getByText("2 · 50%")).toBeTruthy(); // resueltos sin modelo
    expect(screen.getAllByText("1 · 25%")).toHaveLength(2); // con modelo 0; «no entendí» 1 y conversación 1
  });
});
