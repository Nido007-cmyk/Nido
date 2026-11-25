// Tanda de variantes de la casa, Familia 4 (monóxido): las seis
// bases exactas que el censo midió con kind null en los tres
// idiomas: la alarma con «de carbono» detrás, el verbo delante
// («suena la alarma…»), el detector pitando/apitando/beeping y
// el «co» a secas en su marco de alarma o detector. La
// preposición del detector es obligada en la cura: el detector
// de humo no es esta puerta. Cada frase de «declara» estaba
// medida en null sobre la base de la tanda (rojo de
// nacimiento); las guardas estaban en null y siguen.
import { describe, expect, it } from "vitest";
import { matchSafetyAnswer, type SafetyLang } from "./safetyAnswers";

const declara = (casos: Array<[string, SafetyLang]>) => {
  for (const [q, lang] of casos) {
    it(`declara co-symptoms: ${q}`, () => {
      expect(matchSafetyAnswer(q, lang)?.kind, q).toBe("co-symptoms");
    });
  }
};
const noDeclara = (casos: Array<[string, SafetyLang]>) => {
  for (const [q, lang] of casos) {
    it(`no declara co-symptoms: ${q}`, () => {
      expect(matchSafetyAnswer(q, lang)?.kind, q).not.toBe("co-symptoms");
    });
  }
};

describe("variantes F4 · la alarma y el detector de monóxido, contados como se cuentan", () => {
  declara([
    ["suena la alarma de monóxido de carbono", "es"],
    ["suena la alarma de monoxido de carbono", "es"],
    ["¿suena la alarma de monóxido de carbono?", "es"],
    ["el detector de monóxido está pitando", "es"],
    ["el detector de monoxido esta pitando", "es"],
    ["the co alarm is beeping", "en"],
    ["the carbon monoxide detector is beeping", "en"],
    ["o alarme de monóxido de carbono está tocando", "pt"],
    ["o alarme de monoxido de carbono esta tocando", "pt"],
    ["o detector de monóxido está apitando", "pt"],
    ["o detector de monoxido esta apitando", "pt"],
  ]);
});

describe("variantes F4 · guardas: el tema y el detector de humo no declaran", () => {
  noDeclara([
    ["¿cómo instalo un detector de monóxido de carbono?", "es"],
    ["como instalo um detector de monóxido de carbono", "pt"],
    ["el detector de humo está pitando", "es"],
    ["the smoke detector is beeping", "en"],
    ["la alarma del coche suena mucho", "es"],
  ]);
});
