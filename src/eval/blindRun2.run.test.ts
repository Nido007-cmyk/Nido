/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Evaluación ciega contra la frontera — CORREDOR del conjunto
 * FRESCO 02 (no es una prueba unitaria: ejecuta la evaluación).
 * Corre con: npm run eval:blind. Método y resultados:
 * docs/BLIND_EVAL.md.
 *
 * El conjunto 02 se escribió para medir las curas de F-B1 y F-B2
 * sin mirar el conjunto 01 (regla del sello: una cura no se valida
 * contra el conjunto que la destapó). El instrumento es el mismo
 * que mide el conjunto 01: el núcleo compartido de blindCore.ts.
 */
import { describe, it } from "vitest";
import { BLIND_SET_2, BLIND_SET_2_VERSION } from "./blindSet2";
import { BLIND_REFERENCES_2 } from "./blindReferences2";
import { executeBlindRun, formatBlindRun } from "./blindCore";

describe("evaluación ciega — corrida del conjunto fresco 02", () => {
  it("corre el conjunto y escribe rutas, anónimo y clave", () => {
    const result = executeBlindRun(BLIND_SET_2, BLIND_REFERENCES_2, BLIND_SET_2_VERSION);
    console.log(formatBlindRun(BLIND_SET_2_VERSION, result));
  });
});
