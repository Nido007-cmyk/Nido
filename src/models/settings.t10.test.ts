/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * settings.t10.test.ts — TANDA T-10 (0.1.99), m-32.
 *
 * setMaxTokens persistía cualquier número sin recorte (un -5 o un 1e9
 * llegaban al fichero y de ahí a la generación). La UI solo ofrece
 * 256–2048 (MAX_TOKENS_OPTIONS); el setter es la puerta que usan
 * también la restauración y cualquier código futuro, y es ahí donde
 * el rango se impone. Misma clase en setMemorySettings: aceptaba
 * cualquier `number`, NaN incluido, para sus campos numéricos.
 *
 * Arnés: el mismo FS en memoria de settings.fixture.test.ts.
 */
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
}));

import {
  setMaxTokens,
  getMaxTokens,
  setMemorySettings,
  getMemorySettings,
  DEFAULT_MAX_TOKENS,
} from "./settings";

beforeEach(() => {
  fx.reset();
});

describe("m-32: setMaxTokens recorta al rango que la UI ofrece", () => {
  it("un valor negativo no llega al fichero", async () => {
    await setMaxTokens(-5);
    expect(await getMaxTokens()).toBe(256);
  });

  it("un valor astronómico no llega al fichero", async () => {
    await setMaxTokens(1e9);
    expect(await getMaxTokens()).toBe(2048);
  });

  it("NaN e Infinity caen al valor por defecto, no al fichero", async () => {
    await setMaxTokens(Number.NaN);
    expect(await getMaxTokens()).toBe(DEFAULT_MAX_TOKENS);
    await setMaxTokens(Number.POSITIVE_INFINITY);
    expect(await getMaxTokens()).toBe(DEFAULT_MAX_TOKENS);
  });

  it("un valor dentro del rango pasa tal cual", async () => {
    await setMaxTokens(512);
    expect(await getMaxTokens()).toBe(512);
    await setMaxTokens(2048);
    expect(await getMaxTokens()).toBe(2048);
  });
});

describe("m-32 (barrido): setMemorySettings no persiste números no finitos", () => {
  it("NaN en un campo numérico se ignora; el resto del ajuste aplica", async () => {
    const before = await getMemorySettings();
    await setMemorySettings({ historyTurnThreshold: Number.NaN, autoSummarize: false });
    const after = await getMemorySettings();
    expect(after.historyTurnThreshold).toBe(before.historyTurnThreshold);
    expect(after.autoSummarize).toBe(false);
  });

  it("un número finito sigue aplicándose como siempre", async () => {
    await setMemorySettings({ maxSavedSessions: 25 });
    expect((await getMemorySettings()).maxSavedSessions).toBe(25);
  });
});
