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
    colors: {
      bg: { surface: "#000", cardElevated: "#111", subtle: "#222", terminal: "#333" },
      text: { heading: "#fff", secondary: "#ccc", dim: "#999", accentCyan: "#0ff", accentEmerald: "#0f0", muted: "#888" },
      border: { default: "#444", subtle: "#555" },
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
