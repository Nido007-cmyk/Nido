/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  evidenceNumberValues,
  evidenceRanges,
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

describe("C-08: los rangos de la evidencia sostienen su interior", () => {
  const guia19 = "Sumerge la zona en agua tibia (entre 37 y 40 °C) durante 20 a 30 minutos. La lejía va al 5–6 %.";

  it("evidenceRanges extrae «entre N y M», «N a M» y «N–M»", () => {
    const ranges = evidenceRanges([guia19]);
    expect(ranges).toHaveLength(3);
    expect(ranges).toEqual(
      expect.arrayContaining([
        { min: 37, max: 40 },
        { min: 20, max: 30 },
        { min: 5, max: 6 },
      ])
    );
    expect(evidenceRanges(["Sin rangos en esta frase, solo 42 sueltos."])).toEqual([]);
  });

  it("un valor dentro de cualquier rango de la evidencia está sostenido; fuera, no", () => {
    const ev = evidenceNumberValues([guia19]);
    const ranges = evidenceRanges([guia19]);
    // Sin rangos, la red sigue ciega: 39 no es ni 37 ni 40 (el falso
    // positivo histórico). Con los rangos pasados, el interior vale.
    expect(sentenceNumbersSupported("Sumerge la zona en agua a 39 °C.", ev)).toBe(false);
    expect(sentenceNumbersSupported("Sumerge la zona en agua a 39 °C durante 25 minutos.", ev, ranges)).toBe(true);
    expect(sentenceNumbersSupported("Sumerge la zona en agua a 40 °C.", ev, ranges)).toBe(true);
    expect(sentenceNumbersSupported("Sumerge la zona en agua a 45 °C durante 25 minutos.", ev, ranges)).toBe(false);
  });
});

// ---------------------------------------------------------------
// T-J3 (barrido «revisa todo», J3): los números en letra tras los
// portillos de la caja (frecuencia diaria y unidad de dosis) son
// cifras para el juez — antes sellaba «cinco veces al día» contra
// «dos veces al día» mientras la caja marcaba el conflicto. Letra y
// dígito se juzgan en el mismo conjunto de valores, en las dos
// direcciones. Fuera de los portillos la letra no se juzga.

describe("T-J3: los números en letra con portillo se juzgan como cifras", () => {
  it("la frecuencia en letra falsa no pasa; la fiel sí, en letra y en dígito", () => {
    const ev = evidenceNumberValues(["Tome el jarabe dos veces al día, después de comer."]);
    expect(sentenceNumbersSupported("Tome el jarabe cinco veces al día, después de comer.", ev)).toBe(false);
    expect(sentenceNumbersSupported("Tome el jarabe dos veces al día, después de comer.", ev)).toBe(true);
    expect(sentenceNumbersSupported("Tome el jarabe 12 veces al día, después de comer.", ev)).toBe(false);
  });

  it("la dosis en letra falsa no pasa (es/en/pt de la tabla)", () => {
    expect(sentenceNumbersSupported("Tome cinco comprimidos al día.", evidenceNumberValues(["Tome dos comprimidos al día."]))).toBe(false);
    expect(sentenceNumbersSupported("Take five tablets a day.", evidenceNumberValues(["Take two tablets a day."]))).toBe(false);
    expect(sentenceNumbersSupported("Tome cinco comprimidos por dia.", evidenceNumberValues(["Tome dois comprimidos por dia."]))).toBe(false);
  });

  it("letra y dígito se sostienen el uno al otro (la misma cifra, otra ropa)", () => {
    const evLetra = evidenceNumberValues(["Tome doce comprimidos al día."]);
    expect(sentenceNumbersSupported("Tome 12 comprimidos al día.", evLetra)).toBe(true);
    expect(sentenceNumbersSupported("Tome doce comprimidos al día.", evLetra)).toBe(true);
    const evDigito = evidenceNumberValues(["Tome 12 comprimidos al día."]);
    expect(sentenceNumbersSupported("Tome doce comprimidos al día.", evDigito)).toBe(true);
  });

  it("fuera de los portillos la letra sigue sin juzgarse", () => {
    expect(sentenceNumbersSupported("Había dos personas en la sala.", new Set())).toBe(true);
    expect(sentenceNumbersSupported("El grupo tiene cinco miembros.", new Set())).toBe(true);
  });

  it("«media» tras el portillo de dosis vale 0,5", () => {
    const ev = evidenceNumberValues(["Añade media cucharadita de sal."]);
    expect(sentenceNumbersSupported("Añade media cucharadita de sal.", ev)).toBe(true);
    expect(sentenceNumbersSupported("Añade media cucharadita de sal.", new Set())).toBe(false);
  });
});
