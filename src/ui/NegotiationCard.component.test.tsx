/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Auditoría completa 2026-10-31 (F9-01): las etiquetas de alcance
// de la tarjeta de consentimiento salían en inglés para el usuario
// portugués, con las traducciones ya escritas en los locales. La
// prueba monta la tarjeta de verdad, con getResource leyendo los
// JSON reales de los tres idiomas.
import React from "react";
import { render, screen } from "@testing-library/react-native";

const holder = { language: "pt" };

jest.mock("./theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { surface: "#000", cardElevated: "#111", subtle: "#222", terminal: "#333", card: "#111", modalOverlay: "rgba(0,0,0,0.5)" },
      text: { heading: "#fff", primary: "#fff", secondary: "#ccc", dim: "#999", accentCyan: "#0ff", accentEmerald: "#0f0", accentAmber: "#fa0", muted: "#888", inverse: "#000" },
      border: { default: "#444", subtle: "#555", elevated: "#666" },
      amber: { 600: "#B07C2A" },
      crimson: { 400: "#C05A44", 500: "#B3442F" },
      emerald: { 400: "#3ECF6F", 500: "#2F9E44", 600: "#227A35", bgSubtle: "rgba(47,158,68,0.10)" },
    },
    typography: {
      ui: {
        body: { fontSize: 16, lineHeight: 22 },
        caption: { fontSize: 13, lineHeight: 18 },
        subtext: { fontSize: 14, lineHeight: 20 },
        headline: { fontSize: 20, lineHeight: 26 },
        micro: { fontSize: 11, lineHeight: 14 },
        title: { fontSize: 24, lineHeight: 30 },
      },
      mono: { xs: { fontSize: 11, lineHeight: 14 } },
    },
  }),
}));

jest.mock("./components/icons/NidoIcon", () => ({
  NidoIcon: () => null,
}));

jest.mock("./components/calm/NidoMascot", () => ({
  NidoMascot: () => null,
}));

jest.mock("./components/PrivateTextInput", () => {
  const { TextInput } = require("react-native");
  return { PrivateTextInput: TextInput };
});

jest.mock("react-i18next", () => {
  const locales: Record<string, any> = {
    es: require("../i18n/locales/es.json"),
    en: require("../i18n/locales/en.json"),
    pt: require("../i18n/locales/pt.json"),
  };
  const dig = (obj: any, path: string) => path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
  return {
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: {
        language: holder.language,
        getResource: (lng: string, _ns: string, key: string) => dig(locales[lng], key),
      },
    }),
  };
});

import { NegotiationCard } from "./components/calm/NegotiationCard";

const proposal: any = {
  id: "p1",
  taskDescription: "Revisar las notas del proyecto",
  requestedScopes: ["read:notes", "read:knowledge", "write:reminders"],
  expiresAt: Date.now() + 30 * 60000,
};

async function renderCard(language: string) {
  holder.language = language;
  return render(
    <NegotiationCard
      proposal={proposal}
      peerName="Tablet de Alan"
      peerPkShort="ab12"
      onAccept={() => {}}
      onDecline={() => {}}
      onCounter={() => {}}
    />,
  );
}

describe("NegotiationCard — etiquetas de alcance (F9-01)", () => {
  it("en portugués las etiquetas salen en portugués, no en inglés", async () => {
    await renderCard("pt");
    expect(screen.getByText("Ler notas")).toBeTruthy();
    expect(screen.getByText("Ler base de conhecimento")).toBeTruthy();
    expect(screen.getByText("Criar lembretes")).toBeTruthy();
    expect(screen.queryByText("Read notes")).toBeNull();
  });

  it("en español y en inglés siguen en su idioma", async () => {
    const es = await renderCard("es");
    expect(screen.getByText("Leer notas")).toBeTruthy();
    es.unmount();
    await renderCard("en");
    expect(screen.getByText("Read notes")).toBeTruthy();
  });
});
