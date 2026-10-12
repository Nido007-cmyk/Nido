/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type World = { files: Set<string>; deleted: string[] };
const W = (): World => (globalThis as unknown as { __viW: World }).__viW;
(globalThis as unknown as { __viW: World }).__viW = { files: new Set(), deleted: [] };

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: async (uri: string) => ({ exists: W().files.has(uri), size: uri.endsWith(".nvi") ? 45 : 1000 }),
  readDirectoryAsync: async (dir: string) =>
    [...W().files].filter((f) => f.startsWith(dir)).map((f) => f.slice(dir.length)),
  deleteAsync: async (uri: string) => {
    W().deleted.push(uri);
    W().files.delete(uri);
  },
}));

let vi_: typeof import("./vectorIndex");
beforeAll(async () => {
  vi_ = await import("./vectorIndex");
});

const pack = {
  id: "wiki-vital5-e5",
  kind: "corpus" as const,
  format: "sqlite-pack" as const,
  label: "Vital",
  filename: "corpus/wiki-vital5-e5.sqlite",
  sizeBytes: 10,
  sha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  sourceUrl: "",
  license: "",
  description: "",
  required: false,
};

function nativeMock() {
  const calls = { build: [] as string[][], search: [] as unknown[][], release: [] as string[] };
  let resolveBuild: (() => void) | null = null;
  const native = {
    buildIndex: vi.fn(
      (sqlitePath: string, indexPath: string) =>
        new Promise<number>((res) => {
          calls.build.push([sqlitePath, indexPath]);
          resolveBuild = () => {
            W().files.add(`file://${indexPath}`);
            res(3);
          };
        })
    ),
    search: vi.fn(async (...args: unknown[]) => {
      calls.search.push(args);
      return { ids: [1], scores: [0.9], gatedCount: 1, gatedMin: 0.9, count: 3 };
    }),
    release: vi.fn((p: string) => {
      calls.release.push(p);
      return true;
    }),
  };
  return { native, calls, finishBuild: () => resolveBuild?.() };
}

beforeEach(() => {
  W().files = new Set(["file:///docs/corpus/wiki-vital5-e5.sqlite"]);
  W().deleted = [];
});

describe("vectorIndex", () => {
  it("no native module → unavailable, no index, no search", async () => {
    vi_.__setNativeVectorsForTest(null);
    expect(vi_.nativeVectorSearchAvailable()).toBe(false);
    expect(await vi_.packIndexIfReady(pack, 10)).toBeNull();
    expect(await vi_.searchPackIndex("file:///x.nvi", new Float32Array(2), 0.8, 12)).toBeNull();
  });

  it("first use starts ONE background build and answers null; then it's ready", async () => {
    const { native, calls, finishBuild } = nativeMock();
    vi_.__setNativeVectorsForTest(native);
    expect(await vi_.packIndexIfReady(pack, 10)).toBeNull();
    expect(await vi_.packIndexIfReady(pack, 10)).toBeNull();
    await Promise.resolve();
    expect(calls.build).toHaveLength(1);
    expect(calls.build[0]).toEqual([
      "/docs/corpus/wiki-vital5-e5.sqlite",
      "/docs/corpus/wiki-vital5-e5.abcdef0123456789.nvi",
    ]);
    finishBuild();
    await new Promise((r) => setTimeout(r, 0));
    expect(await vi_.packIndexIfReady(pack, 10)).toBe("file:///docs/corpus/wiki-vital5-e5.abcdef0123456789.nvi");
  });

  it("an existing index file is used without rebuilding; search passes a plain array and no file://", async () => {
    const { native, calls } = nativeMock();
    vi_.__setNativeVectorsForTest(native);
    W().files.add("file:///docs/corpus/wiki-vital5-e5.abcdef0123456789.nvi");
    const uri = await vi_.packIndexIfReady(pack, 10);
    expect(uri).not.toBeNull();
    expect(calls.build).toHaveLength(0);
    await vi_.searchPackIndex(uri!, new Float32Array([0.5, 0.25]), 0.81, 12);
    expect(calls.search[0]).toEqual(["/docs/corpus/wiki-vital5-e5.abcdef0123456789.nvi", [0.5, 0.25], 0.81, 12]);
  });

  it("a build deletes stale indexes of an older pack file first", async () => {
    const { native } = nativeMock();
    vi_.__setNativeVectorsForTest(native);
    W().files.add("file:///docs/corpus/wiki-vital5-e5.0000000000000000.nvi");
    W().files.add("file:///docs/corpus/wiki-vital5.abcdef0123456789.nvi"); // another pack: untouched
    void vi_.buildPackIndex(pack, 10);
    await new Promise((r) => setTimeout(r, 0));
    expect(W().deleted).toEqual(["file:///docs/corpus/wiki-vital5-e5.0000000000000000.nvi"]);
  });

  it("deletePackIndexes removes the pack's index files and releases them", async () => {
    const { native, calls } = nativeMock();
    vi_.__setNativeVectorsForTest(native);
    W().files.add("file:///docs/corpus/wiki-vital5-e5.abcdef0123456789.nvi");
    await vi_.deletePackIndexes(pack);
    expect(W().files.has("file:///docs/corpus/wiki-vital5-e5.abcdef0123456789.nvi")).toBe(false);
    expect(W().files.has("file:///docs/corpus/wiki-vital5-e5.sqlite")).toBe(true);
    expect(calls.release).toEqual(["/docs/corpus/wiki-vital5-e5.abcdef0123456789.nvi"]);
  });

  it("a failed build is logged and retried next time, never thrown", async () => {
    const native = {
      buildIndex: vi.fn(async () => {
        throw new Error("disk full");
      }),
      search: vi.fn(),
      release: vi.fn(() => true),
    };
    vi_.__setNativeVectorsForTest(native as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await vi_.buildPackIndex(pack, 10)).toBeNull();
    expect(await vi_.buildPackIndex(pack, 10)).toBeNull();
    expect(native.buildIndex).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("vectorIndexBytes", () => {
  it("sums only the .nvi files in corpus/", async () => {
    W().files = new Set([
      "file:///docs/corpus/wiki-vital5-e5.sqlite",
      "file:///docs/corpus/wiki-vital5-e5.abcdef0123456789.nvi",
    ]);
    expect(await vi_.vectorIndexBytes()).toBe(45);
  });
});
