/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { hasHealthEvidence, healthSafeText, isEmergencyText, isHealthQuestion } from "./emergencyGate";
import type { RetrievedChunk } from "../rag/retrieve";

describe("isEmergencyText (emergencia primero)", () => {
  it("reconoce las tres rutas fijas: CO, número de emergencia y crisis", () => {
    expect(isEmergencyText("la alarma de monoxido esta sonando", "es")).toBe(true);
    expect(isEmergencyText("¿cuál es el número de emergencias de Chile?", "es")).toBe(true);
    expect(isEmergencyText("¿cuál es la línea de crisis de España?", "es")).toBe(true);
    expect(isEmergencyText("what is the emergency number in France?", "en")).toBe(true);
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
