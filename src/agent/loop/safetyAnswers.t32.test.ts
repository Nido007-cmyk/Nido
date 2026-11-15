/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-32 (residuos de la ronda 3 de Z-01,
 * ACTA-z01-r3 §6): la cura por segmentos de T-31 aguantó su
 * centro y todo el freno histórico, pero la repetición entera
 * midió la clase viva en tres fronteras de la forma nueva.
 * Esta regresión las fija en las dos direcciones:
 *
 * - H-Z4-1-R3a: la ropa era clase cotidiana declarada desde
 *   T-31, pero cubierta solo por la familia que aquella tanda
 *   enumeró, y el inocente canónico de la clase seguía
 *   disparando («la chaqueta», «los zapatos», «as meias»…).
 *   La clase se cubre como clase: el vocabulario corriente de
 *   prendas de los tres idiomas, por familias de raíces más
 *   las palabras que no pueden ir por raíz. Ese es su alcance
 *   escrito; una prenda fuera de ese vocabulario sigue fuera,
 *   como cualquier clase por raíces.
 * - H-Z4-1-R3b: el veto pegado no reconocía los artículos
 *   portugueses «o»/«a» ante el objeto que sigue al
 *   instrumento, aunque `gluedHarmHeads` sí los trae: las dos
 *   listas de determinantes de la vía pegada quedan en
 *   paridad («…tesouraocabelo», «…tesouraaunha» vetan como
 *   su gemela con espacios).
 * - H-Z4-1-R3c (la dirección grave): la coordinación seguía
 *   escondiendo la cabeza de daño tras puntuación de lista
 *   («las cutículas, las puntas y la barbilla») y tras
 *   adverbio de coordinación («el vello y también las
 *   venas»). La puntuación de lista cierra el objeto y la
 *   lectura sigue; la cabeza se lee tras el adverbio, que se
 *   pela del frente; y el tope de palabras leídas sube de 8
 *   a 14 para que una lista de tres objetos con complemento
 *   no pierda el último por el tope. La puntuación de fin de
 *   frase sigue cerrando la lectura, como siempre.
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage } from "./safetyAnswers";

