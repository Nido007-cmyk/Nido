/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 *
 * Defectos A y B de la pasada 0.1.106 (fotos del dueño, Tab A9+,
 * 2026-11-16 07:36–07:39 MST, misma conversación crecida):
 *
 * A · La respuesta de ABSTENCIÓN con extracto (la llanta: abstención
 * honesta + extracto de «Avería en carretera») no ofrecía abrir la
 * guía citada, aunque la fundamentada sí enseña «Abrir la guía
 * completa». El botón solo se pinta si el mensaje lleva
 * guideChunkId, y eso solo se asignaba en las respuestas literales.
 * La abstención marca su extracto en la procedencia como origen
 * «source» con `replaced: true` sobre la fuente del extracto: de
 * ahí sale el chunkId que el botón necesita, también al reabrir la
 * sesión (la tarjeta evidenceFirst es solo en memoria; el
 * guideChunkId persiste con el mensaje).
 *
 * B · En el turno degradado (atragantamiento a la primera), la
 * respuesta servida fue el TEXTO SEGURO de salud y sin embargo la
 * tarjeta «Fuente principal» enseñó la guía de la CRECIDA: la
 * tarjeta se construía sin condición desde la recuperación, y con
 * la procedencia toda «fixed» el índice servido caía al rango 1.
 * Un texto fijo no tiene fuente principal: la tarjeta debe ser
 * null cuando lo servido es el texto seguro.
 */
import { describe, it, expect } from "vitest";
import { buildEvidenceCard, abstentionGuideChunkId } from "./evidenceCard";
import type { RetrievedChunk } from "./retrieve.types";
import type { SentenceProvenance } from "./provenance";

function chunk(chunkId: string, title: string, body: string): RetrievedChunk {
  return { chunkId, docId: chunkId, title, body, score: 1, rawScore: 0.9, matchType: "semantic" } as unknown as RetrievedChunk;
}

const CRECIDA = chunk(
  "pack:nido-esencial-e5:63",
  "Crecidas e inundaciones — Antes de la crecida",
  "Antes de la crecida, conoce las rutas de evacuación de tu zona. Si el agua sube, no cruces corrientes.",
);
const AVERIA = chunk(
  "pack:nido-esencial-e5:71",
  "Avería en carretera — Qué hacer si el coche se detiene",
  "Si el coche se detiene, enciende las luces de emergencia y coloca el triángulo de preseñalización. Sal del vehículo por el lado contrario al tráfico.",
);
const GLOSARIO = chunk("glosario:cauterizacion", "Cauterización", "Procedimiento que sella un tejido aplicando calor.");

function prov(origin: SentenceProvenance["origin"]): SentenceProvenance {
  return { text: "frase", origin } as unknown as SentenceProvenance;
}

describe("Defecto B · la tarjeta no corona una guía sobre un texto fijo", () => {
  const chunks = [CRECIDA, AVERIA];
  const q = "Que hago si un niño se esta atragantando";

  it("con el texto seguro servido, la tarjeta es null aunque haya fuentes", () => {
    expect(buildEvidenceCard(chunks, q, null, { servedFixedText: true })).toBeNull();
    expect(buildEvidenceCard(chunks, q, 0, { servedFixedText: true })).toBeNull();
  });

  it("control: sin texto fijo, la tarjeta se construye como siempre", () => {
    const card = buildEvidenceCard(chunks, q, null);
    expect(card).not.toBeNull();
    expect(card?.chunkId).toBe(CRECIDA.chunkId);
    const card2 = buildEvidenceCard(chunks, q, null, { servedFixedText: false });
    expect(card2?.chunkId).toBe(CRECIDA.chunkId);
  });
});

describe("Defecto A · la abstención con extracto ofrece abrir SU guía", () => {
  const chunks = [CRECIDA, AVERIA];

  it("el extracto marcado `replaced` sobre la fuente 2 devuelve su chunkId", () => {
    const provenance = [
      prov({ kind: "fixed" }),
      prov({ kind: "source", n: 2, support: 1, replaced: true }),
      prov({ kind: "source", n: 2, support: 1, replaced: true }),
    ];
    expect(abstentionGuideChunkId(provenance, chunks)).toBe(AVERIA.chunkId);
  });

  it("con el texto seguro (procedencia toda fija) no hay guía que abrir", () => {
    const provenance = [prov({ kind: "fixed" }), prov({ kind: "fixed" })];
    expect(abstentionGuideChunkId(provenance, chunks)).toBeNull();
  });

  it("una frase de fuente SIN `replaced` (respuesta fundamentada) no es el extracto de la abstención", () => {
    const provenance = [prov({ kind: "source", n: 2, support: 1 })];
    expect(abstentionGuideChunkId(provenance, chunks)).toBeNull();
  });

  it("si la fuente del extracto no es un fragmento de guía de pack, no se ofrece abrir nada", () => {
    const provenance = [prov({ kind: "source", n: 1, support: 1, replaced: true })];
    expect(abstentionGuideChunkId(provenance, [GLOSARIO, AVERIA])).toBeNull();
  });

  it("sin procedencia o con el índice fuera de la lista, null", () => {
    expect(abstentionGuideChunkId(undefined, chunks)).toBeNull();
    expect(abstentionGuideChunkId([prov({ kind: "source", n: 9, support: 1, replaced: true })], chunks)).toBeNull();
  });
});
