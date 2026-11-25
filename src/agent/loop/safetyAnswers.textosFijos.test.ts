/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Barrido pre-versión · paso 9, pieza P9-1 (cargo heredado del
 * cierre del paquete #356, venido de la F5): ningún test afirmaba
 * el texto completo de CO_TEXT ni de CO_SYMPTOM_TEXT en ningún
 * idioma, y la corrida de mutación midió que cada segmento de
 * ambos textos podía vaciarse sin que ningún test cayera.
 *
 * Estas dos fotos afirman, por igualdad completa y byte a byte,
 * el texto SERVIDO (la salida de matchSafetyAnswer, con su kind)
 * de las dos respuestas fijas de monóxido en los tres idiomas.
 * Afirman el texto tal como se sirve hoy: no reescriben ni una
 * coma de las constantes.
 */
import { describe, expect, it } from "vitest";
import { matchSafetyAnswer, type SafetyLang } from "./safetyAnswers";

const CO_TEXT_ESPERADO: Record<SafetyLang, string> = {
  es: "No. Nunca uses un generador, una parrilla, un brasero, un hornillo ni ningún aparato que queme gasolina, gas propano o carbón dentro de casa, en el garaje, el sótano, el porche o una tienda de campaña, aunque abras puertas y ventanas. El monóxido de carbono no se ve ni se huele y puede ser mortal.\n\n- El generador, siempre fuera y a más de 6 metros (20 pies) de la casa, con el escape apuntando lejos de puertas, ventanas y respiraderos.\n- Pon alarmas de monóxido de carbono con pilas cerca de los dormitorios y en cada planta.\n- Si suena la alarma o alguien tiene dolor de cabeza, mareo, debilidad, náuseas o confusión: salgan al aire libre ya y llamen a emergencias.\n\nFuentes: CPSC y CDC de EE. UU.",
  en: "No. Never use a generator, grill, camp stove or anything that burns gasoline, propane or charcoal inside your home, garage, basement, porch or a tent, even with doors and windows open. Carbon monoxide can't be seen or smelled and can kill.\n\n- Keep the generator outdoors, at least 20 feet (6 meters) from the house, with the exhaust pointed away from doors, windows and vents.\n- Install battery-operated carbon monoxide alarms near bedrooms and on every floor.\n- If the alarm sounds or someone has a headache, dizziness, weakness, nausea or confusion: get outside right away and call emergency services.\n\nSources: US CPSC and CDC.",
  pt: "Não. Nunca use gerador, churrasqueira, fogareiro ou qualquer aparelho que queime gasolina, gás propano ou carvão dentro de casa, na garagem, no porão, na varanda ou numa barraca, mesmo com portas e janelas abertas. O monóxido de carbono não se vê nem tem cheiro e pode matar.\n\n- O gerador fica sempre do lado de fora, a mais de 6 metros (20 pés) da casa, com o escapamento virado para longe de portas, janelas e respiros.\n- Instale alarmes de monóxido de carbono a pilha perto dos quartos e em cada andar.\n- Se o alarme tocar ou alguém tiver dor de cabeça, tontura, fraqueza, náusea ou confusão: saiam para o ar livre já e liguem para a emergência.\n\nFontes: CPSC e CDC dos EUA.",
};

const CO_SYMPTOM_ESPERADO: Record<SafetyLang, string> = {
  es: "Puede ser monóxido de carbono. Salgan todos al aire libre ahora mismo, sin quedarse a ventilar, y llamen a emergencias desde fuera. No vuelvan a entrar hasta que los bomberos o los servicios de emergencia digan que es seguro.\n\nFuentes: CPSC y CDC de EE. UU.",
  en: "This may be carbon monoxide. Everyone get outside right now, don't stay to air the place out, and call emergency services from outside. Don't go back in until the fire department or emergency services say it's safe.\n\nSources: US CPSC and CDC.",
  pt: "Pode ser monóxido de carbono. Saiam todos para o ar livre agora mesmo, sem ficar para ventilar, e liguem para a emergência do lado de fora. Não voltem a entrar até os bombeiros ou o serviço de emergência dizerem que é seguro.\n\nFontes: CPSC e CDC dos EUA.",
};

const PREGUNTA_PELIGRO: Record<SafetyLang, string> = {
  es: "puedo usar el generador dentro de la casa durante el apagón",
  en: "Can I run the generator on the porch?",
  pt: "Posso ligar o gerador na varanda?",
};
const PREGUNTA_SINTOMAS: Record<SafetyLang, string> = {
  es: "suena la alarma de monóxido de carbono",
  en: "the carbon monoxide detector is beeping",
  pt: "o alarme de monóxido de carbono está tocando",
};
const IDIOMAS: SafetyLang[] = ["es", "en", "pt"];

describe("barrido · paso 9 (P9-1): fotos de texto completo de las respuestas fijas de monóxido", () => {
  it("la respuesta de peligro (co-hazard) servida es byte a byte esta, en los tres idiomas", () => {
    for (const lang of IDIOMAS) {
      const hit = matchSafetyAnswer(PREGUNTA_PELIGRO[lang], lang);
      expect(hit?.kind, lang).toBe("co-hazard");
      expect(hit?.text, lang).toBe(CO_TEXT_ESPERADO[lang]);
    }
  });

  it("la respuesta de síntomas (co-symptoms) servida es byte a byte esta, en los tres idiomas", () => {
    for (const lang of IDIOMAS) {
      const hit = matchSafetyAnswer(PREGUNTA_SINTOMAS[lang], lang);
      expect(hit?.kind, lang).toBe("co-symptoms");
      expect(hit?.text, lang).toBe(CO_SYMPTOM_ESPERADO[lang]);
    }
  });
});
