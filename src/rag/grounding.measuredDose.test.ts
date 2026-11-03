/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría de la 0.1.70 (2026-11-03): la dosis medida que la vara de
 * cifras no veía. Medido sobre la build publicada (be4ed9d): «Take 5
 * tablets» contra «Take 2 tablets», «Give 6 puffs» contra «2 puffs» y
 * «5 ml» contra «10 ml» salían FUNDADAS con su cita, y con la guía real
 * del dolor de pecho «8 aspirinas infantiles» contra «2 a 4» también.
 * Fixtures en las dos direcciones: la dosis infiel se retira y la fiel
 * (incluidas las de las guías de NIDO Esencial) sigue fundada.
 */
import { describe, expect, it } from "vitest";
import { doseMeasuresOf, verifyGroundedAnswer, type GroundingChunk } from "./grounding";

const chunk = (body: string, title = "Fuente"): GroundingChunk => ({ title, body });

const CHEST_ES = chunk(
  "Qué hacer\n1. Llama de inmediato al número de emergencias.\n2. Que la persona deje de hacer esfuerzo. Siéntala semirrecostada, en la posición más cómoda.\n3. Si es un adulto despierto, no es alérgico a la aspirina, no está sangrando y su médico no se lo ha prohibido: que mastique una aspirina para adultos (entre 162 y 325 mg, o 2 a 4 aspirinas infantiles de 81 mg) y la trague.\n4. Si tiene medicación recetada para la angina (nitroglicerina), ayúdala a tomarla.",
  "Dolor de pecho e infarto — Qué hacer",
);
const CHEST_EN = chunk(
  "What to do\n1. Call the emergency number immediately.\n3. If it is an adult who is awake, not allergic to aspirin, not bleeding, and whose doctor has not told them to avoid it: have them chew one adult aspirin (162 to 325 mg, or 2 to 4 low-dose 81 mg aspirins) and swallow it.",
  "Chest pain and heart attack — What to do",
);
const HONEY_ES = chunk(
  "Si puede ser una pila de botón de litio y el niño tiene 1 año o más, se la tragó hace menos de 12 horas, puede tragar y hay miel a mano: en el camino a urgencias, dale 10 ml (2 cucharaditas) de miel cada 10 minutos, hasta 6 dosis.",
  "Intoxicaciones — Pilas de botón",
);

