/**
 * installState.fixture.test.ts — L2 HISTORICAL FIXTURE CORPUS + MIGRATION
 * HARNESS (nido-install-state.json).
 *
 * Longevity rule under test: "v1 data opens in current code; unknown major
 * fails closed with a named error". install-journal.v1.json was captured
 * from the REAL writer (saveInstallState); negatives mutate ONLY the
 * version stamp. Each test seeds the mocked FS with the fixture FILE bytes
 * and runs the REAL loadInstallState path.
 *
 * Encoded L1 semantics:
 * - v1 → ACCEPT.
 * - v2 / v99 / corrupt / missing version → REJECT with
 *   InstallJournalVersionError (exact name).
 * - JSON-unreadable file → ACCEPT-as-empty (degrade to "re-verify what's on
 *   disk", never a false installed claim; NOT a version error).
 * - install-journal.v99-no-records.json documents the F1 FIX: a readable
 *   journal with unknown version but no `records` object now throws
 *   InstallJournalVersionError, because checkFormatVersion runs BEFORE the
 *   records-shape guard in loadInstallState. (L2 pinned the old fails-open
 *   behavior; the F1 lane corrected it.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const fixtureBytes = (name: string): string => readFileSync(join(FIX, name), "utf8");

const fx = vi.hoisted(() => {
  const DOC = "file:///docs/";
  const files = new Map<string, string>();
  return {
    DOC,
    files,
    reset: () => files.clear(),
  };
});

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: fx.DOC,
  cacheDirectory: fx.DOC,
  EncodingType: { UTF8: "utf8" },
  getInfoAsync: async (path: string) => ({ exists: fx.files.has(path) }),
  readAsStringAsync: async (path: string) => {
    const v = fx.files.get(path);
    if (v === undefined) throw new Error(`no existe: ${path}`);
    return v;
  },
  writeAsStringAsync: async (path: string, content: string) => {
    fx.files.set(path, content);
  },
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    const c = fx.files.get(from);
    if (c === undefined) throw new Error(`no existe: ${from}`);
    fx.files.delete(from);
    fx.files.set(to, c);
  },
  deleteAsync: async (path: string) => {
    fx.files.delete(path);
  },
}));

import { InstallJournalVersionError } from "../security/formatVersion";
import { loadInstallState, installStatePath } from "./installState";

const JOURNAL_PATH = `${fx.DOC}nido-install-state.json`;

/** Seed the mocked FS with the exact bytes of a committed fixture file. */
function seedFixture(name: string): void {
  fx.files.set(JOURNAL_PATH, fixtureBytes(name));
}

beforeEach(() => {
  fx.reset();
  expect(installStatePath()).toBe(JOURNAL_PATH);
});

describe("nido-install-state.json fixture corpus — longevity contract", () => {
  it("v1 fixture opens with current code → ACCEPT", async () => {
    seedFixture("install-journal.v1.json");
    const state = await loadInstallState();
    expect(state.version).toBe(1);
    expect(state.records["phi-3.5-mini-instruct-q4km"]?.status).toBe("installed");
  });

  it("v99 fixture → REJECT with InstallJournalVersionError (exact named error)", async () => {
    seedFixture("install-journal.v99.json");
    const err = await loadInstallState().catch((e) => e);
    expect(err).toBeInstanceOf(InstallJournalVersionError);
    expect((err as Error).name).toBe("InstallJournalVersionError");
  });

  it("v2 fixture (newer than this reader) → REJECT with InstallJournalVersionError", async () => {
    seedFixture("install-journal.v2.json");
    await expect(loadInstallState()).rejects.toBeInstanceOf(InstallJournalVersionError);
  });

  it("corrupt version value → REJECT with InstallJournalVersionError", async () => {
    seedFixture("install-journal.corrupt-version.json");
    await expect(loadInstallState()).rejects.toBeInstanceOf(InstallJournalVersionError);
  });

  it("missing version field → REJECT with InstallJournalVersionError", async () => {
    seedFixture("install-journal.missing-version.json");
    await expect(loadInstallState()).rejects.toBeInstanceOf(InstallJournalVersionError);
  });

  it("JSON-unreadable file → ACCEPT-as-empty (degrade to re-verify, not a version error)", async () => {
    seedFixture("install-journal.corrupt-json.json");
    await expect(loadInstallState()).resolves.toEqual({ version: 1, records: {} });
  });

  it("v99 WITHOUT records → REJECT with InstallJournalVersionError (F1 fix: version validated before the records-shape guard)", async () => {
    // F1 (fixed): the records-shape guard must not short-circuit a readable
    // journal whose version is unknown. {"version": 99} fails closed
    // regardless of whether `records` exists, is empty, or is missing.
    seedFixture("install-journal.v99-no-records.json");
    const err = await loadInstallState().catch((e) => e);
    expect(err).toBeInstanceOf(InstallJournalVersionError);
    expect((err as Error).name).toBe("InstallJournalVersionError");
  });
});
