#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Check (c) of rule R00-5 (Esencial re-verification program), sibling
 * of scripts/check-pack-claims.mjs: it validates the citation layer of
 * the sealed guides in knowledge-packs/nido-esencial/
 * verification-ledger.json. The two runs are never confused:
 *
 *   node scripts/check-guide-citations.mjs            (offline)
 *     Structure and hash only: every ledger row carries its official
 *     source, exact quote, locator and check date, its outcome is in
 *     the program's vocabulary, and every sealed file still matches
 *     its ledger hash. No network is touched.
 *
 *   node scripts/check-guide-citations.mjs --online [--strict]
 *     Additionally re-opens each row's official identifier (URL or
 *     DOI) and checks the exact quote is still there, like the weekly
 *     claims check does for the Local pack's facts.
 *
 * Exit code 1 on structural or hash problems; in the online run, also
 * when a quote has disappeared (with --strict, also when a source
 * could not be fetched).
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { htmlToText, quoteIsPresent } from "./lib/knowledge-pack-lib.mjs";
import { ledgerProblems, loadLedger, validateLedger } from "./lib/esencial-ledger-lib.mjs";

const args = process.argv.slice(2);
const online = args.includes("--online");
const strict = args.includes("--strict");
const root = process.cwd();

const ledger = loadLedger(root);
if (!ledger) {
  console.log("## Citas de guías de Esencial\nSin ledger todavía: ninguna tanda ha sellado, no hay capa de citas que validar.");
  process.exit(0);
}

const problems = [...validateLedger(ledger), ...ledgerProblems(root, ledger)];
const rows = ledger.guides.flatMap((g) => g.filas.map((f) => ({ ...f, _guia: g.guideId })));
console.log(`## Citas de guías de Esencial (${online ? "con red: supervivencia" : "sin red: estructura y hash"})`);
console.log(`${ledger.guides.length} guías selladas, ${rows.length} filas de afirmación.`);
if (problems.length) {
  console.log(`\n### Problemas de estructura o hash (${problems.length})\n${problems.map((p) => `- ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("Estructura y hash en regla.");

if (!online) process.exit(0);

// ---- online run: citation survival -------------------------------------
const fetchable = (id) => {
  if (/^https:\/\//.test(id)) return id;
  if (/^10\.\d{4,}\//.test(id)) return `https://doi.org/${id}`;
  return null;
};
const byUrl = new Map();
const notFetchable = [];
for (const row of rows) {
  const url = fetchable(row.identificador);
  if (!url) {
    notFetchable.push(`${row.guia} ${row.afirmacionId}: identificador no recuperable por red («${row.identificador}»)`);
    continue;
  }
  byUrl.set(url, [...(byUrl.get(url) ?? []), row]);
}

async function pageText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "NIDO-source-check/1.0 (+https://github.com/Nido007-cmyk/Nido)", accept: "text/html,application/pdf;q=0.9,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
    const dir = mkdtempSync(join(tmpdir(), "nido-citations-"));
    const pdf = join(dir, "source.pdf");
    writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
    return execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
  }
  return htmlToText(await res.text());
}

const missing = [], unreachable = [];
for (const [url, list] of byUrl) {
  let text;
  try {
    text = await pageText(url);
  } catch (e) {
    unreachable.push(`${url} (${e.message}) — ${list.map((f) => `${f.guia} ${f.afirmacionId}`).join(", ")}`);
    continue;
  }
  const gone = list.filter((f) => !quoteIsPresent(text, f.citaLiteral));
  if (gone.length > 0 && gone.length === list.length) {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    unreachable.push(`${url} (ninguna cita encontrada; ${text.length} caracteres: «${snippet}») — ${list.map((f) => `${f.guia} ${f.afirmacionId}`).join(", ")}`);
    continue;
  }
  for (const f of gone) missing.push(`${f.guia} ${f.afirmacionId}: «${f.citaLiteral}» ya no aparece en ${url}`);
}
if (notFetchable.length) console.log(`\n### Identificadores sin recuperación por red (${notFetchable.length})\n${notFetchable.map((m) => `- ${m}`).join("\n")}`);
if (missing.length) console.log(`\n### Cita que ya no aparece (${missing.length})\n${missing.map((m) => `- ${m}`).join("\n")}`);
if (unreachable.length) console.log(`\n### Fuente que no se pudo abrir (${unreachable.length})\n${unreachable.map((m) => `- ${m}`).join("\n")}`);
if (!missing.length && !unreachable.length) console.log("Todas las citas siguen en su fuente.");
process.exit(missing.length || (strict && unreachable.length) ? 1 : 0);
