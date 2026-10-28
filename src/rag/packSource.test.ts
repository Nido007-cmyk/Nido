/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */
import { describe, expect, it } from "vitest";
import { guideTitleOf, markUsedPart, MAX_SOURCE_PARTS, parsePackChunkId, sectionLikePattern } from "./packSource";

describe("parsePackChunkId (0.1.55)", () => {
  it("lee el pack y la fila", () => {
    expect(parsePackChunkId("pack:nido-esencial:42")).toEqual({ packId: "nido-esencial", rowId: 42 });
    expect(parsePackChunkId("pack:nido-esencial-e5:7")).toEqual({ packId: "nido-esencial-e5", rowId: 7 });
  });
  it("no confunde otros trozos", () => {
    expect(parsePackChunkId("kb:intro:1")).toBeNull();
    expect(parsePackChunkId("pack:nido-esencial:abc")).toBeNull();
    expect(parsePackChunkId("pack::3")).toBeNull();
    expect(parsePackChunkId(undefined)).toBeNull();
  });
});

describe("markUsedPart (0.1.55)", () => {
  const rows = [
    { id: 10, body: "Llama a emergencias." },
    { id: 11, body: "Aplica presión 15 minutos." },
    { id: 12, body: "No retires la gasa." },
  ];
  it("marca solo la parte usada y conserva el orden", () => {
    const d = markUsedPart("Hemorragias", "Cruz Roja Americana", rows, 11)!;
    expect(d.parts.map((p) => p.used)).toEqual([false, true, false]);
    expect(d.parts.map((p) => p.id)).toEqual([10, 11, 12]);
    expect(d.source).toBe("Cruz Roja Americana");
  });
  it("si la parte usada no está, no inventa nada", () => {
    expect(markUsedPart("Hemorragias", "", rows, 99)).toBeNull();
  });
  it("respeta el tope de partes", () => {
    const many = Array.from({ length: MAX_SOURCE_PARTS + 5 }, (_, i) => ({ id: i, body: "x" }));
    expect(markUsedPart("T", "", many, 0)!.parts).toHaveLength(MAX_SOURCE_PARTS);
  });
});

describe("la guía entera, no solo un apartado (0.1.55)", () => {
  it("el título de la guía sale del título del trozo «Guía — Apartado»", () => {
    expect(guideTitleOf("Hemorragias graves — Qué hacer")).toBe("Hemorragias graves");
    expect(guideTitleOf("Cuba: números de emergencia y fases ante ciclones — Las cuatro fases")).toBe(
      "Cuba: números de emergencia y fases ante ciclones",
    );
    expect(guideTitleOf("Paris")).toBe("Paris");
  });
  it("el patrón LIKE escapa %, _ y la barra", () => {
    expect(sectionLikePattern("Guía")).toBe("Guía — %");
    expect(sectionLikePattern("50%_a\\b")).toBe("50\\%\\_a\\\\b — %");
  });
});

