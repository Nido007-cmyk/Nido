/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// 0.1.89 — la fila de pestañas de la pantalla NIDO: en el aparato
// del dueño, «Negociaciones» se partía en dos líneas («s»
// colgando) porque su columna igual no daba el ancho. RNTL no
// hace layout real, así que la regresión fija el contrato que lo
// impide: cada etiqueta en una sola línea (numberOfLines 1), su
// pestaña sin encoger (flexShrink 0) y la fila en un ScrollView
// horizontal que desplaza antes que partir. Con las etiquetas
// reales de los tres idiomas, incluida la larga en cada uno.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("./theme", () => ({
  __esModule: true,
  useTheme: () => ({
    colors: {
      bg: { card: "#222", cardElevated: "#111" },
      text: { primary: "#eee", secondary: "#bbb" },
    },
    typography: { ui: { subtext: { fontSize: 12 } } },
  }),
}));
jest.mock("./theme/calm", () => ({
  calmSpacing: { tight: 4, cozy: 8, comfortable: 16, generous: 48 },
  calmShadows: { whisper: {}, none: {} },
}));

const { NidoTabBar } = require("./NidoTabBar");

const TABS_ES = [
  { key: "chats", label: "Chats" },
  { key: "contactos", label: "Contactos" },
  { key: "enlace", label: "Enlace" },
  { key: "negociaciones", label: "Negociaciones" },
  { key: "packs", label: "Packs" },
];

function flatStyle(style) {
  return Object.assign({}, ...(Array.isArray(style) ? style : [style]).filter(Boolean));
}

function anyNode(node, pred) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => anyNode(n, pred));
  if (pred(node)) return true;
  return anyNode(node.children ?? [], pred);
}

describe("NidoTabBar", () => {
  it("las cinco etiquetas van en una línea, sin encoger, en una fila desplazable", async () => {
    const view = await render(<NidoTabBar tabs={TABS_ES} activeKey="chats" onSelect={() => {}} />);
    for (const { label } of TABS_ES) {
      expect(screen.getByText(label).props.numberOfLines).toBe(1);
      const tabStyle = flatStyle(screen.getByLabelText(label).props.style);
      expect(tabStyle.flexShrink).toBe(0);
      expect(tabStyle.minHeight).toBeGreaterThanOrEqual(40);
    }
    expect(anyNode(view.toJSON(), (n) => n.props && n.props.horizontal === true)).toBe(true);
  });

  it("la etiqueta larga de cada idioma cabe en el mismo contrato", async () => {
    const longest = [
      { key: "es", label: "Negociaciones" },
      { key: "en", label: "Negotiations" },
      { key: "pt", label: "Negociações" },
      { key: "conv", label: "Conversas" },
    ];
    await render(<NidoTabBar tabs={longest} activeKey="es" onSelect={() => {}} />);
    for (const item of longest) {
      expect(screen.getByText(item.label).props.numberOfLines).toBe(1);
      expect(flatStyle(screen.getByLabelText(item.label).props.style).flexShrink).toBe(0);
    }
  });

  it("tocar una pestaña la elige y la activa queda marcada", async () => {
    const onSelect = jest.fn();
    function StatefulBar() {
      const [active, setActive] = React.useState("chats");
      return (
        <NidoTabBar
          tabs={TABS_ES}
          activeKey={active}
          onSelect={(k) => {
            onSelect(k);
            setActive(k);
          }}
        />
      );
    }
    await render(<StatefulBar />);
    expect(screen.getByLabelText("Chats").props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByLabelText("Negociaciones"));
    expect(onSelect).toHaveBeenCalledWith("negociaciones");
    expect(screen.getByLabelText("Negociaciones").props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText("Chats").props.accessibilityState.selected).toBe(false);
  });
});
