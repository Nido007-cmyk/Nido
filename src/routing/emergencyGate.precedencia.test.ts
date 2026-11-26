/**
 * Tanda de precedencia de la guía (2026-11-25) · pieza 2.
 *
 * Foto del dueño (Tab A9+, 0.1.114 y 0.1.115): «Se acaba de
 * caer mi abuela y no se puede levantar» cayó al modelo con
 * texto libre genérico en plena situación declarada. El
 * diagnóstico (CHECKPOINT-PRECEDENCIA-GUIA.md): sin guía
 * literal que la sirva, el único desenlace fijo de la ruta
 * normal era el texto seguro cuando la recuperación venía
 * VACÍA; con fragmentos recuperados (la Wikipedia que se
 * estaba descargando) el turno generaba, y la doctrina
 * sellada del juez deja en pie lo «grounded»/«partial». La
 * cura: declarada la situación y sin guía que la sirva,
 * manda la puerta ANTES de generar — la decisión pura es
 * emergencyTurnOutcome, junto a noSourcesOutcome, y
 * ChatScreen la consulta en el punto compartido tras el
 * intento de guía y antes de despachar a la ruta fija o a
 * la adaptativa. La doctrina del juez no se toca: la cura
 * actúa antes de que el modelo escriba.
 *
 * Las familias se midieron contra la puerta real antes de
 * escribir esta batería (sonda de la tanda): atragantamiento
 * y caída viva declaran en los tres idiomas; narración,
 * prevención, relato y la frase de control del aparato no
 * declaran. Crisis y monóxido (es/pt) NO declaran por esta
 * puerta: son clase de la capa fija (matchSafetyAnswer,
 * consultada al frente de send()), que los sirve antes de
 * que esta decisión exista — aquí se prueba esa cobertura
 * en su capa, y que la decisión no los reclama.
 *
 * Las formas hipotéticas de atragantamiento SÍ declaran
 * (medido: la puerta no trae veto de hipotético para esta
 * familia): su desenlace con la cura es el mismo que la
 * puerta de sin-fuentes sellada ya da hoy con la
 * recuperación vacía — la guía por identidad o el texto
 * seguro —, nunca el modelo libre sobre una forma viva.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emergencyTurnOutcome, isEmergencySituation } from "./emergencyGate";
import { matchSafetyAnswer } from "../agent/loop/safetyAnswers";

const outcomeFor = (query: string) =>
  emergencyTurnOutcome({ isEmergency: isEmergencySituation(query), guideAnswered: false });

describe("pieza 2 · la tabla de verdad de la decisión", () => {
  it("declarada y sin guía que la sirva: texto seguro", () => {
    expect(emergencyTurnOutcome({ isEmergency: true, guideAnswered: false })).toBe("safe-text");
  });

  it("declarada pero con guía servida (pieza 1 o la clave): el turno ya respondió", () => {
    expect(emergencyTurnOutcome({ isEmergency: true, guideAnswered: true })).toBe("generate");
  });

  it("sin declaración, la puerta no manda", () => {
    expect(emergencyTurnOutcome({ isEmergency: false, guideAnswered: false })).toBe("generate");
    expect(emergencyTurnOutcome({ isEmergency: false, guideAnswered: true })).toBe("generate");
  });
});

describe("pieza 2 · atragantamiento vivo: la familia entera cae al texto seguro sin guía", () => {
  const FRASES = [
    // ES — la primera es la frase exacta del dueño en el aparato.
    "Mi hijo se esta ahogando con un pedazo de comida",
    "Se está ahogando un niño",
    "Mi bebé se está ahogando con algo",
    "Mi hija se atragantó y no puede respirar",
    // EN
    "My son is choking on a piece of food",
    "A child is choking",
    "He is choking and cannot breathe",
    "My baby is choking and can't breathe",
    // PT
    "Meu filho está engasgando com um pedaço de comida",
    "Uma criança está engasgando",
    "Ele está se engasgando e não consegue respirar",
    "Meu filho engasgou com uma uva e não consegue tossir",
  ];
  for (const q of FRASES) {
    it(q, () => {
      expect(isEmergencySituation(q)).toBe(true);
      expect(outcomeFor(q)).toBe("safe-text");
      // Y con guía servida, la decisión deja el turno en paz.
      expect(emergencyTurnOutcome({ isEmergency: isEmergencySituation(q), guideAnswered: true })).toBe("generate");
    });
  }
});

describe("pieza 2 · caída viva: la familia entera cae al texto seguro sin guía", () => {
  const FRASES = [
    // ES — la primera es la frase exacta del dueño en el aparato.
    "Se acaba de caer mi abuela y no se puede levantar",
    "Mi abuelo se acaba de caer y no se puede levantar",
    "Acaba de caerse y no se levanta",
    // EN
    "My grandmother just fell and can't get up",
    "He just fell and can't get up",
    "She just fell and is not getting up",
    // PT
    "Minha avó acabou de cair e não levanta",
    "Ele acabou de cair e não consegue se levantar",
    "Ela acabou de cair e não se levanta",
  ];
  for (const q of FRASES) {
    it(q, () => {
      expect(isEmergencySituation(q)).toBe(true);
      expect(outcomeFor(q)).toBe("safe-text");
    });
  }
});

describe("pieza 2 · las formas hipotéticas declaran y heredan el desenlace sellado", () => {
  const FRASES = [
    "Si mi hijo se atragantara, ¿qué tendría que hacer?",
    "If my child were choking, what should I do?",
    "Se meu filho engasgasse, o que eu faria?",
  ];
  for (const q of FRASES) {
    it(q, () => {
      // Medido en la sonda de la tanda: declaran. Con guía, la
      // pieza 1 sirve la de la emergencia; sin guía, el texto
      // seguro — el mismo desenlace que noSourcesOutcome ya
      // da hoy cuando la recuperación viene vacía.
      expect(isEmergencySituation(q)).toBe(true);
      expect(outcomeFor(q)).toBe("safe-text");
    });
  }
});

describe("pieza 2 · controles que no declaran: la decisión no manda", () => {
  const FRASES = [
    // La frase de control del aparato (0.1.115): sin disparo, y sigue sin disparo.
    "Nadie se cayo solo estamos jugando en el suelo",
    // Caída narrada (pasado cerrado) en los tres idiomas.
    "Ayer se cayó mi abuela y se golpeó la cabeza",
    "My grandmother fell yesterday and hit her head",
    "Minha avó caiu ontem e bateu a cabeça",
    // Atragantamiento narrado y resuelto.
    "Mi hijo se atragantó ayer con un hueso, pero ya está bien",
    "My son choked on a bone yesterday, but he is fine now",
    "Meu filho se engasgou ontem com um osso, mas já está bem",
    // Prevención preguntada.
    "¿Cómo puedo evitar que un niño se atragante con la comida?",
    "How can I prevent my toddler from choking on food?",
    "Como posso evitar que uma criança se engasgue?",
    // Habla indirecta de un suceso pasado.
    "Mi vecina me contó que su hijo se atragantó ayer en la escuela",
    "My neighbor told me her son choked yesterday at school",
    "Minha vizinha me contou que o filho dela se engasgou ontem na escola",
    // Pregunta de guía sin suceso.
    "¿Cómo se hace la maniobra de Heimlich?",
    "How do I do the Heimlich maneuver?",
    "Como se faz a manobra de Heimlich?",
  ];
  for (const q of FRASES) {
    it(q, () => {
      expect(isEmergencySituation(q)).toBe(false);
      expect(outcomeFor(q)).toBe("generate");
    });
  }
});

describe("las familias de la capa fija no pasan por esta decisión (su capa las sirve antes)", () => {
  const FIJAS: Array<[string, "es" | "en" | "pt"]> = [
    ["Ya no quiero seguir viviendo", "es"],
    ["I don't want to live anymore", "en"],
    ["Eu não quero mais viver", "pt"],
    ["Está sonando la alarma de monóxido de carbono ahorita", "es"],
    ["Esta sonando la alarma de monoxido de carbono", "es"],
    ["The carbon monoxide alarm is going off", "en"],
    ["O alarme de monóxido de carbono está tocando", "pt"],
  ];
  for (const [q, lang] of FIJAS) {
    it(q, () => {
      // La capa fija las caza (matchSafetyAnswer corre al
      // frente de send(), antes de la guía y de esta puerta)…
      expect(matchSafetyAnswer(q, lang)).not.toBeNull();
      // …y las dos frases del dueño, en cambio, NO tienen
      // capa fija: por eso su familia es la de esta tanda.
    });
  }

  it("las frases del dueño no tienen capa fija (son de esta tanda)", () => {
    expect(matchSafetyAnswer("Mi hijo se esta ahogando con un pedazo de comida", "es")).toBeNull();
    expect(matchSafetyAnswer("Se acaba de caer mi abuela y no se puede levantar", "es")).toBeNull();
  });
});

describe("pieza 2 · cableado en ChatScreen (la consulta precede al despacho)", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../ui/ChatScreen.tsx"), "utf8");

  it("ChatScreen importa y consulta la decisión una sola vez en el flujo de send()", () => {
    expect(source).toContain("emergencyTurnOutcome");
    const calls = source.match(/emergencyTurnOutcome\(\{/g) ?? [];
    expect(calls.length).toBe(1);
  });

  it("la consulta va tras el intento de guía y antes de despachar a la ruta fija o a la adaptativa", () => {
    const guideIdx = source.indexOf("await answerFromGuide(query, uiLang, retrievalQuery)");
    const consultIdx = source.indexOf("emergencyTurnOutcome({");
    const adaptiveIdx = source.indexOf("} else if (adaptiveRoutingEnabled) {");
    const fixedIdx = source.indexOf("const fixedPlain = await runFixedModelChat();");
    expect(guideIdx).toBeGreaterThan(-1);
    expect(consultIdx).toBeGreaterThan(guideIdx);
    expect(adaptiveIdx).toBeGreaterThan(consultIdx);
    expect(fixedIdx).toBeGreaterThan(consultIdx);
  });

  it("la capa fija sigue consultándose antes que esta puerta", () => {
    const fixedLayerIdx = source.indexOf("matchSafetyAnswer(query, uiLang)");
    const consultIdx = source.indexOf("emergencyTurnOutcome({");
    expect(fixedLayerIdx).toBeGreaterThan(-1);
    expect(consultIdx).toBeGreaterThan(fixedLayerIdx);
  });

  it("con «safe-text» se sirve el texto seguro con su procedencia, en el mismo punto", () => {
    const consultIdx = source.indexOf("emergencyTurnOutcome({");
    const region = source.slice(consultIdx, consultIdx + 1400);
    expect(region).toContain("healthSafeText(uiLang)");
    expect(region).toContain("gateSafeServed");
  });
});
