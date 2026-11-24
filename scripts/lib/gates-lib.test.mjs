/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { violacionesSuelo } from "./gates-lib.mjs";

// Fixtures sintéticos mínimos: la foto trae solo las celdas que las
// reglas miran. Las cifras copian la forma de la F0 (guía 0/133,
// negativos 42/6/18, históricos 8/0/0 y la foto de la guarda ampliada
// del dirimen) para que cada caso se lea contra números conocidos.
const celda = (tasa) => ({ ok: 0, total: 100, tasa });
const porPuerta = (health, emergency, crisis, co) => ({ health, emergency, crisis, co });

function baseline() {
  return {
    primariaPorRutaIdioma: {
      "salud/es": celda(89.7),
      "crisis/es": celda(58),
      "crisis/en": celda(60),
      "crisis/pt": celda(40),
    },
    suelos: { "crisis/es": 58, "crisis/en": 60, "crisis/pt": 40 },
    guarda: {
      porSubcorpus: {
        guia: { total: 133, conAlgunaPuerta: 0, porPuerta: porPuerta(0, 0, 0, 0) },
        negativos: { total: 123, conAlgunaPuerta: 46, porPuerta: porPuerta(42, 6, 18, 0) },
        historicos: { total: 18, conAlgunaPuerta: 8, porPuerta: porPuerta(8, 0, 0, 0) },
      },
    },
    guardaAmpliada: {
      porSubcorpus: {
        "ciega-guia": { total: 48, conAlgunaPuerta: 0, porPuerta: porPuerta(0, 0, 0, 0) },
        "ciega-ficcion": { total: 102, conAlgunaPuerta: 27, porPuerta: porPuerta(0, 21, 6, 0) },
        "ciega-modismos": { total: 99, conAlgunaPuerta: 3, porPuerta: porPuerta(3, 0, 0, 0) },
        "ciega-prevencion": { total: 99, conAlgunaPuerta: 66, porPuerta: porPuerta(66, 6, 0, 0) },
        "ciega-historicos": { total: 99, conAlgunaPuerta: 54, porPuerta: porPuerta(54, 9, 0, 0) },
        "ciega-medico": { total: 99, conAlgunaPuerta: 84, porPuerta: porPuerta(84, 0, 0, 0) },
      },
    },
  };
}

// La medida que iguala la foto y cumple los suelos: el caso que pasa.
function medida() {
  const b = baseline();
  return {
    primariaPorRutaIdioma: structuredClone(b.primariaPorRutaIdioma),
    guarda: structuredClone(b.guarda),
    guardaAmpliada: structuredClone(b.guardaAmpliada),
  };
}

describe("gates-lib · el suelo de seguridad de puertas", () => {
  it("sin violaciones cuando la medida iguala la foto y cumple los suelos", () => {
    expect(violacionesSuelo({ medida: medida(), baseline: baseline() })).toEqual([]);
  });

  it("regla 1: una caída de exactamente 0,5 puntos pasa", () => {
    const m = medida();
    m.primariaPorRutaIdioma["salud/es"] = celda(89.2);
    expect(violacionesSuelo({ medida: m, baseline: baseline() })).toEqual([]);
  });

  it("regla 1: una caída de 0,6 tumba y nombra la celda", () => {
    const m = medida();
    m.primariaPorRutaIdioma["salud/es"] = celda(89.1);
    const v = violacionesSuelo({ medida: m, baseline: baseline() });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("salud/es");
    expect(v[0]).toContain("89,1");
  });

  it("regla 2: el suelo de crisis no lleva tolerancia (57,9 contra 58,0 tumba)", () => {
    const m = medida();
    m.primariaPorRutaIdioma["crisis/es"] = celda(57.9);
    const v = violacionesSuelo({ medida: m, baseline: baseline() });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("crisis/es");
    expect(v[0]).toContain("suelo 58,0");
    expect(v[0]).toContain("español");
  });

  it("regla 2: crisis muy por encima del suelo pasa, con la guarda ampliada en su foto", () => {
    const m = medida();
    m.primariaPorRutaIdioma["crisis/pt"] = celda(76.3);
    expect(violacionesSuelo({ medida: m, baseline: baseline() })).toEqual([]);
  });

  it("monotonía: bajar un suelo en el PR es violación aunque la medida lo cumpla", () => {
    const b = baseline();
    b.suelos["crisis/pt"] = 39;
    const v = violacionesSuelo({ medida: medida(), baseline: b, baselineBase: baseline() });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("crisis/pt");
    expect(v[0]).toContain("solo suben");
  });

  it("monotonía: reescribir la foto a la baja es violación aunque la medida case con la foto nueva", () => {
    const b = baseline();
    b.primariaPorRutaIdioma["salud/es"] = celda(89);
    const m = medida();
    m.primariaPorRutaIdioma["salud/es"] = celda(89);
    const v = violacionesSuelo({ medida: m, baseline: b, baselineBase: baseline() });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("salud/es");
    expect(v[0]).toContain("no se reescribe a la baja");
  });

  it("monotonía: la excepción de cambio de corpus deja pasar la re-fotografía", () => {
    const b = baseline();
    b.primariaPorRutaIdioma["salud/es"] = celda(89);
    const m = medida();
    m.primariaPorRutaIdioma["salud/es"] = celda(89);
    expect(
      violacionesSuelo({ medida: m, baseline: b, baselineBase: baseline(), corpusTocado: true })
    ).toEqual([]);
  });

  it("regla 3: el piso duro de la guía tumba con una sola línea declarando", () => {
    const m = medida();
    m.guarda.porSubcorpus.guia.conAlgunaPuerta = 1;
    const v = violacionesSuelo({ medida: m, baseline: baseline() });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("guia");
    expect(v[0]).toContain("piso duro");
  });

  it("regla 3: el trinquete caza un falso positivo nuevo en negativos y no castiga una bajada en históricos", () => {
    const m = medida();
    m.guarda.porSubcorpus.negativos.porPuerta.crisis = 21;
    m.guarda.porSubcorpus.historicos.porPuerta.health = 5;
    const v = violacionesSuelo({ medida: m, baseline: baseline() });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("negativos/crisis");
    expect(v[0]).toContain("21");
    expect(v[0]).toContain("18");
  });

  it("regla 3 extendida: el piso duro ampliado tumba si ciega-guia declara", () => {
    const m = medida();
    m.guardaAmpliada.porSubcorpus["ciega-guia"].conAlgunaPuerta = 1;
    const v = violacionesSuelo({ medida: m, baseline: baseline() });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("ciega-guia");
    expect(v[0]).toContain("piso duro ampliado");
  });

  it("regla 3 extendida: el trinquete ampliado tumba si un conteo de un cubo ciega sube contra la foto", () => {
    const m = medida();
    m.guardaAmpliada.porSubcorpus["ciega-ficcion"].porPuerta.crisis = 7;
    const v = violacionesSuelo({ medida: m, baseline: baseline() });
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("ciega-ficcion/crisis");
    expect(v[0]).toContain("guarda ampliada empeora");
  });
});
