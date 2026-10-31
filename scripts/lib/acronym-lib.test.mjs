/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { extractAcronymPairs, mineGuides } from "./acronym-lib.mjs";

describe("extractAcronymPairs (minería de acrónimos)", () => {
  it("patrón 1: definición delante, acrónimo entre paréntesis", () => {
    expect(extractAcronymPairs("Empieza la reanimación cardiopulmonar (RCP) cuanto antes.")).toEqual([
      { acronym: "RCP", definition: "reanimación cardiopulmonar" },
    ]);
    expect(extractAcronymPairs("que busque un desfibrilador (DEA) cercano")).toEqual([
      { acronym: "DEA", definition: "desfibrilador" },
    ]);
  });

  it("patrón 2: acrónimo delante y definición entre paréntesis", () => {
    expect(extractAcronymPairs("El DEA (desfibrilador externo automático) más cercano está en la plaza.")).toEqual([
      { acronym: "DEA", definition: "desfibrilador externo automático" },
    ]);
  });

  it("las organizaciones de las fuentes también son pares", () => {
    expect(
      extractAcronymPairs("sources: Federación Internacional de la Cruz Roja (IFRC), Directrices 2020")
    ).toEqual([{ acronym: "IFRC", definition: "Federación Internacional de la Cruz Roja" }]);
  });

  it("ruido fuera: años, referencias y comentarios de variantes no minan", () => {
    expect(extractAcronymPairs("Directrices internacionales de primeros auxilios 2020 (edición 2020)")).toEqual([]);
    expect(extractAcronymPairs("Sigue la RCP (ver guía de RCP) hasta que llegue ayuda.")).toEqual([]);
    expect(extractAcronymPairs("<!-- preguntas: qué es la RCP (reanimación) -->")).toEqual([]);
    expect(extractAcronymPairs("Capítulo II (II) del manual")).toEqual([]);
  });

  it("sin duplicados aunque el par se repita", () => {
    const text = "La reanimación cardiopulmonar (RCP) salva vidas. La reanimación cardiopulmonar (RCP) es esto.";
    expect(extractAcronymPairs(text)).toHaveLength(1);
  });
});

describe("mineGuides", () => {
  it("agrega por pareja, cuenta guías y marca lo ya registrado como variante", () => {
    const guides = [
      { name: "a.md", text: "La reanimación cardiopulmonar (RCP) primero.\n<!-- preguntas: cómo se hace la reanimación cardiopulmonar -->" },
      { name: "b.md", text: "La reanimación cardiopulmonar (RCP) otra vez. Busca un desfibrilador (DEA)." },
    ];
    const rows = mineGuides(guides);
    const rcp = rows.find((r) => r.acronym === "RCP");
    expect(rcp?.guides).toBe(2);
    expect(rcp?.inVariants).toBe(true);
    const dea = rows.find((r) => r.acronym === "DEA");
    expect(dea?.guides).toBe(1);
    expect(dea?.inVariants).toBe(false);
  });
});
