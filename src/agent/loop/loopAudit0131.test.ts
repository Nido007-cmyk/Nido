/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.31 — auditoría del loop en es/en/pt (2026-10-13): cada hallazgo con
 * su regresión. Frases normales que caían al modelo o al conocimiento, o
 * que respondían en el idioma equivocado.
 */
import { describe, expect, it } from "vitest";
import { extractToolAction, routerMessage, settleSharedLang } from "./toolRouter";
import { extractCalcAction, generateWeeklyPlan, stripDateWords } from "./actionRouter";
import { extractImplicitFact } from "./rememberRouter";
import { classifyIntent } from "./intent";

describe("NIDO por mensaje: la forma que la propia app enseña", () => {
  it.each([
    ["manda por nido a Ana que llego tarde", "Ana", "llego tarde"],
    ["envía por nido a Ana: llego tarde", "Ana", "llego tarde"],
    ["mándale a Ana por nido que llego tarde", "Ana", "llego tarde"],
  ])("%s", (s, to, text) => {
    expect(extractToolAction(s)).toMatchObject({ kind: "nidoSend", to, text, lang: "es" });
  });
  it("sin texto pregunta qué escribir (y la pregunta enseña una forma que funciona)", () => {
    expect(extractToolAction("manda por nido a Ana")).toMatchObject({ kind: "nidoSend", to: "Ana", text: null });
    expect(routerMessage("nidoAskText", "es", { to: "Ana" })).toContain("manda por nido a Ana que");
  });
});

describe("temporizador: cancelar", () => {
  it.each([
    ["cancela el temporizador", "temporizador", "es"],
    ["cancel the timer", "timer", "en"],
    ["cancela o temporizador", "temporizador", "pt"],
  ])("%s", (s, query, lang) => {
    const a = extractToolAction(s);
    expect(a).toMatchObject({ kind: "reminderDelete", target: { type: "one", query } });
    expect(settleSharedLang(a!, s, lang as "es" | "en" | "pt").lang).toBe(lang);
  });
});

describe("olvidar algo de la memoria: respuesta honesta, nunca un «listo» falso", () => {
  it.each([["olvida mi color favorito", "es"], ["forget my favorite color", "en"], ["esqueça minha cor favorita", "pt"]])("%s", (s, lang) => {
    expect(extractToolAction(s)).toMatchObject({ kind: "memoryForgetHelp", lang });
    expect(classifyIntent(s)).toBe("actuar");
  });
  it.each(["forget it", "forget about it", "olvida eso", "esqueça isso"])("%s no es una orden de memoria", (s) => {
    expect(extractToolAction(s)?.kind).not.toBe("memoryForgetHelp");
  });
  it("el mensaje existe en los tres idiomas y nombra la pantalla", () => {
    expect(routerMessage("memoryForgetHelp", "es")).toContain("Mi memoria");
    expect(routerMessage("memoryForgetHelp", "en")).toContain("My Memory");
    expect(routerMessage("memoryForgetHelp", "pt")).toContain("Minha Memória");
  });
});

describe("hora, agenda y pendientes", () => {
  it.each(["hora", "time please", "the time"])("%s → hora", (s) => {
    expect(extractToolAction(s)).toMatchObject({ kind: "time", what: "time" });
  });
  it("minha agenda desta semana → agenda de la semana", () => {
    expect(extractToolAction("minha agenda desta semana")).toMatchObject({ kind: "calendarList", label: "week", lang: "pt" });
  });
  it.each([["qué tengo pendiente", "es"], ["what's pending", "en"], ["o que tenho pendente", "pt"]])("%s → recordatorios", (s, lang) => {
    expect(extractToolAction(s)).toMatchObject({ kind: "reminderList", lang });
  });
  it.each([
    ["add a meeting on monday at 9", "meeting", "en"],
    ["marca reunião segunda às 9", "reunião", "pt"],
  ])("%s → evento «%s»", (s, title, lang) => {
    const a = extractToolAction(s);
    expect(a).toMatchObject({ kind: "calendarCreate", title, lang });
    expect((a as { start: string | null }).start).toBeTruthy();
  });
  it("el día de la semana no se come la «o» de «reunião»", () => {
    expect(stripDateWords("reunião segunda")).toBe("reunião");
    expect(stripDateWords("canção na sexta")).toBe("canção");
    expect(stripDateWords("dentist on friday")).toBe("dentist");
  });
});

describe("idioma compartido es/pt: manda el de la app si la frase no es claramente del otro", () => {
  it("«anota que preciso pagar a luz» con la app en portugués responde en portugués", () => {
    const a = extractToolAction("anota que preciso pagar a luz")!;
    expect(a.lang).toBe("es"); // la regla que casa es la española…
    expect(settleSharedLang(a, "anota que preciso pagar a luz", "pt").lang).toBe("pt"); // …pero responde en pt
  });
  it("una frase claramente española sigue en español aunque la app esté en portugués", () => {
    const a = extractToolAction("anota que mañana tengo dentista")!;
    expect(settleSharedLang(a, "anota que mañana tengo dentista", "pt").lang).toBe("es");
  });
  it("con la app en inglés no cambia nada", () => {
    const a = extractToolAction("anota que preciso pagar a luz")!;
    expect(settleSharedLang(a, "anota que preciso pagar a luz", "en").lang).toBe("es");
  });
});

describe("memoria y cálculo", () => {
  it("my mom's birthday is March 15 se guarda (como en es/pt)", () => {
    expect(extractImplicitFact("my mom's birthday is March 15")?.content).toBe("my mom's birthday is March 15");
    expect(classifyIntent("my mom's birthday is March 15")).not.toBe("conversar");
  });
  it.each([["what is 2 to the power of 8", 256], ["2 elevado a la 8", 256], ["cuánto es 3 elevado a la potencia 3", 27]])("%s", (s, v) => {
    expect(extractCalcAction(s)?.result).toBe(v);
  });
});

describe("plan semanal", () => {
  it("en español y portugués la hora va en 24 h; en inglés con AM/PM", () => {
    const es = generateWeeklyPlan({ workStart: 9, workEnd: 18, exerciseDays: 3, wantsFamilyTime: true, lang: "es" } as never);
    expect(es).toContain("9:00–18:00");
    expect(es).not.toMatch(/AM|PM/);
    const en = generateWeeklyPlan({ workStart: 9, workEnd: 18, exerciseDays: 3, wantsFamilyTime: true, lang: "en" });
    expect(en).toContain("9:00 AM–6:00 PM");
  });
});
