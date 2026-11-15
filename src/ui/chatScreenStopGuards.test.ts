/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-17 (0.1.99) · m-94: las guardas de parada de la rama de agente
 * de send() (ChatScreen.tsx).
 *
 * La rama directa captura `wasStopped` al salir de la generación y
 * lo aplica en su cierre: aviso de Warning en vez de éxito, outcome
 * «cancelled» en las dos telemetrías, título automático solo si no
 * se detuvo, y lectura en voz alta solo si no se detuvo. La rama de
 * agente cerraba el turno SIN mirar la parada en los mismos cuatro
 * efectos: si la persona detenía un turno de agente con texto
 * parcial, la app podía leer en voz alta lo que acababa de detener
 * y contar el turno como éxito.
 *
 * send() no tiene arnés de render real en esta casa (el refactor
 * que lo permitiría es m-96, fuera de la 0.1.99 por decisión del
 * dueño), así que la sonda es estructural con dientes, en el patrón
 * de nidoScreenGuard.test.ts: localiza el bloque de cierre REAL de
 * cada rama en el texto fuente y exige la guarda en cada efecto.
 * La rama directa va como control: sus aserciones pasan hoy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("./ChatScreen.tsx", import.meta.url), "utf8");

/** Bloque de cierre de la rama de agente: del resultado del loop al retorno. */
function agentCloseBlock(): string {
  const start = SRC.indexOf("assistantText = agentResult.response;");
  const end = SRC.indexOf("if (!divertedToChatNet) return;", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

/** Bloque de cierre de la rama directa (control). */
function directCloseBlock(): string {
  const start = SRC.indexOf("const wasStopped = stopRequestedRef.current;");
  const end = SRC.indexOf("speakAloud", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end + 200);
}

describe("m-94 · la rama de agente captura la parada al salir del loop", () => {
  it("hay una captura de stopRequestedRef tras el resultado del agente", () => {
    // La variable vive en el ámbito de la rama (como divertedToChatNet:
    // declarada antes del try, fijada al salir del loop), porque la
    // lectura en voz alta se decide DESPUÉS del finally del try.
    const head = SRC.slice(SRC.indexOf("let divertedToChatNet = false;"), SRC.indexOf("assistantText = agentResult.response;"));
    expect(head).toMatch(/let \w*(s|S)topped\w* = false;/);
    const block = agentCloseBlock();
    expect(block).toMatch(/\w*(s|S)topped\w* = stopRequestedRef\.current;/);
  });
});

describe("m-94 · los cuatro efectos del cierre de agente llevan la guarda", () => {
  it("la notificación es Warning si se detuvo, no Success fijo", () => {
    const block = agentCloseBlock();
    expect(block).not.toContain("notification(NotificationFeedbackType.Success);");
    expect(block).toMatch(/notification\(\w*(s|S)topped\w* \? NotificationFeedbackType\.Warning : NotificationFeedbackType\.Success\)/);
  });

  it("recordQueryStats cuenta «cancelled» si se detuvo", () => {
    const block = agentCloseBlock();
    const at = block.indexOf("recordQueryStats({");
    expect(at).toBeGreaterThan(-1);
    const call = block.slice(at, block.indexOf("});", at));
    expect(call).toMatch(/outcome: \w*(s|S)topped\w* \? "cancelled" : "success"/);
  });

  it("recordExecution cuenta «cancelled» si se detuvo", () => {
    const block = agentCloseBlock();
    const at = block.indexOf("recordExecution({");
    expect(at).toBeGreaterThan(-1);
    const call = block.slice(at, block.indexOf("}).catch", at));
    expect(call).toMatch(/outcome: \w*(s|S)topped\w* \? "cancelled" : "success"/);
  });

  it("el título automático solo se genera si no se detuvo", () => {
    const block = agentCloseBlock();
    expect(block).toMatch(/isNewSession && agentSettings\.autoGenerateTitles && !\w*(s|S)topped\w*/);
  });

  it("la lectura en voz alta no lee lo que la persona acaba de detener", () => {
    const block = agentCloseBlock();
    expect(block).toMatch(/assistantText\.trim\(\)\.length > 0 && !\w*(s|S)topped\w*/);
  });

  it("el desvío a la red (divertedToChatNet) sigue sin duplicar el cierre", () => {
    const block = agentCloseBlock();
    // Los efectos viven dentro del «si no hubo desvío»: el pipeline
    // de chat cierra los turnos desviados con sus propias guardas.
    const guardAt = block.indexOf("if (!divertedToChatNet) {");
    const notifAt = block.indexOf("notification(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(notifAt).toBeGreaterThan(guardAt);
  });
});

describe("m-94 · control: la rama directa conserva sus guardas", () => {
  it("notificación, outcome, título y lectura de la directa siguen guardados", () => {
    const block = directCloseBlock();
    expect(block).toContain("notification(wasStopped ? NotificationFeedbackType.Warning : NotificationFeedbackType.Success)");
    expect(block).toMatch(/wasStopped \? "cancelled" : "success"/);
    expect(block).toContain("settings.autoGenerateTitles && !wasStopped");
    expect(block).toMatch(/assistantText\.trim\(\)\.length > 0 && !wasStopped/);
  });
});
