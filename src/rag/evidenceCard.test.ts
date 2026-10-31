/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { bestPassageSentence, buildEvidenceCard } from "./evidenceCard";
import type { RetrievedChunk } from "./retrieve";

const BODY =
  "La fotosíntesis es el proceso con el que las plantas fabrican su alimento. " +
  "La clorofila de las hojas captura la energía de la luz del sol. " +
  "Con esa energía, la planta convierte el agua y el dióxido de carbono en azúcares y libera oxígeno.";

function chunk(body: string, extra?: Partial<RetrievedChunk>): RetrievedChunk {
  return {
    chunkId: "pack:esencial:1",
    docId: "guia-1",
    title: "La fotosíntesis",
    body,
    score: 0.9,
    ...extra,
  } as RetrievedChunk;
}

describe("bestPassageSentence", () => {
  it("elige la frase con más términos de la pregunta", () => {
    expect(bestPassageSentence(BODY, "¿qué captura la clorofila de la luz del sol?")).toContain("clorofila");
  });

  it("sin solape devuelve la primera frase, y sin frases, vacío", () => {
    expect(bestPassageSentence(BODY, "¿cuánto cuesta un tren?")).toBe(
      "La fotosíntesis es el proceso con el que las plantas fabrican su alimento.",
    );
    expect(bestPassageSentence("   ", "lo que sea")).toBe("");
  });
});

describe("buildEvidenceCard", () => {
  it("la tarjeta lleva la fuente principal, su frase y el pasaje que la rodea", () => {
    const card = buildEvidenceCard([chunk(BODY)], "¿qué captura la clorofila de la luz del sol?");
    expect(card).not.toBeNull();
    expect(card?.title).toBe("La fotosíntesis");
    expect(card?.chunkId).toBe("pack:esencial:1");
    expect(card?.highlight).toContain("clorofila");
    expect(card?.excerpt).toContain(card?.highlight ?? "");
  });

  it("sin fuentes o con la principal vacía, no hay tarjeta", () => {
    expect(buildEvidenceCard([], "pregunta")).toBeNull();
    expect(buildEvidenceCard([chunk("   ")], "pregunta")).toBeNull();
  });

  it("el extracto queda acotado aunque el pasaje sea largo", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Frase número ${i} con bastante texto para llenar el pasaje recuperado.`).join(" ");
    const card = buildEvidenceCard([chunk(long)], "frase número 6 texto");
    expect(card).not.toBeNull();
    expect((card?.excerpt.length ?? 0)).toBeLessThanOrEqual(340);
    expect(card?.excerpt).toContain(card?.highlight ?? "");
  });
});
