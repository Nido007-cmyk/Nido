// @ts-nocheck
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
// 2026-11-07 (prueba física): con muchos chats el menú quedaba cortado:
// la lista de recientes era un ScrollView de 260 px dentro de otro, y en
// Android el de dentro no se movía. Ahora hay un solo scroll y los atajos
// siempre quedan a mano.
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

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
  useTranslation: () => ({
    t: (k: string, o?: { count?: number; title?: string }) => (o?.count != null ? `${k}:${o.count}` : k),
    i18n: { language: "es" },
  }),
}));
jest.mock("../services/haptics", () => ({ impact: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));
jest.mock("./DrawerFooterStats", () => ({ DrawerFooterStats: () => null }));
jest.mock("./components/PrivateTextInput", () => {
  const { TextInput } = require("react-native");
  return { PrivateTextInput: (p) => <TextInput {...p} /> };
});

const { Drawer } = require("./Drawer");

const sessions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    title: `Chat número ${i}`,
    summary: null,
    createdAt: 0,
    updatedAt: Date.now(),
  }));

const items = [{ key: "settings", icon: "settings", label: "Ajustes", onPress: () => {} }];

describe("menú lateral con muchos chats", () => {
  it("un solo scroll, con barra visible; los atajos siguen ahí", async () => {
    await render(<Drawer open onClose={() => {}} items={items} sessions={sessions(60)} />);
    // La lista de chats ya no es un scroll dentro del scroll del menú.
    expect(screen.getByTestId("drawer-session-list").type).toBe("View");
    const scroll = screen.getByTestId("drawer-scroll");
    expect(scroll.type).toBe("RCTScrollView");
    expect(scroll.props.showsVerticalScrollIndicator).toBe(true);
    expect(screen.getByText("Ajustes")).toBeTruthy();
  });

  it("se ven los primeros; «Ver todos» enseña el resto", async () => {
    await render(<Drawer open onClose={() => {}} items={items} sessions={sessions(60)} />);
    expect(screen.getByText("Chat número 0")).toBeTruthy();
    expect(screen.queryByText("Chat número 59")).toBeNull();
    await fireEvent.press(screen.getByText("drawer.showAll:45"));
    expect(screen.getByText("Chat número 59")).toBeTruthy();
    expect(screen.queryByText("drawer.showAll:45")).toBeNull();
  });

  it("buscar mira todos los chats, no solo los visibles", async () => {
    await render(<Drawer open onClose={() => {}} items={items} sessions={sessions(60)} />);
    await fireEvent.changeText(screen.getByLabelText("drawer.searchLabel"), "59");
    expect(screen.getByText("Chat número 59")).toBeTruthy();
  });

  it("con pocos chats no hay botón", async () => {
    await render(<Drawer open onClose={() => {}} items={items} sessions={sessions(4)} />);
    expect(screen.getByText("Chat número 3")).toBeTruthy();
    expect(screen.queryByText(/drawer\.showAll/)).toBeNull();
  });
});
