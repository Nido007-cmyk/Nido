/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  annotationText,
  buildSummary,
  environmentFrom,
  releaseNotesLine,
  renderMarkdown,
  summarizeRunner,
} from "./test-summary-lib.mjs";
import {
  changelogBlocks,
  citesTestCount,
  compareVersions,
  findViolations,
  missingDeclarations,
  releaseNotesBlocks,
} from "./release-test-figures-lib.mjs";

const ROOT = "/repo";
const vitestReport = {
  success: false,
  numTotalTests: 6,
  numPassedTests: 3,
  numFailedTests: 1,
  numPendingTests: 1,
  numTodoTests: 1,
  numFailedTestSuites: 2,
  testResults: [
    {
      name: "/repo/src/a.test.ts",
      status: "failed",
      assertionResults: [
        { status: "passed", fullName: "a ok" },
        { status: "failed", fullName: "a breaks", failureMessages: ["expected 1\nto be 2"] },
        { status: "skipped", fullName: "a gated" },
      ],
    },
    {
      name: "/repo/src/b.test.ts",
      status: "passed",
      assertionResults: [
        { status: "passed", fullName: "b ok" },
        { status: "passed", fullName: "b ok 2" },
        { status: "todo", fullName: "b later" },
      ],
    },
    { name: "/repo/src/c.test.ts", status: "failed", message: "Cannot find module x", assertionResults: [] },
  ],
};
const jestReport = {
  success: true,
  numTotalTests: 2,
  numPassedTests: 2,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  testResults: [
    { name: "/repo/App.component.test.tsx", status: "passed", assertionResults: [{ status: "passed" }, { status: "passed" }] },
  ],
};
const ciEnv = {
  GITHUB_ACTIONS: "true",
  GITHUB_SERVER_URL: "https://github.com",
  GITHUB_REPOSITORY: "Nido007-cmyk/Nido",
  GITHUB_RUN_ID: "42",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "c0ffee1234567890",
  ImageOS: "ubuntu24",
  ImageVersion: "20261110.1",
};

describe("test summary", () => {
  it("counts each runner from its own report, with skipped files and failures", () => {
    const r = summarizeRunner(vitestReport, ROOT);
    expect(r).toMatchObject({ total: 6, passed: 3, failed: 1, skipped: 1, todo: 1, files: 3, failedFiles: 2 });
    expect(r.skippedByFile).toEqual([
      { file: "src/a.test.ts", skipped: 1, todo: 0 },
      { file: "src/b.test.ts", skipped: 0, todo: 1 },
    ]);
    // El fichero que no carga cuenta como fallo aunque no tenga aserciones.
    expect(r.failures.map((f) => [f.file, f.test])).toEqual([
      ["src/a.test.ts", "a breaks"],
      ["src/c.test.ts", "(file)"],
    ]);
  });

  it("a runner without a report is missing, never zero passed", () => {
    const s = buildSummary({ vitest: vitestReport, jest: null, env: {}, root: ROOT });
    expect(s.runners.jest).toBeNull();
    expect(s.combined).toMatchObject({ total: 6, passed: 3, missingRunners: ["jest"] });
  });

  it("adds both runners, which is what 0.1.94 published and 0.1.95 did not", () => {
    const s = buildSummary({ vitest: vitestReport, jest: jestReport, env: ciEnv, nodeVersion: "24.11.0", root: ROOT });
    expect(s.combined).toMatchObject({ total: 8, passed: 5, failed: 1, skipped: 1, todo: 1, missingRunners: [] });
  });

  it("records CI environment and the run URL; local runs have no run", () => {
    expect(environmentFrom(ciEnv, "24.11.0")).toEqual({
      kind: "CI",
      os: "ubuntu24 20261110.1",
      node: "24.11.0",
      commit: "c0ffee1234567890",
      ref: null,
      run: "https://github.com/Nido007-cmyk/Nido/actions/runs/42",
    });
    expect(environmentFrom({ ...ciEnv, GITHUB_RUN_ATTEMPT: "2" }).run).toBe(
      "https://github.com/Nido007-cmyk/Nido/actions/runs/42/attempts/2",
    );
    expect(environmentFrom({}, "24.0.0")).toMatchObject({ kind: "local", run: null });
  });

  it("the release-notes line passes the release gate as printed", () => {
    const line = releaseNotesLine(
      buildSummary({ vitest: vitestReport, jest: jestReport, env: ciEnv, nodeVersion: "24.11.0", root: ROOT }),
    );
    expect(line).toBe(
      "vitest 3 passed, 1 failed, 1 skipped of 6; jest 2 of 2 (command: `npm test` + `npm run test:components`; " +
        "environment: CI, ubuntu24 20261110.1, Node 24.11.0; run: https://github.com/Nido007-cmyk/Nido/actions/runs/42)",
    );
    expect(citesTestCount(line)).toBe(true);
    expect(missingDeclarations(line)).toEqual([]);
    const local = releaseNotesLine(buildSummary({ vitest: vitestReport, jest: jestReport, env: { GITHUB_SHA: "abcdef1234567890" } }));
    expect(local).toContain("environment: local tree; run: local tree at abcdef123456");
    const vitestOnly = releaseNotesLine(buildSummary({ vitest: vitestReport, jest: null, env: { GITHUB_SHA: "abcdef1" } }));
    expect(vitestOnly).toContain("(command: `npm test`; environment");
    expect(missingDeclarations(local)).toEqual([]);
  });

  it("renders the step summary with the table, environment, skipped files and failures", () => {
    const md = renderMarkdown(
      buildSummary({ vitest: vitestReport, jest: null, env: ciEnv, nodeVersion: "24.11.0", root: ROOT }),
    );
    expect(md).toContain("| vitest | 3 | 1 | 1 | 1 | 6 | 3 |");
    expect(md).toContain("| jest | – | – | – | – | – | no report |");
    expect(md).toContain("- Run: https://github.com/Nido007-cmyk/Nido/actions/runs/42");
    expect(md).toContain("| vitest | `src/a.test.ts` | 1 | 0 |");
    expect(md).toContain("- vitest · `src/c.test.ts` · (file)");
  });

  it("annotation text stays on one line without colour codes", () => {
    expect(annotationText("\u001b[31m50% off\nnext")).toBe("50%25 off%0Anext");
  });
});

