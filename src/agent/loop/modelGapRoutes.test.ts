/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.30 (auditoría 2026-10-13, punto 4): frases normales que caían al
 * modelo pequeño (que inventa la hora o el resultado, o llama mal a las
 * herramientas) y ahora tienen ruta determinista.
 */
import { describe, expect, it } from "vitest";
import { extractCalcAction, extractReminderAction, reminderMissingText } from "./actionRouter";
import { extractToolAction } from "./toolRouter";
import { classifyIntent } from "./intent";

describe("hora", () => {
  it.each(["dime la hora", "me das la hora", "la hora", "qué hora es ahora", "tell me the time", "current time", "me diz as horas"])(
    "%s → hora del sistema",
    (s) => {
      expect(extractToolAction(s)).toMatchObject({ kind: "time", what: "time" });
    },
  );
});

describe("conversiones con la unidad destino primero", () => {
  it.each([
    ["cuántas millas son 10 km", "km", "millas"],
    ["cuántos pies son 2 metros", "metros", "pies"],
    ["quantas milhas são 10 km", "km", "milhas"],
  ])("%s", (s, from, to) => {
    expect(extractToolAction(s)).toMatchObject({ kind: "convert", value: s.includes("2 metros") ? 2 : 10, from, to });
  });
});

describe("abrir un dominio sin https", () => {
  it.each([
    ["abre youtube.com", "https://youtube.com"],
    ["open google.com", "https://google.com"],
    ["abra es.wikipedia.org/wiki/Brasil", "https://es.wikipedia.org/wiki/Brasil"],
    ["abre https://wikipedia.org", "https://wikipedia.org"],
  ])("%s", (s, url) => {
    expect(extractToolAction(s)).toMatchObject({ kind: "openLink", url });
  });
  it.each(["abre notas.pdf", "abre informe.docx", "open photo.jpg"])("%s no es un enlace", (s) => {
    expect(extractToolAction(s)?.kind).not.toBe("openLink");
  });
});

describe("alarmas y avisos", () => {
  it("pon una alarma a las 7 → aviso con hora", () => {
    const r = extractReminderAction("pon una alarma a las 7");
    expect(r?.dueAt).toBeTruthy();
  });
  it("set a reminder for 5pm → sin contenido: se pregunta qué recordar a las 17:00 (0.1.32)", () => {
    expect(extractReminderAction("set a reminder for 5pm")).toBeNull();
    const due = reminderMissingText("set a reminder for 5pm");
    expect(new Date(due!).getHours()).toBe(17);
  });
  it.each([
    ["no me dejes olvidar comprar pan", "comprar pan"],
    ["don't let me forget to call mom", "call mom"],
  ])("%s", (s, text) => {
    expect(extractReminderAction(s)?.text).toBe(text);
  });
  it("todas entran como acción", () => {
    for (const s of ["pon una alarma a las 7", "set a reminder for 5pm", "no me dejes olvidar comprar pan"]) {
      // (sin contenido, «set a reminder for 5pm» entra igual: el loop pregunta qué)
      expect(classifyIntent(s)).toBe("actuar");
    }
  });
});

describe("raíz sin «cuadrada»", () => {
  it("la raíz de 16 = 4", () => {
    expect(extractCalcAction("la raíz de 16")?.result).toBe(4);
    expect(extractCalcAction("cuánto es la raíz de 81")?.result).toBe(9);
  });
});

describe("0.1.41 — prueba física en la Tab A9+", () => {
  const now = new Date(2026, 9, 14, 17, 55);

  it("«grades» (errata) también convierte, y en el sentido correcto", () => {
    expect(extractToolAction("Cuantos grades Fahrenheit son 30 grados", now)).toMatchObject({ kind: "convert", value: 30, from: "grados", to: "fahrenheit" });
    expect(extractToolAction("pasa 30 grado a fahrenheit", now)).toMatchObject({ kind: "convert", from: "grados", to: "fahrenheit" });
  });

  it.each([
    ["Que dia cae el 25 de diciembre", { year: 2026, month: 12, day: 25, lang: "es" }],
    ["¿qué día de la semana es el 1 de enero?", { year: 2027, month: 1, day: 1, lang: "es" }],
    ["que dia cae el 25 de diciembre de 2027", { year: 2027, month: 12, day: 25 }],
    ["what day is December 25", { year: 2026, month: 12, day: 25, lang: "en" }],
    ["what day of the week is the 4th of July 2027", { year: 2027, month: 7, day: 4, lang: "en" }],
    ["que dia cai 25 de dezembro", { year: 2026, month: 12, day: 25, lang: "pt" }],
  ])("%s → día de la semana sin modelo", (input, want) => {
    expect(extractToolAction(input, now)).toMatchObject({ kind: "weekday", ...want });
    expect(classifyIntent(input)).toBe("actuar");
  });

  it("una fecha imposible no se inventa", () => {
    expect(extractToolAction("qué día cae el 31 de febrero", now)).toBeNull();
  });

  it("«qué día es hoy» sigue siendo la fecha de hoy", () => {
    expect(extractToolAction("qué día es hoy", now)).toMatchObject({ kind: "time", what: "date" });
  });

  it("«avísame en 20 minutos que saque la ropa» → título sin el «que»", () => {
    expect(extractReminderAction("Avisame en 20 minutos que saque la ropa", now)?.text).toBe("saque la ropa");
  });
});
