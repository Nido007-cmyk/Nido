/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * rekeyStartupWiring.test.ts — auditoría completa 2026-10-31 (F3-01).
 *
 * INVARIANTE: la recuperación de una rotación de claves interrumpida
 * (checkStaleRekeyStaging, cuyo propio contrato dice «debe llamarse al
 * arranque») corre en TODAS las vías de arranque, no solo tras un
 * borrado total interrumpido. Antes del arreglo solo la llamaba
 * runWipeRecovery: un corte a mitad de rotateAllDatabaseKeys dejaba
 * las bases recifradas con la DEK nueva, el Keystore con la vieja y el
 * staging sin procesar, sin ruta de recuperación al arrancar normal.
 *
 * App.tsx no se renderiza en esta batería (vitest, sin renderer RN:
 * misma restricción que keyLossRecovery.test.ts), así que la prueba
 * fija el contrato de cableado sobre el código fuente: el ayudante
 * existe y llama a checkStaleRekeyStaging, y las dos vías de arranque
 * lo invocan antes de finishStartup.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const appSrc = fs.readFileSync(path.join(repoRoot, "App.tsx"), "utf-8");

/** Cuerpo de una función flecha de componente: de su `const` al siguiente `const` hermano. */
function bodyOf(name: string): string {
  const start = appSrc.indexOf(`const ${name} = async () => {`);
  expect(start, `App.tsx debe definir ${name}`).toBeGreaterThanOrEqual(0);
  const rest = appSrc.slice(start);
  const next = rest.indexOf("\n  const ", 10);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("F3-01: recuperación de rekey interrumpido en el arranque", () => {
  it("el ayudante de recuperación llama a checkStaleRekeyStaging", () => {
    const body = bodyOf("recoverStaleRekeyIfAny");
    expect(body).toContain("checkStaleRekeyStaging(");
    expect(body).toContain("rekey-staging.json");
  });

  it("la vía normal (runStartupGate) recupera el rekey antes de finishStartup", () => {
    const body = bodyOf("runStartupGate");
    const call = body.indexOf("await recoverStaleRekeyIfAny();");
    const finish = body.indexOf("await finishStartup();");
    expect(call, "runStartupGate debe llamar a recoverStaleRekeyIfAny").toBeGreaterThanOrEqual(0);
    expect(finish).toBeGreaterThan(call);
  });

  it("la vía de borrado interrumpido (runWipeRecovery) sigue recuperando el rekey", () => {
    const body = bodyOf("runWipeRecovery");
    expect(body).toContain("await recoverStaleRekeyIfAny();");
    expect(body).toContain("await recoverInterruptedWipe();");
  });

  it("checkStaleRekeyStaging se invoca una sola vez en App.tsx (dentro del ayudante)", () => {
    const calls = appSrc.split("checkStaleRekeyStaging(").length - 1;
    // Una en la llamada del ayudante; la importación dinámica no cuenta
    // porque trae el nombre sin paréntesis de llamada inmediata tras él
    // en la misma expresión... se cuenta la ocurrencia de la llamada.
    expect(calls).toBe(1);
  });
});
