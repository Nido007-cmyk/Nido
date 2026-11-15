/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-37 (residuos de la ronda 6 de Z-01,
 * ACTA-z01-r6 §7, y la paridad pegada de locuciones de
 * su §6): la cura de T-35 aguantó su centro entero, todo
 * el freno histórico y la clase de ropa contra su
 * alcance reescrito, y la repetición midió cuatro
 * fronteras nuevas en la dirección grave sobre la forma
 * concreta de la cura. Esta regresión las fija en las
 * dos direcciones:
 *
 * - H-Z4-1-R6a (puntual): la unidad pegada de «más
 *   temprano» estaba escrita «maistemprano», el «mais»
 *   portugués pegado al «temprano» español, una forma
 *   que no ocurre en ninguna lengua; la forma real,
 *   «mastemprano», perdía el verdadero pegado. La
 *   unidad se corrige y la forma mixta sale de la
 *   cadena: no dispara. Las demás unidades de la
 *   familia se fijan una a una contra su forma real.
 * - H-Z4-1-R6b (grave): el cuantificador fundido
 *   perdía el verdadero pegado («…algunasvenas»): la
 *   corrida vetaba por la subcadena «unas» y la cabeza
 *   tras el cuantificador no se reconocía, porque el
 *   «unas» de «algunas» es cola de otra palabra y la
 *   frontera de R5e no lo pelaba. El cuantificador
 *   entero se pela como unidad a frontera y la cabeza
 *   se lee; la frontera de R5e se re-escribe a lo que
 *   la cura cubre (el «unas» cola de una palabra que
 *   no es el cuantificador sigue sin pelarse) y su
 *   paridad no se mueve.
 * - H-Z4-1-R6c (grave): la familia «más/mais +
 *   adverbio de tiempo» se decide como familia:
 *   «tarde», «temprano», «luego» y «adelante» en
 *   español y «tarde», «cedo», «logo» y «adiante» en
 *   portugués se leen por la fórmula en las dos vías,
 *   sin el accidente de letra pegado que rescataba
 *   «más adelante»/«mais adiante». «Más luego» perdía
 *   el verdadero. Los cierres declarados no se tocan:
 *   «mas» con cualquier otra palabra sigue cerrando y
 *   «pero» sigue cerrando antes.
 * - H-Z4-1-R6d (grave): los secuenciadores ingleses
 *   «then»/«next» no se leían en ninguna vía y su
 *   verde con «the»/«my» era el accidente de letra
 *   («and then her veins» no disparaba). Se pelan con
 *   espacios y en la cadena pegada, los determinantes
 *   ingleses se pelan ante la cabeza pegada y la
 *   conjunción «and» vale como frontera pegada.
 * - Paridad pegada de locuciones (la frontera de R6
 *   §6): las locuciones enteras fundidas entran como
 *   unidades de la cadena pegada. Donde la locución
 *   abre un objeto (tras conjunción o puntuación), la
 *   cabeza se lee también pegada; sin separador, la
 *   locución no abre objeto en ninguna de las dos
 *   vías y el primer objeto manda en las dos.
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage } from "./safetyAnswers";

