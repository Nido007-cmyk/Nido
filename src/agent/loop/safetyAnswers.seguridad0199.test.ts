/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.99 · Tanda T-01 (seguridad fija inmediata), auditoría de la app
 * 2026-11-14, carril 02 (H-14 y H-13):
 *
 * - M-07: la raíz «cort-» no estaba en los patrones de autolesión en
 *   ningún idioma: «quiero cortarme» y «quero me cortar» no disparaban
 *   el texto fijo (sondas P-17d/P-17e); tampoco casaba «no quiero
 *   estar vivo». La gemela portuguesa de «machucar» sí disparaba
 *   (P-17f, control). Se barre la clase entera: formas directas,
 *   enclíticas, «pensando en», dictado pegado y las gemelas de
 *   «estar vivo / estar muerto» en es/en/pt — y los usos cotidianos
 *   de «cortar» (el pelo, las uñas, el pan, cortar con alguien, el
 *   corte accidental) NO deben disparar.
 * - m-09: «¿Qué número llamo en España?» devolvía null: la
 *   alternativa de EMERGENCY_Q_RE exigía la «a» delante («¿A qué
 *   número llamo…?» sí disparaba, P-17c). La forma corriente, sin
 *   «a», es la que la gente escribe (sonda P-17a).
 */
import { describe, expect, it } from "vitest";
import { isSelfHarmMessage, matchSafetyAnswer } from "./safetyAnswers";

describe("M-07 · autolesión: la familia de «cortar» dispara el texto fijo", () => {
  it("las sondas del acta, palabra por palabra (P-17d y P-17e)", () => {
    expect(isSelfHarmMessage("Quiero cortarme, no aguanto más")).toBe(true);
    expect(isSelfHarmMessage("Quero me cortar, não aguento mais")).toBe(true);
    expect(matchSafetyAnswer("Quiero cortarme, no aguanto más", "es")?.kind).toBe("self-harm");
    expect(matchSafetyAnswer("Quero me cortar, não aguento mais", "pt")?.kind).toBe("self-harm");
  });

  it("el control que ya disparaba sigue disparando (P-17f)", () => {
    expect(isSelfHarmMessage("quero me machucar")).toBe(true);
    expect(isSelfHarmMessage("quiero hacerme daño")).toBe(true);
  });

  it("barrido de la clase en español: intención + cortarme, enclítico y «pensando en»", () => {
    for (const q of [
      "quiero cortarme",
      "quiero cortarme las venas",
      "me quiero cortar",
      "voy a cortarme",
      "me voy a cortar",
      "tengo ganas de cortarme",
      "pienso en cortarme",
      "estoy pensando en cortarme",
      "he pensado en cortarme",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("barrido de la clase en portugués: «me cortar», «cortar-me» y «penso em»", () => {
    for (const q of [
      "quero me cortar",
      "vou me cortar",
      "quero cortar-me",
      "tenho vontade de me cortar",
      "penso em me cortar",
      "tenho pensado em me cortar",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("barrido de la clase en inglés: «cutting myself» y las formas de intención", () => {
    for (const q of [
      "I want to cut myself",
      "I keep thinking about cutting myself",
      "I'm cutting myself again",
      "I cut myself on purpose",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("la gemela que el acta nombra: «no quiero estar vivo» y «estar muerto» en es/en/pt", () => {
    for (const q of [
      "ya no quiero estar vivo",
      "no quiero estar viva",
      "quiero estar muerto",
      "não quero estar vivo",
      "quero estar morto",
      "I want to be dead",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(true);
    }
  });

  it("dictado pegado (CL-11b): la familia también entra sin espacios", () => {
    expect(isSelfHarmMessage("quierocortarme")).toBe(true);
    expect(isSelfHarmMessage("queromecortar")).toBe(true);
  });

  it("los usos cotidianos de «cortar» NO disparan: pelo, uñas, cocina, ruptura, accidente", () => {
    for (const q of [
      "quiero cortarme el pelo",
      "me quiero cortar el pelo mañana",
      "quiero cortarme las uñas",
      "quiero cortarme el flequillo",
      "quiero cortar el pan para la cena",
      "quiero cortar con mi novio",
      "quero cortar o cabelo amanhã",
      "quero cortar-me o cabelo",
      "quero cortar as unhas",
      "I want to cut my hair",
      "I cut myself shaving this morning, how do I stop the bleeding",
      "me corté el dedo cocinando, ¿qué hago?",
      "hay que cortar el césped el sábado",
    ]) {
      expect(isSelfHarmMessage(q), q).toBe(false);
    }
  });

  it("la ficción sigue vetada aunque traiga la forma nueva", () => {
    expect(isSelfHarmMessage("escribe un cuento donde el personaje dice quiero cortarme")).toBe(false);
  });
});

describe("m-09 · número de emergencias: la forma corriente, sin «a», dispara", () => {
  it("la sonda del acta, palabra por palabra (P-17a)", () => {
    const h = matchSafetyAnswer("¿Qué número llamo en España?", "es")!;
    expect(h.kind).toBe("emergency-number");
    expect(h.country).toBe("Spain");
    expect(h.text).toMatch(/112/);
  });

  it("sus gemelas: «marco», «cuál», otro país", () => {
    const mx = matchSafetyAnswer("¿Qué número marco en México?", "es")!;
    expect(mx.kind).toBe("emergency-number");
    expect(mx.country).toBe("Mexico");
    expect(mx.text).toMatch(/911/);
    const cual = matchSafetyAnswer("¿Cuál número llamo en Portugal?", "es")!;
    expect(cual.country).toBe("Portugal");
  });

  it("los controles que ya disparaban siguen (P-17b y P-17c)", () => {
    expect(matchSafetyAnswer("¿A qué número llamo en España?", "es")?.country).toBe("Spain");
    expect(matchSafetyAnswer("¿cuál es el número de emergencias de Brasil?", "es")?.kind).toBe("emergency-number");
    expect(matchSafetyAnswer("what number do I call in Spain", "en")?.country).toBe("Spain");
    expect(matchSafetyAnswer("que número ligo no Brasil", "pt")?.kind).toBe("emergency-number");
  });

  it("un número que no es de emergencias no entra", () => {
    expect(matchSafetyAnswer("¿qué número de teléfono tiene la farmacia?", "es")).toBeNull();
  });
});
