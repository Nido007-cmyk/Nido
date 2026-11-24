#!/usr/bin/env node
/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Genera docs/SAFETY_CARD.md, la ficha de seguridad de puertas de la
 * Fase 1: las tasas del corpus de la F0 medidas sobre este árbol, la
 * foto del baseline, los suelos vigentes y los riesgos conocidos.
 *
 * La ficha se genera SOLO desde contenido del repo (la salida de
 * eval-gates.mjs sobre el árbol, eval/gates/baseline.json,
 * eval/gates/riesgos.json y la versión de package.json): sin fecha de
 * corrida, sin SHA de run, sin nombre de máquina. La misma entrada
 * produce la misma ficha byte a byte, en CI y en local; por eso su
 * frescura se puede cobrar por comparación (--check, y el check de la
 * F1 la cobra en cada PR). Nunca se edita a mano.
 *
 *   node scripts/generate-safety-card.mjs           regenera la ficha
 *   node scripts/generate-safety-card.mjs --check   sale 1 si difiere
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fmt, fmtDelta } from "./lib/gates-lib.mjs";

export const CARD_REL = "docs/SAFETY_CARD.md";

// Miles con punto, sin depender de los datos ICU del Node que corre.
const fmtMiles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const celdaTxt = (c) => `${c.ok}/${c.total} · ${fmt(c.tasa)} %`;

/** La ficha entera, como texto. Pura: mismos datos, mismos bytes. */
export function buildSafetyCard({ medida, baseline, riesgos, version }) {
  const L = [];
  L.push(`# Ficha de seguridad · NIDO ${version}`);
  L.push("");
  L.push("> Generada por `scripts/generate-safety-card.mjs` desde");
  L.push("> `eval/gates/baseline.json` y la medida de este árbol.");
  L.push("> No editar a mano: el check de CI la regenera y compara.");
  L.push("");

  // 1 · Tasas de puertas
  const foto = baseline.primariaPorRutaIdioma;
  L.push(`## 1 · Tasas de puertas (corpus de la F0, ${fmtMiles(medida.totalPrimaria.total)} variantes)`);
  L.push("");
  L.push("| Celda | Medida | Baseline | Δ |");
  L.push("|---|---|---|---|");
  for (const [celda, ref] of Object.entries(foto)) {
    const m = medida.primariaPorRutaIdioma[celda];
    L.push(`| ${celda} | ${celdaTxt(m)} | ${fmt(ref.tasa)} % | ${fmtDelta(m.tasa - ref.tasa)} |`);
  }
  L.push(
    `| **Total primaria** | **${medida.totalPrimaria.ok}/${medida.totalPrimaria.total} · ${fmt(medida.totalPrimaria.tasa)} %** | **${fmt(baseline.totalPrimaria.tasa)} %** | **${fmtDelta(medida.totalPrimaria.tasa - baseline.totalPrimaria.tasa)}** |`
  );
  L.push("");
  L.push("Sensibilidad por tipo de variante (puerta primaria):");
  L.push("");
  L.push("| Tipo | Medida | Baseline |");
  L.push("|---|---|---|");
  for (const [tipo, ref] of Object.entries(baseline.sensibilidadPorTipo)) {
    const m = medida.sensibilidadPorTipo[tipo];
    L.push(`| ${tipo} | ${celdaTxt(m)} | ${fmt(ref.tasa)} % |`);
  }
  L.push("");

  // 2 · Falsos positivos (guarda)
  L.push("## 2 · Falsos positivos (guarda)");
  L.push("");
  L.push("| Subcorpus | Con alguna puerta | health | emergency | crisis | co |");
  L.push("|---|---|---|---|---|---|");
  const filaGuarda = (nombre, v) =>
    `| ${nombre} | ${v.conAlgunaPuerta}/${v.total} | ${v.porPuerta.health} | ${v.porPuerta.emergency} | ${v.porPuerta.crisis} | ${v.porPuerta.co} |`;
  L.push(filaGuarda("guía (suelo cero)", medida.guarda.porSubcorpus.guia));
  L.push(filaGuarda("negativos", medida.guarda.porSubcorpus.negativos));
  L.push(filaGuarda("históricos", medida.guarda.porSubcorpus.historicos));
  if (medida.guardaAmpliada) {
    for (const [sub, v] of Object.entries(medida.guardaAmpliada.porSubcorpus)) {
      L.push(filaGuarda(sub === "ciega-guia" ? "ciega-guia (suelo cero)" : sub, v));
    }
  }
  L.push("");
  L.push(
    "La lectura de las familias conocidas: los falsos positivos de crisis son la familia F6 del censo " +
      "(frases de ficción, modismos y marcos que lo léxico lee como crisis: en negativos y en el cubo ciega-ficcion); " +
      "los históricos que declaran salud son la familia F9 (tema histórico que declara salud sin urgencia); " +
      "el veto de prevención lo rompe la cortesía en los tres idiomas (los falsos positivos de emergencia de " +
      "negativos, ciega-prevencion y ciega-historicos); y en los cubos de tema de la ciega (prevención, históricos " +
      "y médico) salud declara como tema, que es conducta asentada: su foto por cubo es el techo, no un cero exigido."
  );
  L.push("");

  // 3 · Matriz de confusión
  L.push("## 3 · Matriz de confusión y confusión nombrada");
  L.push("");
  const cols = ["salud", "emergencia", "crisis", "monoxido", "ninguna"];
  L.push(`| Esperada \\ Respondida | ${cols.join(" | ")} |`);
  L.push(`|---|${cols.map(() => "---").join("|")}|`);
  for (const [esp, fila] of Object.entries(medida.matrizConfusion)) {
    L.push(`| ${esp} | ${cols.map((c) => fila[c] ?? 0).join(" | ")} |`);
  }
  L.push("");
  L.push(`- Crisis esperada respondida como salud: ${medida.confusionNombrada.crisisEsperadaRespondidaComoSalud}`);
  L.push(`- Crisis esperada sin ninguna puerta: ${medida.confusionNombrada.crisisEsperadaSinNingunaPuerta}`);
  L.push("");

  // 4 · Suelos vigentes
  L.push("## 4 · Suelos vigentes");
  L.push("");
  L.push("| Celda | Suelo | Última subida |");
  L.push("|---|---|---|");
  for (const [celda, suelo] of Object.entries(baseline.suelos ?? {})) {
    L.push(`| ${celda} | ${fmt(suelo)} | ${baseline.suelosHistorial?.[celda] ?? "F0 (2026-11-24)"} |`);
  }
  L.push("");

  // 5 · Riesgos conocidos
  L.push("## 5 · Riesgos conocidos");
  L.push("");
  riesgos.riesgos.forEach((r, i) => {
    L.push(`${i + 1}. **${r.titulo}.** ${r.texto}`);
    L.push("");
  });

  // 6 · Lo que no se ha medido
  L.push("## 6 · Lo que no se ha medido");
  L.push("");
  for (const t of riesgos.noMedido) L.push(`- ${t}`);
  L.push("");

  return L.join("\n");
}

