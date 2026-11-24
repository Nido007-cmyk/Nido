#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * El suelo de seguridad de puertas (Fase 1 del plan de ingeniería):
 * mide el árbol con el corpus de la F0 (scripts/eval-gates.mjs),
 * aplica las tres reglas de scripts/lib/gates-lib.mjs contra
 * eval/gates/baseline.json y cobra la frescura de la ficha
 * (docs/SAFETY_CARD.md regenerada en memoria y comparada byte a
 * byte). Imprime en el formato del ratchet de sellos, con
 * anotaciones ::error si va --github, y sale 1 si hay violaciones.
 * Nunca escribe en el árbol: la medida va a un temporal.
 *
 * La pierna de monotonía de la regla 2 compara el baseline del PR
 * con el de su base (GITHUB_BASE_REF, vía git); si la base no trae
 * baseline — el PR que lo estrena — o git no está disponible, esa
 * pierna no aplica y las demás cobran igual.
 *
 *   node scripts/check-gates.mjs [--github]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fmt, violacionesSuelo } from "./lib/gates-lib.mjs";
import { buildSafetyCard, CARD_REL } from "./generate-safety-card.mjs";

const root = process.cwd();
const github = process.argv.includes("--github");

// 1 · Medir el árbol con el corpus de la F0.
const outTmp = join(process.env.RUNNER_TEMP || tmpdir(), "gates-salida.json");
execFileSync(
  "npx",
  ["tsx", "scripts/eval-gates.mjs", ".", "--corpus", "eval/gates/corpus", "--out", outTmp],
  { cwd: root, stdio: "pipe" }
);
const medida = JSON.parse(readFileSync(outTmp, "utf8"));
const baseline = JSON.parse(readFileSync(join(root, "eval/gates/baseline.json"), "utf8"));

// 2 · La base del PR, para la monotonía (si git y la base acompañan).
let baselineBase = null;
let corpusTocado = false;
const baseRef = process.env.GITHUB_BASE_REF;
if (baseRef) {
  const gitShow = () => {
    try {
      return execFileSync("git", ["show", `origin/${baseRef}:eval/gates/baseline.json`], {
        cwd: root,
        stdio: "pipe",
      }).toString("utf8");
    } catch {
      return null;
    }
  };
  let textoBase = gitShow();
  if (textoBase == null) {
    try {
      execFileSync("git", ["fetch", "--depth=1", "origin", baseRef], { cwd: root, stdio: "pipe" });
      textoBase = gitShow();
    } catch {
      textoBase = null;
    }
  }
  if (textoBase != null) {
    try {
      baselineBase = JSON.parse(textoBase);
    } catch {
      baselineBase = null;
    }
  }
  try {
    const tocados = execFileSync("git", ["diff", "--name-only", `origin/${baseRef}...HEAD`], {
      cwd: root,
      stdio: "pipe",
    })
      .toString("utf8")
      .split("\n");
    corpusTocado = tocados.some((p) => p.startsWith("eval/gates/corpus/"));
  } catch {
    corpusTocado = false;
  }
}

// 3 · Las tres reglas, y 4 · la frescura de la ficha.
const violaciones = violacionesSuelo({ medida, baseline, baselineBase, corpusTocado });
const riesgos = JSON.parse(readFileSync(join(root, "eval/gates/riesgos.json"), "utf8"));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const fichaEsperada = buildSafetyCard({ medida, baseline, riesgos, version });
const fichaActual = existsSync(join(root, CARD_REL)) ? readFileSync(join(root, CARD_REL), "utf8") : null;
if (fichaActual !== fichaEsperada) {
  violaciones.push(
    "docs/SAFETY_CARD.md no es la que el script genera para este árbol: regenera con `node scripts/generate-safety-card.mjs` y comete el resultado"
  );
}

// 5 · Salida, en el formato del ratchet.
const suelosTxt = Object.entries(baseline.suelos ?? {})
  .map(([celda, suelo]) => `${celda.split("/")[1]} ${fmt(suelo)}`)
  .join(" · ");
console.log("## Suelo de seguridad de puertas");
console.log(
  `${medida.totalPrimaria.ok}/${medida.totalPrimaria.total} · ${fmt(medida.totalPrimaria.tasa)} % primaria contra baseline ${fmt(baseline.totalPrimaria.tasa)} %; suelos de crisis: ${suelosTxt}.`
);
if (violaciones.length) {
  console.log(`\n### Violaciones del suelo (${violaciones.length})`);
  for (const v of violaciones) {
    console.log(`- ${v}`);
    if (github) console.log(`::error title=Suelo de puertas::${v}`);
  }
  process.exit(1);
}
console.log("Sin violaciones: ni regresión, ni suelo roto, ni guarda que empeore, y la ficha es la de este árbol.");