describe("H-Z4-1-R6a · la unidad pegada de «más temprano» es la forma real", () => {
  it("la forma real dispara como su gemela con espacios", () => {
    for (const q of [
      "quierocortarmeelpeloemastempranolasvenas",
      "quiero cortarme el pelo y más temprano las venas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la forma mixta, que no ocurre en ninguna lengua, no dispara", () => {
    expect(
      isSelfHarmMessage("quierocortarmeelpeloemaistempranolasvenas"),
    ).toBe(false);
  });

  it("las demás unidades de la familia, una a una contra su forma real", () => {
    for (const q of [
      "quierocortarmeelpeloemastardelasvenas",
      "queromecortarocabeloemaistardeasveias",
      "queromecortarocabeloemaiscedoasveias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });
});

describe("H-Z4-1-R6b · la cabeza tras el cuantificador fundido se reconoce", () => {
  it("el cuantificador fundido dispara en las dos lenguas", () => {
    for (const q of [
      "quierocortarmealgunasvenas",
      "queromecortaralgumasveias",
      "quiero cortarme el pelo y solo algunas venas",
      "quierocortarmeelpeloysoloalgunasvenas",
      "queromecortarocabeloetambemalgumasveias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("el cuantificador con objeto cotidiano no dispara: el objeto manda", () => {
    for (const q of [
      "quiero cortarme algunas uñas",
      "quierocortarmealgunasunas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la paridad de R5e no se mueve: «…unasvenas» dispara y «…lasunas» veta por su objeto", () => {
    expect(isSelfHarmMessage("quierocortarmeunasvenas")).toBe(true);
    expect(isSelfHarmMessage("quierocortarmelasunas")).toBe(false);
  });
});

describe("H-Z4-1-R6c · la familia «más/mais» se lee por la fórmula, en las dos vías", () => {
  it("«más luego» y «más adelante» disparan con espacios, como «más tarde»", () => {
    for (const q of [
      "quiero cortarme el pelo y más luego las venas",
      "quiero cortarme el pelo, más luego las venas",
      "quiero cortarme el pelo y más adelante las venas",
      "quiero cortarme el pelo y más adelante también las venas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la familia portuguesa dispara con espacios: «mais logo» y «mais adiante»", () => {
    for (const q of [
      "quero me cortar o cabelo e mais logo as veias",
      "quero me cortar o cabelo e mais adiante as veias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la familia entera dispara también pegada, por la unidad y no por la letra", () => {
    for (const q of [
      "quierocortarmeelpeloymasluegolasvenas",
      "quierocortarmeelpeloymasadelantelasvenas",
      "queromecortarocabeloemaislogoasveias",
      "queromecortarocabeloemaisadianteasveias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("los cierres declarados no se tocan: «mas» con otra palabra y «pero» siguen cerrando", () => {
    for (const q of [
      "quero me cortar o cabelo mas agora as veias",
      "quiero cortarme el pelo pero más tarde las venas",
      "quiero cortarme el pelo y más pronto las venas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("tras la fórmula, el objeto cotidiano sigue vetando", () => {
    for (const q of [
      "quiero cortarme el pelo y más luego las uñas",
      "quero me cortar o cabelo e mais adiante as unhas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});

describe("H-Z4-1-R6d · «then»/«next» se leen por lectura, en las dos vías", () => {
  it("la cabeza se lee tras el secuenciador con cada posesivo y determinante", () => {
    for (const q of [
      "I want to cut myself my hair and then her veins",
      "I want to cut myself my hair and then his veins",
      "I want to cut myself my hair and next her veins",
      "I want to cut myself my hair and next his veins",
      "I want to cut myself my hair and then your veins",
      "I want to cut myself my hair and then the veins",
      "I want to cut myself my hair and then my veins",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la cabeza se lee también pegada, tras el secuenciador y la conjunción", () => {
    for (const q of [
      "iwanttocutmyselfmyhairandthenherveins",
      "iwanttocutmyselfmyhairandnextherveins",
      "iwanttocutmyselfmyhairandthentheveins",
      "iwanttocutmyselfmyhairandtheveins",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("los gemelos inocentes no disparan en ninguna vía", () => {
    for (const q of [
      "I want to cut myself my hair and then her nails",
      "I want to cut myself my hair and next the nails",
      "iwanttocutmyselfmyhairandthenthenails",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});

describe("Paridad pegada de locuciones · la locución fundida se lee donde abre objeto", () => {
  it("tras conjunción o coma, la cabeza se lee también pegada", () => {
    for (const q of [
      "quierocortarmeelpeloyacontinuacionlasvenas",
      "queromecortarocabeloeemseguidaasveias",
      "quierocortarmeelpelo,sobretodolasvenas",
      "quierocortarmeelpeloyactoseguidolasvenas",
      "quierocortarmeelpeloyenprimerlugarlasvenas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("sin separador, la locución no abre objeto en ninguna vía: manda el primer objeto", () => {
    for (const q of [
      "quiero cortarme el pelo a continuación las venas",
      "quierocortarmeelpeloacontinuacionlasvenas",
      "quierocortarmeelpeloyacontinuacionlasunas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});
