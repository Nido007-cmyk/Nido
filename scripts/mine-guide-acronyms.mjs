/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// Minería de acrónimos de las guías (bounty, tanda 8): extrae los
// pares acrónimo↔definición que las propias guías declaran y
// produce un informe Markdown de variantes de búsqueda candidatas
// para el carril de packs (el registro sigue siendo el mecanismo
// `<!-- preguntas: … -->` del constructor, a mano y con la puerta
// de recuperación por delante). Uso:
//
//   node scripts/mine-guide-acronyms.mjs [--out INFORME.md] [pack…]
//
// Sin packs: nido-esencial y nido-local. Sin --out: a stdout.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mineGuides } from "./lib/acronym-lib.mjs";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const outFile = outAt >= 0 ? args[outAt + 1] : null;
const packs = args.filter((a, i) => !a.startsWith("--") && i !== outAt + 1);
const packIds = packs.length > 0 ? packs : ["nido-esencial", "nido-local"];

const lines = [
  "# Minería de acrónimos de las guías — variantes candidatas",
  "",
  "Generado por `scripts/mine-guide-acronyms.mjs` (bounty, tanda 8;",
  "método de minería de alias de Bivouac, MIT). Cada fila es un par",
  "acrónimo↔definición que el propio texto de una guía declara: un",
  "usuario que pregunta por el nombre entero debería encontrar la",
  "guía que solo se titula por el acrónimo. «En variantes» dice si",
  "la definición ya vive en algún comentario `preguntas:` del pack;",
  "las que no, son las candidatas a registrar por el carril de",
  "packs, con la puerta de recuperación (`check-pack-retrieval`)",
  "como juez antes de darlas por buenas. Minar no es registrar:",
  "este informe no cambia la recuperación por sí solo.",
  "",
];

let totalPairs = 0;
let totalCandidates = 0;
for (const packId of packIds) {
  const guides = [];
  const base = join("knowledge-packs", packId);
  for (const lang of readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    for (const file of readdirSync(join(base, lang)).filter((f) => f.endsWith(".md"))) {
      guides.push({ name: `${lang}/${file}`, text: readFileSync(join(base, lang, file), "utf8") });
    }
  }
  const rows = mineGuides(guides);
  const candidates = rows.filter((r) => !r.inVariants);
  totalPairs += rows.length;
  totalCandidates += candidates.length;
  lines.push(`## ${packId} — ${rows.length} pares, ${candidates.length} candidatos sin registrar`);
  lines.push("");
  lines.push("| Acrónimo | Definición que la guía declara | Guías | Ejemplo | En variantes |");
  lines.push("| --- | --- | ---: | --- | --- |");
  for (const r of rows) {
    lines.push(`| ${r.acronym} | ${r.definition} | ${r.guides} | ${r.example} | ${r.inVariants ? "sí" : "NO"} |`);
  }
  lines.push("");
}

lines.push(`Total: ${totalPairs} pares, ${totalCandidates} candidatos sin registrar.`);
lines.push("");

const report = lines.join("\n");
if (outFile) {
  writeFileSync(outFile, report);
  console.log(`informe: ${outFile} (${totalPairs} pares, ${totalCandidates} candidatos)`);
} else {
  console.log(report);
}
