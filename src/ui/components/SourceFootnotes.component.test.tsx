/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// @ts-nocheck
// 0.1.61: the provenance line under an answer's sources ("3 frases de la
// guía · 1 del modelo sin fuente") is real text on screen, in the app's
// language, and only appears when there is something to count.
import React from "react";
import { render, screen } from "@testing-library/react-native";

let mockLang = "es";

jest.mock("../theme", () => ({
  useTheme: () => ({
    colors: {
      bg: { surface: "#000", cardElevated: "#111", subtle: "#222", card: "#111", terminal: "#333" },
      text: { heading: "#fff", primary: "#fff", secondary: "#ccc", dim: "#999", muted: "#888", accentCyan: "#0ff", accentEmerald: "#0f0", inverse: "#000" },
      border: { default: "#444", subtle: "#555", elevated: "#666" },
      emerald: { 400: "#3ECF6F", 500: "#2F9E44", 600: "#227A35", bgSubtle: "rgba(47,158,68,0.10)" },
      amber: { 600: "#B07C2A" },
      crimson: { 500: "#B3442F" },
      cyan: { 400: "#22D3EE", 500: "#06B6D4", bgSubtle: "rgba(6,182,212,0.10)" },
    },
    typography: {
      ui: {
        body: { fontSize: 16, lineHeight: 22 },
        caption: { fontSize: 13, lineHeight: 18 },
        headline: { fontSize: 20, lineHeight: 26 },
        micro: { fontSize: 11, lineHeight: 14 },
        title: { fontSize: 24, lineHeight: 30 },
      },
      mono: { xs: { fontSize: 11, lineHeight: 14 }, sm: { fontSize: 12, lineHeight: 16 } },
    },
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: mockLang } }),
}));

jest.mock("../../services/haptics", () => ({ impact: jest.fn(), ImpactFeedbackStyle: { Light: "light" } }));
jest.mock("./SourceReader", () => ({ SourceReader: () => null }));
jest.mock("./icons/NidoIcon", () => ({ NidoIcon: () => null }));

const { SourceFootnotes } = require("./SourceFootnotes");

const citations = [
  { chunkId: "pack:nido-esencial:12", docId: "d1", title: "Quemaduras", body: "Enfriar pronto…", score: 1, rawScore: 0.88, matchType: "semantic" },
];
const provenance = [
  { text: "Guía «Quemaduras» de NIDO Esencial…", origin: { kind: "fixed" } },
  { text: "Enfriar pronto una quemadura con agua.", origin: { kind: "guide" } },
  { text: "Es lo más importante.", origin: { kind: "guide" } },
  { text: "Aleja a la persona del calor.", origin: { kind: "guide" } },
];

describe("SourceFootnotes: provenance line", () => {
  beforeEach(() => {
    mockLang = "es";
  });

  it("shows the count of where the sentences come from, in Spanish", async () => {
    await render(<SourceFootnotes citations={citations} grounding="grounded" provenance={provenance} />);
    expect(screen.getByText("3 frases de la guía · 1 de un texto fijo de NIDO")).toBeTruthy();
  });

  it("follows the app language (English, Portuguese)", async () => {
    mockLang = "en-US";
    await render(<SourceFootnotes citations={citations} provenance={provenance} />);
    expect(screen.getByText("3 sentences from the guide · 1 from a fixed NIDO text")).toBeTruthy();
    mockLang = "pt";
    await render(<SourceFootnotes citations={citations} provenance={provenance} />);
    expect(screen.getByText("3 frases do guia · 1 de um texto fixo do NIDO")).toBeTruthy();
  });

  it("names a model sentence with no source as such", async () => {
    const p = [
      { text: "A.", origin: { kind: "source", n: 1, support: 1 } },
      { text: "B.", origin: { kind: "model", reason: "too-short-to-check" } },
    ];
    await render(<SourceFootnotes citations={citations} provenance={p} />);
    expect(screen.getByText("1 de las fuentes · 1 del modelo sin fuente")).toBeTruthy();
  });

  it("no provenance: the sources still show, with no count line", async () => {
    await render(<SourceFootnotes citations={citations} grounding="grounded" />);
    expect(screen.getByText("Quemaduras")).toBeTruthy();
    expect(screen.queryByText(/frases|fuente ·/)).toBeNull();
  });

  it("no sources: nothing is drawn", async () => {
    const { toJSON } = await render(<SourceFootnotes citations={[]} provenance={provenance} />);
    expect(toJSON()).toBeNull();
  });
});

describe("SourceFootnotes: color por fuente (bounty, tanda 1)", () => {
  const two = [
    citations[0],
    { chunkId: "pack:nido-esencial:13", docId: "d2", title: "Fiebre", body: "Medir la temperatura…", score: 1, rawScore: 0.7, matchType: "semantic" },
  ];

  function flatStyle(el: any) {
    const s = el.props.style;
    return Object.assign({}, ...(Array.isArray(s) ? s : [s]));
  }

  it("cada píldora lleva el acento de su fuente, distinto del de la otra", async () => {
    await render(<SourceFootnotes citations={two} grounding="grounded" />);
    const one = flatStyle(screen.getByText("1"));
    const twos = screen.getAllByText("2").map(flatStyle);
    // La píldora de la fuente 1: esmeralda del mock; la de la 2: ámbar.
    expect(one.color).toBe("#227A35");
    expect(twos.some((st) => st.color === "#B07C2A")).toBe(true);
  });
});

describe("SourceFootnotes: caja de comprobación (bounty, tanda 8)", () => {
  it("con conflictos, la nota de la caja sale bajo la respuesta", async () => {
    await render(
      <SourceFootnotes
        citations={citations}
        grounding="unverified"
        numberConflicts={[{ unit: "km", sourceSentence: "El telescopio Hubble orbita a unos 600 km." }]}
      />
    );
    expect(screen.getByText("sourceFootnotes.numberConflict")).toBeTruthy();
  });

  it("sin conflictos, ninguna nota de la caja", async () => {
    await render(<SourceFootnotes citations={citations} grounding="unverified" />);
    expect(screen.queryByText("sourceFootnotes.numberConflict")).toBeNull();
  });
});
