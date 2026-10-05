import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const acquireMock = vi.fn(() => true);
const releaseMock = vi.fn();
vi.mock("download-wake-lock", () => ({
  acquireDownloadWakeLock: () => acquireMock(),
  releaseDownloadWakeLock: () => releaseMock(),
}));

type Deferred = { resolve: () => void; reject: (e: unknown) => void };
const pending = new Map<string, Deferred>();
const downloadMock = vi.fn(
  (asset: { id: string }) =>
    new Promise<void>((resolve, reject) => {
      pending.set(asset.id, { resolve, reject });
    })
);
const signalCancelMock = vi.fn(async (asset: { id: string }) => {
  pending.get(asset.id)?.reject(new Error("Download paused"));
});

vi.mock("../models/ModelManager", () => ({
  ModelManager: class {
    downloadCatalogModel(asset: any) {
      return downloadMock(asset);
    }
    signalCancelDownload(asset: any) {
      return signalCancelMock(asset);
    }
    async deletePartialDownload() {}
  },
}));

import { getDownloadState, resetDownloadState, restartDownload, startDownload } from "./downloadManager";
// downloadErrors.ts is pure (no native imports), so a static import is safe
// in tests — unlike the i18n chain, which must stay lazy (see notifications.ts).
import { DownloadFailure } from "../models/downloadErrors";

const asset = (id: string) => ({ id, sizeBytes: 100 }) as any;
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  resetDownloadState();
  pending.clear();
  acquireMock.mockClear();
  releaseMock.mockClear();
  downloadMock.mockClear();
});

