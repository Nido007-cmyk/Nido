/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type FakeContext = {
  model: string;
  released: boolean;
  release: () => Promise<void>;
  completion: (params: unknown, onToken: (d: { token: string }) => void) => Promise<{ text: string }>;
  stopCompletion: () => Promise<void>;
  releasedWhileGenerating: boolean;
};
const created: FakeContext[] = [];
let inFlightInits = 0;
let maxConcurrentInits = 0;

vi.mock("llama.rn", () => ({
  initLlama: async ({ model }: { model: string }) => {
    inFlightInits++;
    maxConcurrentInits = Math.max(maxConcurrentInits, inFlightInits);
    await new Promise((r) => setTimeout(r, 5));
    inFlightInits--;
    const finishes: Array<() => void> = [];
    let generating = false;
    const ctx: FakeContext = {
      model,
      released: false,
      releasedWhileGenerating: false,
      release: async () => {
        if (generating) ctx.releasedWhileGenerating = true;
        ctx.released = true;
      },
      // Like llama.cpp: runs until stopped, and settles a moment after the stop (prompt still processing).
      completion: (_params, onToken) =>
        new Promise((resolve) => {
          generating = true;
          onToken({ token: "Hi" });
          finishes.push(() =>
            setTimeout(() => {
              generating = false;
              resolve({ text: "Hi" });
            }, 20)
          );
        }),
      stopCompletion: async () => {
        finishes.splice(0).forEach((f) => f());
      },
    };
    created.push(ctx);
    return ctx;
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async () => ({ exists: true, size: 1_000_000 }),
}));
let mockTotalRamBytes = 12 * 1024 ** 3;
let mockRssBytes = 1024 ** 3;
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => mockTotalRamBytes,
  getMemoryInfo: () => ({ rssBytes: mockRssBytes }),
}));
// The integrity gate is covered by src/models/modelTrust.test.ts; here it
// is stubbed so engine behavior is tested in isolation.
vi.mock("../models/modelTrust", () => ({
  assertTrustedModelFileByName: vi.fn(async () => {}),
}));

import { LlamaEngine } from "./LlamaEngine";

const live = () => created.filter((c) => !c.released);

beforeEach(() => {
  created.length = 0;
  inFlightInits = 0;
  maxConcurrentInits = 0;
  mockTotalRamBytes = 12 * 1024 ** 3;
  mockRssBytes = 1024 ** 3;
});

describe("LlamaEngine load/unload", () => {
  it("never leaves an orphaned context when loads overlap (quick model swaps)", async () => {
    const engine = new LlamaEngine();
    await Promise.all([engine.load("models/a.gguf"), engine.load("models/b.gguf"), engine.load("models/a.gguf")]);
    expect(maxConcurrentInits).toBe(1);
    expect(live()).toHaveLength(1);
    expect(live()[0].model).toBe("file:///docs/models/a.gguf");
    expect(engine.getModelInfo()?.filename).toBe("models/a.gguf");
  });

  it("skips a load of the model that is already loaded", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    await Promise.all([engine.load("models/a.gguf"), engine.load("models/a.gguf")]);
    expect(created).toHaveLength(1);
  });

  it("serializes unload with a pending load, leaving nothing loaded", async () => {
    const engine = new LlamaEngine();
    await Promise.all([engine.load("models/a.gguf"), engine.unload()]);
    expect(live()).toHaveLength(0);
    expect(engine.isLoaded).toBe(false);
  });

  it("keeps working after a failed load", async () => {
    const engine = new LlamaEngine();
    const fs = await import("expo-file-system/legacy");
    const spy = vi.spyOn(fs, "getInfoAsync").mockResolvedValueOnce({ exists: false } as any);
    await expect(engine.load("models/missing.gguf")).rejects.toThrow(/not found/);
    await engine.load("models/b.gguf");
    expect(engine.getModelInfo()?.filename).toBe("models/b.gguf");
    spy.mockRestore();
  });

  it("stops and waits for a running generation before releasing its model", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    const reply = engine.generate({ prompt: "say hi" });
    await engine.load("models/b.gguf");
    await expect(reply).resolves.toBe("Hi");
    expect(created[0].released).toBe(true);
    expect(created[0].releasedWhileGenerating).toBe(false);
    expect(engine.getModelInfo()?.filename).toBe("models/b.gguf");
  });

  it("F3-2026-10-06: two concurrent generate() calls both settle; unload waits for both", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    // Two generations started without awaiting — both must resolve (no hang),
    // and unload must wait for both (no release while generating).
    const r1 = engine.generate({ prompt: "one" });
    const r2 = engine.generate({ prompt: "two" });
    await engine.unload();
    await expect(r1).resolves.toBe("Hi");
    await expect(r2).resolves.toBe("Hi");
    expect(created[0].released).toBe(true);
    expect(created[0].releasedWhileGenerating).toBe(false);
    expect(engine.isLoaded).toBe(false);
  });

  it("refuses to load with a clear RAM error when the model does not fit", async () => {
    // 2 GiB device, 1 GiB resident: 2 - 1 - 2 (headroom) = 0 available.
    // The error must mention RAM so ModelLoadErrorCard's memory diagnosis picks it up.
    mockTotalRamBytes = 2 * 1024 ** 3;
    mockRssBytes = 1024 ** 3;
    const engine = new LlamaEngine();
    await expect(engine.load("models/a.gguf")).rejects.toThrow(/RAM/);
    expect(created).toHaveLength(0);
    expect(engine.isLoaded).toBe(false);
  });

  it("loads when the model fits the device budget", async () => {
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.isLoaded).toBe(true);
    expect(created).toHaveLength(1);
  });

  it("skips the pre-flight when the RAM readout is blind instead of blocking", async () => {
    mockTotalRamBytes = 0;
    const engine = new LlamaEngine();
    await engine.load("models/a.gguf");
    expect(engine.isLoaded).toBe(true);
  });
});
