/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Offensive audit (0.1.18): settings changes made close together must not
 * erase each other, writes go through a temp file, and the defaults object is
 * never mutated.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface World {
  files: Map<string, string>;
  writes: string[];
  slowRead: boolean;
}
const world = ((globalThis as Record<string, unknown>).__nidoSettingsWorld ??= {
  files: new Map<string, string>(),
  writes: [],
  slowRead: false,
}) as World;

vi.mock("expo-file-system/legacy", () => {
  const w = (globalThis as Record<string, unknown>).__nidoSettingsWorld as World;
  const tick = () => new Promise((r) => setTimeout(r, 1));
  return {
    documentDirectory: "file:///docs/",
    getInfoAsync: async (path: string) => ({ exists: w.files.has(path) }),
    readAsStringAsync: async (path: string) => {
      if (w.slowRead) await tick();
      const v = w.files.get(path);
      if (v === undefined) throw new Error(`no existe: ${path}`);
      return v;
    },
    writeAsStringAsync: async (path: string, content: string) => {
      await tick();
      w.writes.push(path);
      w.files.set(path, content);
    },
    moveAsync: async ({ from, to }: { from: string; to: string }) => {
      const v = w.files.get(from);
      if (v === undefined) throw new Error(`no existe: ${from}`);
      w.files.set(to, v);
      w.files.delete(from);
    },
    deleteAsync: async (path: string) => {
      w.files.delete(path);
    },
  };
});

type S = typeof import("./settings");
let S: S;
beforeAll(async () => {
  S = await import("./settings");
});
beforeEach(() => {
  world.files.clear();
  world.writes.length = 0;
  world.slowRead = true;
});

const SETTINGS = "file:///docs/settings.json";

describe("settings — concurrency and atomic writes", () => {
  it("changes fired together all survive", async () => {
    await Promise.all([
      S.setDisabledToolNames(["place_call"]),
      S.setCustomSystemPrompt("a"),
      S.setCustomSystemPrompt("ab"),
      S.markGuideVisited("start.chat"),
      S.setLanguageId("en"),
      S.setP2PBatteryHintDismissed(true),
    ]);
    expect(await S.getDisabledToolNames()).toEqual(["place_call"]);
    expect(await S.getCustomSystemPrompt()).toBe("ab");
    expect(await S.getGuideVisited()).toEqual(["start.chat"]);
    expect(await S.getLanguageId()).toBe("en");
    expect(await S.getP2PBatteryHintDismissed()).toBe(true);
  });

  it("writes a temp file and renames it (never the live file directly)", async () => {
    await S.setHapticsEnabled(false);
    expect(world.writes).toEqual([`${SETTINGS}.tmp`]);
    expect(world.files.has(`${SETTINGS}.tmp`)).toBe(false);
    expect(JSON.parse(world.files.get(SETTINGS)!).hapticsEnabled).toBe(false);
  });

  it("one failed change doesn't block the next ones", async () => {
    world.files.set(SETTINGS, JSON.stringify({ format_version: 999 }));
    await expect(S.setHapticsEnabled(true)).rejects.toBeTruthy();
    world.files.delete(SETTINGS);
    await S.setHapticsEnabled(true);
    expect(await S.getHapticsEnabled()).toBe(true);
  });

  it("choosing a model never leaks into the defaults (after clearSettings it's gone)", async () => {
    await S.setActiveModelId("llm", "model-x");
    expect(await S.getActiveModelId("llm")).toBe("model-x");
    await S.clearSettings();
    expect(await S.getActiveModelId("llm")).toBeNull();
    // Also when the file existed without activeModelId.
    world.files.set(SETTINGS, JSON.stringify({ format_version: 1 }));
    await S.setActiveModelId("embedding", "e5");
    await S.clearSettings();
    expect(await S.getActiveModelId("embedding")).toBeNull();
  });

  it("clearSettings waits for a write already queued", async () => {
    const p = S.setHapticsEnabled(false);
    await S.clearSettings();
    await p;
    expect(world.files.has(SETTINGS)).toBe(false);
  });
});
