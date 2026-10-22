/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
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

beforeEach(() => files.clear());
afterEach(() => setTestSecureBackend(null));

describe("custom system prompt is kept out of settings.json (blindaje 0.1.44)", () => {
  it("is stored in SecureStore, never in the plain settings file", async () => {
    setTestSecureBackend(createMemorySecureBackend());
    await S.setCustomSystemPrompt("mi secreto");
    expect(await S.getCustomSystemPrompt()).toBe("mi secreto");
    expect(files.get(SETTINGS) ?? "").not.toContain("mi secreto");
  });

  it("migrates an old value from the file and removes it there", async () => {
    files.set(SETTINGS, JSON.stringify({ activeModelId: {}, customSystemPrompt: "viejo" }));
    const backend = createMemorySecureBackend();
    setTestSecureBackend(backend);
    expect(await S.getCustomSystemPrompt()).toBe("viejo");
    expect(await backend.getItemAsync("nido_private_custom_prompt")).toBe("viejo");
    expect(files.get(SETTINGS)).not.toContain("viejo");
    expect(await S.getCustomSystemPrompt()).toBe("viejo");
  });

  it("falls back to the file when SecureStore fails, without losing the value", async () => {
    setTestSecureBackend({
      getItemAsync: async () => {
        throw new Error("keystore");
      },
      setItemAsync: async () => {
        throw new Error("keystore");
      },
      deleteItemAsync: async () => {},
    });
    await S.setCustomSystemPrompt("respaldo");
    expect(await S.getCustomSystemPrompt()).toBe("respaldo");
  });

  it("clearSettings also deletes the private value", async () => {
    const backend = createMemorySecureBackend();
    setTestSecureBackend(backend);
    await S.setCustomSystemPrompt("borrar");
    await S.clearSettings();
    expect(await backend.getItemAsync("nido_private_custom_prompt")).toBeNull();
  });

  it("only nido_private_ keys are accepted", async () => {
    const km = await import("../privacy/keyManager");
    await expect(km.readPrivateSetting("nido_db_key")).rejects.toThrow();
    await expect(km.writePrivateSetting("nido_db_key", "x")).rejects.toThrow();
  });
});
