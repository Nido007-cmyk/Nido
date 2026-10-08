/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
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

const config: ContextBudgetConfig = { nCtx: 4096, reserveGeneration: 512, maxSystemTokens: 2048 };

describe("applyContextBudget — basic", () => {
  it("keeps everything when it fits", () => {
    const history = [msg("user", "hola"), msg("assistant", "¡Hola!"), msg("user", "qué hora es")];
    const r = applyContextBudget(SYS("sys"), history, msg("user", "y ahora?"), config);
    expect(r.history).toHaveLength(3);
    expect(r.droppedTurns).toBe(0);
    expect(r.estimatedTotalTokens).toBeLessThanOrEqual(4096);
  });

  it("drops oldest turns first when over budget", () => {
    const big = "x".repeat(3000); // ~1050 tokens each
    const history = [msg("user", big), msg("assistant", big), msg("user", big), msg("assistant", big)];
    const r = applyContextBudget(SYS("sys"), history, msg("user", "q"), config);
    expect(r.droppedTurns).toBeGreaterThan(0);
    expect(r.estimatedTotalTokens).toBeLessThanOrEqual(4096);
    // The newest turn (last assistant message) survives the cut.
    expect(r.history[r.history.length - 1]).toEqual(msg("assistant", big));
  });

  it("never leaves an orphaned assistant turn", () => {
    // Budget fits exactly 1.5 turns: newest assistant + newest user won't both fit.
    const turn = "y".repeat(2400); // ~850 tokens each
    const history = [msg("user", turn), msg("assistant", turn), msg("user", turn)];
    const tight: ContextBudgetConfig = { nCtx: 2000, reserveGeneration: 100, maxSystemTokens: 1000 };
    const r = applyContextBudget(SYS("s"), history, msg("user", "q"), tight);
    if (r.history.length > 0) {
      const oldest = r.history[0];
      // Oldest kept must be a user message (or the only message is user/current).
      expect(oldest.role).not.toBe("assistant");
    }
    expect(r.estimatedTotalTokens).toBeLessThanOrEqual(2000);
  });

  it("system is pinned: throws when it exceeds maxSystemTokens", () => {
    const huge = "z".repeat(7000); // ~2383 tokens > 2048 cap
    expect(() => applyContextBudget(SYS(huge), [], msg("user", "q"), config)).toThrow(/excede el presupuesto/);
  });

  it("fail-closed when system + current + reserve don't fit", () => {
    const tiny: ContextBudgetConfig = { nCtx: 100, reserveGeneration: 60, maxSystemTokens: 90 };
    expect(() => applyContextBudget(SYS("s"), [], msg("user", "q"), tiny)).toThrow(/sin siquiera historial/);
  });

  it("empty history works", () => {
    const r = applyContextBudget(SYS("sys"), [], msg("user", "hola"), config);
    expect(r.history).toHaveLength(0);
    expect(r.droppedTurns).toBe(0);
    expect(r.estimatedTotalTokens).toBeLessThanOrEqual(4096);
  });
});

describe("budgetConfigFor", () => {
  it("sets maxSystemTokens to half of nCtx", () => {
    expect(budgetConfigFor(4096, 512)).toEqual({ nCtx: 4096, reserveGeneration: 512, maxSystemTokens: 2048 });
  });
});

describe("defaultTokenCounter", () => {
  it("is conservative (overestimates vs chars/4)", () => {
    const text = "a".repeat(1200);
    expect(defaultTokenCounter(text)).toBeGreaterThanOrEqual(1200 / 4);
  });
});
