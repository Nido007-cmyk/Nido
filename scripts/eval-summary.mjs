#!/usr/bin/env node
// Summarizes NIDO evaluation results (see docs/EVAL_QUERIES.md).
//
//   node scripts/eval-summary.mjs results/*.jsonl            # one line per run + config
//   node scripts/eval-summary.mjs --report results/*.jsonl   # detailed per-config report
//   node scripts/eval-summary.mjs --answers results/*.jsonl  # side-by-side answers, markdown
//
// Inputs can be exported .jsonl files or a saved Metro terminal log: any
// line containing "[EVAL] {" is parsed too. Rows are deduped by
// runId + configId + queryId.
import { readFileSync } from "node:fs";
import { dedupeRows, formatAnswers, formatReport, formatTable, parseRows } from "./lib/eval-report.mjs";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("usage: node scripts/eval-summary.mjs [--report | --answers] <results.jsonl | metro.log> ...");
  process.exit(1);
}

const rows = dedupeRows(files.flatMap((f) => parseRows(readFileSync(f, "utf8"))));
if (rows.length === 0) {
  console.error("no evaluation rows found");
  process.exit(1);
}

if (args.includes("--answers")) console.log(formatAnswers(rows));
else if (args.includes("--report")) console.log(formatReport(rows));
else console.log(formatTable(rows));
