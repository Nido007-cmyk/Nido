/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.117 (UI nueva): el botón SOS de la cabecera del chat abre la pestaña
// Emergencia. Solo navega: no llama ni borra nada.
import { jest, describe, it, expect } from "@jest/globals";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("../services/haptics", () => ({
  impact: () => {},
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));
jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));
jest.mock("./components/calm/NidoMascot", () => ({ NidoMascot: () => null }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "es" } }),
}));
jest.mock("./theme", () => {
  const { getTypography } = require("./theme/typography");
  const { daylightTheme } = require("./theme/colors");
  return { useTheme: () => ({ colors: daylightTheme, typography: getTypography("standard") }) };
});

const base = {
  toneIcon: "🙂",
  deepResearchActive: false,
  onOpenDrawer: () => {},
  onNewChat: () => {},
};

describe("ChatHeader · SOS (0.1.117)", () => {
  const { ChatHeader } = require("./ChatHeader");

  it("con onOpenEmergency hay botón SOS y al tocarlo abre Emergencia", async () => {
    const onOpenEmergency = jest.fn();
    await render(<ChatHeader {...base} onOpenEmergency={onOpenEmergency} />);
    const sos = await screen.findByTestId("chat-header-sos");
    expect(screen.getByText("chatHeader.sos")).toBeTruthy();
    expect(screen.getByLabelText("chatHeader.sosA11y")).toBeTruthy();
    fireEvent.press(sos);
    expect(onOpenEmergency).toHaveBeenCalledTimes(1);
  });

  it("sin onOpenEmergency no se pinta (las demás cabeceras quedan igual)", async () => {
    await render(<ChatHeader {...base} />);
    expect(screen.queryByTestId("chat-header-sos")).toBeNull();
    expect(screen.getByLabelText("chatHeader.newChatSession")).toBeTruthy();
  });

  it("el SOS convive con el botón de pánico sin sustituirlo", async () => {
    const { Text } = require("react-native");
    await render(<ChatHeader {...base} onOpenEmergency={() => {}} panicSlot={<Text>panic</Text>} />);
    expect(screen.getByTestId("chat-header-sos")).toBeTruthy();
    expect(screen.getByText("panic")).toBeTruthy();
  });
});
