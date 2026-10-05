/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let mockTotalRam = 0;
let mockShouldThrow = false;
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => {
    if (mockShouldThrow) throw new Error("no native module");
    return mockTotalRam;
  },
  getMemoryInfo: () => ({ rssBytes: 0, totalPssBytes: 0 }),
}));

import { MODEL_CATALOG, pinnedSourceUrl } from "./manifest";
import {
  defaultLlmForRam,
  defaultLlmForDevice,
  contextSpecForModel,
  contextSpecForFilename,
  PREFERRED_LLM_ID,
  LIGHT_LLM_ID,
} from "./defaultModel";
import { estimateContextBytes, SYSTEM_HEADROOM_BYTES } from "../inference/ramBudget";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

beforeEach(() => {
  mockTotalRam = 0;
  mockShouldThrow = false;
});

describe("0.5B catalog entry", () => {
  it("exists with verified bytes, pinning and license", () => {
    const m = MODEL_CATALOG.find((e) => e.id === LIGHT_LLM_ID)!;
    expect(m).toBeDefined();
    expect(m.kind).toBe("llm");
    expect(m.sizeBytes).toBe(397808192);
    expect(m.sha256).toBe("6eb923e7d26e9cea28811e1a8e852009b21242fb157b26149d3b188f3a8c8653");
    expect(m.revision).toBe("41ba88dbac95fed2528c92514c131d73eb5a174b");
    expect(m.license).toBe("Apache-2.0");
    expect(m.required).toBe(false);
    expect(m.filename).toBe("models/qwen2.5-0.5b-instruct-q4km.gguf");
    // Pinned source contract: the mutable /resolve/main/ pointer is replaced.
    expect(pinnedSourceUrl(m)).toContain(`/resolve/${m.revision}/`);
    expect(pinnedSourceUrl(m)).not.toContain("/resolve/main/");
  });

  it("declares its RAM profile and default context", () => {
    const m = MODEL_CATALOG.find((e) => e.id === LIGHT_LLM_ID)!;
    expect(m.arch).toEqual({ nLayer: 24, nKvHeads: 2, headDim: 64 });
    expect(m.defaultNCtx).toBe(2048);
    expect(m.capabilities?.usesChatTemplate).toBe(true);
    expect(m.capabilities?.roles).toContain("fast");
  });

  it("1.5B keeps its declared arch (same numbers the pre-flight assumed)", () => {
    const m = MODEL_CATALOG.find((e) => e.id === PREFERRED_LLM_ID)!;
    expect(m.arch).toEqual({ nLayer: 28, nKvHeads: 2, headDim: 128 });
    expect(m.required).toBe(true);
  });
});

describe("contextSpecForModel", () => {
  it("uses the 0.5B arch + defaultNCtx", () => {
    const m = MODEL_CATALOG.find((e) => e.id === LIGHT_LLM_ID)!;
    const spec = contextSpecForModel(m);
    expect(spec).toMatchObject({
      fileSizeBytes: 397808192,
      nCtx: 2048,
      nLayer: 24,
      nKvHeads: 2,
      headDim: 64,
    });
    // ~0.52 GiB working set: 379.4 MiB weights + 24 MiB KV + 128 MiB compute
    const est = estimateContextBytes(spec);
    expect(est.totalBytes).toBeLessThan(0.6 * GiB);
    expect(est.totalBytes).toBeGreaterThan(0.45 * GiB);
  });

  it("1.5B estimate is unchanged vs the old DEFAULT_ARCH assumption", () => {
    const m = MODEL_CATALOG.find((e) => e.id === PREFERRED_LLM_ID)!;
    const est = estimateContextBytes(contextSpecForModel(m));
    // 940.4 + 112 + 256 MiB ≈ 1308 MiB
    expect(est.totalBytes).toBeGreaterThan(1300 * MiB);
    expect(est.totalBytes).toBeLessThan(1320 * MiB);
  });
});

describe("contextSpecForFilename", () => {
  it("resolves the catalog arch for a known file", () => {
    const spec = contextSpecForFilename("models/qwen2.5-0.5b-instruct-q4km.gguf", 397808192, 2048);
    expect(spec.nLayer).toBe(24);
    expect(spec.headDim).toBe(64);
  });

  it("leaves arch undefined for unknown files (pre-flight fallback)", () => {
    const spec = contextSpecForFilename("models/some-custom.gguf", 123, 4096);
    expect(spec.nLayer).toBeUndefined();
    expect(spec.fileSizeBytes).toBe(123);
  });
});

describe("defaultLlmForRam", () => {
  // Effective threshold from the pre-flight formula:
  // need(1.5B) + 0.5 GiB app baseline + 2 GiB headroom.
  const need15 = estimateContextBytes(
    contextSpecForModel(MODEL_CATALOG.find((e) => e.id === PREFERRED_LLM_ID)!)
  ).totalBytes;
  const threshold = need15 + 512 * MiB + SYSTEM_HEADROOM_BYTES;

  it("picks the 0.5B on a 4GB-class device (Tab A9+ reports ~3.7 GiB)", () => {
    expect(defaultLlmForRam(3.7 * GiB).id).toBe(LIGHT_LLM_ID);
  });

  it("picks the 1.5B on 6GB+ devices", () => {
    expect(defaultLlmForRam(6 * GiB).id).toBe(PREFERRED_LLM_ID);
    expect(defaultLlmForRam(8 * GiB).id).toBe(PREFERRED_LLM_ID);
    expect(defaultLlmForRam(12 * GiB).id).toBe(PREFERRED_LLM_ID);
  });

  it("flips exactly at the formula threshold", () => {
    expect(defaultLlmForRam(Math.ceil(threshold)).id).toBe(PREFERRED_LLM_ID);
    expect(defaultLlmForRam(Math.ceil(threshold) - 1).id).toBe(LIGHT_LLM_ID);
  });

  it("falls back to the historic default when blind (total <= 0)", () => {
    expect(defaultLlmForRam(0).id).toBe(PREFERRED_LLM_ID);
    expect(defaultLlmForRam(-1).id).toBe(PREFERRED_LLM_ID);
  });
});

describe("defaultLlmForDevice", () => {
  it("selects by the native total-RAM readout", () => {
    mockTotalRam = 3.7 * GiB;
    expect(defaultLlmForDevice().id).toBe(LIGHT_LLM_ID);
    mockTotalRam = 8 * GiB;
    expect(defaultLlmForDevice().id).toBe(PREFERRED_LLM_ID);
  });

  it("falls back to the historic default when the native module fails", () => {
    mockShouldThrow = true;
    expect(defaultLlmForDevice().id).toBe(PREFERRED_LLM_ID);
  });
});
