/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Evaluación ciega contra la frontera — CORREDOR del conjunto
 * FRESCO 03 (no es una prueba unitaria: ejecuta la evaluación).
 * Corre con: npm run eval:blind. Método y resultados:
 * docs/BLIND_EVAL.md.
 *
 * El conjunto 03 se escribió para medir la cura de F-B3 (marcos
 * históricos que disparan la puerta de salud) y la sustancia del
 * texto fijo sin mirar los conjuntos 01 ni 02 (regla del sello:
 * una cura no se valida contra el conjunto que la destapó). El
 * instrumento es el mismo que mide los conjuntos 01 y 02: el
 * núcleo compartido de blindCore.ts.
 */
import { describe, it } from "vitest";
import { BLIND_SET_3, BLIND_SET_3_VERSION } from "./blindSet3";
import { BLIND_REFERENCES_3 } from "./blindReferences3";
import { executeBlindRun, formatBlindRun } from "./blindCore";

describe("evaluación ciega — corrida del conjunto fresco 03", () => {
  it("corre el conjunto y escribe rutas, anónimo y clave", () => {
    const result = executeBlindRun(BLIND_SET_3, BLIND_REFERENCES_3, BLIND_SET_3_VERSION);
    console.log(formatBlindRun(BLIND_SET_3_VERSION, result));
  });
});
