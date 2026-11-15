/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-39 (residuos de la ronda 7 de Z-01,
 * ACTA-z01-r7 §5): la cura de T-37 aguantó su centro
 * entero y todo el freno histórico, y la repetición midió
 * la misma forma enumerativa un anillo más afuera en las
 * dos listas que la cura tocó. Las dos se curan dejando
 * de enumerar dos veces la misma clase: cada conjunto
 * pegado se deriva de la constante que nombra su clase.
 * Esta regresión las fija en las dos direcciones:
 *
 * - H-Z4-1-R7a (grave): la familia de cuantificadores
 *   pegados traía solo la de «alguna-» y el cuantificador
 *   negativo perdía el verdadero pegado
 *   («quierocortarmeningunasvenas»): su cola es el mismo
 *   «unas» cotidiano que veta la corrida y la familia
 *   escrita no lo pelaba como unidad. La clase vive en
 *   CUT_QUANTIFIERS (indefinidos y negativos es/pt, con
 *   las apocopadas plegadas) y la regex pegada se deriva
 *   de ella. El freno de R5e/R6b no se mueve: el
 *   cuantificador con objeto cotidiano veta y la cola de
 *   palabra de contenido sigue sin pelarse.
 * - H-Z4-1-R7b (grave): la lista de determinantes
 *   pegados traía los artículos y cuatro ingleses donde
 *   CUT_DETERMINERS lee posesivos y determinantes en las
 *   tres lenguas. La regex pegada se deriva de
 *   CUT_DETERMINERS y la del adjunto de su conjunto
 *   completo: «and then your veins», «y mis venas», «e
 *   minhas veias» disparan pegados por lectura (acaban
 *   en «r»/«s», donde el test de frontera de letra no
 *   puede rescatarlos), los inocentes con posesivo vetan
 *   en las dos vías, y el objeto tras el instrumento se
 *   reconoce tras «the» también en inglés pegado.
 * - El discriminador «whose», declarado: no está en
 *   ningún conjunto y dispara pegado por el test de
 *   frontera de letra, un sobre-disparo sobre una cabeza
 *   de daño (la dirección segura). Se fija con su
 *   declaración: ningún determinante del conjunto
 *   compartido depende ya de esa letra, y la lectura de
 *   «some» (que acaba en «e») se prueba en la rama del
 *   adjunto, donde la letra no opera.
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage } from "./safetyAnswers";

describe("H-Z4-1-R7a · la clase de cuantificadores entera se pela pegada", () => {
  it("el cuantificador negativo dispara pegado, como su gemela con espacios", () => {
    for (const q of [
      "quiero cortarme ningunas venas",
      "quierocortarmeningunasvenas",
      "quierocortarmeningunavenas",
      "quierocortarmeningunosdedos",
      "queromecortarnenhumasveias",
      "queromecortarnenhumaveia",
      "queromecortarnenhunsdedos",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("el cuantificador se pela también tras mediador y con las apocopadas plegadas", () => {
    for (const q of [
      "quierocortarmeelpeloytambienningunasvenas",
      "queromecortarocabeloetambemnenhumasveias",
      "quierocortarmeningunbrazo",
      "quierocortarmealgunbrazo",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("el cuantificador con objeto cotidiano veta: el objeto manda", () => {
    for (const q of [
      "quierocortarmeningunasunas",
      "queromecortarnenhumasunhas",
      "quierocortarmealgunovello",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });
});

describe("H-Z4-1-R7b · los determinantes pegados derivan del conjunto con espacios", () => {
  it("los posesivos y determinantes nuevos se leen pegados en las tres lenguas", () => {
    for (const q of [
      "Iwanttocutmyselfmyhairandthenyourveins",
      "Iwanttocutmyselfmyhairandthentheirveins",
      "Iwanttocutmyselfmyhairandthenourveins",
      "Iwanttocutmyselfmyhairandthenanankle",
      "quierocortarmeelpeloymisvenas",
      "quierocortarmeelpeloysolomisvenas",
      "quierocortarmeelpeloyunosdedos",
      "queromecortarocabeloeminhasveias",
      "queromecortarocabeloemeuspulsos",
      "queromecortarocabeloetuaveia",
      "queromecortarocabeloesuaveia",
      "queromecortarocabeloeunsdedos",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("los inocentes con los determinantes nuevos vetan en las dos vías", () => {
    for (const q of [
      "I want to cut myself my hair and then your nails",
      "Iwanttocutmyselfmyhairandthenyournails",
      "Iwanttocutmyselfmyhairandthenournails",
      "quierocortarmeelpeloymisunas",
      "queromecortarocabeloeminhasunhas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la rama del adjunto reconoce el objeto tras cualquier determinante del conjunto", () => {
    for (const q of [
      "Iwanttocutmyselfwithaknifethehair",
      "Iwanttocutmyselfwithaknifeyourhair",
      // La lectura de «some» se prueba aquí: en esta rama
      // no opera el test de frontera de letra, así que el
      // veto solo puede venir de leer el determinante.
      "Iwanttocutmyselfwithaknifesomehair",
      "I want to cut myself with a knife the hair",
      "queromecortarcomumatesouraocabelo",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("el discriminador «whose» queda fijado como frontera declarada de letra", () => {
    // «Whose» no está en ningún conjunto: dispara pegado
    // por el test de frontera de letra (la conjunción de
    // una letra fusionada), un sobre-disparo sobre una
    // cabeza de daño. Si ese test cambia, este caso se
    // re-decide con su medición, no se cuela.
    expect(
      isSelfHarmMessage("Iwanttocutmyselfmyhairandthenwhoseveins"),
    ).toBe(true);
  });

  it("la paridad es con el conjunto compartido tal como está escrito («essas» queda fuera en las dos vías)", () => {
    // CUT_DETERMINERS trae «estes»/«estas» para el plural
    // demostrativo, no «essas»: su frase veta con espacios
    // y pegada, en paridad.
    for (const q of [
      "quero me cortar o cabelo e essas veias",
      "queromecortarocabeloeessasveias",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
    for (const q of [
      "quiero cortarme el pelo y estas venas",
      "quierocortarmeelpeloyestasvenas",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });
});
