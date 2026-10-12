/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type World = { dismissed: boolean };
const W = (): World => (globalThis as unknown as { __bhW: World }).__bhW;
(globalThis as unknown as { __bhW: World }).__bhW = { dismissed: false };

vi.mock("../models/settings", () => ({
  getP2PBatteryHintDismissed: async () => W().dismissed,
  setP2PBatteryHintDismissed: async (v: boolean) => {
    W().dismissed = v;
  },
}));

let m: typeof import("./batteryHint");
beforeAll(async () => {
  m = await import("./batteryHint");
});

let ignoring = false;
let opened = 0;
beforeEach(() => {
  W().dismissed = false;
  ignoring = false;
  opened = 0;
  m.__setBatteryNativeForTest({
    isIgnoringBatteryOptimizations: () => ignoring,
    openBatterySettings: () => {
      opened += 1;
      return true;
    },
  });
});

describe("P2P battery hint", () => {
  it("shows only when P2P is in use and NIDO is still battery-optimized", async () => {
    expect(await m.shouldShowBatteryHint(0)).toBe(false);
    expect(await m.shouldShowBatteryHint(1)).toBe(true);
    ignoring = true;
    expect(await m.shouldShowBatteryHint(1)).toBe(false);
  });

  it("'Not now' hides it for good", async () => {
    await m.dismissBatteryHint();
    expect(await m.shouldShowBatteryHint(3)).toBe(false);
  });

  it("opens the system setting", () => {
    expect(m.openBatterySettings()).toBe(true);
    expect(opened).toBe(1);
  });

  it("without the native module: never shown, never throws", async () => {
    m.__setBatteryNativeForTest(null);
    expect(await m.shouldShowBatteryHint(5)).toBe(false);
    expect(m.openBatterySettings()).toBe(false);
  });
});
