/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * T-14 (0.1.99): banderas de la serie de red.
 *
 * M-21: el defecto de `p2p.privateHelloOnly` pasa a ENCENDIDO (la
 * iniciación estricta manda desde la instalación), pero la ELECCIÓN del
 * usuario manda sobre el defecto: quien lo tocó conserva su valor, y el
 * lado respondedor solo endurece con el encendido EXPRESO
 * (`isFeatureExplicitlyEnabled`), nunca por el defecto.
 *
 * m-51: flag nuevo `p2p.relaySend` (defecto encendido: el sellado para el
 * relevo es el comportamiento de hoy) que el usuario puede apagar.
 */

const files = new Map<string, string>();

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///doc/",
  getInfoAsync: async (path: string) => ({ exists: files.has(path) }),
  readAsStringAsync: async (path: string) => {
    const c = files.get(path);
    if (c === undefined) throw new Error("not found");
    return c;
  },
  writeAsStringAsync: async (path: string, content: string) => {
    files.set(path, content);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const c = files.get(from);
    if (c === undefined) throw new Error("not found");
    files.delete(from);
    files.set(to, c);
  },
}));

import {
  isFeatureEnabled,
  isFeatureExplicitlyEnabled,
  setFeatureEnabled,
  setFeatureOverrideForTests,
  loadFeatureFlags,
  resetFeatureFlagsForTests,
} from "./featureFlags";

describe("T-14 · M-21: el saludo privado manda al llamar desde la instalación", () => {
  beforeEach(() => {
    files.clear();
    resetFeatureFlagsForTests();
  });

  it("sin elección guardada, el defecto es ENCENDIDO", () => {
    expect(isFeatureEnabled("p2p.privateHelloOnly")).toBe(true);
  });

  it("el defecto NO cuenta como encendido expreso (el respondedor no endurece)", () => {
    expect(isFeatureExplicitlyEnabled("p2p.privateHelloOnly")).toBe(false);
  });

  it("el encendido expreso sí cuenta como expreso", async () => {
    await setFeatureEnabled("p2p.privateHelloOnly", true);
    expect(isFeatureExplicitlyEnabled("p2p.privateHelloOnly")).toBe(true);
    expect(isFeatureEnabled("p2p.privateHelloOnly")).toBe(true);
  });

  it("quien lo APAGÓ conserva su elección tras «reiniciar» (su valor guardado manda)", async () => {
    files.set("file:///doc/feature-flags.json", JSON.stringify({ "p2p.privateHelloOnly": false }));
    await loadFeatureFlags();
    expect(isFeatureEnabled("p2p.privateHelloOnly")).toBe(false);
    expect(isFeatureExplicitlyEnabled("p2p.privateHelloOnly")).toBe(false);
  });

  it("quien lo ENCENDIÓ conserva su elección tras «reiniciar»", async () => {
    files.set("file:///doc/feature-flags.json", JSON.stringify({ "p2p.privateHelloOnly": true }));
    await loadFeatureFlags();
    expect(isFeatureEnabled("p2p.privateHelloOnly")).toBe(true);
    expect(isFeatureExplicitlyEnabled("p2p.privateHelloOnly")).toBe(true);
  });

  it("un override en memoria también es elección expresa", () => {
    setFeatureOverrideForTests("p2p.privateHelloOnly", true);
    expect(isFeatureExplicitlyEnabled("p2p.privateHelloOnly")).toBe(true);
    setFeatureOverrideForTests("p2p.privateHelloOnly", false);
    expect(isFeatureExplicitlyEnabled("p2p.privateHelloOnly")).toBe(false);
    expect(isFeatureEnabled("p2p.privateHelloOnly")).toBe(false);
  });
});

describe("T-14 · m-51: flag del sellado para el relevo", () => {
  beforeEach(() => {
    files.clear();
    resetFeatureFlagsForTests();
  });

  it("viene ENCENDIDO por defecto (sellar para el relevo es lo de hoy)", () => {
    expect(isFeatureEnabled("p2p.relaySend")).toBe(true);
  });

  it("apagarlo persiste y manda tras «reiniciar»", async () => {
    await setFeatureEnabled("p2p.relaySend", false);
    expect(isFeatureEnabled("p2p.relaySend")).toBe(false);
    resetFeatureFlagsForTests();
    await loadFeatureFlags();
    expect(isFeatureEnabled("p2p.relaySend")).toBe(false);
  });
});
