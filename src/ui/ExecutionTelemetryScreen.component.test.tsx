/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// 0.1.33: la pantalla de Telemetría muestra el coste del pre-router y
// adónde va cada mensaje — solo tiempos y cuentas, nunca texto.
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockRouter = { samples: [] as Array<Record<string, unknown>> };
const mockMissed = { on: false, rows: [] as Array<Record<string, unknown>>, setCalls: [] as boolean[], copied: [] as string[] };

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

jest.mock("expo-clipboard", () => ({
  setStringAsync: async (v: string) => {
    mockMissed.copied.push(v);
  },
}));
jest.mock("../services/missedPhrases", () => {
  const pure = jest.requireActual("../services/missedPhrases.pure");
  return {
    formatMissedForCopy: pure.formatMissedForCopy,
    missedSignal: pure.missedSignal,
    isMissedPhraseLogOn: async () => mockMissed.on,
    listMissedPhrases: async () => mockMissed.rows,
    setMissedPhraseLog: async (on: boolean) => {
      mockMissed.setCalls.push(on);
      mockMissed.on = on;
      if (!on) mockMissed.rows = [];
    },
    clearMissedPhrases: async () => {
      mockMissed.rows = [];
    },
  };
});

beforeEach(() => {
  mockMissed.on = false;
  mockMissed.rows = [];
  mockMissed.setCalls = [];
  mockMissed.copied = [];
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

describe("ExecutionTelemetryScreen · 0.1.39 lo que se cuela al modelo", () => {
  it("sin muestras con vía lo explica (las anteriores a la 0.1.39 no cuentan)", async () => {
    mockRouter.samples = [{ ts: 1, classifyMs: 0.04, outcome: "router" }];
    const { ExecutionTelemetryScreen } = require("./ExecutionTelemetryScreen");
    await render(<ExecutionTelemetryScreen onClose={() => {}} />);
    expect(await screen.findByText("executionTelemetry.router.leakEmpty")).toBeTruthy();
  });

  it("cuenta las órdenes que llegaron al modelo y las herramientas que pidió", async () => {
    mockRouter.samples = [
      { ts: 1, classifyMs: 0.04, outcome: "router", route: "calc" },
      { ts: 2, classifyMs: 0.04, outcome: "model", route: "model", modelTool: "create_reminder", retry: null },
      { ts: 3, classifyMs: 0.04, outcome: "notUnderstood", route: "model", modelTool: null, retry: "nudge" },
      { ts: 4, classifyMs: 0.04, outcome: "router", route: "create_reminder" },
    ];
    const { ExecutionTelemetryScreen } = require("./ExecutionTelemetryScreen");
    await render(<ExecutionTelemetryScreen onClose={() => {}} />);
    expect(await screen.findByText("executionTelemetry.router.leakTitle")).toBeTruthy();
    // «2 · 50%»: resueltos sin modelo (desenlaces) y llegaron al modelo (fuga).
    expect(screen.getAllByText("2 · 50%")).toHaveLength(2);
    // «1 · 25%»: con modelo y «no entendí» (desenlaces) + el modelo pidió herramienta.
    expect(screen.getAllByText("1 · 25%")).toHaveLength(3);
    expect(screen.getByText("1 · 50%")).toBeTruthy(); // 1 de los 2 que llegaron necesitó reintento
    expect(screen.getByText("executionTelemetry.router.leakByTool: create_reminder 1")).toBeTruthy();
  });
});

describe("ExecutionTelemetryScreen · 0.1.39 frases no reconocidas (opcional)", () => {
  it("apagado por defecto: no enseña frases", async () => {
    mockRouter.samples = [];
    mockMissed.rows = [{ ts: 1, text: "NO DEBE VERSE", route: "model", modelTool: null, retry: null, fallback: null }];
    const { ExecutionTelemetryScreen } = require("./ExecutionTelemetryScreen");
    await render(<ExecutionTelemetryScreen onClose={() => {}} />);
    expect(await screen.findByText("executionTelemetry.missed.title")).toBeTruthy();
    expect(screen.getByTestId("missed-phrases-toggle").props.value).toBe(false);
    expect(screen.queryByText(/NO DEBE VERSE/)).toBeNull();
  });

  it("encendido: lista las frases y se pueden copiar", async () => {
    mockRouter.samples = [];
    mockMissed.on = true;
    mockMissed.rows = [{ ts: 1, text: "avísame del dentista", route: "model", modelTool: "create_reminder", retry: null, fallback: null }];
    const { ExecutionTelemetryScreen } = require("./ExecutionTelemetryScreen");
    await render(<ExecutionTelemetryScreen onClose={() => {}} />);
    expect(await screen.findByText(/avísame del dentista/)).toBeTruthy();
    await fireEvent.press(screen.getByText("executionTelemetry.missed.copy"));
    await waitFor(() => expect(mockMissed.copied).toEqual(["[tool:create_reminder] avísame del dentista"]));
  });

  it("encenderlo lo guarda", async () => {
    mockRouter.samples = [];
    const { ExecutionTelemetryScreen } = require("./ExecutionTelemetryScreen");
    await render(<ExecutionTelemetryScreen onClose={() => {}} />);
    const toggle = await screen.findByTestId("missed-phrases-toggle");
    await fireEvent(toggle, "valueChange", true);
    await waitFor(() => expect(mockMissed.setCalls).toEqual([true]));
  });
});
