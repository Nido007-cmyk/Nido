/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Programa bounty, tanda 1: los marcadores [n] de la respuesta se
// tiñen con el color de su fuente cuando la pantalla pasa la lista de
// colores; sin lista, el texto se pinta como siempre.
import React from "react";
import { render, screen } from "@testing-library/react-native";

jest.mock("../theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { surface: "#000", cardElevated: "#111", subtle: "#222", terminal: "#333" },
      text: { heading: "#fff", primary: "#eee", secondary: "#ccc", muted: "#888", accentCyan: "#0ff", accentEmerald: "#0f0" },
      border: { default: "#444" },
      emerald: { 400: "#3ECF6F" },
      cyan: { border: "#0aa" },
    },
    typography: {
      ui: {
        body: { fontSize: 16, lineHeight: 22 },
        bodyLg: { fontSize: 17, lineHeight: 24 },
        titleSm: { fontSize: 15, lineHeight: 20 },
        title: { fontSize: 20, lineHeight: 26 },
        titleLg: { fontSize: 24, lineHeight: 30 },
      },
      mono: { xs: { fontSize: 11, lineHeight: 14 }, sm: { fontSize: 12, lineHeight: 16 } },
    },
  }),
}));

jest.mock("../../services/haptics", () => ({ impact: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }));

const { MarkdownMessage } = require("./MarkdownMessage");

function flatStyle(el: any) {
  const s = el.props.style;
  return Object.assign({}, ...(Array.isArray(s) ? s : [s]));
}

describe("MarkdownMessage: color por fuente en los marcadores", () => {
  it("cada [n] lleva el color de su fuente", async () => {
    await render(
      <MarkdownMessage content="Se fundó en 1804 [1] y creció después [2]." citationColors={["#AA0000", "#00AA00"]} />,
    );
    expect(flatStyle(screen.getByText("[1]")).color).toBe("#AA0000");
    expect(flatStyle(screen.getByText("[2]")).color).toBe("#00AA00");
  });

  it("sin lista de colores, el marcador va en el color del texto", async () => {
    await render(<MarkdownMessage content="Se fundó en 1804 [1]." />);
    expect(flatStyle(screen.getByText("[1]")).color).toBe("#eee");
    expect(screen.getByText(/Se fundó en 1804/)).toBeTruthy();
  });

  it("un [n] fuera de la lista no se tiñe ni se pierde", async () => {
    await render(<MarkdownMessage content="Dato [9] sin fuente en la lista." citationColors={["#AA0000"]} />);
    expect(flatStyle(screen.getByText("[9]")).color).toBe("#eee");
    expect(screen.getByText(/Dato/)).toBeTruthy();
  });
});
