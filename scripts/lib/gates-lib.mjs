/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

// La lógica pura del suelo de seguridad de puertas (Fase 1 del plan de
// ingeniería): compara la medida de `eval-gates.mjs` sobre un árbol con
// la foto de `eval/gates/baseline.json` y devuelve las violaciones,
// cada una nombrando su celda, su medida y su referencia. Sin efectos:
// entra la medida y salen las violaciones, como esencial-ledger-lib.
//
// Las tres reglas (PREP-FASE-1 §1.3 a §1.5, con la regla 3 extendida
// por el DIRIMEN-FORMATO-GUARDA, D-7):
//   1. Sin regresión: ninguna de las 27 celdas de primaria puede bajar
//      más de 0,5 puntos contra la foto del baseline.
//   2. Suelos absolutos de crisis, con trinquete: la tasa de crisis de
//      cada idioma no puede caer bajo su suelo (sin tolerancia), y en
//      un PR ni los suelos ni la foto pueden reescribirse a la baja
//      (excepción con nombre: un PR de cambio de corpus re-fotografía).
//   3. La guarda, en dos pisos: piso duro (la guía de la F0 y el cubo
//      ciega-guia de la guarda ampliada nacen en cero y no pueden
//      declarar nada) y piso de trinquete (los conteos de falsos
//      positivos por puerta de negativos, históricos y los cinco cubos
//      restantes de la ampliada no pueden subir contra la foto).

const PUERTAS = ["health", "emergency", "crisis", "co"];
const IDIOMAS = { es: "español", en: "inglés", pt: "portugués" };
const CUBOS_TRINQUETE_AMPLIADA = [
  "ciega-ficcion",
  "ciega-modismos",
  "ciega-prevencion",
  "ciega-historicos",
  "ciega-medico",
];

// Las tasas viajan a un decimal, como las produce eval-gates: el
// formato de los mensajes es el español de la casa (coma decimal).
export const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
export const fmtDelta = (v) => {
  const r = Math.round(v * 10) / 10;
  return (r > 0 ? "+" : "") + r.toFixed(1).replace(".", ",");
};

/**
 * @param {object} entrada
 * @param {object} entrada.medida - salida de eval-gates.mjs sobre el árbol.
 * @param {object} entrada.baseline - eval/gates/baseline.json del árbol.
 * @param {object|null} [entrada.baselineBase] - el baseline de la base
 *   del PR, para la pierna de monotonía; null si no aplica (sin base o
 *   el PR que estrena el baseline).
 * @param {boolean} [entrada.corpusTocado] - el PR toca
 *   eval/gates/corpus/: puede re-fotografiar (excepción de la regla 2).
 * @returns {string[]} las violaciones, en orden de regla.
 */
export function violacionesSuelo({ medida, baseline, baselineBase = null, corpusTocado = false }) {
  const violaciones = [];
  const foto = baseline.primariaPorRutaIdioma ?? {};
  const medidaFoto = medida.primariaPorRutaIdioma ?? {};

  // Regla 1 · sin regresión por celda (caída de exactamente 0,5 pasa).
  for (const [celda, ref] of Object.entries(foto)) {
    const m = medidaFoto[celda];
    if (!m) {
      violaciones.push(`${celda}: la medida no trae la celda de la foto — el corpus o el script han cambiado de forma`);
      continue;
    }
    if (m.tasa < ref.tasa - 0.5 - 1e-9) {
      violaciones.push(
        `${celda}: medida ${fmt(m.tasa)} % · baseline ${fmt(ref.tasa)} — regresión de ${fmt(Math.abs(m.tasa - ref.tasa))} puntos (la regla 1 admite 0,5)`
      );
    }
  }

  // Regla 2 · suelos absolutos de crisis (sin tolerancia).
  const suelos = baseline.suelos ?? {};
  for (const [celda, suelo] of Object.entries(suelos)) {
    const m = medidaFoto[celda];
    if (!m) continue; // la regla 1 ya nombra la celda ausente
    if (m.tasa < suelo - 1e-9) {
      const lang = celda.split("/")[1];
      violaciones.push(
        `${celda}: medida ${fmt(m.tasa)} % · suelo ${fmt(suelo)} · baseline ${fmt(foto[celda]?.tasa ?? suelo)} — el suelo de crisis está roto en ${IDIOMAS[lang] ?? lang}`
      );
    }
  }

  // Regla 2 · monotonía del trinquete contra la base del PR.
  if (baselineBase && !corpusTocado) {
    for (const [celda, sueloBase] of Object.entries(baselineBase.suelos ?? {})) {
      const suelo = suelos[celda];
      if (suelo == null || suelo < sueloBase - 1e-9) {
        violaciones.push(
          `${celda}: el suelo baja de ${fmt(sueloBase)} a ${suelo == null ? "ausente" : fmt(suelo)} en el PR — los suelos solo suben (trinquete)`
        );
      }
    }
    for (const [celda, refBase] of Object.entries(baselineBase.primariaPorRutaIdioma ?? {})) {
      const ref = foto[celda];
      if (!ref || ref.tasa < refBase.tasa - 1e-9) {
        violaciones.push(
          `${celda}: la foto del baseline baja de ${fmt(refBase.tasa)} a ${ref ? fmt(ref.tasa) : "ausente"} en el PR — la foto no se reescribe a la baja (excepción con nombre: PR de cambio de corpus)`
        );
      }
    }
  }

  // Regla 3 · piso duro: la guía no puede declarar nada.
  const guarda = medida.guarda?.porSubcorpus ?? {};
  const fotoGuarda = baseline.guarda?.porSubcorpus ?? {};
  const guia = guarda.guia;
  if (guia && guia.conAlgunaPuerta > 0) {
    violaciones.push(
      `guia: ${guia.conAlgunaPuerta} de ${guia.total} líneas declaran alguna puerta · suelo 0 — el piso duro de la guía está roto`
    );
  }

  // Regla 3 · piso de trinquete: los conteos por puerta no pueden subir.
  for (const sub of ["negativos", "historicos"]) {
    const m = guarda[sub];
    const ref = fotoGuarda[sub];
    if (!m || !ref) continue;
    for (const g of PUERTAS) {
      if (m.porPuerta[g] > ref.porPuerta[g]) {
        violaciones.push(
          `${sub}/${g}: ${m.porPuerta[g]} falsos positivos contra ${ref.porPuerta[g]} de la foto — la guarda empeora`
        );
      }
    }
  }

  // Regla 3 extendida (dirimen D-7) · la guarda ampliada, si la hay.
  const amp = medida.guardaAmpliada?.porSubcorpus;
  const fotoAmp = baseline.guardaAmpliada?.porSubcorpus;
  if (amp && fotoAmp) {
    const guiaAmp = amp["ciega-guia"];
    if (guiaAmp && guiaAmp.conAlgunaPuerta > 0) {
      violaciones.push(
        `ciega-guia: ${guiaAmp.conAlgunaPuerta} de ${guiaAmp.total} líneas declaran alguna puerta · suelo 0 — el piso duro ampliado está roto`
      );
    }
    for (const sub of CUBOS_TRINQUETE_AMPLIADA) {
      const m = amp[sub];
      const ref = fotoAmp[sub];
      if (!m || !ref) continue;
      for (const g of PUERTAS) {
        if (m.porPuerta[g] > ref.porPuerta[g]) {
          violaciones.push(
            `${sub}/${g}: ${m.porPuerta[g]} falsos positivos contra ${ref.porPuerta[g]} de la foto — la guarda ampliada empeora`
          );
        }
      }
    }
  }

  return violaciones;
}

