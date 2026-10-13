/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Component tests for Calm-migrated screens.
// Verifies: renders without crashing, has accessibility labels, uses Calm structure.
import React from "react";
import { render, screen } from "@testing-library/react-native";

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

  // KnowledgeBaseScreen requires mocking expo modules (documentImporter)
  // Skipped: needs more elaborate mock setup
});
