// Tanda de variantes de la casa, Familia 3 (caída, sin su cara de
// lugar, cerrada en el paso 4 del lote): la inmovilidad sin «se»
// («não consegue levantar», «cannot get up», «não levanta»), la
// anciana y la idosa caídas en el baño como contexto de la
// inmovilidad, y la caída narrada inglesa con «last week» /
// «last year», que declaraba por no estar en los bigramas de
// distancia. Cada frase de «declara» y cada «no declara» de la
// narrada estaban medidas al revés sobre la base de la tanda
// (rojo de nacimiento); las guardas de objeto estaban en falso.
import { describe, expect, it } from "vitest";
import { isEmergencySituation } from "./emergencyGate";

const declara = (frases: string[]) => {
  for (const q of frases) {
    it(`declara: ${q}`, () => {
      expect(isEmergencySituation(q), q).toBe(true);
    });
  }
};
const noDeclara = (frases: string[]) => {
  for (const q of frases) {
    it(`no declara: ${q}`, () => {
      expect(isEmergencySituation(q), q).toBe(false);
    });
  }
};

describe("variantes F3 · la inmovilidad sin «se» y la caída en el baño", () => {
  declara([
    "hay una anciana caída en el baño que no se puede levantar",
    "hay una anciana caída en el baño que no se puede levantar, ¿qué hago?",
    "por favor, hay una anciana caída en el baño que no se puede levantar",
    "há uma idosa caída no banheiro que não consegue levantar",
    "ela caiu e não consegue levantar",
    "ela caiu e não consegue levantar, o que eu faço?",
    "minha avó caiu e não levanta",
    "she fell and cannot get up",
    "she fell and cannot get up, what should I do?",
    "não consegue levantar",
    "cannot get up",
  ]);
});

describe("variantes F3 · la caída narrada con distancia en inglés no declara", () => {
  noDeclara([
    "my father fell in the kitchen last week and recovered",
    "my grandmother fell last year and broke her hip",
  ]);
});

describe("variantes F3 · guardas: el objeto y la costumbre no declaran", () => {
  noDeclara([
    "o funcionario não levanta cedo aos domingos",
    "ele não levanta a caixa pesada",
    "la puerta no se puede levantar",
  ]);
});
