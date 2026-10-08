/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi } from "vitest";

// __DEV__ es un global de React Native: se define para el entorno de test.
vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

// Handlers de Fase D puros en entorno de test: se mockean los módulos
// nativos que no existen fuera del teléfono.
vi.mock("expo-calendar", () => ({}));
vi.mock("expo-contacts", () => ({}));
vi.mock("expo-document-picker", () => ({}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("expo-sqlite", () => ({}));
vi.mock("react-native", () => ({ Linking: { openURL: vi.fn() }, Platform: { OS: "android" } }));

import { dispatchToolCall } from "./dispatcher";
import { buildToolHandlers } from "./handlers";

const CSV = "producto,unidades\npan,10\nleche,6\npan,8";

describe("handlers Fase D (vía dispatcher)", () => {
  it("use_skill carga instrucciones de una skill conocida", async () => {
    const out = await dispatchToolCall(
      { name: "use_skill", arguments: { name: "analiza-datos" } },
      buildToolHandlers()
    );
    expect(out).toContain("Skill «analiza-datos» cargada");
    expect(out).toContain("analyze_table");
  });

  it("use_skill avisa con skill desconocida", async () => {
    const out = await dispatchToolCall(
      { name: "use_skill", arguments: { name: "volar" } },
      buildToolHandlers()
    );
    expect(out).toMatch(/No conozco la skill/);
    expect(out).toContain("analiza-datos");
  });

  it("analyze_table devuelve el informe estadístico", async () => {
    const out = await dispatchToolCall(
      { name: "analyze_table", arguments: { text: CSV } },
      buildToolHandlers()
    );
    expect(out).toContain("3 filas × 2 columnas");
    expect(out).toContain("suma=24");
    expect(out).toContain("«pan»(2)");
  });

  it("analyze_table aplica filtros y orden", async () => {
    const out = await dispatchToolCall(
      { name: "analyze_table", arguments: { text: CSV, filter: "producto=pan", sort_by: "-unidades" } },
      buildToolHandlers()
    );
    expect(out).toContain("2 filas");
  });

  it("calculate y convert_units siguen disponibles", async () => {
    const handlers = buildToolHandlers();
    expect(await dispatchToolCall({ name: "calculate", arguments: { expression: "15/100*200" } }, handlers)).toContain("30");
    expect(await dispatchToolCall(
      { name: "convert_units", arguments: { value: 1, from: "km", to: "m" } }, handlers
    )).toContain("1000 m");
  });
});
