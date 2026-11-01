/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Auditoría completa 2026-10-31 (F3-10): un settings.json corrupto
// degradaba a valores de fábrica en silencio, y entre lo que vuelve
// a su valor por defecto hay ajustes de seguridad (herramientas
// apagadas). Ahora la lectura que degrada deja un marcador durable
// y la pantalla principal lo consume una sola vez para avisar.
// Estas pruebas fijan el canal: marcador solo si el fichero existía
// y no se pudo leer; consumo único; un fichero sano no marca nada.

import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => {
  const DOC = "file:///docs/";
  const files = new Map<string, string>();
  return { DOC, files, reset: () => files.clear() };
});

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: fx.DOC,
  getInfoAsync: async (path: string) => ({ exists: fx.files.has(path) }),
  readAsStringAsync: async (path: string) => {
    const v = fx.files.get(path);
    if (v === undefined) throw new Error(`no existe: ${path}`);
    return v;
  },
  writeAsStringAsync: async (path: string, content: string) => {
    fx.files.set(path, content);
  },
  deleteAsync: async (path: string) => {
    fx.files.delete(path);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    fx.files.set(to, fx.files.get(from) ?? "");
    fx.files.delete(from);
  },
}));

import { clearSettings, getActiveModelId, takeSettingsRecoveryNotice } from "./settings";

const SETTINGS = `${fx.DOC}settings.json`;
const MARKER = `${fx.DOC}settings-recovered.json`;

describe("aviso de ajustes restablecidos (F3-10)", () => {
  beforeEach(() => fx.reset());

  it("un settings.json corrupto degrada y deja el marcador con fecha", async () => {
    fx.files.set(SETTINGS, "{esto no es json");
    expect(await getActiveModelId("llm")).toBeNull();
    expect(fx.files.has(MARKER)).toBe(true);
    const marker = JSON.parse(fx.files.get(MARKER) ?? "{}") as { at?: string };
    expect(typeof marker.at).toBe("string");
    expect(marker.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("sin fichero no hay marcador: la primera vez no es una avería", async () => {
    await getActiveModelId("llm");
    expect(fx.files.has(MARKER)).toBe(false);
  });

  it("un fichero sano no marca nada", async () => {
    fx.files.set(SETTINGS, JSON.stringify({ activeModelId: { llm: "m1" } }));
    expect(await getActiveModelId("llm")).toBe("m1");
    expect(fx.files.has(MARKER)).toBe(false);
  });

  it("el aviso se consume una sola vez", async () => {
    fx.files.set(SETTINGS, "{roto");
    await getActiveModelId("llm");
    const first = await takeSettingsRecoveryNotice();
    expect(typeof first).toBe("string");
    expect(fx.files.has(MARKER)).toBe(false);
    expect(await takeSettingsRecoveryNotice()).toBeNull();
  });

  it("sin marcador, el consumo devuelve null", async () => {
    expect(await takeSettingsRecoveryNotice()).toBeNull();
  });

  it("revisión 0.1.67 (F-REV-2): clearSettings se lleva también el marcador", async () => {
    // El marcador es del módulo de ajustes: su borrado deliberado no
    // puede dejar detrás un aviso de «ajustes dañados» pendiente.
    fx.files.set(SETTINGS, "{roto");
    await getActiveModelId("llm");
    expect(fx.files.has(MARKER)).toBe(true);
    await clearSettings();
    expect(fx.files.has(SETTINGS)).toBe(false);
    expect(fx.files.has(MARKER)).toBe(false);
    expect(await takeSettingsRecoveryNotice()).toBeNull();
  });
});
