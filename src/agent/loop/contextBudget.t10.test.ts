/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * contextBudget.t10.test.ts — TANDA T-10 (0.1.99), m-30 (residuo).
 *
 * La corrección de 2026-11-11 dejó tres clases declaradas por debajo
 * del real en la propia fixture: código fuente, texto entero en
 * mayúsculas y ristras de signos. Cubrirlas a lo bruto inflaba ~10 %
 * el presupuesto de todos los turnos; la corrección es condicional
 * por clase: el recargo solo existe cuando la densidad de la clase
 * domina el texto, así que la prosa normal paga ~0.
 *
 * Medición (2026-11-14, tokenizador real Qwen2.5 BPE, método del doc
 * de 2026-11-11; la fixture guarda el máximo de Qwen2.5 y Qwen3):
 * - adv-codigo: densidad de signos ≈ 0,34; déficit ≈ 0,23–0,31 por
 *   signo → recargo de 1/3 por signo con puerta de densidad > 0,30.
 * - adv-puntuacion: densidad ≈ 0,87; déficit ≈ 0,19–0,23 por signo →
 *   el mismo recargo la cubre.
 * - adv-mayus: déficit ≈ 0,04–0,07 por mayúscula en texto con
 *   mayúsculas sostenidas → recargo de 1/12 por mayúscula con puerta
 *   de mayoría de mayúsculas entre las letras (> 0,5).
 */
import { describe, it, expect } from "vitest";
import { estimateTokens } from "./contextBudget";
import fixture from "./__fixtures__/tokenCounts.json";

type Row = { kind: string; text: string; realTokens: number };
const rows = fixture.rows as Row[];
const FORMER_LIMITS = ["adv-codigo", "adv-mayus", "adv-puntuacion"];

describe("m-30: las tres clases declaradas quedan cubiertas", () => {
  it.each(
    rows
      .filter((r) => FORMER_LIMITS.includes(r.kind))
      .map((r, i) => [i, r.kind, r] as const)
  )("fila %i (%s): estimado ≥ real", (_i, _k, r) => {
    expect(estimateTokens(r.text)).toBeGreaterThanOrEqual(r.realTokens);
  });

  it("ninguna fila de la fixture queda por debajo del real", () => {
    const under = rows.filter((r) => estimateTokens(r.text) < r.realTokens);
    expect(under).toEqual([]);
  });
});

describe("m-30: la prosa normal no paga la corrección", () => {
  // Réplica de la fórmula anterior a m-30 (la de 2026-11-11): en prosa
  // de las guías la estimación nueva debe ser idéntica, porque ninguna
  // puerta de clase se abre.
  const previous = (t: string) => {
    let digits = 0;
    let numbers = 0;
    let nonLatin = 0;
    let inNumber = false;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      const isDigit = c >= 0x30 && c <= 0x39;
      if (isDigit) {
        digits++;
        if (!inNumber) numbers++;
      } else if (c > 0x24f) {
        nonLatin++;
      }
      inNumber = isDigit;
    }
    return Math.ceil(t.length / 3 + (digits * 2) / 3 + numbers + (nonLatin * 2) / 3) + 50;
  };

  it.each(["es", "en", "pt"].map((l) => [l] as const))(
    "pack-%s: estimación idéntica a la anterior",
    (lang) => {
      for (const r of rows.filter((x) => x.kind === `pack-${lang}`)) {
        expect(estimateTokens(r.text)).toBe(previous(r.text));
      }
    }
  );

  it("la tabla del documento (doc-tabla) tampoco cambia: su densidad no abre la puerta", () => {
    const table = rows.find((r) => r.kind === "doc-tabla")!;
    expect(estimateTokens(table.text)).toBe(previous(table.text));
  });
});
