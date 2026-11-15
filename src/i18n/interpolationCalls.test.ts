/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Censo de interpolación fijado (T-23, subida a i18next 27).
 *
 * La comprobación estricta de interpolación de i18next solo muerde con los
 * recursos tipados, y NIDO no los tipa: esta sonda es su superficie. Recorre
 * el código con el parser de TypeScript y exige que toda llamada con clave
 * literal — t("clave"), t("clave", {…}) y la forma con texto por defecto
 * t("clave", "…", {…}) — pase TODAS las variables que el mensaje necesita
 * (su valor y el de sus formas plurales y de contexto). Una variable ausente
 * o mal nombrada se ve como un {{hueco}} crudo en la pantalla del usuario.
 *
 * Las llamadas con opciones no literales (identificador, spread, llamada)
 * no pueden comprobarse así: hoy hay CERO y la sonda lo fija; si aparece
 * una, este test la nombra y toca revisarla a ojo antes de sellarla aquí.
 * Las claves dinámicas (plantillas o variables) son mecanismos diseñados
 * con sus propias baterías (p. ej. downloadErrors) y quedan fuera, como en
 * hygiene.test.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import en from "./locales/en.json";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");

function flatValues(node: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (node === null || typeof node !== "object") {
    out.set(prefix, String(node));
    return out;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    flatValues(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

const VALUES = flatValues(en);
const VAR_RE = /\{\{\s*([A-Za-z_][\w.]*)\s*(?:,[^}]*)?\}\}/g;
const SUFFIXES = ["zero", "one", "two", "few", "many", "other"];

function neededVars(key: string): { found: boolean; vars: Set<string> } {
  const vars = new Set<string>();
  let found = false;
  const forms = [key, ...SUFFIXES.map((s) => `${key}_${s}`)];
  for (const [k, v] of VALUES) {
    if (forms.includes(k) || (k.startsWith(`${key}_`) && !forms.includes(k))) {
      found = true;
      for (const m of v.matchAll(VAR_RE)) vars.add(m[1]);
    }
  }
  return { found, vars };
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sourceFiles(full);
    if (!/\.tsx?$/.test(name) || /\.test\.|\.d\.ts$/.test(name)) return [];
    return [full];
  });
}

const FILES = [...sourceFiles(join(ROOT, "src")), join(ROOT, "App.tsx")];

function isTCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const e = node.expression;
  return (ts.isIdentifier(e) && e.text === "t") || (ts.isPropertyAccessExpression(e) && e.name.text === "t");
}

describe("i18n interpolation calls", () => {
  it("every literal t() call passes the variables its message needs", () => {
    const missing: string[] = [];
    const dynamic: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("t(")) continue;
      const sf = ts.createSourceFile(
        file,
        src,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const rel = relative(ROOT, file);
      const visit = (node: ts.Node): void => {
        if (isTCall(node) && node.arguments.length >= 1 && ts.isStringLiteral(node.arguments[0])) {
          const key = node.arguments[0].text;
          const { found, vars } = neededVars(key);
          if (found) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            const at = `${rel}:${line} t('${key}')`;
            let options: ts.ObjectLiteralExpression | undefined;
            let nonLiteral = false;
            if (node.arguments.length >= 2) {
              const a1 = node.arguments[1];
              if (ts.isObjectLiteralExpression(a1)) options = a1;
              else if (ts.isStringLiteral(a1)) {
                // Forma con texto por defecto: las opciones van en tercer lugar.
                const a2 = node.arguments[2];
                if (a2) {
                  if (ts.isObjectLiteralExpression(a2)) options = a2;
                  else nonLiteral = true;
                }
              } else nonLiteral = true;
            }
            if (nonLiteral) {
              dynamic.push(at);
            } else if (!options) {
              if (vars.size > 0) missing.push(`${at} sin opciones; el mensaje pide ${[...vars].sort().join(", ")}`);
            } else if (options.properties.some((p) => ts.isSpreadAssignment(p) || (p.name && ts.isComputedPropertyName(p.name)))) {
              dynamic.push(at);
            } else {
              const passed = new Set<string>();
              for (const p of options.properties) {
                if (
                  (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
                  p.name &&
                  "text" in p.name
                ) {
                  passed.add(p.name.text);
                }
              }
              const faltan = [...vars].filter((v) => !passed.has(v));
              if (faltan.length > 0) {
                missing.push(`${at} no pasa ${faltan.sort().join(", ")} (pasa: ${[...passed].sort().join(", ")})`);
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(missing).toEqual([]);
    // Sellado en T-23: cero llamadas con opciones no literales. Si una
    // aparece, se revisa a ojo y se sella aquí con su sitio.
    expect(dynamic).toEqual([]);
  }, 60_000);
});
