// Tanda de variantes de la casa, Familia 7 (salud restante):
// las tres formas que el censo dejó medidas fuera de la puerta
// de salud sin tocar la cura de «hurt» del bloque 2, que queda
// intacta: la «coceira» portuguesa (38 frases del corpus, 8
// sujetos de una sola base), el mareo y el tonto contados con
// el adjetivo («me siento mareado», «estou tonto»), que tenían
// el sustantivo («mareo», «tontura») pero no su forma, y el
// «cold» inglés como sustantivo, que entra solo con su
// determinante («a cold»), como las formas de ingestión de la
// lista: el frío del tiempo no es salud. La forma de errata de
// «coceira» entra en la misma batería: al entrar la palabra en
// el vocabulario, la reparación de la Familia 5 la repone.
import { describe, expect, it } from "vitest";
import { isHealthQuestion } from "./emergencyGate";

const declara = (frases: string[]) => {
  for (const q of frases) {
    it(`declara: ${q}`, () => {
      expect(isHealthQuestion(q), q).toBe(true);
    });
  }
};
const noDeclara = (frases: string[]) => {
  for (const q of frases) {
    it(`no declara: ${q}`, () => {
      expect(isHealthQuestion(q), q).toBe(false);
    });
  }
};

describe("variantes F7 · coceira, el adjetivo de mareo y el «cold» sustantivo", () => {
  declara([
    "meu filho tem coceira na pele",
    "minha filha tem coceira na pele",
    "estou com coceira na pele",
    "meu filho tem cceira na pele",
    "me siento mareado y el corazón me late muy rápido",
    "me siento mareada",
    "estou tonto e meu coração está acelerado",
    "estou tonta",
    "what should I take for a cold",
    "my son has a cold, what can I give him",
  ]);
});

describe("variantes F7 · guardas: el frío del tiempo no es salud", () => {
  noDeclara(["is it cold outside today", "cold water is better after running", "que frio está hoje"]);
});
