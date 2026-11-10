/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// SourceReader: el lector a pantalla completa de la guía fuente
// (un <Modal> con ventana propia). 0.1.90: su raíz no aplicaba el
// área segura ni arriba ni abajo; la regresión fija los insets
// (arriba 24, abajo 34) y exige que la pantalla sume el de arriba
// a su padding de diseño y el contenido del desplazamiento sume
// el de abajo al suyo.
import React from "react";
import { render, screen } from "@testing-library/react-native";

jest.mock("../theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { black: "#000", surface: "#111", cardElevated: "#111", subtle: "#222" },
      text: { heading: "#fff", primary: "#eee", secondary: "#bbb", dim: "#888", accentEmerald: "#0f0" },
      border: { default: "#333", subtle: "#444" },
      emerald: { 400: "#0f0", 600: "#0a0", bgSubtle: "#021" },
    },
    typography: { ui: { title: {}, body: {}, caption: {} } },
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, opts?: { source?: string }) => (opts?.source ? `${k}:${opts.source}` : k) }),
}));

jest.mock("../../rag/packs", () => ({
  __esModule: true,
  readPackSource: async () => ({
    title: "Fuga de gas",
    source: "PHMSA",
    parts: [{ id: "1", used: true, body: "Sal a pie y llama desde fuera." }],
  }),
}));

// Área segura fijada: arriba 24, abajo 34 (en el aparato la da el sistema).
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }),
}));

const flatStyle = (s) => Object.assign({}, ...(Array.isArray(s) ? s : [s]).filter(Boolean));
const findByStyle = (tree, pred) => {
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    // El margen inferior vive en el contentContainerStyle del
    // ScrollView, no en su style: se miran las dos props.
    if (pred(flatStyle(n.props?.style)) || pred(flatStyle(n.props?.contentContainerStyle))) found.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(tree);
  return found;
};

describe("SourceReader", () => {
  it("enseña la guía fuente entera con la parte usada resaltada", async () => {
    const { SourceReader } = require("./SourceReader");
    await render(<SourceReader chunkId="pack:1:1" onClose={() => {}} />);
    expect(await screen.findByText(/Sal a pie y llama desde fuera/)).toBeTruthy();
    expect(screen.getByText("sourceReader.usedPart")).toBeTruthy();
  });

  it("0.1.90: la pantalla suma el inset superior a su padding y el contenido suma el inferior", async () => {
    const { SourceReader } = require("./SourceReader");
    const view = await render(<SourceReader chunkId="pack:1:1" onClose={() => {}} />);
    await screen.findByText(/Sal a pie y llama desde fuera/);
    const tree = view.toJSON();
    // spacing.lg = 20 de diseño + 24 del sistema.
    expect(findByStyle(tree, (st) => st.paddingTop === 44).length).toBeGreaterThanOrEqual(1);
    // spacing.md = 12 de diseño + 34 del sistema, en el contenido desplazable.
    expect(findByStyle(tree, (st) => st.paddingBottom === 46).length).toBeGreaterThanOrEqual(1);
  });
});
