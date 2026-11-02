/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Version-surface guard, wired into the unit suite.
//
// Invariant A14 (src/security/backup.ts): the APP_VERSION stamped into
// every backup must equal package.json's version and the release tag.
// The versionName lives in FIVE seats (package.json, package-lock.json
// twice, app.json, backup.ts) and until now nothing watched them: a
// version bump that forgot backup.ts would ship backups stamped with
// the previous version and no test would turn red. This test reads the
// real files, like src/deps/depPins.test.ts, and fails the suite the
// moment any seat disagrees with package.json.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// src/build/appVersion.test.ts -> repo ROOT is three levels up.
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function readJson(rel: string): any {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

describe("A14 version surface", () => {
  it("every versionName seat equals package.json's version", () => {
    const pkg = readJson("package.json");
    const lock = readJson("package-lock.json");
    const app = readJson("app.json");
    const backupSrc = readFileSync(
      join(ROOT, "src/security/backup.ts"),
      "utf8",
    );
    const m = backupSrc.match(/const APP_VERSION = "([^"]+)"/);
    expect(m, "APP_VERSION declaration not found in backup.ts").not.toBeNull();
    const seats: Record<string, string> = {
      "package.json:version": pkg.version,
      "package-lock.json:version": lock.version,
      "package-lock.json:packages[''].version": lock.packages[""].version,
      "app.json:expo.version": app.expo.version,
      "backup.ts:APP_VERSION": m![1],
    };
    for (const [seat, value] of Object.entries(seats)) {
      expect(value, `${seat} disagrees with package.json`).toBe(pkg.version);
    }
  });

  it("app.json carries a positive integer android.versionCode", () => {
    const app = readJson("app.json");
    const code = app.expo.android.versionCode;
    expect(Number.isInteger(code) && code > 0).toBe(true);
  });
});
