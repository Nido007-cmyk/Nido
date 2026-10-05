import { describe, it, expect, vi } from "vitest";

let mockTotalRam = 0;
let mockRss = 0;
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => mockTotalRam,
  getMemoryInfo: () => ({ rssBytes: mockRss, totalPssBytes: mockRss }),
}));

import {
  estimateKvCacheBytes,
  estimateContextBytes,
  checkRamBudget,
  readRamSnapshot,
  toGb,
} from "./ramBudget";

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

// Bundled default model profile: Qwen2.5-1.5B-Instruct Q4_K_M.
const DEFAULT_MODEL = { fileSizeBytes: 986_048_768, nCtx: 4096 };

describe("estimateKvCacheBytes", () => {
  it("computes the exact transformer KV-cache formula (K+V, fp16)", () => {
    // 2 * 28 layers * 4096 ctx * 2 kv heads * 128 headDim * 2 bytes
    expect(estimateKvCacheBytes(28, 4096, 2, 128)).toBe(117_440_512);
  });

  it("scales linearly with context length", () => {
    expect(estimateKvCacheBytes(28, 512, 2, 128)).toBe(estimateKvCacheBytes(28, 4096, 2, 128) / 8);
  });
});

describe("estimateContextBytes", () => {
  it("sums weights + KV cache + compute buffers for the default model", () => {
    const e = estimateContextBytes(DEFAULT_MODEL);
    expect(e.weightsBytes).toBe(986_048_768);
    expect(e.kvCacheBytes).toBe(117_440_512);
    expect(e.computeBytes).toBe(256 * MiB);
    expect(e.totalBytes).toBe(e.weightsBytes + e.kvCacheBytes + e.computeBytes);
    // ~1.28 GiB ~= 1.40x the 0.92 GiB file — documents why the old flat
    // 1.15x factor under-estimated the real working set.
    expect(e.totalBytes / 986_048_768).toBeGreaterThan(1.3);
  });

  it("degrades gracefully when the file size is unknown (0)", () => {
    const e = estimateContextBytes({ fileSizeBytes: 0, nCtx: 512 });
    expect(e.weightsBytes).toBe(0);
    expect(e.totalBytes).toBe(e.kvCacheBytes + e.computeBytes);
    expect(e.totalBytes).toBeGreaterThan(0);
  });

  it("scales the compute allowance with nCtx (embedding-size context)", () => {
    const e = estimateContextBytes({ fileSizeBytes: 36_806_944, nCtx: 512 });
    expect(e.computeBytes).toBe(32 * MiB);
  });

  it("is deterministic", () => {
    expect(estimateContextBytes(DEFAULT_MODEL)).toEqual(estimateContextBytes(DEFAULT_MODEL));
  });
});

describe("checkRamBudget", () => {
  it("fits on a roomy device", () => {
    const v = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 12 * GiB, rssBytes: 1 * GiB });
    expect(v).not.toBeNull();
    expect(v!.fits).toBe(true);
    // 12 - 1 (rss) - 2 (headroom) = 9 GiB available
    expect(v!.availableBytes).toBe(9 * GiB);
    expect(v!.totalRamBytes).toBe(12 * GiB);
  });

  it("refuses on a tight device where the model would not fit", () => {
    // 3 GiB device, 800 MiB already resident: 3 - 0.78 - 2 = ~0.22 GiB free < ~1.28 GiB need
    const v = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 3 * GiB, rssBytes: 800 * MiB });
    expect(v).not.toBeNull();
    expect(v!.fits).toBe(false);
  });

  it("accounts for an already-high RSS (e.g. another resident context)", () => {
    const roomy = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 8 * GiB, rssBytes: 1 * GiB });
    const crowded = checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 8 * GiB, rssBytes: 5 * GiB });
    expect(roomy!.fits).toBe(true);
    expect(crowded!.fits).toBe(false);
  });

  it("returns null when blind (no usable total-RAM readout) so callers skip the check", () => {
    expect(checkRamBudget(DEFAULT_MODEL, { totalRamBytes: 0, rssBytes: 0 })).toBeNull();
    expect(checkRamBudget(DEFAULT_MODEL, { totalRamBytes: -1, rssBytes: 0 })).toBeNull();
  });

  it("blocks a 7B-class model on a busy 8 GiB device but allows it on 12 GiB", () => {
    const big = { fileSizeBytes: 4_683_074_240, nCtx: 4096 };
    // 8 GiB device with 2 GiB resident: 8 - 2 - 2 = 4 GiB free < ~4.72 GiB need
    const on8 = checkRamBudget(big, { totalRamBytes: 8 * GiB, rssBytes: 2 * GiB });
    const on12 = checkRamBudget(big, { totalRamBytes: 12 * GiB, rssBytes: 1 * GiB });
    expect(on8!.fits).toBe(false);
    expect(on12!.fits).toBe(true);
  });

  it("a small embedding context fits almost anywhere", () => {
    const emb = { fileSizeBytes: 36_806_944, nCtx: 512 };
    const v = checkRamBudget(emb, { totalRamBytes: 4 * GiB, rssBytes: 1 * GiB });
    expect(v!.fits).toBe(true);
    expect(v!.totalBytes).toBeLessThan(100 * MiB);
  });
});

describe("toGb", () => {
  it("formats GiB with one decimal", () => {
    expect(toGb(1.28 * GiB)).toBe("1.3");
    expect(toGb(12 * GiB)).toBe("12.0");
  });
});

describe("readRamSnapshot", () => {
  it("returns the native readout when available", () => {
    mockTotalRam = 8 * GiB;
    mockRss = 1 * GiB;
    expect(readRamSnapshot()).toEqual({ totalRamBytes: 8 * GiB, rssBytes: 1 * GiB });
  });

  it("returns null when blind (fail open, never block on missing data)", () => {
    mockTotalRam = 0;
    mockRss = 0;
    expect(readRamSnapshot()).toBeNull();
  });
});
