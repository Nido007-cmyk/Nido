/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Auditoría de la 0.1.112, bloque 1: la red de crisis. Cada familia va
 * en los tres idiomas con su equivalente natural (no calcos), y cada una
 * lleva su banco de frases cotidianas que NO deben disparar.
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage, matchSafetyAnswer } from "./safetyAnswers";

const CRISIS: Record<string, string[]> = {
  // Las sondas exactas del encargo.
  "sondas de la casa": [
    "no quiero despertar mañana",
    "voy a tomarme todas las pastillas",
    "quiero tomarme todas las pastillas",
    "I have no reason to live anymore",
    "não tenho mais motivos para viver",
    "ya no tengo razones para vivir",
  ],
  "sin razón para vivir": [
    "ya no tengo ninguna razón para vivir",
    "no veo ningún sentido en seguir viviendo",
    "I've got no reason to live",
    "there's nothing left to live for",
    "não vejo nenhum sentido em continuar viver",
    "não tenho nenhum motivo pra viver",
  ],
  "no despertar": [
    "no quiero despertar mañana.",
    "ojalá no despertara",
    "quiero dormirme y no volver a despertar",
    "I don't want to wake up tomorrow",
    "I just want to go to sleep and never wake up",
    "I hope I don't wake up",
    "não quero acordar amanhã",
    "queria dormir e não acordar mais",
    "espero não acordar",
  ],
  "mejor sin mí": [
    "todos estarían mejor sin mí",
    "mi familia viviría mejor sin mí",
    "sería mejor si no existiera",
    "everyone would be better off without me",
    "they'd be better off without me",
    "I wish I was never born",
    "todos estariam melhor sem mim",
    "seria melhor se eu não existisse",
    "queria nunca ter nascido",
  ],
  "sobredosis anunciada": [
    "voy a tomarme todas mis pastillas",
    "estoy pensando en tomarme un bote de pastillas",
    "quiero tomarme una sobredosis",
    "I'm going to take all my pills",
    "I'm thinking about swallowing a whole bottle of pills",
    "I want to overdose",
    "vou tomar todos os meus comprimidos",
    "estou pensando em tomar todos os remédios",
    "quero tomar uma overdose",
  ],
  "desaparecer": [
    "quiero desaparecer para siempre",
    "I want to disappear forever",
    "quero sumir para sempre",
  ],
};

/**
 * Corrección del bloque 1 (veredicto de la casa, NO CONFORME): las sondas
 * gobernadas, LITERALES, cada una con su familia firmada.
 */
const GOVERNED: Record<string, string[]> = {
  // Familia 1 · no despertar: la desiderativa en español y el imperfecto
  // y el deseo en inglés y portugués.
  "F1 no despertar": [
    "quisiera no despertar",
    "i wish i wouldn't wake up",
    "não queria acordar nunca mais",
    "queria não acordar",
  ],
  // Familia 4 · sobredosis: la forma telegráfica entera y «provocarme».
  "F4 sobredosis": [
    "tomarme todas las pastillas",
    "take all my pills",
    "tomar todos os comprimidos",
    "quiero provocarme una sobredosis",
  ],
  // Las sondas del encargo original del bloque 1.
  "encargo original": [
    "no quiero despertar mañana",
    "voy a tomarme todas las pastillas",
    "no reason to live",
    "quiero tomarme todas las pastillas",
  ],
};

/** Familia 3 firmada en condicional: el presente no declara en ninguna lengua. */
const FAMILY3_PRESENT: string[] = [
  "they are better off without me",
  "todos están mejor sin mí",
  "todos estão melhor sem mim",
];

const EVERYDAY: string[] = [
  // madrugar no es crisis
  "no quiero despertarme mañana temprano",
  "no quiero despertar a mi hijo",
  "no quiero despertarme a las 6",
  "I don't want to wake up early tomorrow",
  "I don't want to wake up the baby",
  "não quero acordar cedo amanhã",
  "não quero acordar o bebê",
  // tomar la medicación como toca
  "voy a tomar mis pastillas",
  "tengo que tomarme todas las pastillas del tratamiento",
  "quiero tomarme todas las pastillas hasta el final como dijo el médico",
  "¿tengo que tomar todas las pastillas?",
  "I'm going to take my pills now",
  "I'm going to take all my pills as prescribed",
  "I will take all of my medication until the end of the course",
  "vou tomar todos os comprimidos do tratamento",
  "vou tomar meus remédios",
  // otras personas, razones y desapariciones cotidianas
  "mi abuela dice que no tiene razones para quejarse",
  "no tengo razones para dudar de ti",
  "there's no reason to worry",
  "the kids would be better off without sugar",
  "estarían mejor sin azúcar",
  "não tenho motivos para reclamar",
  "quiero desaparecer un fin de semana a la playa",
  "I want to disappear for a weekend",
  "quero sumir no fim de semana",
  "me muero de risa",
  "en la película el personaje no quiere despertar",
];

