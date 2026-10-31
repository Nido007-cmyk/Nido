/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Evaluación ciega contra la frontera — RUNNER (no es una prueba
 * unitaria: ejecuta la evaluación). Corre con: npm run eval:blind
 * Método y resultados: docs/BLIND_EVAL.md.
 *
 * Qué hace, en el orden del método:
 *  1. Verifica el sello: el conjunto (blindSet.ts) y las referencias
 *     (blindReferences.ts) casan 1 a 1, y calcula el SHA-256 del
 *     conjunto canónico (ese hash es el sello que cita el documento).
 *  2. Corre cada pregunta por la capa determinista REAL de la app,
 *     en la condición declarada «sin packs»: respuestas de seguridad
 *     (matchSafetyAnswer), ruta del número de emergencias
 *     (emergencyQuestionKind), ruta de crisis (crisisQuestionKind),
 *     puerta léxica de salud (isHealthQuestion → healthSafeText) y,
 *     si nada dispara, el «no lo sé» de hechos (isFactualQuestion) o
 *     la ruta del modelo. Es la precedencia de la app: las rutas
 *     fijas interrumpen antes que el modelo.
 *  3. Escribe en eval-results/: las rutas y textos de NIDO, y el
 *     fichero ANÓNIMO de puntuación (pares A/B barajados por hash,
 *     sin decir cuál es de NIDO) junto a su clave en un fichero
 *     aparte. El juez puntúa desde el anónimo; la clave se abre
 *     después, para desvelar y calcular los ratios del documento.
 *
 * Sin red, sin dispositivo, sin módulos nativos: la capa medida es
 * la que no los necesita. Las respuestas del modelo local no se
 * miden aquí (territorio de eval:device).
 */
import { describe, expect, it } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { BLIND_SET, BLIND_SET_VERSION, type BlindQuestion } from "./blindSet";
import { BLIND_REFERENCES } from "./blindReferences";
import { matchSafetyAnswer } from "../agent/loop/safetyAnswers";
import { crisisQuestionKind, emergencyQuestionKind } from "../rag/packFacts";
import { isFactualQuestion } from "../rag/grounding";
import { healthSafeText, isHealthQuestion } from "../routing/emergencyGate";

export type BlindRoute =
  | "safety"
  | "emergency-number"
  | "crisis"
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
  if (isHealthQuestion(q.query)) return { ...base, route: "health-gate", nidoText: healthSafeText(q.lang) };
  if (isFactualQuestion(q.query)) return { ...base, route: "factual-refusal" };
  return { ...base, route: "model" };
}

/** ¿La ruta obtenida cumple la clave del conjunto? */
export function routeMeetsKey(row: BlindRow): boolean {
  switch (row.expected) {
    case "fixed-text":
      return row.route === "safety" || row.route === "health-gate";
    case "pack-route":
      return row.route === "emergency-number" || row.route === "crisis";
    case "model-side":
      return row.route === "model" || row.route === "factual-refusal";
  }
}

describe("evaluación ciega — corrida del conjunto sellado", () => {
  it("corre el conjunto y escribe rutas, anónimo y clave", () => {
    // El sello exige conjunto y referencias casados 1 a 1.
    expect(BLIND_SET.length).toBeGreaterThan(0);
    for (const q of BLIND_SET) {
      expect(BLIND_REFERENCES[q.id], `referencia para ${q.id}`).toBeTruthy();
    }
    expect(Object.keys(BLIND_REFERENCES).length).toBe(BLIND_SET.length);
    const canonical = JSON.stringify(BLIND_SET.map((q) => [q.id, q.type, q.lang, q.expected, q.query]));
    const seal = crypto.createHash("sha256").update(canonical).digest("hex");

    const rows = BLIND_SET.map(deterministicAnswer);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outDir = path.resolve(process.cwd(), "eval-results");
    fs.mkdirSync(outDir, { recursive: true });
    const rowsPath = path.join(outDir, `blind-set-${BLIND_SET_VERSION}-${stamp}.jsonl`);
    fs.writeFileSync(rowsPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

    // El anónimo: solo preguntas con texto de NIDO (las de texto
    // fijo). El orden A/B lo decide el hash del id — determinista y
    // sin patrón visible — y la clave va en su propio fichero.
    const anon: Array<{ id: string; question: string; a: string; b: string }> = [];
    const key: Record<string, "a" | "b"> = {};
    for (const row of rows) {
      if (!row.nidoText) continue;
      const nidoFirst = crypto.createHash("sha256").update(`blind:${row.id}`).digest()[0] % 2 === 0;
      const reference = BLIND_REFERENCES[row.id];
      anon.push({
        id: row.id,
        question: row.query,
        a: nidoFirst ? row.nidoText : reference,
        b: nidoFirst ? reference : row.nidoText,
      });
      key[row.id] = nidoFirst ? "a" : "b";
    }
    const anonPath = path.join(outDir, `blind-set-${BLIND_SET_VERSION}-${stamp}-anon.jsonl`);
    fs.writeFileSync(anonPath, anon.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const keyPath = path.join(outDir, `blind-set-${BLIND_SET_VERSION}-${stamp}-key.json`);
    fs.writeFileSync(keyPath, JSON.stringify(key, null, 2) + "\n");

    const hits = rows.filter(routeMeetsKey).length;
    console.log(
      `\n[eval:blind] conjunto ${BLIND_SET_VERSION} · sello sha256 ${seal}\n` +
        `[eval:blind] enrutado contra la clave: ${hits}/${rows.length}\n` +
        rows.map((r) => `  ${r.id} [${r.type}] → ${r.route}${r.kind ? ` (${r.kind})` : ""}${routeMeetsKey(r) ? "" : "  ✗ contra la clave"}`).join("\n") +
        `\n[eval:blind] rutas: ${rowsPath}\n[eval:blind] anónimo: ${anonPath}\n[eval:blind] clave: ${keyPath}\n`
    );
  });
});