// --- CLI (no corre al importar: check-gates reutiliza buildSafetyCard) ---
const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) {
  const root = process.cwd();
  const outTmp = join(process.env.RUNNER_TEMP || tmpdir(), "gates-salida-ficha.json");
  execFileSync(
    "npx",
    ["tsx", "scripts/eval-gates.mjs", ".", "--corpus", "eval/gates/corpus", "--out", outTmp],
    { cwd: root, stdio: "pipe" }
  );
  const medida = JSON.parse(readFileSync(outTmp, "utf8"));
  const baseline = JSON.parse(readFileSync(join(root, "eval/gates/baseline.json"), "utf8"));
  const riesgos = JSON.parse(readFileSync(join(root, "eval/gates/riesgos.json"), "utf8"));
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const ficha = buildSafetyCard({ medida, baseline, riesgos, version });
  const destino = join(root, CARD_REL);
  if (process.argv.includes("--check")) {
    const actual = existsSync(destino) ? readFileSync(destino, "utf8") : null;
    if (actual !== ficha) {
      console.error(
        "docs/SAFETY_CARD.md no es la que el script genera para este árbol: regenera con `node scripts/generate-safety-card.mjs` y comete el resultado"
      );
      process.exit(1);
    }
    console.log("docs/SAFETY_CARD.md: la ficha cometida es la que el script genera para este árbol.");
  } else {
    writeFileSync(destino, ficha);
    console.log(`ficha escrita en ${CARD_REL}`);
  }
}
