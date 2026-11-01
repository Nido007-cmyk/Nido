/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import {
  gatePreemptsDeepResearch,
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

  it("el marco histórico veta la puerta (F-B3): el pasado no es una situación", () => {
    // El caso que destapó el hallazgo en la corrida 02 y sus primos
    // del conjunto 03: término de salud + señal, pero marco pasado.
    expect(isHealthQuestion("Qual foi a febre espanhola de 1918 e quantas pessoas matou?")).toBe(false);
    expect(isHealthQuestion("¿Cuántas personas murieron de fiebre tifoidea durante la Primera Guerra Mundial?")).toBe(false);
    expect(isHealthQuestion("How many people died in the flu pandemic of 1918?")).toBe(false);
    expect(isHealthQuestion("Como a pandemia de gripe de 1957 afetou as cidades do Brasil?")).toBe(false);
    expect(isHealthQuestion("Num romance do século XIX, a personagem morre de pneumonia em poucos dias; isso era comum naquela época?")).toBe(false);
    // El marco al principio de la frase también veta.
    expect(isHealthQuestion("Historia de la fiebre en el siglo XIX, ¿cómo se trataba?")).toBe(false);
    // Año sin verbo en pasado ni marco: no veta por sí solo.
    expect(isHealthQuestion("tengo fiebre desde 2023 y no se me quita, ¿qué puede ser?")).toBe(true);
    // La salud presente sigue disparando con los mismos textos de siempre.
    expect(isHealthQuestion("mi hijo tiene fiebre, ¿qué hago?")).toBe(true);
    expect(isHealthQuestion("¿qué dosis de paracetamol le puedo dar a un niño de 4 años?")).toBe(true);
    expect(isHealthQuestion("o que fazer se meu filho está com febre?")).toBe(true);
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

  it("el marco histórico también veta la cara de emergencia (F-B3)", () => {
    expect(isEmergencySituation("En la novela, un hombre no respira y nadie lo ayuda")).toBe(false);
    expect(isEmergencySituation("In the film, a man is not breathing and nobody helps him")).toBe(false);
    // La emergencia viva de siempre sigue disparando.
    expect(isEmergencySituation("Sale humo por la ventana de la cocina, ¿qué hago?")).toBe(true);
    expect(isEmergencySituation("Mi hijo se está ahogando con un hueso de pollo y no puede respirar")).toBe(true);
  });
});

describe("R-07: la frase exacta de la ronda y la tolerancia al ruido de dictado", () => {
  it("la frase exacta recibida en el aparato dispara las tres caras", () => {
    // El dictado convirtió «alguien» en «argument»: la palabra ajena
    // no estorba al signo, que estaba entero.
    const exacta = "Que hago si argument se esta atragantando?";
    expect(isEmergencySituation(exacta)).toBe(true);
    expect(isEmergencyText(exacta, "es")).toBe(true);
    expect(isHealthQuestion(exacta)).toBe(true);
  });

  it("una letra caída dentro de la palabra-signo ya no la vuelve invisible (cara por raíz)", () => {
    // Sin la «a» inicial y sin una vocal en medio: las frases exactas
    // fallaban en las tres caras; la raíz casa por principio de palabra.
    expect(isEmergencySituation("se esta tragantando")).toBe(true);
    expect(isEmergencySituation("se esta atragantndo")).toBe(true);
    expect(isEmergencyText("se esta tragantando", "es")).toBe(true);
    expect(isEmergencyText("se esta atragantndo", "es")).toBe(true);
    // Los equivalentes de dictado en inglés y portugués.
    expect(isEmergencySituation("my toddler is chokng on a grape")).toBe(true);
    expect(isEmergencySituation("o bebê está engasgndo com um pedaço de pão")).toBe(true);
  });

  it("los sinónimos que faltaban: asfixia y respiración que cuesta", () => {
    expect(isEmergencySituation("se está asfixiando, ¿qué hago?")).toBe(true);
    expect(isEmergencySituation("le cuesta mucho respirar")).toBe(true);
    expect(isEmergencySituation("a mi padre le cuesta respirar desde hace un rato")).toBe(true);
    expect(isEmergencySituation("she is struggling to breathe")).toBe(true);
    expect(isEmergencySituation("ele tem dificuldade para respirar")).toBe(true);
  });

  it("la cara por raíz no abre falsos positivos: debate, ficción e historia quedan fuera", () => {
    expect(isEmergencySituation("¿cómo gano un argumento en un debate?")).toBe(false);
    expect(isEmergencyText("¿cómo gano un argumento en un debate?", "es")).toBe(false);
    expect(isEmergencySituation("escribe un cuento sobre un niño que se atraganta")).toBe(false);
    expect(isEmergencySituation("¿qué fue la gripe española de 1918?")).toBe(false);
    expect(isEmergencyText("¿qué fue la gripe española de 1918?", "es")).toBe(false);
    expect(isEmergencySituation("En la novela, un hombre se atraganta en la cena")).toBe(false);
  });
});

describe("H-05 (adversaria): la raíz sola no declara la situación — la metáfora no es una emergencia", () => {
  it("la sonda exacta de la adversaria: «choke» deportivo no dispara ninguna cara", () => {
    // «Choke under pressure» es fallar bajo presión: sujeto genérico
    // de clase, verbo en presente simple, sin víctima ni cuerpo.
    const q = "Why do golfers choke under pressure in finals?";
    expect(isEmergencySituation(q)).toBe(false);
    expect(isHealthQuestion(q)).toBe(false);
    expect(isEmergencyText(q, "en")).toBe(false);
    expect(gatePreemptsDeepResearch(q, "en")).toBe(false);
  });

  it("gemelas de la metáfora: escenario, examen, deporte portugués y «atragantarse» un tema", () => {
    expect(isEmergencySituation("She choked on stage and forgot her lines")).toBe(false);
    expect(isEmergencySituation("I choked during the exam and left half of it blank")).toBe(false);
    expect(isEmergencySituation("por que os jogadores engasgam sob pressão?")).toBe(false);
    expect(isEmergencySituation("se me atragantan las matemáticas")).toBe(false);
    // La cara de SITUACIÓN queda curada en las tres lenguas (la
    // corroboración mira las raíces de todas). La puerta de SALUD
    // solo se acotó para «chok» — el resto nombrado y su porqué
    // van en el informe del carril y en la fixture siguiente.
  });

  it("las variantes dictadas medidas siguen disparando: el contexto de cuerpo las sostiene", () => {
    // Auxiliar ante la palabra-signo.
    expect(isEmergencySituation("he is chokng")).toBe(true);
    expect(isEmergencySituation("se esta tragantando")).toBe(true);
    expect(isEmergencySituation("se esta atragantndo")).toBe(true);
    // Víctima nombrada cerca de la palabra-signo.
    expect(isEmergencySituation("my toddler is chokng on a grape")).toBe(true);
    expect(isEmergencySituation("o bebê está engasgndo com um pedaço de pão")).toBe(true);
    expect(isEmergencySituation("my baby is suffocatng")).toBe(true);
    // Enclítico reflexivo pegado al gerundio.
    expect(isEmergencySituation("Atragantándose")).toBe(true);
    // El caso del conjunto ciego v2: pretérito con «se» antes de la raíz.
    expect(isEmergencySituation("mi hijo de 3 años se atragantó con una uva y no puede toser")).toBe(true);
    // La puerta de salud con la familia «chok» y cuerpo presente sigue cerrando.
    expect(isHealthQuestion("my daughter is choking, how do I help her?")).toBe(true);
    expect(isHealthQuestion("How do I stop choking?")).toBe(true);
  });

  it("la pregunta instructiva genérica sobre atragantamiento sigue cerrando la puerta de salud", () => {
    // La familia «atragant» no comparte la homografía de «chok» y
    // su casado en isHealthQuestion NO se tocó en H-05 — también
    // porque el dueño excluyó H-04 el 2026-11-01 («lo de la
    // investigación solo déjala así»): la desviación de esta
    // subpregunta por la segunda red se acepta tal cual, y esta
    // aserción fija que la cura de H-05 no la deshace por detrás.
    expect(gatePreemptsDeepResearch("¿Qué se debe hacer ante un atragantamiento?", "es")).toBe(true);
  });
});

describe("gatePreemptsDeepResearch (R-07: la decisión antes de la bifurcación)", () => {
  it("emergencia o salud con Investigar activo: el turno va protegido", () => {
    expect(gatePreemptsDeepResearch("Que hago si argument se esta atragantando?", "es")).toBe(true);
    expect(gatePreemptsDeepResearch("mi hijo tiene fiebre, ¿qué hago?", "es")).toBe(true);
    expect(gatePreemptsDeepResearch("my daughter is choking, how do I help her?", "en")).toBe(true);
    expect(gatePreemptsDeepResearch("o que fazer se meu filho está com febre?", "pt")).toBe(true);
  });

  it("una pregunta de investigación ordinaria no se desvía", () => {
    expect(gatePreemptsDeepResearch("¿cuáles son los efectos del cambio climático en el Mediterráneo?", "es")).toBe(false);
    expect(gatePreemptsDeepResearch("what were the causes of the First World War?", "en")).toBe(false);
    expect(gatePreemptsDeepResearch("", "es")).toBe(false);
    expect(gatePreemptsDeepResearch("   ", "es")).toBe(false);
  });

  it("el pasado no se desvía: el veto histórico sigue mandando sobre la decisión", () => {
    expect(gatePreemptsDeepResearch("¿cuántas personas murieron de gripe en 1918?", "es")).toBe(false);
    expect(gatePreemptsDeepResearch("Qual foi a febre espanhola de 1918 e quantas pessoas matou?", "pt")).toBe(false);
    expect(gatePreemptsDeepResearch("How many people died in the flu pandemic of 1918?", "en")).toBe(false);
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

  it("paridad trilingüe contada y lo esencial trazado a las guías (sustancia)", () => {
    const texts = (["es", "en", "pt"] as const).map((lang) => healthSafeText(lang));
    // Misma estructura: 6 bloques y 6 pasos numerados en cada lengua.
    for (const text of texts) {
      expect(text.split("\n\n")).toHaveLength(6);
      expect(text.match(/^\d\. /gm)).toHaveLength(6);
    }
    // Longitudes de la misma familia (ninguna lengua queda en el suelo viejo).
    const words = texts.map((t) => t.split(/\s+/).length);
    for (const w of words) {
      expect(w).toBeGreaterThan(250);
      expect(Math.abs(w - words[0]) / words[0]).toBeLessThan(0.15);
    }
    // Lo esencial de las guías, en cada lengua: RCP, presión, atragantamiento, dosis por prospecto.
    expect(healthSafeText("es")).toContain("centro del pecho");
    expect(healthSafeText("en")).toContain("center of the chest");
    expect(healthSafeText("pt")).toContain("centro do peito");
    expect(healthSafeText("es")).toContain("prospecto del medicamento");
    expect(healthSafeText("en")).toContain("medicine's leaflet");
    expect(healthSafeText("pt")).toContain("bula do medicamento");
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
