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

  // R-05: el caso inverso — la respuesta nombra el dato sin darlo y
  // la fuente sí lo trae. La frase enseñada es la del número, no la
  // primera que comparta una palabra.
  it("R-05 omisión: «el teléfono es el número de emergencia» contra la fuente que trae el teléfono", () => {
    const doc =
      "Su cita es el martes 10 de noviembre de 2026 a las 9:30 de la mañana, en la sala 214, segundo piso. " +
      "Para cambiar la cita llame al 520-555-0147.";
    const conflicts = findNumberConflicts("El teléfono para cambiar la cita es el número de emergencia.", [chunk(doc)]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].omission).toBe(true);
    expect(conflicts[0].sourceSentence).toContain("520-555-0147");
  });

  it("R-05 omisión: si la respuesta SÍ da el número, no hay aviso", () => {
    const doc = "Para cambiar la cita llame al 520-555-0147.";
    expect(findNumberConflicts("El teléfono para cambiar la cita es el 520-555-0147.", [chunk(doc)])).toEqual([]);
  });

  it("R-05 omisión: sin categoría de dato en la respuesta, o sin cifras del tema en la fuente, no hay aviso", () => {
    expect(
      findNumberConflicts("La respuesta es muy interesante y completa.", [chunk("El dato es 42 y nada más.")])
    ).toEqual([]);
    expect(
      findNumberConflicts("El teléfono es el número de emergencia.", [chunk("El teléfono de la oficina atiende de día.")])
    ).toEqual([]);
  });
});
