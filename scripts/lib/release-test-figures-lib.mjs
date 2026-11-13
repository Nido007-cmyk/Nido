/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Toda cifra de pruebas en las notas de una versión dice de dónde sale
 * (paquete NIDO-MANT-2026-11-13, encargo 4).
 *
 * Una frase de CHANGELOG.md o de docs/ALPHA_RELEASE_NOTES.md que cite
 * un recuento de pruebas («6,844 tests», «vitest 6,706 passed…») tiene
 * que llevar en el mismo párrafo o viñeta:
 *   command: `…`                       el comando exacto
 *   environment: CI … | local tree …   dónde se midió
 *   run: https://github.com/…/actions/runs/<id> | local tree at <commit>
 * scripts/test-summary.mjs imprime esa línea lista para copiar.
 *
 * Rige desde FIRST_CHECKED_VERSION: las notas ya publicadas (0.1.95 y
 * anteriores) no se reescriben.
 */

export const FIRST_CHECKED_VERSION = "0.1.96";

export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

const COUNT =
  /(?:\b\d{1,3}(?:,\d{3})+|\b\d{3,}\b)\s+(?:of\s+[\d,]+\s+)?(?:tests?|passed|skipped)\b|\b(?:vitest|jest)\b[^.;\n]{0,20}?\d|\btests?\b[^.;\n]{0,40}?\(\s*\d{1,3}(?:,\d{3})+/i;
const COMMAND = /\bcommand:\s*`[^`]+`/i;
const ENVIRONMENT = /\benvironment:\s*(?:CI\b|local tree\b)/i;
const RUN = /\brun:\s*(?:https:\/\/github\.com\/[^\s)]+\/actions\/runs\/\d+|local tree at [0-9a-f]{7,40}\b)/i;

/** ¿Cita este bloque una cifra de pruebas? */
export function citesTestCount(text) {
  return COUNT.test(text);
}

/** Lo que le falta al bloque para que su cifra sea auditable. */
export function missingDeclarations(text) {
  const missing = [];
  if (!COMMAND.test(text)) missing.push("command");
  if (!ENVIRONMENT.test(text)) missing.push("environment");
  if (!RUN.test(text)) missing.push("run");
  return missing;
}

/** Párrafos y viñetas de un texto markdown, con su línea de inicio. */
function blocks(text, firstLine = 1) {
  const out = [];
  let current = null;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const isBullet = /^\s*[-*]\s+/.test(line);
    if (line.trim() === "" || isBullet || /^#{1,6}\s/.test(line)) {
      if (current) out.push(current);
      current = line.trim() === "" || /^#{1,6}\s/.test(line) ? null : { line: firstLine + i, text: line };
    } else if (current) current.text += `\n${line}`;
    else current = { line: firstLine + i, text: line };
  });
  if (current) out.push(current);
  return out;
}

/** Bloques de CHANGELOG.md con la versión de su sección. */
export function changelogBlocks(text) {
  const out = [];
  const re = /^## (\d+\.\d+\.\d+)\S*.*$/gm;
  const heads = [...text.matchAll(re)];
  heads.forEach((h, i) => {
    const start = h.index + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const firstLine = text.slice(0, start).split("\n").length + 1;
    for (const b of blocks(text.slice(start + 1, end), firstLine)) out.push({ ...b, version: h[1] });
  });
  return out;
}

/** Viñetas de ALPHA_RELEASE_NOTES.md que empiezan nombrando su versión. */
export function releaseNotesBlocks(text) {
  return blocks(text)
    .map((b) => {
      const m = b.text.match(/^\s*[-*]\s+\*\*(\d+\.\d+\.\d+)\b/);
      return m ? { ...b, version: m[1] } : null;
    })
    .filter(Boolean);
}

/** Los bloques en vigor que citan una cifra sin declarar su origen. */
export function findViolations(files, firstVersion = FIRST_CHECKED_VERSION) {
  const violations = [];
  for (const { path, blocks: list } of files) {
    for (const b of list) {
      if (compareVersions(b.version, firstVersion) < 0) continue;
      if (!citesTestCount(b.text)) continue;
      const missing = missingDeclarations(b.text);
      if (missing.length) violations.push({ path, line: b.line, version: b.version, missing });
    }
  }
  return violations;
}
