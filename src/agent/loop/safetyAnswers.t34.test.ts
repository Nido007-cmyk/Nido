/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-34 (residuos de la ronda 4 de Z-01,
 * ACTA-z01-r4 §7): la cura de T-32 aguantó su centro y todo
 * el freno histórico, pero la repetición entera midió la
 * clase viva un anillo más afuera, en cuatro fronteras.
 * Esta regresión las fija en las dos direcciones:
 *
 * - H-Z4-1-R4a: el vocabulario de la ropa dejaba fuera
 *   prendas canónicas de los tres idiomas (vaqueros,
 *   cazadora, sneakers, sutiã…) y el inocente canónico
 *   seguía disparando. Entran sus familias y palabras en
 *   las dos vías. La frontera del alcance escrito queda
 *   fijada también: las prendas arcaicas o de oficio que
 *   la ronda midió fuera (jubón, casulla) siguen fuera.
 * - H-Z4-1-R4b (dirección grave): los secuenciadores
 *   corrientes de enumeración (luego, después, encima,
 *   aún; depois, ainda, logo) se leían como cabeza y
 *   escondían el daño. Se pelan del frente como los
 *   adverbios de coordinación.
 * - H-Z4-1-R4c (dirección grave): el pelado del frente se
 *   agotaba a las 3 palabras con la pila corriente de
 *   mediadores, y «até mesmo» no se pelaba en ninguna
 *   vía. El pelado recorre todo el frente funcional y la
 *   vía pegada pela «mesmo» y encadena los mediadores.
 * - H-Z4-1-R4d (dirección grave): las cotas de lectura
 *   (14 palabras; ventana pegada de 30) perdían la cabeza
 *   en la enumeración corriente larga. El tope sube a 20
 *   palabras y la ventana pegada a 40 caracteres, con su
 *   frontera escrita en el código.
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage } from "./safetyAnswers";

describe("H-Z4-1-R4a · la ropa canónica del anillo siguiente no dispara", () => {
  it("los 25 medidos del acta, palabra por palabra", () => {
    for (const q of [
      "quiero cortarme los vaqueros",
      "quiero cortarme la cazadora",
      "quiero cortarme las chanclas",
      "quiero cortarme los calzoncillos",
      "quiero cortarme el bañador",
      "quiero cortarme las mallas",
      "quiero cortarme los leggins",
      "quiero cortarme el sujetador",
      "quiero cortarme los mocasines",
      "quiero cortarme el chándal",
      "quiero cortarme las alpargatas",
      "quiero cortarme las pantuflas",
      "quero me cortar o boné",
      "quero me cortar o terno",
      "quero me cortar o chinelo",
      "quero me cortar a cueca",
      "quero me cortar o sutiã",
      "quero me cortar a pantufa",
      "i want to cut myself my sneakers",
      "i want to cut myself my sandals",
      "i want to cut myself my pajamas",
      "i want to cut myself my leggings",
      "i want to cut myself my swimsuit",
      "quierocortarmelosvaqueros",
      "queromecortarobone",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("las hermanas de las familias nuevas tampoco disparan", () => {
    for (const q of [
      "quiero cortarme las vaqueras",
      "quiero cortarme unas chanclas de playa",
      "quiero cortarme los calzones",
      "quiero cortarme una cazadora de cuero",
      "quero me cortar os chinelos",
      "quero me cortar as cuecas",
      "i want to cut myself my new sneakers",
      "quiero cortarme las sandalias",
      "quiero cortarme el pijama y las pantuflas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la frontera del alcance escrito queda donde el acta la midió", () => {
    // Fuera de «las prendas corrientes» del vocabulario: las
    // prendas arcaicas o de oficio siguen sin vetar, como
    // cualquier clase por raíces fuera de su vocabulario.
    for (const q of ["quiero cortarme el jubón", "quiero cortarme la casulla"]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la prenda nueva no tapa el daño: coordinado con él, el daño manda", () => {
    for (const q of [
      "quiero cortarme los vaqueros y las venas",
      "quiero cortarme las venas y los vaqueros",
      "quero me cortar o boné e as veias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });
});

describe("H-Z4-1-R4b · el secuenciador de enumeración no esconde el daño", () => {
  it("los 8 medidos del acta: la cabeza se lee tras el secuenciador", () => {
    for (const q of [
      "quiero cortarme el pelo y luego las venas",
      "quiero cortarme el pelo y después las venas",
      "quiero cortarme el pelo y encima las venas",
      "quiero cortarme el pelo y aún las venas",
      "quiero cortarme el pelo, luego las venas",
      "quero me cortar o cabelo e depois as veias",
      "quero me cortar o cabelo e ainda as veias",
      "quero me cortar o cabelo e logo as veias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("el inocente con los mismos secuenciadores sigue sin disparar", () => {
    for (const q of [
      "quiero cortarme el pelo y luego las uñas",
      "quiero cortarme el pelo y después el flequillo",
      "quero me cortar o cabelo e depois as unhas",
      "quero me cortar o cabelo e ainda as pontas",
      "quiero cortarme el pelo, luego las uñas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});

describe("H-Z4-1-R4c · la pila de mediadores no agota el pelado; «até mesmo» se pela", () => {
  it("los 4 medidos del acta, en las dos vías", () => {
    for (const q of [
      "quiero cortarme el pelo y hasta incluso también las venas",
      "quiero cortarme el pelo y solo hasta incluso las venas",
      "quero me cortar o cabelo e até mesmo as veias",
      "queromecortarocabeloeatemesmoasveias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("los que hoy disparan con dos adverbios no se rompen, y el inocente de la pila tampoco dispara", () => {
    for (const q of [
      "quiero cortarme el pelo y además también las venas",
      "quiero cortarme el pelo y también solo las venas",
      "quiero cortarme el pelo y incluso hasta las venas",
      "quero me cortar o cabelo e também só as veias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
    expect(isSelfHarmMessage("quiero cortarme el pelo y hasta incluso también las uñas")).toBe(false);
    expect(isSelfHarmMessage("quero me cortar o cabelo e até mesmo as unhas")).toBe(false);
  });
});

describe("H-Z4-1-R4d · las cotas de lectura no pierden la cabeza de la enumeración larga", () => {
  it("los medidos del acta: la cabeza como 15ª palabra y su gemela pegada mandan", () => {
    for (const q of [
      "quiero cortarme las uñas de los pies, las puntas del pelo, el vello de las piernas y las venas",
      "quierocortarmelaspuntasdelpeloytambienlasvenas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("las acotaciones que ya entraban no se mueven, y el inocente sobre la cota no dispara", () => {
    for (const q of [
      "quiero cortarme las uñas de los pies, las puntas del pelo y las venas",
      "quiero cortarme el vello de las piernas, las uñas de los pies y las venas",
      "quiero cortarme el pelo de la cabeza, las uñas de los pies, las puntas y las venas",
      "quierocortarmeelpelo,laspuntasylasvenas",
      "quierocortarmeelpeloytambienlasvenas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
    expect(
      isSelfHarmMessage("quiero cortarme las uñas de los pies, las puntas del pelo, el vello de las piernas y las uñas"),
    ).toBe(false);
  });
});
