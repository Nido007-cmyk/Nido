/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  evidenceNumberValues,
  numberTokens,
  parseNumberToken,
  roundsFromEvidence,
  sentenceNumbersSupported,
} from "./evidenceNumbers";

describe("numberTokens", () => {
  it("extrae las cifras y deja fuera las citas [n]", () => {
    expect(numberTokens("Fundada en 1804 [1], con 26,5 mg y 16.431.599 personas.")).toEqual([
      "1804",
      "26,5",
      "16.431.599",
    ]);
  });

  it("sin cifras, nada", () => {
    expect(numberTokens("Sin números aquí.")).toEqual([]);
  });
});

describe("parseNumberToken", () => {
  it("enteros y decimales de las tres lenguas", () => {
    expect(parseNumberToken("1804")).toEqual([1804]);
    expect(parseNumberToken("26,5")).toEqual([26.5]);
    expect(parseNumberToken("26.5")).toEqual([26.5]);
    expect(parseNumberToken("3,1416")).toEqual([3.1416]);
  });

  it("miles con separador repetido o con decimal al final", () => {
    expect(parseNumberToken("16.431.599")).toEqual([16431599]);
    expect(parseNumberToken("16,431,599")).toEqual([16431599]);
    expect(parseNumberToken("1,234,567.89")).toEqual([1234567.89]);
    expect(parseNumberToken("1.234.567,89")).toEqual([1234567.89]);
  });

  it("el token ambiguo aporta sus dos lecturas", () => {
    expect(parseNumberToken("1.234")).toEqual([1.234, 1234]);
    expect(parseNumberToken("1,234")).toEqual([1.234, 1234]);
  });
});

describe("roundsFromEvidence", () => {
  const ev = new Set([26.52, 1804, 16431599, 12345]);

  it("el valor exacto y sus redondeos a la precisión afirmada", () => {
    expect(roundsFromEvidence(1804, 0, ev)).toBe(true);
    expect(roundsFromEvidence(27, 0, ev)).toBe(true); // 26,52 → 27
    expect(roundsFromEvidence(26.5, 1, ev)).toBe(true); // 26,52 → 26,5
    expect(roundsFromEvidence(26.4, 1, ev)).toBe(false);
    expect(roundsFromEvidence(1904, 0, ev)).toBe(false);
  });

  it("la escala (millones) solo vale con decimales", () => {
    expect(roundsFromEvidence(16.4, 1, ev)).toBe(true); // 16,4 millones de 16.431.599
    expect(roundsFromEvidence(12, 0, ev)).toBe(false); // «12» no es redondeo de 12.345
    expect(roundsFromEvidence(12.3, 1, ev)).toBe(true); // 12,3 miles de 12.345
  });
});

describe("sentenceNumbersSupported", () => {
  const ev = evidenceNumberValues(["La ciudad se fundó en 1804. Tenía 16,431,599 habitantes y la dosis era 26.52 mg."]);

  it("las cifras de la evidencia y sus redondeos pasan", () => {
    expect(sentenceNumbersSupported("Se fundó en 1804.", ev)).toBe(true);
    expect(sentenceNumbersSupported("Vivían 16,4 millones de personas.", ev)).toBe(true);
    expect(sentenceNumbersSupported("La dosis es 26,5 mg.", ev)).toBe(true);
    expect(sentenceNumbersSupported("La dosis es 27 mg.", ev)).toBe(true);
  });

  it("una cifra inventada no pasa aunque el resto sí", () => {
    expect(sentenceNumbersSupported("Se fundó en 1904.", ev)).toBe(false);
    expect(sentenceNumbersSupported("La dosis es 30 mg.", ev)).toBe(false);
  });

  it("los enteros de un dígito no se juzgan y las citas no son cifras", () => {
    expect(sentenceNumbersSupported("Llega en el capítulo 3.", new Set())).toBe(true);
    expect(sentenceNumbersSupported("Se fundó en 1804 [2].", ev)).toBe(true);
    expect(sentenceNumbersSupported("Sin cifras en esta frase.", new Set())).toBe(true);
  });
});
