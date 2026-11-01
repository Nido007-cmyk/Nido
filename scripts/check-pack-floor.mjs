#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Gate on the BUILT bytes: a candidate NIDO Local whose regions/facts
// tables are smaller than the newest published set's must never be
// uploaded. See scripts/lib/pack-floor-lib.mjs for the full story (the
// 0.1.68 near-miss: a v9 draft built from the app tree's old facts copy
// carried 32 regions / 71 facts against v8's published 69 / 155).
//
//   node scripts/check-pack-floor.mjs <pack.sqlite> [more.sqlite ...]
//       [--ledger knowledge-packs/release-ledger.json]
//
// Reads each file's guides/chunks/regions/facts tables (node:sqlite,
// read-only), compares regions and facts against the floor recorded in
// the ledger's localPublishedFloor, prints every count, and exits 1 on
// any violation or unreadable file. The knowledge-pack workflow runs
// this on both Local profiles after building and before uploading.

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { floorViolations, localFloorFromLedger } from "./lib/pack-floor-lib.mjs";

const args = process.argv.slice(2);
let ledgerPath = "knowledge-packs/release-ledger.json";
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--ledger") {
    ledgerPath = args[++i];
    if (!ledgerPath) {
      console.error("✗ --ledger needs a value");
      process.exit(2);
    }
  } else {
    files.push(args[i]);
  }
}
if (files.length === 0) {
  console.error("usage: node scripts/check-pack-floor.mjs <pack.sqlite> [more.sqlite ...] [--ledger <release-ledger.json>]");
  process.exit(2);
}

let floor;
try {
  floor = localFloorFromLedger(JSON.parse(readFileSync(ledgerPath, "utf8")), ledgerPath);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
console.log(`published floor (${floor.tag}): regions >= ${floor.regions}, facts >= ${floor.facts}`);

let failed = false;
for (const file of files) {
  let counts;
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const row = db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM guides) AS guides, (SELECT COUNT(*) FROM chunks) AS chunks, " +
            "(SELECT COUNT(*) FROM regions) AS regions, (SELECT COUNT(*) FROM facts) AS facts",
        )
        .get();
      counts = { guides: row.guides, chunks: row.chunks, regions: row.regions, facts: row.facts };
    } finally {
      db.close();
    }
  } catch (e) {
    console.error(`✗ ${file}: cannot read its tables (${e.message})`);
    failed = true;
    continue;
  }
  const violations = floorViolations(counts, floor);
  console.log(`${file}: guides ${counts.guides}, chunks ${counts.chunks}, regions ${counts.regions}, facts ${counts.facts}`);
  for (const v of violations) {
    console.error(`✗ ${file}: ${v}`);
    failed = true;
  }
}

if (failed) {
  console.error("✗ the candidate Local is below the published floor — do not upload it");
  process.exit(1);
}
console.log("✓ every candidate is at or above the published floor");
