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

  it("y el banco cotidiano no dispara", () => {
    for (const s of EVERYDAY) expect(isSelfHarmMessage(s), s).toBe(false);
  });

  it("la vía pegada del dictado también caza las familias nuevas", () => {
    for (const s of ["noquierodespertarmañana", "voyatomarmetodaslaspastillas", "iwanttooverdose", "nãoqueromaisacordar"]) {
      expect(isSelfHarmMessage(s), s).toBe(true);
    }
  });
});
