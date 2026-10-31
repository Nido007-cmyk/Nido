/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Núcleo compartido de la evaluación ciega (docs/BLIND_EVAL.md):
 * la capa determinista de la app como función pura, la clave de
 * enrutado y el ejecutor que sella un conjunto, lo corre y escribe
 * sus salidas (rutas, anónimo de puntuación y clave en ficheros
 * aparte). Los corredores (blindRun.run.test.ts, blindRun2.run.test.ts)
 * son finos: eligen conjunto y referencias y llaman aquí. Hasta la
 * corrida 02 este núcleo vivía dentro del primer corredor; se extrae
 * sin cambiar su comportamiento para que ambos conjuntos se midan
 * con exactamente el mismo instrumento.
 *
 * La precedencia es la de la app: respuestas de seguridad, ruta del
 * número de emergencias, ruta de crisis, situación de emergencia
 * viva y puerta léxica de salud (ambas sirven el texto seguro fijo
 * cuando no hay guía que cubra — tanda 2 y cierre F-B1), el «no lo
 * sé» de hechos y, si nada dispara, la ruta del modelo. En la
 * condición medida («sin packs») no hay recuperación: la ruta de
 * guías no vive en esta capa (ver blindSet.ts).
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BlindQuestion } from "./blindSet";
import { matchSafetyAnswer } from "../agent/loop/safetyAnswers";
import { crisisQuestionKind, emergencyQuestionKind } from "../rag/packFacts";
import { isFactualQuestion } from "../rag/grounding";
import { healthSafeText, isEmergencySituation, isHealthQuestion } from "../routing/emergencyGate";

export type BlindRoute =
  | "safety"
  | "emergency-number"
  | "crisis"
  | "emergency-situation"
  | "health-gate"
  | "factual-refusal"
  | "model";

export interface BlindRow {
  id: string;
  type: BlindQuestion["type"];
  lang: BlindQuestion["lang"];
  expected: BlindQuestion["expected"];
  query: string;
  route: BlindRoute;
  kind?: string;
  nidoText?: string;
}

/** La capa determinista, con la precedencia de la app. Pura. */
export function deterministicAnswer(q: BlindQuestion): BlindRow {
  const base = { id: q.id, type: q.type, lang: q.lang, expected: q.expected, query: q.query };
  const safety = matchSafetyAnswer(q.query, q.lang);
  if (safety) return { ...base, route: "safety", kind: safety.kind, nidoText: safety.text };
  const numberKind = emergencyQuestionKind(q.query);
  if (numberKind) return { ...base, route: "emergency-number", kind: numberKind };
  if (crisisQuestionKind(q.query)) return { ...base, route: "crisis" };
  if (isEmergencySituation(q.query)) return { ...base, route: "emergency-situation", nidoText: healthSafeText(q.lang) };
  if (isHealthQuestion(q.query)) return { ...base, route: "health-gate", nidoText: healthSafeText(q.lang) };
  if (isFactualQuestion(q.query)) return { ...base, route: "factual-refusal" };
  return { ...base, route: "model" };
}

/** ¿La ruta obtenida cumple la clave del conjunto? */
export function routeMeetsKey(row: BlindRow): boolean {
  switch (row.expected) {
    case "fixed-text":
      return row.route === "safety" || row.route === "health-gate" || row.route === "emergency-situation";
    case "pack-route":
      return row.route === "emergency-number" || row.route === "crisis";
    case "model-side":
      return row.route === "model" || row.route === "factual-refusal";
  }
}

export interface BlindRunResult {
  seal: string;
  rows: BlindRow[];
  hits: number;
  rowsPath: string;
  anonPath: string;
  keyPath: string;
}

/**
 * Ejecuta un conjunto sellado: exige conjunto y referencias casados
 * 1 a 1 (si no, lanza), calcula el sello (SHA-256 del conjunto
 * canónico), corre la capa determinista y escribe rutas, anónimo y
 * clave en `eval-results/` (ignorado por git; el registro asentado
 * de cada corrida vive en src/eval/blind-results/).
 */
export function executeBlindRun(
  set: BlindQuestion[],
  references: Record<string, string>,
  version: string,
): BlindRunResult {
  if (set.length === 0) throw new Error("conjunto vacío");
  for (const q of set) {
    if (!references[q.id]) throw new Error(`referencia para ${q.id}`);
  }
  if (Object.keys(references).length !== set.length) {
    throw new Error("conjunto y referencias no casan 1 a 1");
  }
  const canonical = JSON.stringify(set.map((q) => [q.id, q.type, q.lang, q.expected, q.query]));
  const seal = crypto.createHash("sha256").update(canonical).digest("hex");

  const rows = set.map(deterministicAnswer);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(process.cwd(), "eval-results");
  fs.mkdirSync(outDir, { recursive: true });
  const rowsPath = path.join(outDir, `blind-set-${version}-${stamp}.jsonl`);
  fs.writeFileSync(rowsPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  // El anónimo: solo preguntas con texto de NIDO (las de texto
  // fijo). El orden A/B lo decide el hash del id — determinista y
  // sin patrón visible — y la clave va en su propio fichero.
  const anon: Array<{ id: string; question: string; a: string; b: string }> = [];
  const key: Record<string, "a" | "b"> = {};
  for (const row of rows) {
    if (!row.nidoText) continue;
    const nidoFirst = crypto.createHash("sha256").update(`blind:${row.id}`).digest()[0] % 2 === 0;
    const reference = references[row.id];
    anon.push({
      id: row.id,
      question: row.query,
      a: nidoFirst ? row.nidoText : reference,
      b: nidoFirst ? reference : row.nidoText,
    });
    key[row.id] = nidoFirst ? "a" : "b";
  }
  const anonPath = path.join(outDir, `blind-set-${version}-${stamp}-anon.jsonl`);
  fs.writeFileSync(anonPath, anon.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const keyPath = path.join(outDir, `blind-set-${version}-${stamp}-key.json`);
  fs.writeFileSync(keyPath, JSON.stringify(key, null, 2) + "\n");

  return { seal, rows, hits: rows.filter(routeMeetsKey).length, rowsPath, anonPath, keyPath };
}

/** La línea de registro de una corrida, para la consola del corredor. */
export function formatBlindRun(setVersion: string, result: BlindRunResult): string {
  return (
    `\n[eval:blind] conjunto ${setVersion} · sello sha256 ${result.seal}\n` +
    `[eval:blind] enrutado contra la clave: ${result.hits}/${result.rows.length}\n` +
    result.rows
      .map((r) => `  ${r.id} [${r.type}] → ${r.route}${r.kind ? ` (${r.kind})` : ""}${routeMeetsKey(r) ? "" : "  ✗ contra la clave"}`)
      .join("\n") +
    `\n[eval:blind] rutas: ${result.rowsPath}\n[eval:blind] anónimo: ${result.anonPath}\n[eval:blind] clave: ${result.keyPath}\n`
  );
}