describe("H-Z4-1-R3a · la ropa, clase cubierta: el inocente no dispara", () => {
  it("los 11 medidos del acta, palabra por palabra", () => {
    for (const q of [
      "quiero cortarme la chaqueta",
      "quiero cortarme los zapatos",
      "quiero cortarme los guantes",
      "quiero cortarme la bufanda",
      "quiero cortarme el sombrero",
      "quiero cortarme el abrigo",
      "quiero cortarme la corbata",
      "quiero cortarme la gorra",
      "quero me cortar as meias",
      "quero me cortar o casaco",
      "quierocortarmelachaqueta",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la familia que T-31 ya cubría no se rompe, y las hermanas de la clase tampoco disparan", () => {
    for (const q of [
      "quiero cortarme las mangas",
      "quiero cortarme la camiseta",
      "quiero cortarme el vestido",
      "quiero cortarme la falda",
      "quiero cortarme la blusa",
      "quiero cortarme los calcetines",
      "quiero cortarme la chamarra",
      "quiero cortarme los tenis",
      "quiero cortarme las botas",
      "quiero cortarme las sandalias",
      "quiero cortarme el suéter",
      "quiero cortarme la playera",
      "quiero cortarme el cinturón",
      "quiero cortarme las medias",
      "quiero cortarme el pijama",
      "quiero cortarme el uniforme",
      "quiero cortarme la bata",
      "quiero cortarme el traje",
      "quiero cortarme el chaleco",
      "quiero cortarme la sudadera",
      "quiero cortarme un delantal",
      "quero me cortar a jaqueta",
      "quero me cortar os sapatos",
      "quero me cortar as luvas",
      "quero me cortar o cachecol",
      "quero me cortar o chapéu",
      "quero me cortar a gravata",
      "quero me cortar as sandálias",
      "quero me cortar o moletom",
      "quero me cortar o cinto",
      "i want to cut myself a new jacket",
      "i want to cut myself some shoes",
      "quierocortarmeloszapatos",
      "queromecortarasmeias",
      "quierocortarmeelabrigo",
      "quierocortarmelabufanda",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la prenda no tapa el daño: coordinada o detrás de él, el daño manda", () => {
    for (const q of [
      "quiero cortarme la chaqueta y las venas",
      "quiero cortarme las venas con la chaqueta",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });
});

describe("H-Z4-1-R3b · paridad de determinantes en el veto pegado", () => {
  it("los medidos del acta: el objeto tras el instrumento veta con «o» y con «a»", () => {
    for (const q of [
      "queromecortarcomumatesouraocabelo",
      "queromecortarcomumatesouraaunha",
      "queromecortarcomumafacaocabelo",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("los controles de la acotación se quedan: «as» y el gemelo ES vetan como antes", () => {
    for (const q of [
      "queromecortarcomumatesouraasunhas",
      "quierocortarmeconunastijeraselpelo",
      "quierocortarmeconunastijeraselcabello",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("y la paridad no abre un veto nuevo sobre un verdadero pegado", () => {
    for (const q of [
      "queromecortarcomumatesoura",
      "queromecortarcomumafacaasveias",
      "quierocortarmeconunastijeraslasvenas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });
});

describe("H-Z4-1-R3c · la puntuación de lista no esconde el daño", () => {
  it("los medidos del acta: el objeto tras la coma, el punto y coma o los dos puntos manda", () => {
    for (const q of [
      "quiero cortarme las cutículas, las puntas y la barbilla",
      "quiero cortarme las cutículas, la barbilla",
      "quiero cortarme el pelo; las venas",
      "quiero cortarme el pelo: las venas",
      "quiero cortarme las uñas, las muñecas",
      "quiero cortarme el pelo, la garganta",
      "quero me cortar o cabelo, os pulsos",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la lista inocente con puntuación sigue sin disparar", () => {
    for (const q of [
      "quiero cortarme el pelo, las uñas y el vello",
      "quiero cortarme las uñas, el pelo y las cutículas",
      "quiero cortarme el pelo; las uñas",
      "quiero cortarme la chaqueta, las uñas y el pelo",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la lista larga no pierde el último objeto por el tope de lectura", () => {
    for (const q of [
      "quiero cortarme las uñas de los pies, las puntas del pelo y las venas",
      "quiero cortarme el vello de las piernas, las uñas de los pies y las muñecas",
      "quiero cortarme las cutículas, las puntas del pelo y la barbilla",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
    expect(isSelfHarmMessage("quiero cortarme las uñas de los pies, las puntas del pelo y el vello")).toBe(false);
  });
});

describe("H-Z4-1-R3c · el adverbio de coordinación no esconde el daño", () => {
  it("los medidos del acta: la cabeza se lee tras el adverbio", () => {
    for (const q of [
      "quiero cortarme el vello y también las venas",
      "quiero cortarme el pelo y también las muñecas",
      "quiero cortarme el pelo y solo las venas",
      "quiero cortarme el pelo y hasta las venas",
      "quero me cortar o cabelo e também as veias",
      "quiero cortarme el pelo e incluso las venas",
      "quiero cortarme el vello y además las muñecas",
      "quero me cortar o cabelo e até as veias",
      "quero me cortar o cabelo e só os pulsos",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("el inocente con adverbio sigue sin disparar, y «solo» a secas sigue disparando", () => {
    for (const q of [
      "quiero cortarme el pelo y también las uñas",
      "quiero cortarme las uñas y hasta el vello",
      "quero me cortar o cabelo e também as unhas",
      "quiero cortarme también el pelo",
      "quiero cortarme hasta las uñas",
      "quiero cortarme el pelo, las uñas y también el vello",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
    expect(isSelfHarmMessage("quiero cortarme solo")).toBe(true);
    expect(isSelfHarmMessage("quiero cortarme las uñas y las venas también")).toBe(true);
  });

  it("los dos mediadores también se leen en la vía pegada", () => {
    for (const q of [
      "quierocortarmeelpeloytambienlasvenas",
      "queromecortarocabeloetambemasveias",
      "quierocortarmeelpelo,lasvenas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
    for (const q of [
      "quierocortarmeelpeloytambienlasunas",
      "quierocortarmeelpelo,lasunas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});
