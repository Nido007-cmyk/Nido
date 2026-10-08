/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ram-monitor is a native module: stub it so suites that reach the models
// layer transitively (via ModelManager -> defaultModel -> ramBudget) don't
// pull react-native's Flow sources into vitest. Same pattern as
// src/inference/LlamaEngine.test.ts.
vi.mock("ram-monitor", () => ({
  getDeviceTotalRamBytes: () => 8 * 1024 ** 3,
  getMemoryInfo: () => ({ rssBytes: 0 }),
}));
import { createHash } from "crypto";

// T-005 regression: verifyChecksum must hash the file's RAW BYTES, not the
// base64 text of those bytes. The old implementation hashed the base64
// string itself, so verification failed deterministically for every asset
// (observed on-device: bge-small-en-v1.5 + corpus packs deleted with
// "sha256 mismatch" even though the downloads were byte-perfect).
//
// Streaming: the file is read in ~1 MiB chunks via position/length reads
// (expo-file-system semantics: position/length are FILE BYTES, the result
// is base64 of exactly those bytes). The mock below honors that contract.

const RAW = new Uint8Array([0, 1, 2, 250, 255, 72, 101, 108, 108, 111]);
const REAL_SHA256 = createHash("sha256").update(RAW).digest("hex");

// Fixture "file on disk".
let fileBytes: Uint8Array = RAW;
const readCalls: Array<{ position?: number; length?: number }> = [];

const readAsStringAsyncMock = vi.fn(
  async (...args: any[]): Promise<string> => {
    const opts = args[1] as { position?: number; length?: number } | undefined;
    readCalls.push({ position: opts?.position, length: opts?.length });
    const pos = opts?.position ?? 0;
    const len = opts?.length ?? fileBytes.length - pos;
    return Buffer.from(fileBytes.subarray(pos, pos + len)).toString("base64");
  }
);
const getInfoAsyncMock = vi.fn(async (..._args: any[]) => ({
  exists: true,
  isDirectory: false,
  size: fileBytes.length,
}));

vi.mock("expo-file-system/legacy", () => ({
  default: undefined,
  documentDirectory: "file:///docs/",
  EncodingType: { Base64: "base64" },
  readAsStringAsync: (...args: any[]) => readAsStringAsyncMock(...args),
  getInfoAsync: (...args: any[]) => getInfoAsyncMock(...args),
}));

vi.mock("bundled-assets", () => ({ copyBundledAssetToFile: async () => 0 }));
vi.mock("./storageBudget", () => ({ checkStorageForDownload: async () => ({ ok: true }) }));
vi.mock("../privacy/networkAudit", () => ({
  networkAudit: { log: () => {} },
  sanitizeEndpoint: (u: string) => u,
}));

import { ModelManager, VERIFY_CHUNK_BYTES } from "./ModelManager";
import { DownloadFailure } from "./downloadErrors";

const mgr = new ModelManager([]);
const asset = { filename: "models/test.gguf", sha256: REAL_SHA256 };

beforeEach(() => {
  fileBytes = RAW;
  readCalls.length = 0;
  readAsStringAsyncMock.mockClear();
  getInfoAsyncMock.mockClear();
});

describe("verifyChecksum (streaming)", () => {
  it("hashes the raw file bytes, not the base64 text", async () => {
    expect(await mgr.verifyChecksum(asset)).toBe(true);
    expect(readAsStringAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("reads a multi-chunk file with sequential byte positions", async () => {
    // 2 full chunks + a 10-byte tail → 3 reads at exact byte offsets.
    fileBytes = new Uint8Array(2 * VERIFY_CHUNK_BYTES + 10);
    for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = i & 0xff;
    const expected = createHash("sha256").update(fileBytes).digest("hex");

    expect(await mgr.verifyChecksum({ filename: "models/big.gguf", sha256: expected })).toBe(true);
    expect(readCalls).toEqual([
      { position: 0, length: VERIFY_CHUNK_BYTES },
      { position: VERIFY_CHUNK_BYTES, length: VERIFY_CHUNK_BYTES },
      { position: 2 * VERIFY_CHUNK_BYTES, length: 10 },
    ]);
  });

  it("rejects a file whose bytes do not match the expected sha256", async () => {
    const ok = await mgr.verifyChecksum({ ...asset, sha256: "00".repeat(32) });
    expect(ok).toBe(false);
  });

  it("FAILS CLOSED when the asset declares no sha256 (throws instead of reading)", async () => {
    // Integrity invariant: "no hash declared" must never read as
    // "verified". verifyChecksum throws; checkModelTrust() is the
    // non-throwing verdict API.
    await expect(mgr.verifyChecksum({ filename: "models/test.gguf", sha256: "" })).rejects.toThrow(
      /no expected SHA-256/
    );
    expect(readAsStringAsyncMock).not.toHaveBeenCalled();
  });

  it("returns false for a missing file", async () => {
    getInfoAsyncMock.mockResolvedValueOnce({ exists: false, isDirectory: false, size: 0 });
    expect(await mgr.verifyChecksum(asset)).toBe(false);
  });

  it("reports progress per chunk, ending at the total", async () => {
    fileBytes = new Uint8Array(VERIFY_CHUNK_BYTES + 7).fill(9);
    const seen: Array<[number, number]> = [];
    await mgr.verifyChecksum(
      { filename: "models/big.gguf", sha256: createHash("sha256").update(fileBytes).digest("hex") },
      { onProgress: (done, total) => seen.push([done, total]) }
    );
    expect(seen).toEqual([
      [VERIFY_CHUNK_BYTES, VERIFY_CHUNK_BYTES + 7],
      [VERIFY_CHUNK_BYTES + 7, VERIFY_CHUNK_BYTES + 7],
    ]);
  });

  it("aborting mid-verification throws DownloadFailure 'cancelled' and keeps the file", async () => {
    fileBytes = new Uint8Array(3 * VERIFY_CHUNK_BYTES).fill(3);
    const controller = new AbortController();
    let calls = 0;
    const promise = mgr.verifyChecksum(
      { filename: "models/big.gguf", sha256: "ff".repeat(32), id: "big" },
      {
        signal: controller.signal,
        onProgress: () => {
          if (++calls === 1) controller.abort();
        },
      }
    );
    const err = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(DownloadFailure);
    expect(err.code).toBe("cancelled");
    expect(err.canResume).toBe(true); // nothing deleted — verification can be retried
    expect(err.bytesReceived).toBe(VERIFY_CHUNK_BYTES);
  });
});
