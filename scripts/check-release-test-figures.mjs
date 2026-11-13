#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Puerta de CI: desde la 0.1.96, toda cifra de pruebas en CHANGELOG.md
 * o docs/ALPHA_RELEASE_NOTES.md declara comando, entorno y run. Ver
 * scripts/lib/release-test-figures-lib.mjs y docs/release/RELEASE_MODEL.md.
 */
import { readFileSync } from "node:fs";
import {
  FIRST_CHECKED_VERSION,
  changelogBlocks,
  findViolations,
  releaseNotesBlocks,
} from "./lib/release-test-figures-lib.mjs";

const files = [
  { path: "CHANGELOG.md", blocks: changelogBlocks(readFileSync("CHANGELOG.md", "utf8")) },
  {
    path: "docs/ALPHA_RELEASE_NOTES.md",
    blocks: releaseNotesBlocks(readFileSync("docs/ALPHA_RELEASE_NOTES.md", "utf8")),
  },
];

const violations = findViolations(files);
for (const v of violations) {
  console.log(
    `::error file=${v.path},line=${v.line},title=Test figure without its source::` +
      `${v.version}: a test count needs ${v.missing.join(", ")} in the same paragraph ` +
      "(scripts/test-summary.mjs prints the line to copy)",
  );
}
if (violations.length) {
  console.error(`FAIL: ${violations.length} test figure(s) without command, environment or run`);
  process.exit(1);
}
console.log(`PASS: test figures in release notes from ${FIRST_CHECKED_VERSION} on declare command, environment and run`);