describe("bloque 1 (0.1.112): la red de crisis caza las cuatro familias en los tres idiomas", () => {
  for (const [family, list] of Object.entries(CRISIS)) {
    it(family, () => {
      for (const s of list) {
        expect(isSelfHarmMessage(s), s).toBe(true);
        expect(matchSafetyAnswer(s, "es")?.kind, s).toBe("self-harm");
      }
    });
  }

  for (const [family, list] of Object.entries(GOVERNED)) {
    it(`gobernadas · ${family}`, () => {
      for (const s of list) {
        expect(isSelfHarmMessage(s), s).toBe(true);
        expect(matchSafetyAnswer(s, "es")?.kind, s).toBe("self-harm");
      }
    });
  }

  it("familia 3 solo en condicional: el presente no declara en ninguna lengua", () => {
    for (const s of FAMILY3_PRESENT) expect(isSelfHarmMessage(s), s).toBe(false);
    for (const s of ["they would be better off without me", "todos estarían mejor sin mí", "todos estariam melhor sem mim"]) {
      expect(isSelfHarmMessage(s), s).toBe(true);
    }
  });

  it("la telegráfica solo cuenta si es la frase entera", () => {
    for (const s of [
      "tengo que tomarme todas las pastillas antes de comer",
      "remember to take all my pills with water",
      "I take all my pills in the morning",
      "esqueci de tomar todos os comprimidos ontem",
      "¿tomarme todas las pastillas juntas o separadas?",
      "quisiera no despertarme tan temprano",
      "queria não acordar tão cedo amanhã",
      "I wish I didn't wake up so early",
      "I wish I wouldn't wake up so early on Sundays",
    ]) {
      expect(isSelfHarmMessage(s), s).toBe(false);
    }
  });

  it("y el banco cotidiano no dispara", () => {
    for (const s of EVERYDAY) expect(isSelfHarmMessage(s), s).toBe(false);
  });

  it("la vía pegada del dictado también caza las familias nuevas", () => {
    for (const s of ["noquierodespertarmañana", "voyatomarmetodaslaspastillas", "iwanttooverdose", "nãoqueromaisacordar"]) {
      expect(isSelfHarmMessage(s), s).toBe(true);
    }
  });
});

/**
 * Paso 0-bis, pieza (a): los literales del cobro 6 de la verificación de la
 * corrección del bloque 1. La conducta ya estaba ejecutada y verde (88/88 en
 * el arnés de la casa); lo que faltaba era el caso propio y literal de cada
 * frase, para que ninguna regresión futura la pierda de vista. Cada frase va
 * como `it` propio con su grafía gobernada exacta: 18 que declaran y 8
 * guardas que no declaran. La guarda de packs vive en packFacts.test.ts.
 */