describe("release-notes test figures", () => {
  it("recognises the figures the notes have actually used", () => {
    for (const t of [
      "passed the automated tests (vitest 6,682 passed and 46 skipped, jest 116 of 116, 0 failures)",
      "The rest passed the automated tests only (6,798 passed of 6,820 on the release tree)",
      "Its fixes passed the automated tests only (6,320 on the release tree); the Android build compiles.",
      "the full suite (4,711 tests)",
    ]) {
      expect(citesTestCount(t)).toBe(true);
    }
    expect(citesTestCount("69 countries and 174 guides, 0.4 MB")).toBe(false);
    expect(citesTestCount("passed the automated tests")).toBe(false);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("0.1.96", "0.1.95")).toBeGreaterThan(0);
    expect(compareVersions("0.1.100", "0.1.96")).toBeGreaterThan(0);
    expect(compareVersions("0.1.9", "0.1.96")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.1.96")).toBeGreaterThan(0);
  });

  it("only versions from 0.1.96 must declare, so the published notes stay as they are", () => {
    const changelog = [
      "# Changelog",
      "",
      "## 0.1.96-alpha - 2026-11-20",
      "",
      "Fixes passed vitest 6,706 passed and 22 skipped.",
      "",
      "- jest 116 of 116 (command: `npm run test:components`; environment: CI; run: https://github.com/Nido007-cmyk/Nido/actions/runs/7)",
      "",
      "## 0.1.95-alpha - 2026-11-13",
      "",
      "vitest 6,682 passed and 46 skipped.",
    ].join("\n");
    const notes = [
      "## Known limitations",
      "",
      "- **0.1.96 has not been tested on a phone.** 6,844 tests passed (command: `npm test`; environment: local tree; run: local tree at fb4e3095)",
      "- **0.1.95 has not been tested on a physical phone yet.** (vitest 6,682 passed and 46 skipped)",
    ].join("\n");
    const v = findViolations([
      { path: "CHANGELOG.md", blocks: changelogBlocks(changelog) },
      { path: "docs/ALPHA_RELEASE_NOTES.md", blocks: releaseNotesBlocks(notes) },
    ]);
    expect(v).toEqual([{ path: "CHANGELOG.md", line: 5, version: "0.1.96", missing: ["command", "environment", "run"] }]);
  });

  it("a run must be a real Actions run URL or a local tree with its commit", () => {
    expect(missingDeclarations("command: `npm test`; environment: CI; run: the green one")).toEqual(["run"]);
    expect(missingDeclarations("command: npm test; environment: CI; run: https://github.com/o/r/actions/runs/1")).toEqual([
      "command",
    ]);
    expect(missingDeclarations("command: `npm test`; environment: my laptop; run: local tree at abc1234")).toEqual([
      "environment",
    ]);
  });

  it("the repository's own notes pass today", () => {
    const v = findViolations([
      { path: "CHANGELOG.md", blocks: changelogBlocks(readFileSync("CHANGELOG.md", "utf8")) },
      {
        path: "docs/ALPHA_RELEASE_NOTES.md",
        blocks: releaseNotesBlocks(readFileSync("docs/ALPHA_RELEASE_NOTES.md", "utf8")),
      },
    ]);
    expect(v).toEqual([]);
  });

  it("finds the 0.1.95 figure when the rule is applied to it, which is why it starts at 0.1.96", () => {
    const blocks = releaseNotesBlocks(readFileSync("docs/ALPHA_RELEASE_NOTES.md", "utf8"));
    const v = findViolations([{ path: "docs/ALPHA_RELEASE_NOTES.md", blocks }], "0.1.95");
    expect(v.some((x) => x.version === "0.1.95")).toBe(true);
  });
});
