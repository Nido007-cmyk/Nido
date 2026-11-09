/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Lector de guías como documentos (pieza 2026-11-08): la biblioteca lista
// los packs instalados con sus guías, abrir una guía enseña su texto
// entero, y la ruta jamás toca los motores ni monta el chat. El almacén
// de packs va mockeado: lo que se prueba es la superficie y su aislamiento.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

const mockState = {
  packs: [{ id: "pack-1", label: "Pack Uno", format: "sqlite-pack" }] as Array<Record<string, unknown>>,
  guidesByPack: {
    "pack-1": [
      { id: 1, key: "cpr", lang: "en", title: "CPR for adults", category: "first-aid", region: "", sources: "IFRC 2025", verified: "2026-11-07" },
      { id: 2, key: "burns", lang: "en", title: "Burns", category: "first-aid", region: "", sources: "IFRC 2025", verified: "2026-11-07" },
    ],
  } as Record<string, Array<Record<string, unknown>>>,
  docs: {
    "pack-1:1": { title: "CPR for adults", source: "NIDO — CPR for adults", body: "Check response first.\n\nPush in the center." },
    "pack-1:2": { title: "Burns", source: "NIDO — Burns", body: "Cool with water." },
  } as Record<string, Record<string, unknown> | null>,
};

const mockLlamaLoad = jest.fn();
const mockEmbeddingLoad = jest.fn();

jest.mock("../rag/packs", () => ({
  knowledgePacks: async () => mockState.packs,
  listPackGuides: async (packId: string) => mockState.guidesByPack[packId] ?? [],
  readPackGuide: async (packId: string, guideId: number) => mockState.docs[`${packId}:${guideId}`] ?? null,
}));
jest.mock("../inference/LlamaEngine", () => ({ llamaEngine: { load: mockLlamaLoad } }));
jest.mock("../rag/embed", () => ({ embeddingEngine: { load: mockEmbeddingLoad } }));
jest.mock("./ChatScreen", () => ({ ChatScreen: () => null }));
jest.mock("./theme", () => ({
  __esModule: true,
  useTheme: () => ({
    colors: {
      bg: { black: "#000", cardElevated: "#111" },
      text: { heading: "#fff", primary: "#eee", secondary: "#bbb", dim: "#888", accentEmerald: "#0f0" },
      border: { default: "#333" },
      emerald: { 400: "#0f0", 600: "#0a0", bgSubtle: "#021" },
    },
    typography: { ui: { title: {}, body: {}, caption: {} } },
  }),
  calmSpacing: { tight: 4, cozy: 8, comfortable: 16, generous: 48 },
  calmRadii: { soft: 12 },
}));
jest.mock("./theme/calm", () => ({
  calmSpacing: { tight: 4, cozy: 8, comfortable: 16, generous: 48 },
  calmRadii: { soft: 12 },
}));
jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));
jest.mock("../services/haptics", () => ({
  impact: () => {},
  ImpactFeedbackStyle: { Light: "light" },
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { source?: string }) => (opts?.source ? `${k}:${opts.source}` : k),
  }),
}));
// 0.1.89: el área segura queda fijada en 24 para probar que la
// pantalla la aplica a su raíz (en el aparato la da el sistema).
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
}));

