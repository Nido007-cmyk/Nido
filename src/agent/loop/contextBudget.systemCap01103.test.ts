/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * 0.1.103 (foto del dueño, Tab A9+, 2026-11-15): la guarda de
 * presupuesto mataba el turno cuando el mensaje de sistema superaba
 * maxSystemTokens (nCtx/2), aunque el turno cupiera de sobra en la
 * ventana: sistema 530 + pregunta + reserva degradada < 1024. El
 * sistema no se trunca jamás (esa era la intención del fail-closed
 * original); lo que cede es el historial, que para eso está la
 * guarda. El único lanzamiento que queda es el físico: sistema +
 * mensaje actual + reserva por encima de la ventana misma.
 */
import { describe, expect, it } from "vitest";
import {
  applyContextBudget,
  budgetConfigFor,
  defaultTokenCounter,
  type BudgetMessage,
  type ContextBudgetConfig,
} from "./contextBudget";

const msg = (role: string, content: string): BudgetMessage => ({ role, content });
const SYS = (content: string): BudgetMessage => ({ role: "system", content });

// "s"×1440 estima exactamente 530 (480 + 50 de plantilla): el sistema
// de la foto del dueño contra el tope de 512 de una ventana de 1024.
const SISTEMA_530 = "s".repeat(1440);

describe("applyContextBudget — el tope de sistema degrada, no mata (0.1.103)", () => {
  it("sistema de 530 a nCtx 1024: no lanza, el sistema va entero y el historial cede", () => {
    expect(defaultTokenCounter(SISTEMA_530)).toBe(530);
    const config: ContextBudgetConfig = { nCtx: 1024, reserveGeneration: 256, maxSystemTokens: 512 };
    const history = [msg("user", "hola"), msg("assistant", "¡Hola!"), msg("user", "otra cosa")];
    const r = applyContextBudget(SYS(SISTEMA_530), history, msg("user", "y ahora?"), config);
    expect(r.system.content).toBe(SISTEMA_530);
    expect(r.estimatedTotalTokens).toBeLessThanOrEqual(1024);
  });

  it("sistema por encima del tope con historial grande: el historial se recorta hasta caber", () => {
    const config: ContextBudgetConfig = { nCtx: 1024, reserveGeneration: 256, maxSystemTokens: 512 };
    const big = "x".repeat(900); // ~350 tokens por turno
    const history = [msg("user", big), msg("assistant", big), msg("user", big), msg("assistant", big)];
    const r = applyContextBudget(SYS(SISTEMA_530), history, msg("user", "q"), config);
    expect(r.droppedTurns).toBeGreaterThan(0);
    expect(r.estimatedTotalTokens).toBeLessThanOrEqual(1024);
    if (r.history.length > 0) expect(r.history[0].role).not.toBe("assistant");
  });

  it("la muerte que queda es la física: sistema + actual + reserva por encima de la ventana", () => {
    const config: ContextBudgetConfig = { nCtx: 1024, reserveGeneration: 64, maxSystemTokens: 512 };
    const actual = "q".repeat(1350); // ~500 tokens estimados
    expect(() => applyContextBudget(SYS(SISTEMA_530), [], msg("user", actual), config)).toThrow(
      /sin siquiera historial/
    );
  });

  it("budgetConfigFor sigue calculando el tope como la mitad de la ventana", () => {
    expect(budgetConfigFor(1024, 512).maxSystemTokens).toBe(512);
  });
});
