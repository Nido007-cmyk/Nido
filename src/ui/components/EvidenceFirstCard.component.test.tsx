/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// Programa bounty, tanda 1: la tarjeta de evidencia primero enseña la
// fuente principal y su frase que mejor responde, encima de la
// respuesta; el enlace a la guía entera solo sale si la fuente es un
// chunk de pack (lo único que el lector sabe abrir).
import React from "react";
import { render, screen } from "@testing-library/react-native";

jest.mock("../theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { surface: "#000", cardElevated: "#111", subtle: "#222" },
      text: { heading: "#fff", primary: "#fff", secondary: "#ccc", dim: "#999", accentCyan: "#0ff", accentEmerald: "#0f0" },
      border: { default: "#444", subtle: "#555" },
      emerald: { 500: "#2F9E44", 600: "#227A35", bgSubtle: "rgba(47,158,68,0.10)", border: "#2F9E44" },
      amber: { 500: "#D9A441", 600: "#B07C2A", bgSubtle: "rgba(217,164,65,0.10)", border: "#B07C2A" },
      crimson: { 500: "#B3442F", 600: "#93371F", bgSubtle: "rgba(179,68,47,0.10)", border: "#B3442F" },
      cyan: { 500: "#06B6D4", 600: "#0891B2", bgSubtle: "rgba(6,182,212,0.10)", border: "#06B6D4" },
    },
    typography: {
      ui: {
        body: { fontSize: 16, lineHeight: 22 },
        caption: { fontSize: 13, lineHeight: 18 },
      },
    },
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "es" } }),
}));

jest.mock("../../services/haptics", () => ({ impact: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("./SourceReader", () => ({ SourceReader: () => null }));

const { EvidenceFirstCard } = require("./EvidenceFirstCard");

const card = {
  chunkId: "pack:nido-esencial:12",
  title: "Quemaduras",
  highlight: "Enfría la quemadura con agua corriente.",
  excerpt: "Actúa pronto. Enfría la quemadura con agua corriente. Después cubre la zona.",
};

describe("EvidenceFirstCard", () => {
  it("enseña la fuente principal, su frase resaltada y el pasaje", async () => {
    await render(<EvidenceFirstCard card={card} />);
    expect(screen.getByText("sourceFootnotes.evidenceFirst")).toBeTruthy();
    expect(screen.getByText("Quemaduras")).toBeTruthy();
    expect(screen.getByText("Enfría la quemadura con agua corriente.")).toBeTruthy();
    expect(screen.getByText(/Actúa pronto/)).toBeTruthy();
  });

  it("con chunk de pack ofrece leer la guía entera; sin él, no", async () => {
    await render(<EvidenceFirstCard card={card} />);
    expect(screen.getByText("sourceFootnotes.readWhole")).toBeTruthy();
  });

  it("una fuente que no es de pack no finge el enlace", async () => {
    await render(<EvidenceFirstCard card={{ ...card, chunkId: "doc:local:7" }} />);
    expect(screen.getByText("Quemaduras")).toBeTruthy();
    expect(screen.queryByText("sourceFootnotes.readWhole")).toBeNull();
  });
});