describe("download wake lock", () => {
  it("is acquired when a download starts, and released when it succeeds", async () => {
    const p = startDownload(asset("a"));
    expect(acquireMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).not.toHaveBeenCalled();
    pending.get("a")!.resolve();
    await p;
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(getDownloadState("a")?.error).toBeNull();
  });

  it("is released when the download fails", async () => {
    const p = startDownload(asset("a"));
    pending.get("a")!.reject(new Error("failed verification — got 0 bytes"));
    await p;
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(getDownloadState("a")?.error).toMatch(/verification/);
  });

  it("is released on an unexpected exception inside the download", async () => {
    downloadMock.mockImplementationOnce(async () => {
      throw new TypeError("boom");
    });
    await startDownload(asset("a"));
    expect(acquireMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("is released when a download is cancelled, and re-acquired for its restart", async () => {
    const first = startDownload(asset("a"));
    const restart = restartDownload(asset("a"));
    await first;
    await settle();
    expect(releaseMock).toHaveBeenCalledTimes(1);
    expect(acquireMock).toHaveBeenCalledTimes(2);
    pending.get("a")!.resolve();
    await restart;
    expect(releaseMock).toHaveBeenCalledTimes(2);
  });

  it("does not take a second lock when the same download is started twice", async () => {
    const p1 = startDownload(asset("a"));
    const p2 = startDownload(asset("a"));
    expect(p2).toBe(p1);
    expect(acquireMock).toHaveBeenCalledTimes(1);
    pending.get("a")!.resolve();
    await p1;
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("shares one lock between concurrent downloads, released after the last one", async () => {
    const a = startDownload(asset("a"));
    const b = startDownload(asset("b"));
    expect(acquireMock).toHaveBeenCalledTimes(1);
    pending.get("a")!.resolve();
    await a;
    expect(releaseMock).not.toHaveBeenCalled();
    pending.get("b")!.reject(new Error("network"));
    await b;
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("never lets a wake lock error break the download", async () => {
    acquireMock.mockImplementationOnce(() => {
      throw new Error("no permission");
    });
    const p = startDownload(asset("a"));
    pending.get("a")!.resolve();
    await expect(p).resolves.toBeUndefined();
    expect(getDownloadState("a")?.progress).toBe(1);
  });
});

describe("honest download failures", () => {
  // Meta #3: transient failures now auto-retry (bounded) before surfacing.
  // These tests exhaust the retry chain with fake timers, then assert the
  // final error is still honest.
  it("surfaces a DownloadFailure with its code, canResume flag, and honest byte count", async () => {
    vi.useFakeTimers();
    try {
      downloadMock.mockImplementation(async () => {
        throw new DownloadFailure({
          code: "interrupted",
          kind: "transient",
          canResume: false, // partial was deleted — retry restarts at zero
          assetId: "a",
          bytesReceived: 1234567,
          bytesExpected: 100,
        });
      });
      startDownload(asset("a"));
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(120_000);
      }
      await vi.advanceTimersByTimeAsync(0);
      const s = getDownloadState("a");
      expect(s?.errorCode).toBe("interrupted");
      expect(s?.canResume).toBe(false);
      expect(s?.bytesWritten).toBe(1234567);
      expect(s?.bytesExpected).toBe(100);
      // User message is English (i18n unavailable in tests → EN fallback)
      // and must say the retry starts from the beginning, never "resume".
      expect(s?.error).toMatch(/starts from the beginning/i);
      expect(s?.error).not.toMatch(/resume/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a stalled failure as resumable", async () => {
    vi.useFakeTimers();
    try {
      downloadMock.mockImplementation(async () => {
        throw new DownloadFailure({
          code: "stalled",
          kind: "transient",
          canResume: true, // partial + resume token kept
          assetId: "a",
          bytesReceived: 50,
          bytesExpected: 100,
          extraVars: { seconds: 60 },
        });
      });
      startDownload(asset("a"));
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(120_000);
      }
      await vi.advanceTimersByTimeAsync(0);
      const s = getDownloadState("a");
      expect(s?.errorCode).toBe("stalled");
      expect(s?.canResume).toBe(true);
      expect(s?.bytesWritten).toBe(50);
      expect(s?.error).toMatch(/resumes where it stopped/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps plain Error messages untouched (non-taxonomy path)", async () => {
    downloadMock.mockImplementationOnce(async () => {
      throw new Error("custom boom");
    });
    await startDownload(asset("a"));
    const s = getDownloadState("a");
    expect(s?.error).toBe("custom boom");
    expect(s?.errorCode).toBeUndefined();
    expect(s?.canResume).toBe(false);
  });
});

describe("automatic retry with backoff (Meta #3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const transient = (id: string) =>
    new DownloadFailure({
      code: "stalled",
      kind: "transient",
      canResume: true,
      assetId: id,
      bytesReceived: 10,
      bytesExpected: 100,
      extraVars: { seconds: 60 },
    });
  const permanent = (id: string) =>
    new DownloadFailure({
      code: "checksumMismatch",
      kind: "permanent",
      canResume: false,
      assetId: id,
      bytesReceived: 100,
      bytesExpected: 100,
    });

  it("retries a transient failure automatically with backoff, then succeeds", async () => {
    downloadMock
      .mockImplementationOnce(async () => {
        throw transient("a");
      })
      .mockImplementationOnce(async () => {});
    const p = startDownload(asset("a"));
    await vi.advanceTimersByTimeAsync(0);
    // First failure -> waiting for auto-retry, not a final error.
    let s = getDownloadState("a");
    expect(s?.autoRetrying).toBe(true);
    expect(s?.retryAttempt).toBe(1);
    expect(s?.error).toBeNull();
    expect(s?.nextRetryInSeconds).toBeGreaterThan(0);
    // Fire the retry timer -> second attempt succeeds.
    await vi.advanceTimersByTimeAsync(60_000);
    await p.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    s = getDownloadState("a");
    expect(s?.autoRetrying).toBe(false);
    expect(s?.error).toBeNull();
    expect(downloadMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after MAX_AUTO_RETRIES and surfaces the final error", async () => {
    downloadMock.mockImplementation(async () => {
      throw transient("a");
    });
    startDownload(asset("a"));
    // Exhaust all retries: each cycle needs the failure + the backoff wait.
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(120_000);
    }
    await vi.advanceTimersByTimeAsync(0);
    const s = getDownloadState("a");
    expect(s?.autoRetrying).toBe(false);
    expect(s?.errorCode).toBe("stalled");
    expect(s?.error).toMatch(/resumes where it stopped/i);
    // 1 initial + 3 auto-retries, never more.
    expect(downloadMock).toHaveBeenCalledTimes(4);
  });

  it("never auto-retries permanent failures", async () => {
    downloadMock.mockImplementationOnce(async () => {
      throw permanent("a");
    });
    await startDownload(asset("a"));
    await vi.advanceTimersByTimeAsync(120_000);
    const s = getDownloadState("a");
    expect(s?.autoRetrying).toBe(false);
    expect(s?.errorCode).toBe("checksumMismatch");
    expect(downloadMock).toHaveBeenCalledTimes(1);
  });

  it("a manual startDownload resets the retry chain", async () => {
    downloadMock.mockImplementation(async () => {
      throw transient("a");
    });
    startDownload(asset("a"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getDownloadState("a")?.retryAttempt).toBe(1);
    // User taps retry manually: counter resets, next failure is attempt 1 again.
    startDownload(asset("a"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getDownloadState("a")?.retryAttempt).toBe(1);
    expect(downloadMock).toHaveBeenCalledTimes(2);
  });

  it("retryDelayMs grows exponentially with jitter bounds", async () => {
    const { retryDelayMs } = await import("./downloadManager");
    const d1 = retryDelayMs(1);
    const d2 = retryDelayMs(2);
    const d3 = retryDelayMs(3);
    // base 2000 * 4^(n-1), ±25% jitter
    expect(d1).toBeGreaterThanOrEqual(1500);
    expect(d1).toBeLessThanOrEqual(2500);
    expect(d2).toBeGreaterThanOrEqual(6000);
    expect(d2).toBeLessThanOrEqual(10000);
    expect(d3).toBeGreaterThanOrEqual(24000);
    expect(d3).toBeLessThanOrEqual(40000);
  });
});
