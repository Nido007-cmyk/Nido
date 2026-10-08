/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * settings.fixture.test.ts — L2 HISTORICAL FIXTURE CORPUS + MIGRATION HARNESS
 * (settings.json).
 *
 * Longevity rule under test: "v1 data opens in current code; unknown major
 * fails closed with a named error". The fixtures in __fixtures__/ are
 * byte-faithful artifacts: settings.v1.json was captured from the REAL
 * writer (writeSettings via setThemeId); negatives mutate ONLY the version
 * stamp. Each test seeds the mocked FS with the fixture FILE bytes and runs
 * the REAL read path — the fixture, not an in-memory imitation, is the
 * input under test.
 *
 * Encoded L1 semantics (do not "fix" here):
 * - v1 / pre-L1-no-field / v1+unknown-keys → ACCEPT (grandfathering of
 *   field-less files is the deliberate L1 deviation, documented not fixed).
 * - v2 / v99 / corrupt → REJECT with SettingsVersionError (exact name).
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
  getInfoAsync: async (path: string) => ({ exists: fx.files.has(path) }),
  readAsStringAsync: async (path: string) => {
    const v = fx.files.get(path);
    if (v === undefined) throw new Error(`no existe: ${path}`);
    return v;
  },
  writeAsStringAsync: async (path: string, content: string) => {
    fx.files.set(path, content);
  },
  deleteAsync: async (path: string) => {
    fx.files.delete(path);
  },
}));

import { SettingsVersionError } from "../security/formatVersion";
import { getThemeId, setThemeId } from "./settings";

const SETTINGS_PATH = `${fx.DOC}settings.json`;

/** Seed the mocked FS with the exact bytes of a committed fixture file. */
function seedFixture(name: string): void {
  fx.files.set(SETTINGS_PATH, fixtureBytes(name));
}

beforeEach(() => {
  fx.reset();
});

describe("settings.json fixture corpus — longevity contract", () => {
  it("v1 fixture opens with current code → ACCEPT", async () => {
    seedFixture("settings.v1.json");
    await expect(getThemeId()).resolves.toBe("daylight");
  });

  it("pre-L1 fixture (no format_version field) → ACCEPT as v1 (documented grandfathering)", async () => {
    // Deliberate L1 deviation: a field-less file is accepted as v1 and
    // stamped on next write — literal fail-closed would brick every
    // existing install on update with no recovery path.
    seedFixture("settings.pre-l1.json");
    await expect(getThemeId()).resolves.toBe("daylight");
    await setThemeId("nightgarden");
    expect(JSON.parse(fx.files.get(SETTINGS_PATH) ?? "null")).toMatchObject({
      format_version: 1,
    });
  });

  it("v1 fixture with unknown extra keys → ACCEPT (forward tolerance preserved)", async () => {
    seedFixture("settings.unknown-keys.v1.json");
    await expect(getThemeId()).resolves.toBe("daylight");
  });

  it("v99 fixture → REJECT with SettingsVersionError (exact named error)", async () => {
    seedFixture("settings.v99.json");
    const err = await getThemeId().catch((e) => e);
    expect(err).toBeInstanceOf(SettingsVersionError);
    expect((err as Error).name).toBe("SettingsVersionError");
  });

  it("v2 fixture (newer than this reader) → REJECT with SettingsVersionError", async () => {
    seedFixture("settings.v2.json");
    await expect(getThemeId()).rejects.toBeInstanceOf(SettingsVersionError);
  });

  it("corrupt version value → REJECT with SettingsVersionError", async () => {
    seedFixture("settings.corrupt-version.json");
    await expect(getThemeId()).rejects.toBeInstanceOf(SettingsVersionError);
  });
});
