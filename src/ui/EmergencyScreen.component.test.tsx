/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// EmergencyScreen: la pestaña de emergencia en flujo (sana por el
// SafeAreaView raíz del app) y su hoja de elección de país, un
// <Modal> anclado al borde inferior de la ventana. 0.1.90: la
// hoja cerraba con 12 de padding de diseño y el final de la
// lista podía quedar bajo la barra del sistema; la regresión
// fija el inset inferior en 34 y exige 12 + 34 en la hoja.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("../rag/packs", () => ({
  loadAllPackFacts: async () => ({ regions: [], facts: [] }),
}));

jest.mock("../rag/packFacts", () => ({
  emergencyRegions: () => [{ code: "US", name: "United States" }],
  emergencyCard: () => ({
    name: "United States",
    numbers: [{ label: "Emergency", value: "911", tel: "tel:911" }],
    sources: ["PHMSA"],
  }),
  crisisCard: () => null,
  outdatedPackNote: () => null,
}));

jest.mock("../models/settings", () => ({
  getEmergencyRegion: async () => null,
  setEmergencyRegion: async () => {},
}));

jest.mock("../services/haptics", () => ({
  impact: () => {},
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

jest.mock("./theme/ThemeContext", () => ({
  useTheme: () => ({
    colors: {
      bg: { black: "#000", surface: "#111", modalOverlay: "rgba(0,0,0,0.5)", subtle: "#222", card: "#111" },
      text: { heading: "#fff", primary: "#eee", secondary: "#bbb", dim: "#888", muted: "#777", inverse: "#000", accentAmber: "#fa0", accentEmerald: "#0f0" },
      border: { default: "#333", subtle: "#444" },
      emerald: { 400: "#0f0", 500: "#0c0", 600: "#0a0", bgSubtle: "#021" },
      crimson: { 400: "#f66", 500: "#c33", 600: "#933" },
      amber: { 500: "#fa0", 600: "#c80", bgSubtle: "#210" },
      cyan: { 400: "#0ff", 500: "#0cc" },
    },
    typography: { ui: new Proxy({}, { get: () => ({}) }) },
  }),
}));

jest.mock("./components/icons/NidoIcon", () => ({ NidoIcon: () => null }));
jest.mock("./emergency/CprPractice", () => ({ CprPractice: () => null }));
jest.mock("./components/PrivateTextInput", () => {
  const { TextInput } = require("react-native");
  return { PrivateTextInput: TextInput };
});

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { name?: string }) => (opts?.name ? `${k}:${opts.name}` : k),
    i18n: { language: "es", resolvedLanguage: "es" },
  }),
}));

// Área segura fijada: abajo 34 (en el aparato la da el sistema).
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

const flatStyle = (s) => Object.assign({}, ...(Array.isArray(s) ? s : [s]).filter(Boolean));
const findByStyle = (tree, pred) => {
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (pred(flatStyle(n.props?.style))) found.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(tree);
  return found;
};

describe("EmergencyScreen", () => {
  it("0.1.90: la hoja de países suma el inset inferior a su padding de diseño", async () => {
    const { EmergencyScreen } = require("./EmergencyScreen");
    const view = await render(<EmergencyScreen onAsk={() => {}} onOpenLibrary={() => {}} />);
    fireEvent.press(await screen.findByLabelText("emergency.pickCountry"));
    expect(await screen.findByText("emergency.chooseCountry")).toBeTruthy();
    // La hoja: paddingBottom de diseño (12) + el inset del sistema (34).
    expect(findByStyle(view.toJSON(), (st) => st.paddingBottom === 46).length).toBeGreaterThanOrEqual(1);
  });
});
