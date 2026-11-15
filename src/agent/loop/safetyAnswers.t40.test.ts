/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-40 (residuos de la ronda 8 de Z-01,
 * ACTA-z01-r8 §5): T-39 derivó los cuantificadores y los
 * determinantes pegados de sus constantes compartidas, y
 * la repetición encontró la misma forma enumerativa en
 * la única lista de la vía pegada que quedaba sin
 * derivar: las raíces de daño, enumeradas aparte de las
 * cabezas que la vía con espacios lee. Esta regresión
 * las fija en las dos direcciones:
 *
 * - H-Z4-1-R8a (grave): `CUT_HARM_GLUED_STEMS` no
 *   cubría 36 palabras de `CUT_HARM_HEADS`: bajo un veto
 *   cotidiano en la misma corrida pegada, la cabeza no
 *   se reconocía y el verdadero se perdía («quiero
 *   cortarme el pelo y las manos» dictado sin espacios
 *   no disparaba). La lista se completó con decisión
 *   escrita por cabeza (ninguna raíz nueva es prefijo de
 *   ninguna palabra cotidiana de las listas) y las tres
 *   cabezas que ninguna raíz puede abrir sin rescatar
 *   al objeto que veta («pe», «pes», «leg») se leen
 *   como palabra entera desde la lista derivada de
 *   CUT_HARM_HEADS, con la guarda de la palabra
 *   cotidiana: la aparición no cuenta si la corrida en
 *   ese punto empieza por una raíz cotidiana.
 * - H-Z4-1-R8b (grave, atribución): «antebrazo» y su
 *   familia y «forearm» solo disparaban por el
 *   accidente de letra (su prefijo «ante»/«fore» acaba
 *   en «e»), sin declaración. Entran como raíces al
 *   inicio de su cabeza («antebraz», «antebrac»,
 *   «forearm»): se leen, y el discriminador de la
 *   misma geometría con consonante («desarmado»)
 *   sigue sin rescatar.
 * - La frontera de letra que queda, declarada como la
 *   de «whose»: la raíz «head» aparece a mitad de
 *   «forehead», tras un prefijo acabado en «e», y esa
 *   palabra, que no es cabeza de la clase, queda
 *   rescatada por la letra (sobre-disparo: la lectura
 *   con espacios veta por su primer objeto y la gemela
 *   pegada la rescata, como «venado»). Se fija con su
 *   declaración.
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage } from "./safetyAnswers";

const g = (s: string) => s.replace(/ /g, "");

describe("H-Z4-1-R8a · las cabezas sin raíz se reconocen pegadas bajo veto", () => {
  it("las familias nuevas disparan en la construcción de veto, en las tres lenguas y las dos grafías", () => {
    for (const q of [
      "quiero cortarme el pelo y la mano",
      "quiero cortarme el pelo y las manos",
      "quiero cortarme el pelo y el pecho",
      "quiero cortarme el pelo y el tendón",
      "quiero cortarme el pelo y los tendones",
      "quiero cortarme el pelo y la lengua",
      "quiero cortarme el pelo y la oreja",
      "quiero cortarme el pelo y las orejas",
      "quiero cortarme el pelo y la nariz",
      "quero cortar-me o cabelo e a mão",
      "quero cortar-me o cabelo e o peito",
      "quero cortar-me o cabelo e o tendão",
      "quero cortar-me o cabelo e o pé",
      "quero cortar-me o cabelo e os pés",
      "quero cortar-me o cabelo e o olho",
      "quero cortar-me o cabelo e a língua",
      "quero cortar-me o cabelo e a orelha",
      "I want to cut myself my hair and then the leg",
      "I want to cut myself my hair and then the legs",
      "I want to cut myself my hair and then the hand",
      "I want to cut myself my hair and then the face",
      "I want to cut myself my hair and then the head",
      "I want to cut myself my hair and then the foot",
      "I want to cut myself my hair and then the feet",
      "I want to cut myself my hair and then the artery",
      "I want to cut myself my hair and then the chest",
      "I want to cut myself my hair and then the eye",
      "I want to cut myself my hair and then the tongue",
      "I want to cut myself my hair and then the ear",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
      expect(isSelfHarmMessage(g(q)), g(q)).toBe(true);
    }
  });

  it("la cabeza corta se lee tras su complemento pegado y tras cuantificador", () => {
    for (const q of [
      "quero cortar-me o cabelo e o pé dele",
      "quiero cortarme algunas manos",
      "quiero cortarme las uñas y las orejas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
      expect(isSelfHarmMessage(g(q)), g(q)).toBe(true);
    }
  });
});

describe("H-Z4-1-R8a · el freno: ninguna raíz nueva rescata al objeto que veta", () => {
  it("las palabras cotidianas que comparten letras con las cabezas cortas siguen vetando pegadas", () => {
    for (const q of [
      // «pe» no rescata «pelo», «pelucas» ni «pedazo»;
      // «pes» no rescata «pestañas»; «leg» no rescata
      // «leggins»; «ear» a mitad de «beard» no rescata.
      "quiero cortarme el pelo",
      "quiero cortarme unas pelucas",
      "quiero cortarme un pedazo",
      "quero cortar-me um pedaço",
      "quiero cortarme las pestañas",
      "quiero cortarme algunas pestañas",
      "I want to cut myself the leggins",
      "I want to cut myself my hair and the leggins",
      "I want to cut myself the beard",
      "I want to cut myself my hair and the beard",
      "quiero cortarme el pelo y el desarmado",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
      expect(isSelfHarmMessage(g(q)), g(q)).toBe(false);
    }
  });
});

describe("H-Z4-1-R8b · las cabezas de mitad de palabra se leen por su raíz", () => {
  it("antebrazo y forearm disparan pegados, desnudos y bajo veto", () => {
    for (const q of [
      "quierocortarmeantebrazo",
      "iwanttocutmyselfforearm",
      "quiero cortarme el pelo y el antebrazo",
      "quiero cortarme el pelo y los antebrazos",
      "quero cortar-me o cabelo e o antebraço",
      "I want to cut myself my hair and then the forearm",
      "I want to cut myself my hair and then the forearms",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
      expect(isSelfHarmMessage(g(q)), g(q)).toBe(true);
    }
  });
});

describe("La frontera de letra declarada de «forehead»", () => {
  it("queda fijada con su declaración: dispara en las dos grafías por la gemela pegada", () => {
    // «Forehead» no es cabeza de CUT_HARM_HEADS: la
    // lectura con espacios veta por su primer objeto
    // («hair»), pero la raíz «head» aparece dentro de
    // la palabra tras un prefijo acabado en «e» y la
    // gemela pegada la rescata por el test de frontera
    // de letra, un sobre-disparo declarado en el
    // código con su dirección, como «venado» y como
    // «whose». Si ese test cambia, este caso se
    // re-decide con su medición, no se cuela.
    expect(
      isSelfHarmMessage("I want to cut myself my hair and the forehead"),
    ).toBe(true);
    expect(
      isSelfHarmMessage("iwanttocutmyselfmyhairandtheforehead"),
    ).toBe(true);
    // Sin objeto cotidiano delante no hay veto que
    // rescatar: dispara en las dos vías por su cuenta.
    expect(isSelfHarmMessage("I want to cut myself the forehead")).toBe(true);
  });
});
