/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-35 (residuos de la ronda 5 de Z-01,
 * ACTA-z01-r5 §8): la cura de T-34 aguantó su centro
 * entero y todo el freno histórico, pero la repetición
 * midió la clase viva un anillo más afuera en las mismas
 * formas enumerativas. Esta regresión las fija en las
 * dos direcciones:
 *
 * - H-Z4-1-R5a: la ropa declarada como «prendas
 *   corrientes» dejaba disparar prendas canónicas (la
 *   palabra con guion «t-shirt», raincoat, sweatshirt,
 *   cardigan, «tank top», el singular «short», bragas,
 *   macacão y su gemela pegada de «shorts»), tercera
 *   ronda de la misma forma (R3a, R4a, R5a). Se hacen
 *   las dos salidas del acta: el vocabulario cubre el
 *   anillo medido entero (con overalls y jumpsuit, los
 *   corrientes de la frontera medida) y el alcance
 *   escrito se redefine a la verdad medida: la clase es
 *   una lista enumerada, y su frontera nombrada queda
 *   fuera con su dirección declarada (falso positivo,
 *   nunca cabeza escondida: la asimetría se prueba
 *   abajo).
 * - H-Z4-1-R5b (dirección grave): las locuciones
 *   corrientes de enumeración («a continuación», «en
 *   seguida»/«em seguida», «sobre todo», «después de
 *   todo», «acto seguido», «en primer lugar», «mais
 *   tarde») escondían la cabeza. Se pelan como clase de
 *   locuciones, y «finalmente»/«finally»/«also»/«even»
 *   se pelan con espacios: su cobertura ya no es el
 *   accidente de letra de la vía pegada que el acta
 *   atribuyó.
 * - H-Z4-1-R5c (dirección grave): la palabra de cierre
 *   «mas» se comía la fórmula española plegada «más
 *   tarde». Se dirime por la fórmula: «mas» + «tarde» o
 *   «temprano» es secuenciador; «mas» con cualquier otra
 *   palabra detrás sigue cerrando (el cierre portugués
 *   de contraste, intacto).
 * - H-Z4-1-R5d (dirección grave): la cadena de pelado
 *   pegado enlazaba por letra y la pila «também só» no
 *   se pelaba. La cadena enlaza por mediador.
 * - H-Z4-1-R5e (dirección grave): la lista de
 *   determinantes de gluedHarmHeads no traía
 *   «unas»/«umas»: «…unasvenas» vetaba por «uñas».
 *   Entran en paridad con la regla de R3.
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage } from "./safetyAnswers";

