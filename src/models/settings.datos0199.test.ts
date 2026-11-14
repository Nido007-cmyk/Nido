/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Tanda T-03 de la 0.1.99 (auditoría de la app 2026-11-14, carril 06,
 * asiento m-63): si SecureStore falla al escribir el prompt
 * personalizado, el texto caía a settings.json EN CLARO y sin aviso —
 * justo lo que el blindaje 0.1.44 vino a cerrar. El valor que no se
 * puede cifrar vive solo en memoria (con reintento de cifrado en cada
 * lectura), y el fichero en claro no lo recibe nunca.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/doc/",
  getInfoAsync: vi.fn(async (p: string) => ({ exists: files.has(p) })),
  readAsStringAsync: vi.fn(async (p: string) => {
    if (!files.has(p)) throw new Error("missing");
    return files.get(p)!;
  }),
  writeAsStringAsync: vi.fn(async (p: string, v: string) => void files.set(p, v)),
  moveAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    files.set(to, files.get(from)!);
    files.delete(from);
  }),
  deleteAsync: vi.fn(async (p: string) => void files.delete(p)),
}));

import { createMemorySecureBackend, setTestSecureBackend } from "../privacy/keyManager";
import * as S from "./settings";

const SETTINGS = "/doc/settings.json";

const FAILING_BACKEND = {
  getItemAsync: async () => {
    throw new Error("keystore");
  },
  setItemAsync: async () => {
    throw new Error("keystore");
  },
  deleteItemAsync: async () => {},
};

beforeEach(() => files.clear());
afterEach(() => setTestSecureBackend(null));

describe("m-63: el prompt personalizado nunca cae en claro a settings.json", () => {
  it("con SecureStore caído, el fichero no contiene el prompt y la sesión lo conserva", async () => {
    setTestSecureBackend(FAILING_BACKEND);
    await S.setCustomSystemPrompt("mi prompt privado");
    expect(files.get(SETTINGS) ?? "").not.toContain("mi prompt privado");
    // El ajuste no se pierde dentro de la sesión (la promesa del
    // blindaje era no perderlo; lo que cambia es dónde vive mientras
    // el Keystore no responde: memoria, nunca el fichero en claro).
    expect(await S.getCustomSystemPrompt()).toBe("mi prompt privado");
  });

  it("cuando SecureStore vuelve, el valor en memoria se cifra y sale de la memoria volátil", async () => {
    setTestSecureBackend(FAILING_BACKEND);
    await S.setCustomSystemPrompt("a cifrar luego");
    const backend = createMemorySecureBackend();
    setTestSecureBackend(backend);
    expect(await S.getCustomSystemPrompt()).toBe("a cifrar luego");
    expect(await backend.getItemAsync("nido_private_custom_prompt")).toBe("a cifrar luego");
    expect(files.get(SETTINGS) ?? "").not.toContain("a cifrar luego");
  });

  it("clearSettings también limpia el valor que solo vivía en memoria", async () => {
    setTestSecureBackend(FAILING_BACKEND);
    await S.setCustomSystemPrompt("a borrar");
    await S.clearSettings();
    expect(await S.getCustomSystemPrompt()).toBe("");
    await expect(S.customPromptStillStored()).resolves.toBe(false);
  });

  it("con SecureStore sano el comportamiento es el de siempre (cifrado, sin pasar por el fichero)", async () => {
    const backend = createMemorySecureBackend();
    setTestSecureBackend(backend);
    await S.setCustomSystemPrompt("prompt sano");
    expect(await backend.getItemAsync("nido_private_custom_prompt")).toBe("prompt sano");
    expect(files.get(SETTINGS) ?? "").not.toContain("prompt sano");
    expect(await S.getCustomSystemPrompt()).toBe("prompt sano");
  });
});
