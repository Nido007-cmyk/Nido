/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/** 0.1.32: cuenta atrás de fechas y recordatorio con fecha pero sin contenido. */
import { describe, expect, it } from "vitest";
import { countdownTarget, extractToolAction, routerMessage, runToolAction } from "./toolRouter";
import { extractReminderAction, reminderMissingText } from "./actionRouter";
import { classifyIntent } from "./intent";

const NOW = new Date(2026, 9, 13, 10, 0); // martes 13-10-2026

describe("cuenta atrás", () => {
  it.each([
    ["cuánto falta para navidad", "es", "Navidad", 11, 25],
    ["cuántos días faltan para nochebuena", "es", "Nochebuena", 11, 24],
    ["how many days until christmas", "en", "Christmas", 11, 25],
    ["how long until new year", "en", "New Year's Day", 0, 1],
    ["quanto falta para o natal", "pt", "o Natal", 11, 25],
    ["quantos dias faltam para o ano novo", "pt", "o Ano Novo", 0, 1],
  ])("%s", (s, lang, label, month, day) => {
    const a = extractToolAction(s, NOW) as { kind: string; target: string; label: string; lang: string };
    expect(a).toMatchObject({ kind: "countdown", label, lang });
    const d = new Date(a.target);
    expect([d.getMonth(), d.getDate()]).toEqual([month, day]);
    expect(d.getTime()).toBeGreaterThanOrEqual(new Date(2026, 9, 13).getTime());
  });

  it("fechas sin nombre: sin etiqueta, la respuesta nombra el día", () => {
    const c = countdownTarget("25 de diciembre", NOW, "es");
    expect(c?.label).toBe("");
    expect([c!.target.getMonth(), c!.target.getDate()]).toEqual([11, 25]);
  });

  it("una fiesta que ya pasó este año es la del año que viene", () => {
    const c = countdownTarget("halloween", new Date(2026, 10, 2), "en");
    expect(c!.target.getFullYear()).toBe(2027);
  });

  it("calcula los días y responde en el idioma", async () => {
    const deps = {
      isDisabled: () => false,
      dispatch: async () => ({ status: "executed" as const, text: "" }),
      now: () => NOW,
    };
    const es = await runToolAction(extractToolAction("cuánto falta para navidad", NOW)!, deps as never);
    expect(es.response).toBe("Faltan 73 días para Navidad (viernes, 25 de diciembre).");
    const en = await runToolAction(extractToolAction("how many days until christmas", NOW)!, deps as never);
    expect(en.response).toBe("73 days until Christmas (Friday, December 25).");
    const today = await runToolAction(extractToolAction("cuánto falta para el 13 de octubre", NOW)!, deps as never);
    expect(today.response).toMatch(/^¡Es hoy!/);
  });

  it("lo que no se entiende no se inventa", () => {
    expect(extractToolAction("cuánto falta para que llegue mi hermano", NOW)?.kind).not.toBe("countdown");
  });
});

describe("recordatorio con fecha pero sin contenido: se pregunta qué", () => {
  it.each(["ponme un recordatorio para el lunes", "set a reminder for monday", "me põe um lembrete para segunda", "set a reminder for 5pm"])(
    "%s",
    (s) => {
      expect(extractReminderAction(s)).toBeNull();
      expect(reminderMissingText(s)).toBeTruthy();
      expect(classifyIntent(s)).toBe("actuar");
    },
  );
  it("con contenido sigue creando el recordatorio", () => {
    expect(reminderMissingText("ponme un recordatorio para el lunes de pagar la luz")).toBeNull();
    expect(extractReminderAction("ponme un recordatorio para el lunes de pagar la luz")?.text).toBe("pagar la luz");
  });
  it("las alarmas sin texto siguen siendo avisos", () => {
    expect(extractReminderAction("pon una alarma a las 7")?.dueAt).toBeTruthy();
  });
  it("el mensaje existe en los tres idiomas", () => {
    for (const l of ["es", "en", "pt"] as const) expect(routerMessage("reminderAskWhat", l, { when: " X" })).toContain(" X");
  });
});
