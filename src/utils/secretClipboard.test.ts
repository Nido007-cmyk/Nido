/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { SECRET_CLIPBOARD_TTL_MS, _resetSecretClipboard, copySecretWith, type SecretClipboardDeps } from "./secretClipboard";

function fake(native: boolean) {
  const state = { clip: "", t: 0, timers: [] as Array<() => void>, fg: [] as Array<() => void>, sensitive: false };
  const deps: SecretClipboardDeps = {
    copySensitive: async (text) => {
      if (!native) return false;
      state.clip = text;
      state.sensitive = true;
      return true;
    },
    clearIfEquals: async (text) => {
      if (!native) return null;
      if (state.clip !== text) return false;
      state.clip = "";
      return true;
    },
    copyPlain: async (text) => {
      state.clip = text;
    },
    readPlain: async () => state.clip,
    now: () => state.t,
    setTimer: (fn) => state.timers.push(fn),
    onForeground: (fn) => {
      state.fg.push(fn);
      return () => {
        state.fg = state.fg.filter((f) => f !== fn);
      };
    },
  };
  return { state, deps };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => _resetSecretClipboard());

describe("secret clipboard", () => {
  it("native: copied as sensitive and cleared after the TTL", async () => {
    const { state, deps } = fake(true);
    await copySecretWith(deps, "KEY");
    expect(state.sensitive).toBe(true);
    expect(state.clip).toBe("KEY");
    state.t = SECRET_CLIPBOARD_TTL_MS + 100;
    state.timers.forEach((f) => f());
    await flush();
    expect(state.clip).toBe("");
  });

  it("without the native module: plain copy, still cleared", async () => {
    const { state, deps } = fake(false);
    await copySecretWith(deps, "KEY");
    expect(state.sensitive).toBe(false);
    state.t = SECRET_CLIPBOARD_TTL_MS + 1;
    state.timers.forEach((f) => f());
    await flush();
    expect(state.clip).toBe("");
  });

  it("cleared when NIDO comes back after the TTL (timers paused in background)", async () => {
    const { state, deps } = fake(true);
    await copySecretWith(deps, "KEY");
    state.fg.forEach((f) => f()); // too early: stays
    await flush();
    expect(state.clip).toBe("KEY");
    state.t = SECRET_CLIPBOARD_TTL_MS * 5;
    state.fg.forEach((f) => f());
    await flush();
    expect(state.clip).toBe("");
    expect(state.fg).toHaveLength(0);
  });

  it("doesn't erase something else the user copied afterwards", async () => {
    const { state, deps } = fake(false);
    await copySecretWith(deps, "KEY");
    state.clip = "otra cosa";
    state.t = SECRET_CLIPBOARD_TTL_MS + 1;
    state.timers.forEach((f) => f());
    await flush();
    expect(state.clip).toBe("otra cosa");
  });
});
