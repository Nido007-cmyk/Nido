#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Checks that every firm rule of docs/NIDO_CONSTITUTION.md is backed by what
// docs/constitution-rules.json says: the test files and docs exist, every
// evaluation case pattern matches at least one case in
// src/eval/cases/v2.json, a rule that isn't "done" says what is pending, and
// the rules listed are exactly the ones in the constitution's table (R1…Rn),
// in both languages.
//
//   node scripts/check-constitution.mjs [--github]
import { existsSync, readFileSync } from "node:fs";

const github = process.argv.includes("--github");
const errors = [];
const fail = (msg) => errors.push(msg);

const map = JSON.parse(readFileSync("docs/constitution-rules.json", "utf8"));
const cases = JSON.parse(readFileSync("src/eval/cases/v2.json", "utf8")).cases.map((c) => c.id);
const rulesIn = (path) => [...readFileSync(path, "utf8").matchAll(/^\| (R\d+) \|/gm)].map((m) => m[1]);

const en = rulesIn("docs/NIDO_CONSTITUTION.md");
const es = rulesIn("docs/es/NIDO_CONSTITUTION.md");
const listed = Object.keys(map.rules);
if (en.join() !== es.join()) fail(`English and Spanish constitutions list different rules: ${en} vs ${es}`);
if (en.join() !== listed.join()) fail(`docs/constitution-rules.json lists ${listed}, the constitution lists ${en}`);

for (const [id, r] of Object.entries(map.rules)) {
  if (!["done", "partial", "review-only"].includes(r.status)) fail(`${id}: unknown status "${r.status}"`);
  for (const f of [...(r.tests ?? []), ...(r.docs ?? [])]) if (!existsSync(f)) fail(`${id}: ${f} does not exist`);
  for (const pat of r.evalCases ?? []) {
    const re = new RegExp(`^${pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    if (!cases.some((c) => re.test(c))) fail(`${id}: no evaluation case matches "${pat}"`);
  }
  if (r.status === "done" && (r.tests ?? []).length === 0) fail(`${id}: "done" needs at least one test`);
  if (r.status === "partial" && !r.pendingWork) fail(`${id}: "partial" needs pendingWork`);
  if (r.status === "review-only" && !r.why) fail(`${id}: "review-only" needs why`);
}

if (errors.length) {
  for (const e of errors) console.log(github ? `::error title=Constitution::${e}` : `✗ ${e}`);
  process.exit(1);
}
console.log(`constitution: ${listed.length} firm rules, all checks in place`);
