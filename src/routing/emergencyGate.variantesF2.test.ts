// Tanda de variantes de la casa, Familia 2 (emergencia): el
// paradigma de convulsiones contado en presente simple, la base
// restante de la 2b del censo («she is not moving»), el «não se
// mexe» portugués y el parte telegráfico con la cortesía delante
// o la pregunta detrás, que rompía la forma. Cada frase de
// «declara» estaba medida en falso sobre la base de la tanda
// (rojo de nacimiento); cada guarda estaba en falso y sigue.
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

describe("variantes F2 · convulsiones: el presente simple con su paradigma de sujeto", () => {
  declara([
    "mi hijo tiene convulsiones",
    "mi hija tiene convulsiones",
    "mi bebé tiene convulsiones",
    "por favor, mi hijo tiene convulsiones",
    "mi hijo tiene convulsiones, ¿qué hago?",
    "my son is having seizures",
    "my daughter is having seizures",
    "please, my son is having seizures",
    "my son is having seizures, what should I do?",
    "meu filho está tendo convulsões",
    "minha filha está tendo convulsões",
    "por favor, meu filho está tendo convulsões",
    "meu filho está tendo convulsões, o que eu faço?",
  ]);
});

describe("variantes F2 · la base restante de la 2b y el «não se mexe»", () => {
  declara([
    "there is a woman lying on the ground and she is not moving",
    "please, there is a woman lying on the ground and she is not moving",
    "there is a woman lying on the ground and she is not moving, what should I do?",
    "há uma mulher caída no chão e não se mexe",
    "há uma mulher caída no chão e não se mexe, o que eu faço?",
  ]);
});

describe("variantes F2 · el parte telegráfico con cortesía o con pregunta detrás", () => {
  declara([
    "por favor, inconsciente en la calle",
    "inconsciente en la calle, ¿qué hago?",
    "unconscious on the street, what should I do?",
    "inconsciente na rua, o que eu faço?",
  ]);
});

describe("variantes F2 · guardas: el tema y el objeto no declaran", () => {
  noDeclara([
    "¿qué son las convulsiones?",
    "what is a seizure",
    "o que são convulsões",
    "las convulsiones febriles son comunes en niños pequeños",
    "the car is not moving in this traffic",
    "the bus is not moving yet",
  ]);
});
