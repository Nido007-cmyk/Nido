#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Publica el recuento de pruebas de una corrida (encargo 4 del paquete
 * NIDO-MANT-2026-11-13). Lee los JSON de vitest y jest y deja:
 *  - test-summary.json: corredores, ficheros con omitidas, fallos,
 *    comando y entorno. La CI lo sube como artefacto.
 *  - $GITHUB_STEP_SUMMARY: la tabla, el entorno y la línea lista para
 *    las notas de la versión.
 *  - ::notice con el recuento y un ::error por fichero que falla (como
 *    hacía el paso anterior, para cuando los logs no se pueden leer).
 *
 * Uso: node scripts/test-summary.mjs [vitest.json] [jest.json] [out.json]
 * Nunca falla por su cuenta: el veredicto lo dan los pasos de prueba.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { annotationText, buildSummary, releaseNotesLine, renderMarkdown } from "./lib/test-summary-lib.mjs";

const [vitestPath = "vitest-results.json", jestPath = "jest-results.json", outPath = "test-summary.json"] =
  process.argv.slice(2);

function read(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Fuera de la CI no hay GITHUB_SHA: el commit del árbol local es su «run».
function localCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const summary = buildSummary({
  vitest: read(vitestPath),
  jest: read(jestPath),
  env: process.env.GITHUB_SHA ? process.env : { ...process.env, GITHUB_SHA: localCommit() },
  nodeVersion: process.versions.node,
  root: process.cwd(),
});

writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);

const c = summary.combined;
const v = summary.runners.vitest;
const j = summary.runners.jest;
console.log(
  `::notice title=Test count::${c.total} tests (${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped): ` +
    `vitest ${v ? `${v.passed}/${v.total}, ${v.skipped} skipped` : "no report"}, ` +
    `jest ${j ? `${j.passed}/${j.total}` : "no report"}`,
);
console.log(releaseNotesLine(summary));

for (const [name, r] of Object.entries(summary.runners)) {
  for (const f of r?.failures ?? []) {
    const title = f.file.split("/").slice(-2).join("/");
    console.log(`::error title=${name} ${title}::${annotationText(`${f.test}: ${f.message}`)}`);
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderMarkdown(summary));
}
