#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Re-opens the official source of every verified fact in a pack's facts.json
 * and checks that its exact quote is still there. Run weekly in CI so a pack
 * never keeps a number its source has changed or withdrawn.
 *
 *   node scripts/check-pack-claims.mjs knowledge-packs/nido-local/facts.json [--max-age 180] [--strict]
 *
 * Exit code 1 when a quote is missing (with --strict, also when a source could
 * not be fetched or a fact is older than --max-age days).
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daysSince, htmlToText, quoteIsPresent, validateFacts } from "./lib/knowledge-pack-lib.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? "knowledge-packs/nido-local/facts.json";
const strict = args.includes("--strict");
const maxAgeIdx = args.indexOf("--max-age");
const maxAge = maxAgeIdx >= 0 ? Number(args[maxAgeIdx + 1]) : 180;

const { facts } = validateFacts(JSON.parse(readFileSync(file, "utf8")), file);
const byUrl = new Map();
for (const f of facts) byUrl.set(f.source.url, [...(byUrl.get(f.source.url) ?? []), f]);

async function pageText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "NIDO-source-check/1.0 (+https://github.com/Nido007-cmyk/Nido)", accept: "text/html,application/pdf;q=0.9,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
    const dir = mkdtempSync(join(tmpdir(), "nido-claims-"));
    const pdf = join(dir, "source.pdf");
    writeFileSync(pdf, Buffer.from(await res.arrayBuffer()));
    return execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
  }
  return htmlToText(await res.text());
}

const missing = [], unreachable = [], stale = [];
for (const [url, list] of byUrl) {
  let text;
  try {
    text = await pageText(url);
  } catch (e) {
    unreachable.push(`${url} (${e.message}) — ${list.map((f) => `${f.region} ${f.key}`).join(", ")}`);
    continue;
  }
  const gone = list.filter((f) => !quoteIsPresent(text, f.source.quote));
  if (gone.length > 0 && gone.length === list.length) {
    // Not one quote from this page is there: most likely we were served a
    // different page (consent wall, bot block, script-only shell), not a
    // changed number. Reported for a human to open, with what we got.
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    unreachable.push(`${url} (ninguna cita encontrada; ${text.length} caracteres: «${snippet}») — ${list.map((f) => `${f.region} ${f.key}`).join(", ")}`);
    continue;
  }
  for (const f of gone) missing.push(`${f.region} ${f.key} = ${f.value}: «${f.source.quote}» no aparece en ${url}`);
}
for (const f of facts) if (daysSince(f.source.checked) > maxAge) stale.push(`${f.region} ${f.key}: comprobado el ${f.source.checked}`);

const lines = [
  `## Comprobación de fuentes de ${file}`,
  `${facts.length} datos, ${byUrl.size} fuentes.`,
  missing.length ? `\n### Cita que ya no aparece (${missing.length})\n${missing.map((m) => `- ${m}`).join("\n")}` : "\nTodas las citas siguen en su fuente.",
  unreachable.length ? `\n### Fuente que no se pudo abrir (${unreachable.length})\n${unreachable.map((m) => `- ${m}`).join("\n")}` : "",
  stale.length ? `\n### Datos con más de ${maxAge} días sin revisar (${stale.length})\n${stale.map((m) => `- ${m}`).join("\n")}` : "",
].join("\n");
console.log(lines);
if (process.env.GITHUB_ACTIONS) {
  // One annotation per kind of problem (GitHub caps how many a step can show).
  const esc = (t) => t.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  if (missing.length) console.log(`::error title=Citas que ya no aparecen (${missing.length})::${esc(missing.join("\n"))}`);
  if (unreachable.length) console.log(`::warning title=Fuentes que no se pudieron abrir (${unreachable.length})::${esc(unreachable.join("\n"))}`);
  if (stale.length) console.log(`::warning title=Datos sin revisar hace más de ${maxAge} días (${stale.length})::${esc(stale.join("\n"))}`);
}
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines + "\n", { flag: "a" });
process.exit(missing.length || (strict && (unreachable.length || stale.length)) ? 1 : 0);
