/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Evaluación ciega contra la frontera — CORREDOR del conjunto 01
 * (no es una prueba unitaria: ejecuta la evaluación). Corre con:
 * npm run eval:blind. Método y resultados: docs/BLIND_EVAL.md.
 *
 * El instrumento (la capa determinista, la clave y el ejecutor que
 * sella, corre y escribe rutas/anónimo/clave) vive en blindCore.ts,
 * compartido con el corredor del conjunto fresco 02
 * (blindRun2.run.test.ts) para que ambos conjuntos se midan con
 * exactamente el mismo instrumento. Hasta la corrida 02 el núcleo
 * vivía en este fichero; la extracción no cambia su comportamiento
 * ni el sello, que es del conjunto, no del corredor.
 *
 * Sin red, sin dispositivo, sin módulos nativos: la capa medida es
 * la que no los necesita. Las respuestas del modelo local no se
 * miden aquí (territorio de eval:device).
 */
import { describe, it } from "vitest";
import { BLIND_SET, BLIND_SET_VERSION } from "./blindSet";
import { BLIND_REFERENCES } from "./blindReferences";
import { executeBlindRun, formatBlindRun } from "./blindCore";

describe("evaluación ciega — corrida del conjunto sellado 01", () => {
  it("corre el conjunto y escribe rutas, anónimo y clave", () => {
    const result = executeBlindRun(BLIND_SET, BLIND_REFERENCES, BLIND_SET_VERSION);
    console.log(formatBlindRun(BLIND_SET_VERSION, result));
  });
});
