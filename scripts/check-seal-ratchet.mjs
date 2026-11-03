#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Check (a) of rule R00-5 (Esencial re-verification program): the seal
 * ratchet. The set of sealed guides named by the baseline file
 * (knowledge-packs/nido-esencial/seal-baseline.json) can only grow, and
 * only in a tanda that brings its ledger: a baseline seal that is no
 * longer on its file, or a seal with no ledger entry, fails here.
 * A tanda that seals updates the baseline in the same commit as its
 * ledger; this check never writes anything.
 *
 *   node scripts/check-seal-ratchet.mjs
 *
 * Exit code 1 when the ratchet is violated.
 */
import { join } from "node:path";
import { BASELINE_FILE, ESENCIAL_REL, loadBaseline, loadLedger, ratchetProblems, sealedGuides } from "./lib/esencial-ledger-lib.mjs";

const root = process.cwd();
const baseline = loadBaseline(root);
const problems = [];
if (!baseline) {
  problems.push(`falta la línea base de sellos (${join(ESENCIAL_REL, BASELINE_FILE)}): el ratchet no tiene contra qué medir`);
} else {
  problems.push(...ratchetProblems(root, baseline, loadLedger(root)));
}
const sealed = sealedGuides(root);
console.log(`## Ratchet de sellos de Esencial`);
console.log(`${sealed.length} guías selladas; línea base: ${baseline?.guides?.length ?? "ausente"}.`);
if (problems.length) {
  console.log(`\n### Violaciones del ratchet (${problems.length})\n${problems.map((p) => `- ${p}`).join("\n")}`);
} else {
  console.log("El conjunto de sellos no ha encogido y cada sello tiene su ledger.");
}
process.exit(problems.length ? 1 : 0);
