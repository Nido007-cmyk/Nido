import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory fake of the expo-file-system/legacy surface installState uses.
const files = new Map<string, string>();
let failWrites = false;

vi.mock("expo-file-system/legacy", () => ({
  default: undefined,
  documentDirectory: "file:///docs/",
  EncodingType: { UTF8: "utf8" },
  getInfoAsync: vi.fn(async (path: string) => ({
    exists: files.has(path),
    isDirectory: false,
    size: files.get(path)?.length ?? 0,
  })),
  readAsStringAsync: vi.fn(async (path: string) => {
    const v = files.get(path);
    if (v === undefined) throw new Error(`not found: ${path}`);
    return v;
  }),
  writeAsStringAsync: vi.fn(async (path: string, content: string) => {
    if (failWrites) throw new Error("ENOSPC");
    files.set(path, content);
  }),
  moveAsync: vi.fn(async ({ from, to }: { from: string; to: string }) => {
    const v = files.get(from);
    if (v === undefined) throw new Error(`not found: ${from}`);
    files.delete(from);
    files.set(to, v);
  }),
}));

import {
  loadInstallState,
  saveInstallState,
  getInstallRecord,
  recordInstall,
  clearInstallRecord,
  installStatePath,
} from "./installState";
import { InstallJournalVersionError } from "../security/formatVersion";

beforeEach(() => {
  files.clear();
  failWrites = false;
});

const rec = {
  status: "downloading" as const,
  sizeBytes: 100,
  sha256: "abc",
};

describe("installState journal", () => {
  it("missing journal loads as empty", async () => {
    expect(await loadInstallState()).toEqual({ version: 1, records: {} });
    expect(await getInstallRecord("x")).toBeNull();
  });

  it("corrupt journal loads as empty (never throws)", async () => {
    files.set(installStatePath(), "{not json");
    expect(await loadInstallState()).toEqual({ version: 1, records: {} });
  });

  it("wrong version fails closed with InstallJournalVersionError (never parsed as empty)", async () => {
    files.set(installStatePath(), JSON.stringify({ version: 2, records: {} }));
    const err = await loadInstallState().catch((e) => e);
    expect(err).toBeInstanceOf(InstallJournalVersionError);
    expect((err as Error).name).toBe("InstallJournalVersionError");
    expect((err as Error).message).toContain("nido-install-state.json");
  });

  it("missing version field fails closed (not treated as empty)", async () => {
    files.set(installStatePath(), JSON.stringify({ records: {} }));
    await expect(loadInstallState()).rejects.toBeInstanceOf(InstallJournalVersionError);
  });

  it("corrupt version value fails closed", async () => {
    files.set(installStatePath(), JSON.stringify({ version: "v1", records: {} }));
    await expect(loadInstallState()).rejects.toBeInstanceOf(InstallJournalVersionError);
  });

  it("v99 without records fails closed (F1: version validated before the records-shape guard)", async () => {
    files.set(installStatePath(), JSON.stringify({ version: 99 }));
    const err = await loadInstallState().catch((e) => e);
    expect(err).toBeInstanceOf(InstallJournalVersionError);
    expect((err as Error).name).toBe("InstallJournalVersionError");
  });

  it("v99 with records fails closed", async () => {
    files.set(installStatePath(), JSON.stringify({ version: 99, records: { qwen: {} } }));
    await expect(loadInstallState()).rejects.toBeInstanceOf(InstallJournalVersionError);
  });

  it("v1 with empty records loads as empty (per contract)", async () => {
    files.set(installStatePath(), JSON.stringify({ version: 1, records: {} }));
    expect(await loadInstallState()).toEqual({ version: 1, records: {} });
  });

  it("v1 with missing records loads as empty (per contract: shape degrades only after version is proven)", async () => {
    files.set(installStatePath(), JSON.stringify({ version: 1 }));
    expect(await loadInstallState()).toEqual({ version: 1, records: {} });
  });

  it("non-object JSON body fails closed (no version field — never misread as unreadable)", async () => {
    for (const body of ["42", '"str"', "[1,2]", "null", "true"]) {
      files.set(installStatePath(), body);
      await expect(loadInstallState()).rejects.toBeInstanceOf(InstallJournalVersionError);
    }
  });

  it("null version fails closed", async () => {
    files.set(installStatePath(), JSON.stringify({ version: null, records: {} }));
    await expect(loadInstallState()).rejects.toBeInstanceOf(InstallJournalVersionError);
  });

  it("non-numeric string version fails closed", async () => {
    files.set(installStatePath(), JSON.stringify({ version: "abc", records: {} }));
    await expect(loadInstallState()).rejects.toBeInstanceOf(InstallJournalVersionError);
  });

  it("version 1 still loads (regression: the trust gate's normal path)", async () => {
    files.set(
      installStatePath(),
      JSON.stringify({ version: 1, records: { qwen: { status: "installed" } } })
    );
    const state = await loadInstallState();
    expect(state.version).toBe(1);
    expect(state.records.qwen.status).toBe("installed");
  });

  it("recordInstall creates and merges records", async () => {
    await recordInstall("qwen", rec);
    await recordInstall("qwen", { status: "installed", sizeBytes: 100, sha256: "abc", bytesWritten: 100 });
    const r = await getInstallRecord("qwen");
    expect(r?.status).toBe("installed");
    expect(r?.bytesWritten).toBe(100);
    expect(typeof r?.updatedAt).toBe("number");
  });

  it("records are keyed per asset", async () => {
    await recordInstall("a", rec);
    await recordInstall("b", { ...rec, status: "failed", failureCode: "interrupted" });
    expect((await getInstallRecord("a"))?.status).toBe("downloading");
    expect((await getInstallRecord("b"))?.failureCode).toBe("interrupted");
  });

  it("clearInstallRecord removes the record", async () => {
    await recordInstall("qwen", rec);
    await clearInstallRecord("qwen");
    expect(await getInstallRecord("qwen")).toBeNull();
  });

  it("journal write failure does not throw (degrades to unverified)", async () => {
    failWrites = true;
    await expect(recordInstall("qwen", rec)).resolves.toBeUndefined();
    expect(await getInstallRecord("qwen")).toBeNull();
  });

  it("save is atomic: temp file is renamed, never left behind", async () => {
    await saveInstallState({ version: 1, records: { qwen: { assetId: "qwen", ...rec, updatedAt: 1 } } });
    expect(files.has(`${installStatePath()}.tmp`)).toBe(false);
    expect(files.has(installStatePath())).toBe(true);
  });
});
