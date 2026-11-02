#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Check (b) of rule R00-5 (Esencial re-verification program): every
 * sealed guide's clinical hash (rule R00-4) must still equal the hash
 * recorded in knowledge-packs/nido-esencial/verification-ledger.json,
 * and the file must still carry the same `id` and `verified` date.
 * A clinical change without a new audit row and date — or without
 * retiring the seal — fails here, so an old date can never ride on
 * new text in silence.
 *
 *   node scripts/check-clinical-hashes.mjs
 *
 * Exit code 1 when any sealed guide disagrees with the ledger.
 */
import { ledgerProblems, loadLedger, sealedGuides } from "./lib/esencial-ledger-lib.mjs";

const root = process.cwd();
const ledger = loadLedger(root);
let problems;
if (!ledger) {
  // No tanda has sealed yet: the check passes only if no file claims a seal.
  const sealed = sealedGuides(root);
  problems = sealed.map((s) => `${s.guideId}/${s.lang}: lleva sello pero no existe verification-ledger.json`);
} else {
  problems = ledgerProblems(root, ledger);
}
console.log(`## Hash clínico contra el ledger de Esencial`);
console.log(`${ledger?.guides?.length ?? 0} entradas en el ledger.`);
if (problems.length) {
  console.log(`\n### Desacuerdos (${problems.length})\n${problems.map((p) => `- ${p}`).join("\n")}`);
} else {
  console.log("Cada guía sellada coincide con su fila del ledger (id, fecha y hash clínico).");
}
process.exit(problems.length ? 1 : 0);
