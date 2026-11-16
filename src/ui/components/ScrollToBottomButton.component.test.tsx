/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// 0.1.108 (pedido del dueño, 2026-11-16): «algo para irte en los
// chats hasta el final sin tener que hacer scroll». El botón flota
// sobre la lista solo cuando el usuario está arriba, lejos del
// final; un toque baja al último mensaje. Aquí se prueba el
// componente: visible pinta un botón accesible que responde al
// toque; no visible no pinta nada.
import { jest, describe, it, expect } from "@jest/globals";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("../theme", () => ({
  useTheme: () => ({
    colors: {
      id: "nightgarden",
      bg: { cardElevated: "#111", subtle: "#222" },
      text: { heading: "#fff", primary: "#eee", dim: "#888" },
      border: { default: "#333", subtle: "#444" },
      emerald: { 400: "#0f0", 500: "#0c0", border: "#0a0", bgSubtle: "#021" },
    },
    typography: {
      ui: { titleSm: { fontSize: 15 }, caption: { fontSize: 12 } },
      mono: { xs: { fontSize: 10 } },
    },
  }),
}));

jest.mock("../../services/haptics", () => ({
  impact: () => {},
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

jest.mock("./icons/NidoIcon", () => ({ NidoIcon: () => null }));

const { ScrollToBottomButton } = require("./ScrollToBottomButton");

describe("ScrollToBottomButton (0.1.108)", () => {
  it("visible: un botón con su etiqueta de accesibilidad; el toque llama a onPress", async () => {
    const onPress = jest.fn();
    await render(<ScrollToBottomButton visible onPress={onPress} accessibilityLabel="Ir al final" />);
    const btn = await screen.findByLabelText("Ir al final");
    expect(btn).toBeTruthy();
    fireEvent.press(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("no visible (ya estás al final): no pinta nada", async () => {
    await render(<ScrollToBottomButton visible={false} onPress={() => {}} accessibilityLabel="Ir al final" />);
    expect(screen.queryByLabelText("Ir al final")).toBeNull();
  });
});
