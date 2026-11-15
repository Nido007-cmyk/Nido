/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-17 (0.1.99) · La marca «replaced» de procedencia: cada clase de
 * sustitución del juez deja su frase marcada como CITA (el texto que
 * se sirve es el de la fuente, palabra por palabra), y ninguna frase
 * que el juez NO sustituyó la lleva. Es la distinción que pidió
 * @Pezhonchain: «respaldada por la fuente» no es lo mismo que «cita
 * literal», y pintar como cita una frase del modelo sería el engaño
 * contrario.
 *
 * Rojo previo (medido antes de la cura): ninguna sustitución llevaba
 * la marca; solo las de negación/condicional llevaban negationFixed.
 */
import { describe, expect, it } from "vitest";
import { verifyGroundedAnswer, type GroundingChunk } from "./grounding";

const replacedOf = (r: ReturnType<typeof verifyGroundedAnswer>) =>
  (r.sentences ?? []).filter((s) => s.origin.kind === "source" && s.origin.replaced === true);

describe("T-17 · marca «replaced» en cada clase de sustitución", () => {
  it("dato: el teléfono equivocado se sustituye por el de la fuente y la frase sale marcada", () => {
    const ch: GroundingChunk = {
      title: "nota",
      body: "Nota. La cita es el martes. Para emergencias llama al 911. El teléfono de la clínica es 520-555-0147.",
    };
    const r = verifyGroundedAnswer("El teléfono de la clínica es el 911.", [ch], "es", "¿Cuál es el teléfono de la clínica?");
    expect(r.text).toContain("520-555-0147");
    const marked = replacedOf(r);
    expect(marked.length).toBe(1);
    expect(marked[0].text).toContain("520-555-0147");
    expect(marked[0].origin).toMatchObject({ kind: "source", n: 1 });
  });

  it("idioma (rama principal): la copia portuguesa sale como gemela española marcada", () => {
    const DOC_ES = "Tome el jarabe de 5 ml dos veces al día, después de comer. Para cambiar la cita llame al 520-555-0147.";
    const DOC_PT = "Tome 5 ml do xarope duas vezes ao dia, depois das refeições. Para mudar a consulta ligue para 520-555-0147.";
    const doc: GroundingChunk = {
      title: "documento-prueba-ocr",
      body: `ESPAÑOL — Recordatorio de cita. ${DOC_ES} PORTUGUÊS — Lembrete de consulta. ${DOC_PT}`,
    };
    const r = verifyGroundedAnswer("Tome 5 ml do xarope duas vezes ao dia, depois das refeições.", [doc], "es", "");
    expect(r.text).toContain("Tome el jarabe de 5 ml dos veces al día");
    const marked = replacedOf(r);
    expect(marked.length).toBe(1);
    expect(marked[0].text).toContain("Tome el jarabe");
  });

  it("idioma (rama cruzada): la copia que vive en las fuentes se sustituye marcada", () => {
    const photo: GroundingChunk = {
      title: "Photosynthesis",
      body: "Photosynthesis is a system of biological processes by which plants convert light energy into chemical energy.",
    };
    const ptChunk: GroundingChunk = { title: "documento-prueba-ocr", body: "Tome 5 ml do xarope duas vezes ao dia, depois das refeições." };
    const esChunk: GroundingChunk = { title: "documento-prueba-ocr", body: "Tome el jarabe de 5 ml dos veces al día, después de comer." };
    const r = verifyGroundedAnswer(ptChunk.body, [photo, ptChunk, esChunk], "es", "");
    expect(r.status).toBe("grounded");
    const marked = replacedOf(r);
    expect(marked.length).toBe(1);
    expect(marked[0].text).toContain("Tome el jarabe");
  });

  it("negación: la copia con la negación volcada se sustituye marcada (y conserva negationFixed)", () => {
    const nota: GroundingChunk = {
      title: "nota",
      body: "Nota de urgencias. El paciente no está sangrando. El paciente está en la cama.",
    };
    const r = verifyGroundedAnswer("El paciente está sangrando.", [nota], "es", "¿El paciente está sangrando?");
    expect(r.text).toContain("El paciente no está sangrando");
    const marked = replacedOf(r);
    expect(marked.length).toBe(1);
    expect(marked[0].origin).toMatchObject({ kind: "source", negationFixed: true, replaced: true });
  });

  it("condicional: la copia sin el «si» se sustituye por la frase de la guía, marcada", () => {
    const fiebre: GroundingChunk[] = [{ title: "Fiebre", body: "Si la fiebre pasa de 39 grados, busca atención médica." }];
    const r = verifyGroundedAnswer("La fiebre pasa de 39 grados, busca atención médica.", fiebre, "es", "¿Qué hago si la fiebre pasa de 39 grados?");
    expect(r.text).toContain("Si la fiebre pasa de 39 grados, busca atención médica");
    const marked = replacedOf(r);
    expect(marked.length).toBe(1);
    expect(marked[0].origin).toMatchObject({ kind: "source", replaced: true });
  });

  it("extracto de la abstención: el extracto literal que acompaña al «no lo sé» sale marcado", () => {
    const photo: GroundingChunk = {
      title: "Photosynthesis",
      body: "Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms convert light energy into chemical energy.",
    };
    const r = verifyGroundedAnswer("The moon is made of cheese and orbits Mars every Tuesday.", [photo], "en", "");
    expect(r.status).toBe("abstained");
    const extract = r.sentences!.at(-1)!;
    expect(extract.origin).toMatchObject({ kind: "source", n: 1, replaced: true });
    expect(extract.text).toContain("Photosynthesis is a system");
  });
});

describe("T-17 · lo que NO se sustituyó no lleva la marca", () => {
  it("la copia fiel del condicional se sirve tal cual, sin marca", () => {
    const fiebre: GroundingChunk[] = [{ title: "Fiebre", body: "Si la fiebre pasa de 39 grados, busca atención médica." }];
    const r = verifyGroundedAnswer("Si la fiebre pasa de 39 grados, busca atención médica.", fiebre, "es", "¿Qué hago si la fiebre pasa de 39 grados?");
    expect(r.text).toContain("Si la fiebre pasa de 39 grados");
    expect(replacedOf(r).length).toBe(0);
  });

  it("la frase del modelo respaldada por la fuente (sin sustituir) no es cita: sin marca", () => {
    const photo: GroundingChunk = {
      title: "Photosynthesis",
      body:
        "Photosynthesis is a system of biological processes by which photopigment-bearing autotrophic organisms, " +
        "such as most plants, algae and cyanobacteria, convert light energy—typically from sunlight—into the chemical " +
        "energy necessary to fuel their metabolism.",
    };
    const r = verifyGroundedAnswer(
      "Photosynthesis is the process by which plants convert light energy into chemical energy [1].",
      [photo],
      "en",
      "",
    );
    const backed = (r.sentences ?? []).find((s) => s.origin.kind === "source");
    expect(backed).toBeTruthy();
    expect(backed!.origin.kind === "source" && backed!.origin.replaced).toBeUndefined();
    expect(replacedOf(r).length).toBe(0);
  });

  it("una respuesta sin sustituciones no produce ninguna frase marcada", () => {
    const nota: GroundingChunk = {
      title: "nota",
      body: "Nota de urgencias. El paciente no está sangrando. El paciente está en la cama.",
    };
    const r = verifyGroundedAnswer("El paciente no está sangrando.", [nota], "es", "¿El paciente está sangrando?");
    expect(replacedOf(r).length).toBe(0);
  });
});
