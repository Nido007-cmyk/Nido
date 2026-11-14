/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-01 (seguridad fija inmediata), auditoría de la app
 * 2026-11-14, carril 02 (H-15 → m-10, SOSPECHA en origen):
 *
 * «Mi padre respira muy mal y está muy pálido» no declaraba situación
 * de emergencia (sonda P-18a): los signos traían «no puede respirar»
 * pero ninguna forma de la raíz «respir-» con su contexto. El arreglo
 * sigue la doctrina de formas del fichero: entran las formas
 * atestiguadas de la respiración con su marca de gravedad dentro de
 * la frase («respira muy mal», «breathing poorly»), como ya entran
 * «cuesta respirar» o «struggling to breathe». La raíz suelta NO se
 * añade a EMERGENCY_STEMS a propósito: «respir-» comparte principio
 * con temas cotidianos (ejercicios de respiración, «un respiro» =
 * un descanso, «a breather»), y la cabecera de las raíces exige que
 * no compartan principio con temas cotidianos. Los negativos de
 * abajo dejan esa frontera probada.
 */
import { describe, expect, it } from "vitest";
import { isEmergencySituation } from "./emergencyGate";

describe("m-10 · la respiración contada con su gravedad abre la puerta", () => {
  it("la sonda del acta, palabra por palabra (P-18a)", () => {
    expect(isEmergencySituation("Mi padre respira muy mal y está muy pálido")).toBe(true);
  });

  it("la familia en español: «respira mal», gerundio y primera persona", () => {
    for (const q of [
      "mi padre respira mal",
      "mi abuelo está respirando muy mal",
      "mi abuela está respirando mal",
      "respiro muy mal desde hace un rato",
      "mi padre respira con dificultad",
      "está respirando con dificultad",
    ]) {
      expect(isEmergencySituation(q), q).toBe(true);
    }
  });

  it("la familia en portugués: «muito mal» y «com dificuldade»", () => {
    for (const q of ["meu pai respira muito mal", "meu pai respira mal", "ele está respirando com dificuldade"]) {
      expect(isEmergencySituation(q), q).toBe(true);
    }
  });

  it("la familia en inglés: «breathing badly / poorly / with difficulty»", () => {
    for (const q of ["my dad is breathing very badly", "my father is breathing poorly", "she is breathing with difficulty"]) {
      expect(isEmergencySituation(q), q).toBe(true);
    }
  });

  it("el control del acta sigue disparando (P-18b, atragantamiento dictado)", () => {
    expect(isEmergencySituation("se esta tragantando")).toBe(true);
    expect(isEmergencySituation("mi hijo no respira")).toBe(true);
  });

  it("la respiración cotidiana NO declara: la raíz suelta no es detector", () => {
    for (const q of [
      "mi padre respira tranquilo mientras duerme",
      "hago ejercicios de respiración todas las mañanas",
      "mi madre respira hondo y se relaja en yoga",
      "¿cómo puedo respirar mejor cuando corro?",
      "necesito un respiro, llevo todo el día trabajando",
      "my dad took a breather after the run",
    ]) {
      expect(isEmergencySituation(q), q).toBe(false);
    }
  });
});
