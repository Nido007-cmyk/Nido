/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  hasHealthEvidence,
  healthSafeText,
  isEmergencySituation,
  isEmergencyText,
  isHealthQuestion,
} from "./emergencyGate";
import type { RetrievedChunk } from "../rag/retrieve";

describe("isEmergencyText (emergencia primero)", () => {
  it("reconoce las tres rutas fijas: CO, número de emergencia y crisis", () => {
    expect(isEmergencyText("la alarma de monoxido esta sonando", "es")).toBe(true);
    expect(isEmergencyText("¿cuál es el número de emergencias de Chile?", "es")).toBe(true);
    expect(isEmergencyText("¿cuál es la línea de crisis de España?", "es")).toBe(true);
    expect(isEmergencyText("what is the emergency number in France?", "en")).toBe(true);
  });

  it("la emergencia viva contada tampoco hace cola (F-B1)", () => {
    expect(isEmergencyText("mi hijo se está ahogando con un hueso de pollo", "es")).toBe(true);
    expect(isEmergencyText("a man collapsed outside and is not breathing", "en")).toBe(true);
    expect(isEmergencyText("o meu pai desmaiou e não está respirando", "pt")).toBe(true);
  });

  it("lo que no es emergencia no se adelanta", () => {
    expect(isEmergencyText("¿qué es la fotosíntesis?", "es")).toBe(false);
    expect(isEmergencyText("cuéntame un cuento sobre un faro", "es")).toBe(false);
    expect(isEmergencyText("", "es")).toBe(false);
    expect(isEmergencyText("   ", "es")).toBe(false);
  });
});

describe("isHealthQuestion (puerta léxica)", () => {
  it("situaciones de salud en las tres lenguas", () => {
    expect(isHealthQuestion("mi hijo tiene fiebre, ¿qué hago?")).toBe(true);
    expect(isHealthQuestion("me duele el pecho y me mareo, ¿qué puede ser?")).toBe(true);
    expect(isHealthQuestion("¿qué hago si alguien se está atragantando?")).toBe(true);
    expect(isHealthQuestion("I have a fever and my head hurts, what should I do?")).toBe(true);
    expect(isHealthQuestion("my daughter is choking, how do I help her?")).toBe(true);
    expect(isHealthQuestion("o que fazer se meu filho está com febre?")).toBe(true);
    expect(isHealthQuestion("estou com uma dor no peito, o que faço?")).toBe(true);
  });

  it("un tema suelto sin pregunta ni situación no cierra la puerta", () => {
    expect(isHealthQuestion("fiebre amarilla")).toBe(false);
    expect(isHealthQuestion("asma")).toBe(false);
    expect(isHealthQuestion("dosis")).toBe(false);
    expect(isHealthQuestion("paracetamol")).toBe(false);
  });

  it("el campo de medicamentos y dosis dispara la puerta (F-B2)", () => {
    expect(isHealthQuestion("necesito saber la dosis de amoxicilina para mi hija de 6 años")).toBe(true);
    expect(isHealthQuestion("¿cada cuántas horas puedo tomar ibuprofeno?")).toBe(true);
    expect(isHealthQuestion("How many milligrams of aspirin can an adult take in one day?")).toBe(true);
    expect(isHealthQuestion("What is the right dosage of acetaminophen for a toddler?")).toBe(true);
    expect(isHealthQuestion("qual é a dosagem certa de dipirona para uma criança de 20 quilos?")).toBe(true);
    expect(isHealthQuestion("posso dar paracetamol ao meu filho com 15 quilos?")).toBe(true);
  });

  it("el campo nuevo no crea falsos positivos: cuento, ensayo y homógrafos", () => {
    // Sin señal de pregunta ni situación, la dosis de un cuento no cierra.
    expect(isHealthQuestion("estoy escribiendo un cuento donde una enfermera calcula la dosis de un medicamento")).toBe(false);
    // El veto de contexto sigue mandando sobre los términos nuevos.
    expect(isHealthQuestion("write an essay about the history of aspirin and how it changed medicine")).toBe(false);
    // «Remediar» una fuga no es un medicamento: «remedio» quedó fuera del
    // léxico portugués a propósito (ver la nota en emergencyGate.ts).
    expect(isHealthQuestion("como remediar um vazamento em casa?")).toBe(false);
  });

  it("los falsos positivos conocidos quedan fuera", () => {
    // Los ejemplos del propio Field Atlas: temas que solo mencionan.
    expect(isHealthQuestion("¿cuál es la historia de la fiebre amarilla?")).toBe(false);
    expect(isHealthQuestion("tell me the history of the 2004 tsunami and its fever outbreaks")).toBe(false);
    expect(isHealthQuestion("¿cómo corto una cebolla sin llorar?")).toBe(false);
    expect(isHealthQuestion("¿qué fue la fiebre del oro en California?")).toBe(false);
    expect(isHealthQuestion("escribe un cuento sobre un niño con fiebre")).toBe(false);
    expect(isHealthQuestion("¿qué es la fotosíntesis?")).toBe(false);
  });
});

