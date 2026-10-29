/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Evaluación v2, parte determinista: los casos "ci-router" y "ci-safety" de
 * cases/v2.json contra el código real, sin modelo, en cada PR.
 *
 * Orden de rutas: matchSmallTalk primero (como ChatScreen) y después
 * routeOf() de routerSweep.pure.ts, que reproduce el orden real del chat y
 * del agente. No se escribe otro enrutador: si el orden cambia en la app,
 * routeOf cambia con ella.
 */
import { describe, expect, it } from "vitest";
import knownFailures from "./cases/known-failures.json";
import { EVAL_SET_V2, foldForEval, type EvalCaseV2 } from "./evalSetV2";
import { routeOf } from "./routerSweep.pure";
import { matchSafetyAnswer } from "../agent/loop/safetyAnswers";
import { matchSmallTalk } from "../agent/loop/smallTalk";
import { extractToolAction } from "../agent/loop/toolRouter";

const NOW = new Date(2026, 9, 29, 10, 0);
const KNOWN = (knownFailures as { failures: Record<string, string> }).failures;

/** Nombres de routeOf → nombres de los casos. */
function mapRoute(r: string): string {
  if (r === "create_reminder") return "reminder";
  if (r === "calc" || r === "timer") return r;
  if (r === "canned") return "smalltalk";
  if (r === "chat" || r === "model") return "none";
  return `tool:${r}`;
}

/** null si pasa; si no, por qué falla. */
export function checkDeterministic(c: EvalCaseV2): string | null {
  const e = c.expect;
  if (c.runner === "ci-safety") {
    const hit = matchSafetyAnswer(c.query, c.lang);
    const got = hit ? `safety:${hit.kind}` : "none";
    if (got !== e.route) return `ruta ${got}, se esperaba ${e.route}`;
    if (!hit) return null;
    if (e.country && hit.country !== e.country) return `país ${hit.country}`;
    if (e.countryUnknownAsked !== undefined && (hit.countryUnknown?.asked ?? null) !== e.countryUnknownAsked) {
      return `countryUnknown ${JSON.stringify(hit.countryUnknown)}`;
    }
    for (const s of e.mustContain ?? []) if (!foldForEval(hit.text).includes(foldForEval(s))) return `falta «${s}»`;
    for (const s of e.mustNotContain ?? []) if (foldForEval(hit.text).includes(foldForEval(s))) return `sobra «${s}»`;
    return null;
  }
  const got = matchSmallTalk(c.query, c.lang) ? "smalltalk" : mapRoute(routeOf(c.query, undefined, NOW));
  if (e.route === "none-tool") return got === "none" || got === "smalltalk" ? null : `ruta ${got}, no debía haber acción`;
  if (got !== e.route) return `ruta ${got}, se esperaba ${e.route}`;
  if (e.text !== undefined) {
    const a = extractToolAction(c.query, NOW);
    const text = a && "text" in a ? a.text : null;
    if (text !== e.text) return `texto «${text}», se esperaba «${e.text}»`;
  }
  return null;
}

const CI_CASES = EVAL_SET_V2.filter((c) => c.runner === "ci-router" || c.runner === "ci-safety");

describe("evaluación v2: casos deterministas", () => {
  it("hay casos que comprobar", () => {
    expect(CI_CASES.length).toBeGreaterThanOrEqual(47);
  });

  it.each(CI_CASES.map((c) => [c.id, c] as const))("%s", (id, c) => {
    const why = checkDeterministic(c);
    if (KNOWN[id]) {
      // Un fallo conocido que empieza a pasar se quita de la lista.
      expect(why, `${id} ya pasa: quítalo de known-failures.json`).not.toBeNull();
    } else {
      expect(why, `${id} «${c.query}»`).toBeNull();
    }
  });
});
