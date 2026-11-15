/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-41 (residuo de la ronda 9 de Z-01,
 * ACTA-z01-r9 §4): T-40 llevó las seis cabezas de raíz
 * interna («antebrazo», «antebrazos», «antebraco»,
 * «antebracos», «forearm», «forearms») a la lectura por
 * su raíz al inicio en posición de objeto, y su
 * comentario afirmó que ya no dependían del accidente
 * de letra. La repetición lo midió un anillo más
 * afuera y la afirmación no aguantó: la aparición
 * INTERIOR de las mismas raíces («braz»/«brac»/«arm»
 * tras «ante»/«fore», acabados en «e») seguía
 * rescatando por el test de frontera de letra desde
 * las posiciones donde la lectura no opera, el
 * complemento fundido sin determinante y la fusión
 * sobre el objeto anterior, donde la vía con espacios
 * veta porque manda su primer objeto (16 casos con
 * expectativa). Esta regresión fija la cura y su
 * freno:
 *
 * - H-Z4-1-R9a (grave, atribución): la puerta de sitio
 *   no acepta una aparición estrictamente interior a
 *   una palabra de la clase (`gluedStemIsInterior`:
 *   una cabeza de CUT_HARM_HEADS deletreada desde un
 *   índice anterior que la contiene entera). Esas
 *   posiciones vetan en paridad en las dos grafías
 *   (la grafía con espacios solo disparaba por esta
 *   misma sombra pegada).
 * - El freno de la puerta: la cubierta es la palabra
 *   deletreada, no cualquier aparición de raíz. Una
 *   raíz también aparece cruzando palabras («the» +
 *   «arm» deletrea «ear» desde la «e» del
 *   determinante), y la forma que saltaba toda
 *   aparición interior a otra raíz cortó casos fieles
 *   medidos por esta tanda: «the arm» y «the artery»
 *   tras «and then» dejaban de disparar, porque su
 *   raíz abre su palabra y rebasa la «ear» espuria.
 *   La lectura en posición de objeto y la geometría
 *   de «the» + cabeza quedan fijadas disparando.
 * - Los declarados no se mueven: «whose» y «forehead»
 *   siguen por la letra declarada («forehead» no es
 *   cabeza de la clase: su «head» no es aparición
 *   interior a una palabra de la clase), y el
 *   discriminador «desarmado» y «blockhead» siguen
 *   sin rescatar.
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage } from "./safetyAnswers";

const g = (s: string) => s.replace(/ /g, "");

describe("H-Z4-1-R9a · el complemento y la fusión no rescatan por la raíz interior", () => {
  it("las seis cabezas como complemento fundido sin determinante vetan en paridad, en las tres lenguas y las dos grafías", () => {
    for (const q of [
      "quiero cortarme las uñas del antebrazo",
      "quiero cortarme las uñas del antebrazos",
      "quero cortar-me as unhas do antebraço",
      "quero cortar-me as unhas do antebraços",
      "I want to cut myself the nails of the forearm",
      "I want to cut myself the nails of the forearms",
      // Hermanas: el complemento de otros objetos
      // cotidianos, y el complemento con «de los».
      "quiero cortarme la barba del antebrazo",
      "quero cortar-me a barba do antebraço",
      "quero cortar-me o cabelo do antebraço",
      "I want to cut myself the beard of the forearm",
      "I want to cut myself my nails of the forearms",
      "quiero cortarme las uñas de los antebrazos",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
      expect(isSelfHarmMessage(g(q)), g(q)).toBe(false);
    }
  });

  it("fundidas sobre el objeto anterior, sin conjunción, vetan en paridad", () => {
    for (const q of [
      "quiero cortarme el pelo antebrazo",
      "I want to cut myself my hair forearm",
      "quiero cortarme la barba antebrazo",
      "I want to cut myself the beard forearm",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
      expect(isSelfHarmMessage(g(q)), g(q)).toBe(false);
    }
  });
});

describe("H-Z4-1-R9a · el freno de la puerta: la lectura no se corta", () => {
  it("las seis cabezas en posición de objeto disparan por su raíz al inicio, en las dos grafías", () => {
    for (const q of [
      "quiero cortarme el pelo y el antebrazo",
      "quero cortar-me o cabelo e o antebraço",
      "quero cortar-me o cabelo e os antebraços",
      "I want to cut myself my hair and then the forearm",
      "I want to cut myself my hair and the forearms",
      "quiero cortarme algunos antebrazos",
      "quiero cortarme el pelo, el antebrazo",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
      expect(isSelfHarmMessage(g(q)), g(q)).toBe(true);
    }
  });

  it("la geometría de «the» + cabeza dispara pegada: la raíz abre su palabra y rebasa la «ear» que cruza el determinante", () => {
    for (const q of [
      "I want to cut myself my hair and then the arm",
      "I want to cut myself my hair and then the arms",
      "I want to cut myself my hair and then the artery",
      "I want to cut myself my hair and then the arteries",
      "I want to cut myself my hair and then the ear",
      "I want to cut myself my hair and then the ears",
      "I want to cut myself my hair and then the eye",
    ]) {
      expect(isSelfHarmMessage(g(q)), g(q)).toBe(true);
    }
  });
});

describe("H-Z4-1-R9a · los declarados y los discriminadores, como están", () => {
  it("«whose» y «forehead» siguen por la letra declarada; «desarmado» y «blockhead» no rescatan", () => {
    expect(
      isSelfHarmMessage("iwanttocutmyselfmyhairandthenwhoseveins"),
    ).toBe(true);
    expect(
      isSelfHarmMessage("iwanttocutmyselfmyhairandtheforehead"),
    ).toBe(true);
    expect(
      isSelfHarmMessage("iwanttocutmyselfmyhairandtheblockhead"),
    ).toBe(false);
    expect(isSelfHarmMessage("quierocortarmelasuñasdeldesarmado")).toBe(
      false,
    );
    expect(isSelfHarmMessage("quierocortarmeelpeloyeldesarmado")).toBe(
      false,
    );
  });
});
