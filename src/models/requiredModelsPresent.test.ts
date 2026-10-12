/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * SETUP-LOOP-2026-10-10 regression: a tablet whose user picked the *other*
 * LLM in the setup wizard (e.g. the light 0.5B on a device whose RAM-based
 * default is the 1.5B) was sent back to required-setup on every launch,
 * because requiredModelsPresent() only checked the device default.
 */

vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 8 * 1024 ** 3,
  getMemoryInfo: () => ({ rssBytes: 0 }),
}));
vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///doc/" }));
vi.mock("bundled-assets", () => ({ copyBundledAssetToFile: async () => 0 }));
vi.mock("../privacy/networkAudit", () => ({
  networkAudit: { record: () => {} },
  sanitizeEndpoint: (s: string) => s,
}));

let activeLlm: string | null = null;
let activeEmbedding: string | null = null;
vi.mock("./settings", () => ({
  getActiveModelId: async (kind: string) => (kind === "embedding" ? activeEmbedding : activeLlm),
}));

import { ModelManager } from "./ModelManager";
import { MODEL_CATALOG, type CatalogModel } from "./manifest";
import { defaultLlmForDevice } from "./defaultModel";

function managerWithInstalled(installed: Set<string>) {
  const mm = new ModelManager();
  vi.spyOn(mm, "statusOf").mockImplementation(async (asset: CatalogModel) => ({
    asset,
    present: installed.has(asset.id),
    sizeOnDiskBytes: installed.has(asset.id) ? asset.sizeBytes : 0,
  }) as never);
  return mm;
}

const nonLlmRequired = MODEL_CATALOG.filter((m) => m.required && m.kind !== "llm").map((m) => m.id);
const deviceDefault = defaultLlmForDevice();
const otherLlm = MODEL_CATALOG.find((m) => m.kind === "llm" && m.id !== deviceDefault.id)!;

describe("requiredModelsPresent — honours the LLM chosen in setup", () => {
  beforeEach(() => {
    activeLlm = null;
    activeEmbedding = null;
  });

  it("is true when the user's chosen (non-default) LLM is installed", async () => {
    activeLlm = otherLlm.id;
    const mm = managerWithInstalled(new Set([...nonLlmRequired, otherLlm.id]));
    expect(await mm.requiredModelsPresent()).toBe(true);
  });

  it("still accepts the device default when no choice was saved", async () => {
    const mm = managerWithInstalled(new Set([...nonLlmRequired, deviceDefault.id]));
    expect(await mm.requiredModelsPresent()).toBe(true);
  });

  it("is false when no LLM is installed", async () => {
    activeLlm = otherLlm.id;
    const mm = managerWithInstalled(new Set(nonLlmRequired));
    expect(await mm.requiredModelsPresent()).toBe(false);
  });

  it("is false when a non-LLM required asset is missing", async () => {
    if (nonLlmRequired.length === 0) return;
    activeLlm = otherLlm.id;
    const mm = managerWithInstalled(new Set([otherLlm.id]));
    expect(await mm.requiredModelsPresent()).toBe(false);
  });
});

describe("requiredModelsPresent — honours the search model chosen in setup (es/pt)", () => {
  const e5 = MODEL_CATALOG.find((m) => m.id === "multilingual-e5-small-q8")!;
  const bge = MODEL_CATALOG.find((m) => m.kind === "embedding" && m.required)!;
  const notEmbedding = MODEL_CATALOG.filter((m) => m.required && m.kind !== "llm" && m.kind !== "embedding").map((m) => m.id);
  beforeEach(() => {
    activeLlm = null;
    activeEmbedding = null;
  });

  it("multilingual install (e5 active, bge never downloaded) does NOT loop back to setup", async () => {
    activeEmbedding = e5.id;
    const mm = managerWithInstalled(new Set([...notEmbedding, e5.id, deviceDefault.id]));
    expect(await mm.requiredModelsPresent()).toBe(true);
  });

  it("e5 active but its file missing → setup", async () => {
    activeEmbedding = e5.id;
    const mm = managerWithInstalled(new Set([...notEmbedding, bge.id, deviceDefault.id]));
    expect(await mm.requiredModelsPresent()).toBe(false);
  });

  it("no choice saved → the required bge, as before", async () => {
    const withBge = managerWithInstalled(new Set([...notEmbedding, bge.id, deviceDefault.id]));
    expect(await withBge.requiredModelsPresent()).toBe(true);
    const withoutBge = managerWithInstalled(new Set([...notEmbedding, e5.id, deviceDefault.id]));
    expect(await withoutBge.requiredModelsPresent()).toBe(false);
  });
});
