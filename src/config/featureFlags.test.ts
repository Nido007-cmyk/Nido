/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * TESTFIX-2026-10-08 (Fix 7): the flag must be runtime-toggleable and
 * persisted, defaulting to OFF. Previously `as const` + unread.
 */

const files = new Map<string, string>();

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///doc/",
  getInfoAsync: async (path: string) => ({ exists: files.has(path) }),
  readAsStringAsync: async (path: string) => {
    const c = files.get(path);
    if (c === undefined) throw new Error("not found");
    return c;
  },
  writeAsStringAsync: async (path: string, content: string) => {
    files.set(path, content);
  },
}));

import {
  isFeatureEnabled,
  setFeatureEnabled,
  loadFeatureFlags,
  resetFeatureFlagsForTests,
} from "./featureFlags";

describe("featureFlags (Fix 7)", () => {
  beforeEach(() => {
    files.clear();
    resetFeatureFlagsForTests();
  });

  it("defaults to OFF", () => {
    expect(isFeatureEnabled("delegation.enabled")).toBe(false);
  });

  it("setFeatureEnabled persists and loadFeatureFlags hydrates", async () => {
    await setFeatureEnabled("delegation.enabled", true);
    expect(isFeatureEnabled("delegation.enabled")).toBe(true);
    // Simulate restart: clear memory, reload from disk.
    resetFeatureFlagsForTests();
    expect(isFeatureEnabled("delegation.enabled")).toBe(false);
    await loadFeatureFlags();
    expect(isFeatureEnabled("delegation.enabled")).toBe(true);
  });

  it("corrupt file → fail-open to defaults (OFF)", async () => {
    files.set("file:///doc/feature-flags.json", "not-json{{{");
    await loadFeatureFlags();
    expect(isFeatureEnabled("delegation.enabled")).toBe(false);
  });

  it("unknown keys in file are ignored", async () => {
    files.set(
      "file:///doc/feature-flags.json",
      JSON.stringify({ "delegation.enabled": true, "evil.flag": true })
    );
    await loadFeatureFlags();
    expect(isFeatureEnabled("delegation.enabled")).toBe(true);
    expect(isFeatureEnabled("evil.flag" as never)).toBe(false);
  });
});
