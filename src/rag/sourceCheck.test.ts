/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { findNumberConflicts } from "./sourceCheck";
import type { RetrievedChunk } from "./retrieve";

const chunk = (body: string): RetrievedChunk =>
  ({ id: "c1", title: "Fuente", body, source: "test", score: 1 }) as unknown as RetrievedChunk;

describe("findNumberConflicts (la caja de comprobación)", () => {
  it("el caso Hubble de Field Atlas: 870 km en la respuesta contra 600 km en la fuente", () => {
    const conflicts = findNumberConflicts(
      "La órbita del Hubble está a 540 millas (870 km) de altura.",
      [chunk("El telescopio Hubble orbita a unos 600 km sobre la superficie de la Tierra.")]
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("km");
    expect(conflicts[0].sourceSentence).toContain("600 km");
  });

  it("el caso del Gran Cañón: 8.000 pies contra 6.000 pies", () => {
    const conflicts = findNumberConflicts(
      "The Grand Canyon is over 8,000 feet deep at its deepest point.",
      [chunk("The Grand Canyon reaches about 6,000 feet deep in places.")]
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unit).toBe("pies");
  });

  it("el redondeo honesto y la escala NO son contradicción (la regla de la tanda 1)", () => {
    expect(
      findNumberConflicts("La población del país es de 16,4 millones de habitantes.", [
        chunk("El país tiene 16.431.599 habitantes según el censo."),
      ])
    ).toEqual([]);
    expect(
      findNumberConflicts("El depósito guarda unos 600 litros de agua.", [
        chunk("El depósito guarda 598 litros de agua."),
      ])
    ).toEqual([]);
  });

  it("unidades distintas nunca se comparan (no se convierte)", () => {
    expect(
      findNumberConflicts("La ruta mide 5 km en total.", [chunk("La ruta mide 3 millas en total.")])
    ).toEqual([]);
  });

  it("sin tema compartido no hay aviso, aunque la unidad coincida", () => {
    expect(
      findNumberConflicts("El tanque de la granja guarda 600 litros de agua.", [
        chunk("La receta tradicional usa 200 litros de leche."),
      ])
    ).toEqual([]);
  });

  it("sin fuentes o sin cifras no hay nada que comprobar", () => {
    expect(findNumberConflicts("Una respuesta sin cifras.", [chunk("Tampoco hay cifras aquí.")])).toEqual([]);
    expect(findNumberConflicts("Hay 600 km de costa.", [])).toEqual([]);
  });
});
