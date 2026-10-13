/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.31 (auditoría del loop): los textos que los handlers devuelven y el
 * router muestra tal cual (fecha de una nota, mensajes NIDO, eventos) van
 * en el idioma de la app, no siempre en español.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));

import { fmtDateTime, setHandlerLangForTest } from "./handlers";

const ISO = new Date(2026, 9, 13, 17, 5).toISOString();

describe("fmtDateTime en el idioma de la app", () => {
  it("inglés", () => {
    setHandlerLangForTest("en");
    expect(fmtDateTime(ISO)).toBe("Tuesday, October 13, 5:05 PM");
    expect(fmtDateTime(null)).toBe("no date");
  });
  it("portugués", () => {
    setHandlerLangForTest("pt");
    expect(fmtDateTime(ISO)).toBe("terça-feira, 13 de outubro, 17:05");
    expect(fmtDateTime(null)).toBe("sem data");
  });
  it("español (y lo de siempre si no hay idioma)", () => {
    setHandlerLangForTest("es");
    expect(fmtDateTime(ISO)).toBe("martes, 13 de octubre, 17:05");
    expect(fmtDateTime(null)).toBe("sin fecha");
    setHandlerLangForTest(null);
  });
});