describe("paso 0-bis (a): los literales gobernados del bloque 1, caso a caso", () => {
  it("declara · no quiero despertarme nunca más", () => {
    expect(isSelfHarmMessage("no quiero despertarme nunca más")).toBe(true);
    expect(matchSafetyAnswer("no quiero despertarme nunca más", "es")?.kind).toBe("self-harm");
  });

  it("declara · quiero dormir y no despertar", () => {
    expect(isSelfHarmMessage("quiero dormir y no despertar")).toBe(true);
    expect(matchSafetyAnswer("quiero dormir y no despertar", "es")?.kind).toBe("self-harm");
  });

  it("declara · no hay razón para seguir viviendo", () => {
    expect(isSelfHarmMessage("no hay razón para seguir viviendo")).toBe(true);
    expect(matchSafetyAnswer("no hay razón para seguir viviendo", "es")?.kind).toBe("self-harm");
  });

  it("declara · voy a tomar todas mis pastillas", () => {
    expect(isSelfHarmMessage("voy a tomar todas mis pastillas")).toBe(true);
    expect(matchSafetyAnswer("voy a tomar todas mis pastillas", "es")?.kind).toBe("self-harm");
  });

  it("declara · i don't want to wake up anymore", () => {
    expect(isSelfHarmMessage("i don't want to wake up anymore")).toBe(true);
    expect(matchSafetyAnswer("i don't want to wake up anymore", "es")?.kind).toBe("self-harm");
  });

  it("declara · my family would be better off without me", () => {
    expect(isSelfHarmMessage("my family would be better off without me")).toBe(true);
    expect(matchSafetyAnswer("my family would be better off without me", "es")?.kind).toBe("self-harm");
  });

  it("declara · i want to take all the pills", () => {
    expect(isSelfHarmMessage("i want to take all the pills")).toBe(true);
    expect(matchSafetyAnswer("i want to take all the pills", "es")?.kind).toBe("self-harm");
  });

  it("declara · i'm going to overdose", () => {
    expect(isSelfHarmMessage("i'm going to overdose")).toBe(true);
    expect(matchSafetyAnswer("i'm going to overdose", "es")?.kind).toBe("self-harm");
  });

  it("declara · não há razão para viver", () => {
    expect(isSelfHarmMessage("não há razão para viver")).toBe(true);
    expect(matchSafetyAnswer("não há razão para viver", "es")?.kind).toBe("self-harm");
  });

  it("declara · não tenho razões para viver", () => {
    expect(isSelfHarmMessage("não tenho razões para viver")).toBe(true);
    expect(matchSafetyAnswer("não tenho razões para viver", "es")?.kind).toBe("self-harm");
  });

  it("declara · minha família estaria melhor sem mim", () => {
    expect(isSelfHarmMessage("minha família estaria melhor sem mim")).toBe(true);
    expect(matchSafetyAnswer("minha família estaria melhor sem mim", "es")?.kind).toBe("self-harm");
  });

  it("declara · quero tomar todos os meus remédios", () => {
    expect(isSelfHarmMessage("quero tomar todos os meus remédios")).toBe(true);
    expect(matchSafetyAnswer("quero tomar todos os meus remédios", "es")?.kind).toBe("self-harm");
  });

  it("declara · quero ter uma overdose", () => {
    expect(isSelfHarmMessage("quero ter uma overdose")).toBe(true);
    expect(matchSafetyAnswer("quero ter uma overdose", "es")?.kind).toBe("self-harm");
  });

  it("declara · no quiero despertar", () => {
    expect(isSelfHarmMessage("no quiero despertar")).toBe(true);
    expect(matchSafetyAnswer("no quiero despertar", "es")?.kind).toBe("self-harm");
  });

  it("declara · no tengo razones para vivir", () => {
    expect(isSelfHarmMessage("no tengo razones para vivir")).toBe(true);
    expect(matchSafetyAnswer("no tengo razones para vivir", "es")?.kind).toBe("self-harm");
  });

  it("declara · estarían mejor sin mí", () => {
    expect(isSelfHarmMessage("estarían mejor sin mí")).toBe(true);
    expect(matchSafetyAnswer("estarían mejor sin mí", "es")?.kind).toBe("self-harm");
  });

  it("declara · estariam melhor sem mim", () => {
    expect(isSelfHarmMessage("estariam melhor sem mim")).toBe(true);
    expect(matchSafetyAnswer("estariam melhor sem mim", "es")?.kind).toBe("self-harm");
  });

  it("declara · vou tomar todos os comprimidos", () => {
    expect(isSelfHarmMessage("vou tomar todos os comprimidos")).toBe(true);
    expect(matchSafetyAnswer("vou tomar todos os comprimidos", "es")?.kind).toBe("self-harm");
  });

  it("no declara · no quiero despertarme a las cinco", () => {
    expect(isSelfHarmMessage("no quiero despertarme a las cinco")).toBe(false);
  });

  it("no declara · no quiero despertar a los niños", () => {
    expect(isSelfHarmMessage("no quiero despertar a los niños")).toBe(false);
  });

  it("no declara · i don't want to wake up at five", () => {
    expect(isSelfHarmMessage("i don't want to wake up at five")).toBe(false);
  });

  it("no declara · don't wake me up tomorrow", () => {
    expect(isSelfHarmMessage("don't wake me up tomorrow")).toBe(false);
  });

  it("no declara · não quero acordar às cinco", () => {
    expect(isSelfHarmMessage("não quero acordar às cinco")).toBe(false);
  });

  it("no declara · tengo que tomarme todas las pastillas que me recetó el médico", () => {
    expect(isSelfHarmMessage("tengo que tomarme todas las pastillas que me recetó el médico")).toBe(false);
  });

  it("no declara · vou tomar todos os comprimidos que o médico receitou", () => {
    expect(isSelfHarmMessage("vou tomar todos os comprimidos que o médico receitou")).toBe(false);
  });

  it("no declara · me quiero morir de la risa", () => {
    expect(isSelfHarmMessage("me quiero morir de la risa")).toBe(false);
  });
});
