/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * setup.no-boar.test.mjs — BOAR setup residue (INTEGRITY lane 2026-09-28).
 *
 * The guided setup wizard must NEVER fall back to downloading another
 * project's APK (previously rferrari/boar-app) and present it as a NIDO
 * install. With no APK path given, it must fail honestly and point at
 * building from source — no network, no wrong app.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function runSetup(stdin) {
  return spawnSync("node", ["scripts/setup.mjs"], {
    input: stdin,
    encoding: "utf8",
    cwd: ROOT,
    timeout: 15000,
  });
}

describe("setup.mjs install flow (no BOAR fallback)", () => {
  it("empty APK path fails honestly instead of downloading a release", () => {
    const res = runSetup("1\n\n");
    const out = res.stdout + res.stderr;
    expect(res.status).toBe(0);
    // Honest failure: no official NIDO release to download.
    expect(out).toMatch(/no official release APK/i);
    expect(out).toMatch(/build the app from source/i);
  });

  it("never references the BOAR repository", () => {
    const res = runSetup("1\n\n");
    const out = (res.stdout + res.stderr).toLowerCase();
    expect(res.status).toBe(0);
    expect(out).not.toContain("rferrari");
    expect(out).not.toContain("boar-app");
    expect(out).not.toContain("boar");
    expect(out).not.toContain("looking up the latest release");
    expect(out).not.toContain("downloading");
  });

  it("menu no longer advertises a download", () => {
    const res = runSetup("q\n");
    const out = res.stdout + res.stderr;
    expect(res.status).toBe(0);
    expect(out).not.toMatch(/download the app/i);
  });
});
