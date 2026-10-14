/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Component tests for Calm-migrated screens.
// Verifies: renders without crashing, has accessibility labels, uses Calm structure.
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

// Mock the theme hook
jest.mock("./theme", () => ({
  useTheme: () => ({
    // 2026-10-12: el mock quedó viejo: no traía typography ni varios
    // tokens que las tarjetas de AboutScreen usan hoy (bg.card, amber,
    // crimson, emerald, text.primary/inverse). La suite fallaba por el
    // mock, no por las pantallas.
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

describe("Calm-migrated screens", () => {
  it("AboutScreen renders with accessibility", async () => {
    const { AboutScreen } = require("./AboutScreen");
    await render(<AboutScreen onClose={() => {}} />);
    // Should have a close button with accessibility label
    expect(screen.getByLabelText("common.done")).toBeTruthy();
  });

  // 0.1.40: Acerca de → Licencias.
  it("AboutScreen abre la pantalla de licencias", async () => {
    const { AboutScreen } = require("./AboutScreen");
    await render(<AboutScreen onClose={() => {}} />);
    await fireEvent.press(screen.getByLabelText("aboutScreen.licensesOpen"));
    expect(await screen.findByText("licenses.title")).toBeTruthy();
  });

  it("LicensesScreen: la licencia de NIDO, cada modelo con su licencia y la nota de LFM", async () => {
    const { LicensesScreen } = require("./LicensesScreen");
    await render(<LicensesScreen onClose={() => {}} />);
    expect(screen.getByText(/Copyright \(c\) 2026 NIDO contributors/)).toBeTruthy();
    expect(screen.getByTestId("license-asset-lfm2.5-8b-a1b-q4km")).toBeTruthy();
    expect(screen.getByTestId("license-asset-qwen3-0.6b-q4km")).toBeTruthy();
    expect(screen.getByText("licenses.notes.lfm")).toBeTruthy();
    expect(screen.getAllByText("licenses.notes.ccBySa").length).toBeGreaterThan(0);
    expect(screen.getByText("licenses.knowledgeBody")).toBeTruthy();
  });

  it("LicensesScreen: tocar un paquete enseña su licencia", async () => {
    const { THIRD_PARTY } = require("../legal/licenses");
    const { LicensesScreen } = require("./LicensesScreen");
    await render(<LicensesScreen onClose={() => {}} />);
    const first = THIRD_PARTY.packages[0];
    const row = screen.getByLabelText(new RegExp(`^${first.name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} ${first.version},`));
    await fireEvent.press(row);
    if (first.files.length) {
      expect(screen.getAllByText(THIRD_PARTY.texts[first.files[0].text]).length).toBeGreaterThan(0);
    } else {
      expect(screen.getByText("licenses.noText")).toBeTruthy();
    }
  });

  // KnowledgeBaseScreen requires mocking expo modules (documentImporter)
  // Skipped: needs more elaborate mock setup
});
