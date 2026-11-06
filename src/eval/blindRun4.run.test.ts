/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Evaluación ciega contra la frontera — CORREDOR del conjunto
 * FRESCO 04 (no es una prueba unitaria: ejecuta la evaluación).
 * Corre con: npm run eval:blind. Método y resultados:
 * docs/BLIND_EVAL.md.
 *
 * El conjunto 04 se escribió para medir la cura de F-1 (la puerta
 * que no reconocía la reanimación en curso ni varias formas de
 * preguntar cómo se hace, auditoría adversaria de la práctica de
 * RCP de la 0.1.76) sin mirar los conjuntos 01, 02 ni 03 ni la
 * batería de la auditoría (regla del sello: una cura no se valida
 * contra el conjunto que la destapó). El instrumento es el mismo
 * que mide los conjuntos anteriores: el núcleo compartido de
 * blindCore.ts.
 */
import { describe, it } from "vitest";
import { BLIND_SET_4, BLIND_SET_4_VERSION } from "./blindSet4";
import { BLIND_REFERENCES_4 } from "./blindReferences4";
import { executeBlindRun, formatBlindRun } from "./blindCore";

describe("evaluación ciega — corrida del conjunto fresco 04", () => {
  it("corre el conjunto y escribe rutas, anónimo y clave", () => {
    const result = executeBlindRun(BLIND_SET_4, BLIND_REFERENCES_4, BLIND_SET_4_VERSION);
    console.log(formatBlindRun(BLIND_SET_4_VERSION, result));
  });
});
