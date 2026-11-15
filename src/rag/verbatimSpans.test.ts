/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * T-17 (0.1.99) · verbatimSpans: la alineación pura entre la
 * procedencia de una respuesta y su texto final, para pintar las
 * citas dentro del propio párrafo (lo que pidió @Pezhonchain).
 *
 * Contrato: solo es cita lo que la procedencia dice que es literal
 * (la guía tal cual, o una frase que el juez SUSTITUYÓ por la
 * fuente: origin «source» con replaced). La alineación es búsqueda
 * secuencial exacta contra el texto tal y como se guarda, citas
 * [n] incluidas; un tramo que no se encuentra exactamente NO se
 * marca: fallar a «sin marca», nunca a «marca equivocada».
 */
import { describe, expect, it } from "vitest";
import { verbatimSpans, type SentenceProvenance } from "./provenance";

const S = (text: string, origin: SentenceProvenance["origin"]): SentenceProvenance => ({ text, origin });

describe("verbatimSpans · qué es cita", () => {
  it("una frase sustituida por la fuente es cita, con su número", () => {
    const sentences = [
      S("El teléfono de la clínica es 520-555-0147 [1].", { kind: "source", n: 1, support: 1, replaced: true }),
    ];
    const spans = verbatimSpans(sentences, "El teléfono de la clínica es 520-555-0147 [1].");
    expect(spans).toEqual([{ text: "El teléfono de la clínica es 520-555-0147 [1].", n: 1 }]);
  });

  it("la guía es cita por definición, sin número de fuente", () => {
    const sentences = [S("Enfriar pronto una quemadura con agua.", { kind: "guide" })];
    const spans = verbatimSpans(sentences, "Enfriar pronto una quemadura con agua.");
    expect(spans).toEqual([{ text: "Enfriar pronto una quemadura con agua." }]);
  });

  it("una frase respaldada pero NO sustituida no es cita", () => {
    const sentences = [
      S("Photosynthesis is the process by which plants convert light energy [1].", { kind: "source", n: 1, support: 0.9 }),
      S("Es del modelo.", { kind: "model", reason: "no-sources" }),
      S("No lo sé.", { kind: "abstain" }),
    ];
    expect(verbatimSpans(sentences, sentences.map((s) => s.text).join(" "))).toEqual([]);
  });

  it("sin frases o sin citas: lista vacía", () => {
    expect(verbatimSpans([], "lo que sea")).toEqual([]);
    expect(verbatimSpans([S("Del modelo.", { kind: "model", reason: "too-short-to-check" })], "Del modelo.")).toEqual([]);
  });
});

describe("verbatimSpans · alineación secuencial exacta", () => {
  it("devuelve los tramos en el orden del texto, saltando las frases del modelo", () => {
    const sentences = [
      S("Primera cita [1].", { kind: "source", n: 1, support: 1, replaced: true }),
      S("Frase del modelo en medio.", { kind: "model", reason: "no-sources" }),
      S("Segunda cita [2].", { kind: "source", n: 2, support: 1, replaced: true }),
    ];
    const text = "Primera cita [1]. Frase del modelo en medio. Segunda cita [2].";
    expect(verbatimSpans(sentences, text)).toEqual([
      { text: "Primera cita [1].", n: 1 },
      { text: "Segunda cita [2].", n: 2 },
    ]);
  });

  it("un tramo con deriva (una palabra cambiada) no se marca; los demás sí", () => {
    const sentences = [
      S("La dosis es de 5 ml [1].", { kind: "source", n: 1, support: 1, replaced: true }),
      S("Tómala dos veces al día [1].", { kind: "source", n: 1, support: 1, replaced: true }),
    ];
    // El texto final trae «10 ml»: la primera frase derivó y no se marca.
    const text = "La dosis es de 10 ml [1]. Tómala dos veces al día [1].";
    expect(verbatimSpans(sentences, text)).toEqual([{ text: "Tómala dos veces al día [1].", n: 1 }]);
  });

  it("un tramo ausente del texto (truncado) no se marca ni rompe la búsqueda", () => {
    const sentences = [
      S("Esto ya no está.", { kind: "source", n: 1, support: 1, replaced: true }),
      S("Esto sí está [1].", { kind: "source", n: 1, support: 1, replaced: true }),
    ];
    expect(verbatimSpans(sentences, "Esto sí está [1].")).toEqual([{ text: "Esto sí está [1].", n: 1 }]);
  });

  it("dos citas idénticas se alinean dos veces, en orden, sin solaparse", () => {
    const sentences = [
      S("Llama al 911 [1].", { kind: "source", n: 1, support: 1, replaced: true }),
      S("Llama al 911 [1].", { kind: "source", n: 1, support: 1, replaced: true }),
    ];
    const spans = verbatimSpans(sentences, "Llama al 911 [1]. Llama al 911 [1].");
    expect(spans.length).toBe(2);
  });

  it("la búsqueda es secuencial: una cita no se alinea hacia atrás", () => {
    const sentences = [
      S("Segunda [2].", { kind: "source", n: 2, support: 1, replaced: true }),
      S("Primera [1].", { kind: "source", n: 1, support: 1, replaced: true }),
    ];
    // En el texto el orden real es el contrario al de la lista: la
    // primera de la lista se encuentra, la segunda ya quedó atrás.
    const spans = verbatimSpans(sentences, "Primera [1]. Segunda [2].");
    expect(spans).toEqual([{ text: "Segunda [2].", n: 2 }]);
  });
});