describe("GuideLibraryScreen", () => {
  beforeEach(() => {
    mockLlamaLoad.mockClear();
    mockEmbeddingLoad.mockClear();
    mockState.packs = [{ id: "pack-1", label: "Pack Uno", format: "sqlite-pack" }];
  });

  it("lista los packs instalados y sus guías", async () => {
    const { GuideLibraryScreen } = require("./GuideLibraryScreen");
    await render(<GuideLibraryScreen onClose={() => {}} />);
    expect(await screen.findByText("Pack Uno")).toBeTruthy();
    expect(screen.getByText("CPR for adults")).toBeTruthy();
    expect(screen.getByText("Burns")).toBeTruthy();
    expect(screen.getByText("guideLibrary.intro")).toBeTruthy();
  });

  it("abrir una guía enseña su texto entero y volver regresa a la lista", async () => {
    const { GuideLibraryScreen } = require("./GuideLibraryScreen");
    await render(<GuideLibraryScreen onClose={() => {}} />);
    fireEvent.press(await screen.findByText("CPR for adults"));
    expect(await screen.findByText(/Check response first/)).toBeTruthy();
    expect(screen.getByText(/Push in the center/)).toBeTruthy();
    expect(screen.getByText("sourceReader.source:NIDO — CPR for adults")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("guideLibrary.back"));
    expect(await screen.findByText("Burns")).toBeTruthy();
  });

  it("sin packs con guías enseña el estado vacío honesto", async () => {
    mockState.packs = [];
    const { GuideLibraryScreen } = require("./GuideLibraryScreen");
    await render(<GuideLibraryScreen onClose={() => {}} />);
    expect(await screen.findByText("guideLibrary.noPacks")).toBeTruthy();
  });

  it("RED TEAM 2026-11-08: un texto gigante se pinta recortado y con aviso visible", async () => {
    mockState.guidesByPack["pack-1"] = [
      ...mockState.guidesByPack["pack-1"],
      { id: 3, key: "giant", lang: "en", title: "Giant guide", category: "misc", region: "", sources: "", verified: "" },
    ];
    mockState.docs["pack-1:3"] = {
      title: "Giant guide",
      source: "",
      body: "START " + "x".repeat(150_000) + " ENDMARKER",
    };
    const { GuideLibraryScreen } = require("./GuideLibraryScreen");
    await render(<GuideLibraryScreen onClose={() => {}} />);
    fireEvent.press(await screen.findByText("Giant guide"));
    expect(await screen.findByText(/START/)).toBeTruthy();
    expect(screen.getByText("guideLibrary.truncated")).toBeTruthy();
    expect(screen.queryByText(/ENDMARKER/)).toBeNull();
  });

  it("RED TEAM 2026-11-08: una guía larga pero real (10.000 caracteres) se pinta entera y sin aviso", async () => {
    mockState.guidesByPack["pack-1"] = [
      ...mockState.guidesByPack["pack-1"],
      { id: 4, key: "long", lang: "en", title: "Long guide", category: "misc", region: "", sources: "", verified: "" },
    ];
    mockState.docs["pack-1:4"] = {
      title: "Long guide",
      source: "",
      body: "BEGIN " + "y".repeat(10_000) + " FINALWORD",
    };
    const { GuideLibraryScreen } = require("./GuideLibraryScreen");
    await render(<GuideLibraryScreen onClose={() => {}} />);
    fireEvent.press(await screen.findByText("Long guide"));
    expect(await screen.findByText(/FINALWORD/)).toBeTruthy();
    expect(screen.queryByText("guideLibrary.truncated")).toBeNull();
  });

  it("una guía que ya no está enseña el error de lectura", async () => {
    mockState.docs["pack-1:2"] = null;
    const { GuideLibraryScreen } = require("./GuideLibraryScreen");
    await render(<GuideLibraryScreen onClose={() => {}} />);
    fireEvent.press(await screen.findByText("Burns"));
    expect(await screen.findByText("guideLibrary.readError")).toBeTruthy();
  });

  it("0.1.89: la raíz lleva el margen del área segura y el botón de cierre sigue cerrando", async () => {
    const { GuideLibraryScreen } = require("./GuideLibraryScreen");
    const onClose = jest.fn();
    const view = await render(<GuideLibraryScreen onClose={onClose} />);
    const flatStyle = (s) => Object.assign({}, ...(Array.isArray(s) ? s : [s]).filter(Boolean));
    const withInset = () => {
      const tree = view.toJSON();
      const root = Array.isArray(tree) ? tree[0] : tree;
      return root && flatStyle(root.props.style).paddingTop === 24 ? [root] : [];
    };
    expect(withInset().length).toBe(1);
    expect(screen.getByText("guideLibrary.title")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("common.done"));
    expect(onClose).toHaveBeenCalledTimes(1);
    // La vista de documento comparte la raíz: el margen sigue ahí.
    fireEvent.press(await screen.findByText("CPR for adults"));
    expect(await screen.findByText(/Check response first/)).toBeTruthy();
    expect(withInset().length).toBeGreaterThanOrEqual(1);
  });

  it("la ruta de lectura no carga ningún motor", async () => {
    const { GuideLibraryScreen } = require("./GuideLibraryScreen");
    await render(<GuideLibraryScreen onClose={() => {}} />);
    fireEvent.press(await screen.findByText("CPR for adults"));
    await screen.findByText(/Check response first/);
    expect(mockLlamaLoad).not.toHaveBeenCalled();
    expect(mockEmbeddingLoad).not.toHaveBeenCalled();
  });
});