describe("la dosis medida se juzga aunque la frase no sea «la dosis es…»", () => {
  it("dígito único infiel: se retira (en, es, pt)", () => {
    expect(verifyGroundedAnswer("Take 5 tablets every eight hours.", [chunk("Take 2 tablets every eight hours.")], "en", "How many tablets?").status).toBe("abstained");
    expect(verifyGroundedAnswer("Toma 5 comprimidos cada ocho horas.", [chunk("Toma 2 comprimidos cada ocho horas.")], "es", "¿Cuántos comprimidos?").status).toBe("abstained");
    expect(verifyGroundedAnswer("Dê 6 jatos da bombinha de alívio.", [chunk("Dê 2 jatos da bombinha de alívio.")], "pt", "Quantos jatos?").status).toBe("abstained");
  });

  it("inhalador con frecuencia: 1 puff es fiel, 3 puffs no", () => {
    const src = [chunk("Help them sit upright, leaning slightly forward, and help them use their reliever inhaler. Give 1 puff every 30 to 60 seconds. Call the emergency number if it does not help.", "Asthma attack")];
    expect(verifyGroundedAnswer("Help them sit upright and use their reliever inhaler, 1 puff every 30 to 60 seconds.", src, "en", "What do I do?").status).toBe("grounded");
    expect(verifyGroundedAnswer("Help them sit upright and use their reliever inhaler, 3 puffs every 30 to 60 seconds.", src, "en", "What do I do?").status).toBe("abstained");
  });

  it("inhalador y mililitros: 6 puffs contra 2, 5 ml contra 10", () => {
    expect(verifyGroundedAnswer("Give 6 puffs of the reliever inhaler.", [chunk("Give 2 puffs of the reliever inhaler.")], "en", "How many puffs?").status).toBe("abstained");
    expect(verifyGroundedAnswer("Give 5 ml of the syrup.", [chunk("Give 10 ml of the syrup.")], "en", "How much syrup?").status).toBe("abstained");
  });

  it("la cifra de dos dígitos que la evidencia trae con OTRA unidad ya no salva la dosis", () => {
    // «20» está en la evidencia, pero como minutos: 20 ml no es la dosis.
    const r = verifyGroundedAnswer("Give 20 ml of the syrup.", [chunk("Give 10 ml of the syrup every 20 minutes.")], "en", "How much syrup?");
    expect(r.status).toBe("abstained");
  });

  it("la guía real del dolor de pecho: 8 aspirinas infantiles se retira; las fieles siguen fundadas", () => {
    const q = "Mi padre tiene dolor de pecho, ¿le doy aspirina?";
    expect(verifyGroundedAnswer("Que mastique 8 aspirinas infantiles de 81 mg y las trague.", [CHEST_ES], "es", q).status).toBe("abstained");
    expect(verifyGroundedAnswer("Si no hay de adultos, puede masticar 4 aspirinas infantiles de 81 mg.", [CHEST_ES], "es", q).status).toBe("grounded");
    expect(verifyGroundedAnswer("Si es un adulto despierto y no es alérgico, que mastique una aspirina para adultos y la trague.", [CHEST_ES], "es", q).status).toBe("grounded");
    expect(verifyGroundedAnswer("Have them chew 1 adult aspirin and swallow it.", [CHEST_EN], "en", "Should I give aspirin?").status).toBe("grounded");
  });

  it("fiel con dos unidades y frecuencia: la miel de la guía de pilas de botón", () => {
    const r = verifyGroundedAnswer("En el camino a urgencias, dale 10 ml (2 cucharaditas) de miel cada 10 minutos.", [HONEY_ES], "es", "¿Le doy miel?");
    expect(r.status).toBe("grounded");
    // Y la infiel en cucharaditas se retira aunque los ml cuadren.
    expect(verifyGroundedAnswer("En el camino a urgencias, dale 10 ml (4 cucharaditas) de miel cada 10 minutos.", [HONEY_ES], "es", "¿Le doy miel?").status).toBe("abstained");
  });

  it("sin dosis de esa unidad en la evidencia no juzga (no hay contra qué)", () => {
    const r = verifyGroundedAnswer(
      "Help them sit upright, leaning slightly forward, and help them use 2 puffs of their reliever inhaler.",
      [chunk("Help them sit upright, leaning slightly forward, and help them use their reliever inhaler.")],
      "en",
      "What do I do?",
    );
    expect(r.status).toBe("grounded");
  });

  it("la frase tipada («la dosis es…») sigue en su pierna, que sustituye por la fuente", () => {
    const r = verifyGroundedAnswer("The dose is 5 ml.", [chunk("The dose is 10 ml.")], "en", "What is the dose of the syrup?");
    expect(r.text).toContain("10 ml");
  });
});

describe("doseMeasuresOf: la unión cifra→unidad", () => {
  it("rangos, números en letra y el par intercalado", () => {
    expect(doseMeasuresOf("chew one adult aspirin (162 to 325 mg, or 2 to 4 low-dose 81 mg aspirins)")).toEqual([
      { unit: "aspirin", lo: 1, hi: 1 },
      { unit: "mg", lo: 162, hi: 325 },
      { unit: "aspirin", lo: 2, hi: 4 },
      { unit: "mg", lo: 81, hi: 81 },
    ]);
    expect(doseMeasuresOf("Usa 2–4 inhalaciones.")).toEqual([{ unit: "puff", lo: 2, hi: 4 }]);
  });

  it("las cifras de tiempo, tamaño o frecuencia no se unen a una unidad posterior", () => {
    expect(doseMeasuresOf("Espera 10 minutos y sigue con las gotas.")).toEqual([]);
    expect(doseMeasuresOf("de 2 a 10 años, un vaso (100 a 200 ml)")).toEqual([{ unit: "ml", lo: 100, hi: 200 }]);
    expect(doseMeasuresOf("una vez al día")).toEqual([]);
  });
});