describe("isEmergencySituation (la emergencia contada, F-B1)", () => {
  it("signos tal cual se cuentan, en las tres lenguas y sin preguntar", () => {
    // Respiración que falta, en primera y en tercera persona.
    expect(isEmergencySituation("Mi hijo se está ahogando con un hueso de pollo y no puede respirar")).toBe(true);
    expect(isEmergencySituation("Hay un hombre tirado en la acera que no respira")).toBe(true);
    expect(isEmergencySituation("A man collapsed at the stop and he is not breathing")).toBe(true);
    expect(isEmergencySituation("O meu pai desmaiou e não está respirando")).toBe(true);
    // El signo visto, no el diagnóstico.
    expect(isEmergencySituation("She is clutching her chest and sweating a lot")).toBe(true);
    expect(isEmergencySituation("Mi abuelo no responde cuando le hablo")).toBe(true);
    expect(isEmergencySituation("O bebé engasgou com um pedaço de pão")).toBe(true);
    // Humo y fuego en un lugar.
    expect(isEmergencySituation("Sale humo por la ventana de la cocina, ¿qué hago?")).toBe(true);
    expect(isEmergencySituation("There is smoke coming out of the basement")).toBe(true);
    expect(isEmergencySituation("Está saindo fumaça do apartamento ao lado")).toBe(true);
  });

  it("una pregunta de salud ordinaria no es una situación de emergencia", () => {
    expect(isEmergencySituation("mi hijo tiene fiebre, ¿qué hago?")).toBe(false);
    expect(isEmergencySituation("¿qué dosis de paracetamol le doy a un niño?")).toBe(false);
    expect(isEmergencySituation("What are the symptoms of dehydration in babies?")).toBe(false);
    expect(isEmergencySituation("¿cuál es el número de emergencias de Chile?")).toBe(false);
    expect(isEmergencySituation("")).toBe(false);
    expect(isEmergencySituation("   ")).toBe(false);
  });

  it("ficción, ensayo y metáfora no disparan la cara de emergencia", () => {
    expect(isEmergencySituation("Estoy escribiendo una historia sobre un pirata que no respira bajo el agua")).toBe(false);
    expect(isEmergencySituation("I'm writing an essay about the history of choking hazards in toys")).toBe(false);
    expect(isEmergencySituation("Cuéntame un cuento sobre un dragón que echa humo por la boca")).toBe(false);
    expect(isEmergencySituation("Desde que perdió el trabajo se ahoga en un vaso de agua")).toBe(false);
    expect(isEmergencySituation("The striker is on fire this season, three goals again")).toBe(false);
    expect(isEmergencySituation("Estou a escrever um conto sobre um dragão que cospe fogo")).toBe(false);
  });
});

describe("healthSafeText", () => {
  it("tres lenguas, con la llamada de urgencia y sin ningún número inventado", () => {
    for (const lang of ["es", "en", "pt"] as const) {
      const text = healthSafeText(lang);
      expect(text.length).toBeGreaterThan(100);
      expect(text).not.toMatch(/\d{3,}/);
    }
    expect(healthSafeText("es")).toContain("llama ahora mismo");
    expect(healthSafeText("en")).toContain("call your emergency number");
    expect(healthSafeText("pt")).toContain("ligue agora mesmo");
  });
});

describe("hasHealthEvidence", () => {
  const chunk = (chunkId: string): RetrievedChunk => ({ chunkId }) as RetrievedChunk;

  it("los packs de salud cuentan, con o sin sufijo de embeddings", () => {
    expect(hasHealthEvidence([chunk("pack:nido-esencial:5")])).toBe(true);
    expect(hasHealthEvidence([chunk("pack:nido-esencial-e5:5")])).toBe(true);
    expect(hasHealthEvidence([chunk("pack:nido-ninos:2"), chunk("pack:nido-viaje:1")])).toBe(true);
    expect(hasHealthEvidence([chunk("pack:nido-crisis:9")])).toBe(true);
  });

  it("otros packs y los documentos propios no son evidencia de salud de la puerta", () => {
    expect(hasHealthEvidence([chunk("pack:nido-viaje:1")])).toBe(false);
    expect(hasHealthEvidence([chunk("doc:local:7")])).toBe(false);
    expect(hasHealthEvidence([])).toBe(false);
  });
});
