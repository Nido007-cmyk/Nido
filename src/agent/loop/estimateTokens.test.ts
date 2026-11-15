/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * estimateTokens.test.ts — la estimación de tokens es una cota superior
 * (2026-11-11).
 *
 * Defecto probado: `ceil(longitud / 3) + 50` se quedaba corta con cifras,
 * tablas, mayúsculas, emoji, código y hashes. La fixture guarda textos con
 * su número real de tokens, medido con los dos tokenizadores del catálogo
 * (Qwen2.5-0.5B y Qwen3-0.6B, el máximo de los dos). No hay tokenizador
 * en la app ni en CI: la fixture es la evidencia congelada.
 */
import { describe, it, expect } from "vitest";
import { estimateTokens, defaultTokenCounter } from "./contextBudget";
import { estimatePromptTokens } from "./agentLoop";
import { assembleChatMessages } from "../../rag/pure";
import fixture from "./__fixtures__/tokenCounts.json";

type Row = { kind: string; text: string; realTokens: number };
const rows = fixture.rows as Row[];
const oldEstimate = (t: string) => Math.ceil(t.length / 3) + 50;

describe("estimateTokens — nunca por debajo del real", () => {
  it("la fixture cubre packs en los tres idiomas, prompts y textos difíciles", () => {
    const kinds = new Set(rows.map((r) => r.kind));
    for (const k of ["pack-es", "pack-en", "pack-pt", "doc-tabla", "adv-cifras", "adv-tabla", "adv-emoji", "adv-cjk", "adv-hex", "adv-url"]) {
      expect(kinds.has(k), k).toBe(true);
    }
    expect(rows.length).toBeGreaterThan(100);
  });

  // Límite declarado hasta la 0.1.98: código fuente, texto entero en
  // mayúsculas y ristras de signos sueltos quedaban por debajo del
  // real. m-30 (T-10, 0.1.99) los cubre con recargos condicionales por
  // clase, sin inflar la prosa (ver contextBudget.ts y
  // contextBudget.t10.test.ts): el conjunto queda vacío y la prueba
  // de abajo vigila que ninguna fila vuelva a caer por debajo.
  const KNOWN_LIMITS = new Set<string>([]);
  const covered = rows.filter((r) => !KNOWN_LIMITS.has(r.kind));

  it.each(covered.map((r, i) => [i, r.kind, r] as const))("fila %i (%s): estimado ≥ real", (_i, _k, r) => {
    expect(estimateTokens(r.text)).toBeGreaterThanOrEqual(r.realTokens);
  });

  it("sin límites declarados: ninguna clase conocida queda por debajo (m-30)", () => {
    const stillUnder = rows.filter((r) => KNOWN_LIMITS.has(r.kind) && estimateTokens(r.text) < r.realTokens);
    expect(stillUnder.length).toBe(0);
  });

  it("la estimación anterior fallaba en la misma fixture (el defecto existía)", () => {
    const under = rows.filter((r) => oldEstimate(r.text) < r.realTokens);
    expect(under.length).toBeGreaterThan(0);
    expect(under.map((r) => r.kind)).toContain("doc-tabla");
  });

  it("en prosa de las guías no infla el presupuesto más de un 10 % sobre la anterior", () => {
    for (const lang of ["es", "en", "pt"]) {
      const prose = rows.filter((r) => r.kind === `pack-${lang}`);
      const now = prose.reduce((a, r) => a + estimateTokens(r.text), 0);
      const before = prose.reduce((a, r) => a + oldEstimate(r.text), 0);
      expect(now / before, lang).toBeLessThan(1.1);
    }
  });
});

describe("las dos funciones gemelas cuentan igual", () => {
  it.each(rows.slice(0, 40).map((r) => [r.kind, r.text] as const))("%s", (_k, t) => {
    expect(defaultTokenCounter(t)).toBe(estimateTokens(t));
    expect(estimatePromptTokens(t)).toBe(estimateTokens(t));
  });

  it("vacío = solo la plantilla", () => {
    expect(estimateTokens("")).toBe(50);
  });
});

describe("el caso del documento con tabla deja sitio de verdad para responder", () => {
  const table = rows.find((r) => r.kind === "doc-tabla")!;
  const chunks = [0, 1, 2, 3].map((k) => ({
    chunkId: `c${k}`,
    docId: "d",
    title: "estado-de-cuenta.csv",
    body: table.text,
    score: 1 - k * 0.1,
    matchType: "hybrid" as const,
    sourceKind: "user" as never,
    collectionId: "u",
  }));

  it("antes: un fragmento entraba estimado en ~717 tokens; ocupaba 1.649", () => {
    expect(oldEstimate(table.text)).toBeLessThan(table.realTokens);
    expect(estimateTokens(table.text)).toBeGreaterThanOrEqual(table.realTokens);
  });

  it("con n_ctx 2048 y 512 reservados, lo que entra cabe con su reserva según la cota", () => {
    let fitted: unknown[] = [];
    const msgs = assembleChatMessages(
      "¿cuál fue el saldo de marzo?",
      chunks as never,
      "You are Nido.",
      undefined,
      undefined,
      false,
      { nCtx: 2048, reserveGeneration: 512 },
      (f) => {
        fitted = f;
      }
    );
    // Cota superior del prompt real: cada fragmento que entró cuenta como
    // mínimo sus tokens reales medidos.
    const promptUpper = msgs.reduce((a, m) => a + estimateTokens(m.content), 0);
    expect(promptUpper + 512).toBeLessThanOrEqual(2048);
    expect(fitted.length).toBeLessThanOrEqual(1);
  });
});