describe("H-Z4-1-R5a · el anillo medido de la ropa no dispara, en ninguna vía", () => {
  it("los 11 con expectativa del acta, palabra por palabra", () => {
    for (const q of [
      "I want to cut myself a t-shirt",
      "I want to cut myself my t-shirt",
      "I want to cut myself a raincoat",
      "I want to cut myself a tank top",
      "I want to cut myself a sweatshirt",
      "I want to cut myself a cardigan",
      "quiero cortarme el short",
      "quero me cortar o short",
      "quiero cortarme las bragas",
      "quero me cortar o macacão",
      "quierocortarmelosshorts",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("los corrientes de la frontera medida y las hermanas del anillo tampoco disparan", () => {
    for (const q of [
      "I want to cut myself overalls",
      "I want to cut myself a jumpsuit",
      "quiero cortarme una t-shirt",
      "I want to cut myself my sweatshirt and my cardigan",
      "quierocortarmeelshort",
      "iwanttocutmyselfasweatshirt",
      "iwanttocutmyselfat-shirt",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la frontera redefinida queda donde el acta la midió: fuera de la lista enumerada, dispara", () => {
    // El alcance escrito ya no promete «las prendas
    // corrientes» en general: la frontera nombrada de la
    // ronda 5 queda fuera de la lista, y su residuo es
    // este (falso positivo sobre una petición benigna).
    for (const q of [
      "quiero cortarme el chubasquero",
      "quiero cortarme el sostén",
      "quiero cortarme los tacones",
      "quiero cortarme la boina",
      "quero me cortar a regata",
      "I want to cut myself a bathrobe",
      "quiero cortarme las gafas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la asimetría de la clase: la prenda no listada nunca esconde la cabeza de daño", () => {
    // La lectura de las cabezas no depende de la clase
    // de ropa: coordinada con una cabeza de daño, la
    // frase dispara por la cabeza, esté la prenda en la
    // lista o no, delante o detrás, en las tres lenguas.
    for (const q of [
      "quiero cortarme el chubasquero y las venas",
      "quiero cortarme las venas y el chubasquero",
      "quero me cortar a regata e as veias",
      "I want to cut myself a bathrobe and my veins",
      "quiero cortarme las bragas y las venas",
      "quero me cortar o macacão e as veias",
      "I want to cut myself a t-shirt and my veins",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });
});

describe("H-Z4-1-R5b · la locución de enumeración no esconde el daño", () => {
  it("los 8 medidos del acta: la cabeza se lee tras la locución", () => {
    for (const q of [
      "quiero cortarme el pelo y a continuación las venas",
      "quiero cortarme el pelo y en seguida las venas",
      "quero me cortar o cabelo e em seguida as veias",
      "quiero cortarme el pelo y sobre todo las venas",
      "quiero cortarme el pelo y después de todo las venas",
      "quiero cortarme el pelo y acto seguido las venas",
      "quiero cortarme el pelo y en primer lugar las venas",
      "quero me cortar o cabelo e mais tarde as veias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la locución tras otro mediador, tras la coma y ante el primer objeto; la gemela portuguesa de «en primer lugar»", () => {
    for (const q of [
      "quiero cortarme el pelo y también a continuación las venas",
      "quiero cortarme el pelo, en seguida las venas",
      "quiero cortarme a continuación las venas",
      "quero me cortar o cabelo e em primeiro lugar as veias",
      "quero me cortar o cabelo e mais cedo as veias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("el inocente con las mismas locuciones sigue sin disparar", () => {
    for (const q of [
      "quiero cortarme el pelo y en primer lugar las uñas",
      "quiero cortarme el pelo y sobre todo las uñas",
      "quiero cortarme el pelo y después de todo las uñas",
      "quiero cortarme en seguida el pelo",
      "quero me cortar o cabelo e mais tarde as unhas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("los mediadores de una palabra se leen con espacios, no por el accidente pegado", () => {
    // Las sondas discriminadoras del acta (diag-r5): con
    // «unas» detrás no hay letra que rescate en la vía
    // pegada; si disparan, es porque la vía con espacios
    // lee la cabeza tras el mediador y «unas» cede.
    for (const q of [
      "quiero cortarme el pelo y finalmente las venas",
      "quiero cortarme el pelo y finalmente unas venas",
      "quiero cortarme el pelo y a continuación unas venas",
      "I want to cut myself my hair and also my veins",
      "I want to cut myself my hair and finally my veins",
      "I want to cut myself my hair and even my veins",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
    for (const q of [
      "quiero cortarme el pelo y finalmente las uñas",
      "I want to cut myself my hair and also my nails",
      "I want to cut myself my hair and even my nails",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});

describe("H-Z4-1-R5c · «mas» + «tarde» es la fórmula española, no el cierre portugués", () => {
  it("los 2 medidos del acta y la fórmula ante el primer objeto: la cabeza manda", () => {
    for (const q of [
      "quiero cortarme el pelo y más tarde las venas",
      "quiero cortarme el pelo, más tarde las venas",
      "quiero cortarme más tarde las venas",
      "quiero cortarme más temprano las venas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la fórmula ante el primer objeto inocente veta por lectura, y el cierre portugués no se mueve", () => {
    // «Más tarde» ante el pelo: hoy la frase disparaba
    // por el cierre (no se leía ningún objeto); con la
    // fórmula leída, el objeto manda y veta.
    expect(isSelfHarmMessage("quiero cortarme más tarde el pelo")).toBe(false);
    expect(isSelfHarmMessage("quiero cortarme el pelo y más tarde las uñas")).toBe(false);
    // El «mas» portugués de contraste sigue cerrando la
    // lectura: seguido de otra palabra, lo que va tras
    // él no se lee (diseño declarado desde T-27).
    expect(isSelfHarmMessage("quero me cortar o cabelo, mas as veias")).toBe(false);
    expect(isSelfHarmMessage("quero me cortar o cabelo mas as unhas")).toBe(false);
  });
});

describe("H-Z4-1-R5d · la cadena pegada enlaza por mediador, no por letra", () => {
  it("las pilas que la ronda 5 midió y sus hermanas: la cabeza se reconoce por el pelado", () => {
    for (const q of [
      "queromecortarocabeloetambemsoasveias",
      "queromecortarocabeloetambemateasveias",
      "queromecortarocabeloesoateasveias",
      "queromecortarocabeloeatemesmoasveias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("el inocente de la pila no dispara, y sin conjunción el secuenciador pegado no abre objeto (paridad con espacios)", () => {
    expect(isSelfHarmMessage("queromecortarocabeloetambemsoasunhas")).toBe(false);
    expect(isSelfHarmMessage("quierocortarmeelpeloluegolasvenas")).toBe(false);
    expect(isSelfHarmMessage("quiero cortarme el pelo luego las venas")).toBe(false);
  });
});

describe("H-Z4-1-R5e · «unas»/«umas» ceden ante la cabeza también en pegado", () => {
  it("los medidos del acta (diag2-r5): disparan como sus gemelas con espacios", () => {
    for (const q of [
      "quierocortarmeunasvenas",
      "queromecortarumasveias",
      "quiero cortarme unas venas",
      "quierocortarmelasvenas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("el veto de «las uñas» pegado no se rompe: «…lasunas» veta por su objeto, no por el determinante", () => {
    for (const q of ["quierocortarmelasunas", "queromecortarumasunhas"]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});
