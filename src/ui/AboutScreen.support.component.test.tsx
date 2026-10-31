/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// 2026-10-30: la tarjeta «Desarrollo de NIDO» de Acerca de. Se prueban los
// DOS caminos de copiado (el botón «Copiar» y el toque sobre la propia
// dirección) para las DOS direcciones, y que el portapapeles recibe el
// valor exacto, carácter a carácter — los literales de esta prueba son
// una segunda transcripción independiente de aboutSupport.ts.
// El mock de i18n devuelve la clave como texto, como en calm-screens.
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { surface: "#000", cardElevated: "#111", subtle: "#222", terminal: "#333", card: "#111", modalOverlay: "rgba(0,0,0,0.5)" },
      text: { heading: "#fff", primary: "#fff", secondary: "#ccc", dim: "#999", accentCyan: "#0ff", accentEmerald: "#0f0", muted: "#888", inverse: "#000" },
      border: { default: "#444", subtle: "#555", elevated: "#666" },
      amber: { 600: "#B07C2A" },
      crimson: { 500: "#B3442F" },
      emerald: { 400: "#3ECF6F", 500: "#2F9E44", 600: "#227A35", bgSubtle: "rgba(47,158,68,0.10)" },
    },
    typography: {
      ui: {
        body: { fontSize: 16, lineHeight: 22 },
        caption: { fontSize: 13, lineHeight: 18 },
        headline: { fontSize: 20, lineHeight: 26 },
        micro: { fontSize: 11, lineHeight: 14 },
        title: { fontSize: 24, lineHeight: 30 },
      },
      mono: { xs: { fontSize: 11, lineHeight: 14 } },
    },
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock("../services/haptics", () => ({
  impact: jest.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
}));

// Segunda transcripción independiente de las direcciones (2026-10-30).
const SOLANA = "G74aAtEB41eFAcXtRbBVcRVpZDgELBCoFeUo9AyTnjRK";
const BASE = "0x5c030688FAcF0c74a5fF5eB00686A0021d95c1fC";

describe("Acerca de · Desarrollo de NIDO: copiar por los dos caminos", () => {
  beforeEach(() => {
    (Clipboard.setStringAsync as jest.Mock).mockClear();
  });

  it("la sección se renderiza por claves i18n y enseña las dos direcciones completas", async () => {
    const { AboutScreen } = require("./AboutScreen");
    await render(<AboutScreen onClose={() => {}} />);
    expect(screen.getByText("aboutScreen.developmentTitle")).toBeTruthy();
    expect(screen.getByText("aboutScreen.developmentBody")).toBeTruthy();
    expect(screen.getByText("aboutScreen.developmentSolanaLabel")).toBeTruthy();
    expect(screen.getByText("aboutScreen.developmentBaseLabel")).toBeTruthy();
    expect(screen.getByText(SOLANA)).toBeTruthy();
    expect(screen.getByText(BASE)).toBeTruthy();
  });

  it.each([
    ["solana", SOLANA],
    ["base", BASE],
  ])("toque sobre la dirección y botón Copiar entregan %s exacta", async (id, address) => {
    const { AboutScreen } = require("./AboutScreen");
    await render(<AboutScreen onClose={() => {}} />);

    // Camino 1: tocar la propia dirección.
    await fireEvent.press(screen.getByTestId(`about-support-address-${id}`));
    expect(await screen.findByText("aboutScreen.developmentCopied")).toBeTruthy();
    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1);
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(address);

    // Camino 2: el botón «Copiar».
    await fireEvent.press(screen.getByTestId(`about-support-copy-${id}`));
    expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(2);
    expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(address);

    // Sin espacios, sin saltos, sin recortes, en ninguna de las dos llamadas.
    for (const call of (Clipboard.setStringAsync as jest.Mock).mock.calls) {
      expect(call[0]).toBe(address);
      expect(call[0]).not.toMatch(/\s/);
    }
  });
});
