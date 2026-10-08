/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * settings.version.test.ts — L1 FORMAT VERSIONING CONTRACT (settings.json).
 *
 * - Cada escritura estampa format_version=1.
 * - La lectura exige la versión cuando está presente: major desconocido o
 *   valor corrupto → fail-closed con SettingsVersionError (nunca degrada a
 *   defaults en silencio).
 * - Un fichero pre-versionado (sin format_version, instalaciones
 *   existentes) se acepta como v1 y se estampa en la próxima escritura.
 * - Claves desconocidas se siguen tolerando (spread sobre defaults).
 * - Fichero inexistente o JSON ilegible → defaults (comportamiento previo,
 *   sin cambios).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => {
  const DOC = "file:///docs/";
  const files = new Map<string, string>();
  return {
    DOC,
    files,
    reset: () => files.clear(),
  };
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
}));

import { SettingsVersionError } from "../security/formatVersion";
import {
  getThemeId,
  setThemeId,
  getLanguageId,
  clearSettings,
} from "./settings";

const SETTINGS_PATH = `${fx.DOC}settings.json`;

function writeRaw(content: string): void {
  fx.files.set(SETTINGS_PATH, content);
}

function readRaw(): unknown {
  return JSON.parse(fx.files.get(SETTINGS_PATH) ?? "null");
}

beforeEach(() => {
  fx.reset();
});

describe("settings.json version contract", () => {
  it("fichero inexistente → defaults", async () => {
    await expect(getThemeId()).resolves.toBe("daylight");
  });

  it("cada escritura estampa format_version=1", async () => {
    await setThemeId("nightgarden");
    expect(readRaw()).toMatchObject({ format_version: 1, themeId: "nightgarden" });
  });

  it("fichero pre-versionado (sin format_version) se acepta y se estampa al escribir", async () => {
    writeRaw(JSON.stringify({ themeId: "nightgarden", someFutureKey: "kept" }));
    // Claves desconocidas se toleran; la lectura no falla.
    await expect(getThemeId()).resolves.toBe("nightgarden");
    await setThemeId("daylight");
    expect(readRaw()).toMatchObject({ format_version: 1 });
  });

  it("format_version=1 se lee con normalidad", async () => {
    writeRaw(JSON.stringify({ format_version: 1, themeId: "nightgarden" }));
    await expect(getThemeId()).resolves.toBe("nightgarden");
  });

  it("format_version=2 (más nuevo) falla cerrado con SettingsVersionError", async () => {
    writeRaw(JSON.stringify({ format_version: 2, themeId: "nightgarden" }));
    const err = await getThemeId().catch((e) => e);
    expect(err).toBeInstanceOf(SettingsVersionError);
    expect((err as Error).name).toBe("SettingsVersionError");
    expect((err as Error).message).toContain("settings.json");
  });

  it("format_version corrupta falla cerrada (no degrada a defaults)", async () => {
    writeRaw(JSON.stringify({ format_version: "banana", themeId: "nightgarden" }));
    await expect(getThemeId()).rejects.toBeInstanceOf(SettingsVersionError);
    writeRaw(JSON.stringify({ format_version: null, themeId: "nightgarden" }));
    await expect(getLanguageId()).rejects.toBeInstanceOf(SettingsVersionError);
  });

  it("JSON ilegible → defaults (sin cambios respecto a antes)", async () => {
    writeRaw("{no es json");
    await expect(getThemeId()).resolves.toBe("daylight");
  });

  it("clearSettings deja el fichero inexistente → defaults", async () => {
    await setThemeId("nightgarden");
    await clearSettings();
    await expect(getThemeId()).resolves.toBe("daylight");
  });
});
