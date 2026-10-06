/**
 * relativeRequirePaths.test.ts — regression test for the 2026-10-06 APK
 * build failure.
 *
 * Root cause: `src/privacy/keyManager.ts` contained
 * `require("./secureDatabase")`, but the module lives at
 * `src/security/secureDatabase.ts`. TypeScript + vitest did not catch it;
 * Metro's production bundler did — `./gradlew assembleRelease` failed at
 * the bundle step while CI (typecheck + unit tests) stayed green.
 *
 * This test statically scans every non-test .ts source file for dynamic
 * `require()` calls with relative paths and asserts each one resolves to
 * an existing file, so a wrong relative path can never again pass CI
 * while breaking the release bundle.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "..");

const REQUIRE_RE = /require\(\s*["'](\.[^"']+)["']\s*\)/g;

function collectTsFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
}

function resolveRelativeRequire(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base + ".ts",
    base + ".tsx",
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    // Asset requires (images, etc.) — existence check on the literal path.
    base,
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

describe("relative require() paths resolve (APK bundle gate)", () => {
  it("every relative require() in src/ points at an existing file", () => {
    const files: string[] = [];
    collectTsFiles(SRC_ROOT, files);
    expect(files.length).toBeGreaterThan(0);

    const broken: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      REQUIRE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = REQUIRE_RE.exec(content)) !== null) {
        const spec = m[1];
        // Skip package requires (no leading dot) — already filtered by regex,
        // and skip known Metro asset patterns handled above via literal check.
        if (!resolveRelativeRequire(file, spec)) {
          broken.push(`${path.relative(SRC_ROOT, file)} -> require("${spec}")`);
        }
      }
    }
    expect(
      broken,
      `Unresolvable relative require() paths (breaks Metro release bundle):\n${broken.join("\n")}`,
    ).toEqual([]);
  });
});
