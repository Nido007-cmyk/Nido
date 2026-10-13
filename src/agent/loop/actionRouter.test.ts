/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import { extractCalcAction, extractReminderAction, extractTimerAction, extractWeeklyPlanAction, generateWeeklyPlan } from "./actionRouter";

describe("actionRouter: calculadora (FIX 2026-10-07)", () => {
  it("extrae 'cuánto es 245 * 38'", () => {
    const r = extractCalcAction("Cuánto es 245 * 38");
    expect(r).not.toBeNull();
    expect(r!.expression).toBe("245 * 38");
    expect(r!.result).toBe(9310);
  });

  it("extrae 'calcula 10/3'", () => {
    const r = extractCalcAction("calcula 10/3");
    expect(r).not.toBeNull();
    expect(r!.result).toBeCloseTo(3.333, 2);
  });

  it("retorna null sin patrón de cálculo", () => {
    expect(extractCalcAction("hola, ¿cómo estás?")).toBeNull();
    expect(extractCalcAction("cuánto cuesta el pan")).toBeNull();
  });

  it("retorna null para expresión inválida", () => {
    expect(extractCalcAction("cuánto es abc")).toBeNull();
  });
});

describe("actionRouter: recordatorios (FIX 2026-10-07)", () => {
  it("extrae 'agrégame cita con el doctor el viernes a las 10'", () => {
    const r = extractReminderAction("Agrégame cita con el doctor el viernes a las 10");
    expect(r).not.toBeNull();
    expect(r!.text).toContain("doctor");
  });

  it("extrae 'créame un recordatorio para comprar leche'", () => {
    const r = extractReminderAction("créame un recordatorio para comprar leche");
    expect(r).not.toBeNull();
    expect(r!.text).toContain("leche");
  });

  it("retorna null sin patrón", () => {
    expect(extractReminderAction("hola")).toBeNull();
  });
});

describe("WEEKLY-PLAN 2026-10-07", () => {
  it("detecta plan my week en inglés", () => {
    const a = extractWeeklyPlanAction("Help me plan my week: I work 9 to 6");
    expect(a).not.toBeNull();
    expect(a!.workStart).toBe(9);
    expect(a!.workEnd).toBe(18);
  });

  it("detecta planifica mi semana en español", () => {
    const a = extractWeeklyPlanAction("Planifica mi semana, trabajo de 9 a 18");
    expect(a).not.toBeNull();
    expect(a!.workStart).toBe(9);
    expect(a!.workEnd).toBe(18);
  });

  it("extrae ejercicio 3 veces", () => {
    const a = extractWeeklyPlanAction("plan my week, exercise 3 times, work 9 to 6");
    expect(a!.exerciseDays).toBe(3);
  });

  it("no detecta mensajes normales", () => {
    expect(extractWeeklyPlanAction("hola cómo estás")).toBeNull();
    expect(extractWeeklyPlanAction("cuánto es 2+2")).toBeNull();
  });

  it("0.1.24 (H-6): la petición en portugués genera el plan EN portugués", () => {
    // Sonda P3: «planeja minha semana…» → lang «es» y plan en español,
    // porque «semana» también es palabra portuguesa y ganaba el ES.
    const a = extractWeeklyPlanAction("planeja minha semana: trabalho das 9 às 18, exercício 1 hora, família");
    expect(a).not.toBeNull();
    expect(a!.lang).toBe("pt");
    const plan = generateWeeklyPlan(a!);
    expect(plan).toContain("Horário semanal (trabalho 9:00 AM–6:00 PM):");
    expect(plan).toContain("**Segunda-feira**");
    expect(plan).toContain("**Sexta-feira**");
    expect(plan).toContain("Trabalho");
    expect(plan).toContain("Tempo em família");
    expect(plan).not.toContain("Horario semanal");
    // Horas PT reales, no el defecto: «trabalho das 8 às 17».
    const b = extractWeeklyPlanAction("faz um plano semanal, trabalho das 8 às 17, exercício 3 vezes");
    expect(b!.lang).toBe("pt");
    expect(b!.workStart).toBe(8);
    expect(b!.workEnd).toBe(17);
    expect(b!.exerciseDays).toBe(3);
    // El ES sigue en español y el EN en inglés.
    expect(extractWeeklyPlanAction("organiza mi semana")!.lang).toBe("es");
    expect(extractWeeklyPlanAction("plan my week")!.lang).toBe("en");
  });

  it("genera 7 días sin traslapes", () => {
    const plan = generateWeeklyPlan({ workStart: 9, workEnd: 18, exerciseDays: 3, wantsFamilyTime: true, lang: "en" });
    // 7 días mencionados
    expect(plan).toContain("Monday");
    expect(plan).toContain("Sunday");
    // Horario de trabajo correcto (no inventa 8AM)
    expect(plan).toContain("9:00 AM");
    expect(plan).toContain("6:00 PM");
    // No contiene los turnos inventados del bug
    expect(plan).not.toContain("8:00 AM");
  });
});

describe("CALENDAR-FIX 2026-10-07: parseo de fechas", () => {
  it("parsea 'el viernes a las 10'", () => {
    const r = extractReminderAction("agrégame cita con el doctor el viernes a las 10");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
    const d = new Date(r!.dueAt!);
    expect(d.getDay()).toBe(5); // viernes
    expect(d.getHours()).toBe(10);
    // El texto no debe contener la fecha duplicada
    expect(r!.text.toLowerCase()).not.toContain("viernes");
  });

  it("parsea 'mañana'", () => {
    const r = extractReminderAction("créame un recordatorio para comprar leche mañana");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
    const d = new Date(r!.dueAt!);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(d.getDate()).toBe(tomorrow.getDate());
  });

  it("sin fecha clara → dueAt null", () => {
    const r = extractReminderAction("agrégame un recordatorio para algo");
    expect(r).not.toBeNull();
    // "algo" no es fecha
    expect(r!.dueAt).toBeNull();
  });

  it("LOOP-1 FIX: 'recuérdame comprar pan' se captura como recordatorio", () => {
    const r = extractReminderAction("recuérdame comprar pan");
    expect(r).not.toBeNull();
    expect(r!.text.toLowerCase()).toContain("comprar pan");
  });

  it("LOOP-1 FIX: 'remember me to call mom' se captura como recordatorio", () => {
    const r = extractReminderAction("remember me to call mom");
    expect(r).not.toBeNull();
    expect(r!.text.toLowerCase()).toContain("call mom");
  });

  it("M1 FIX: 'a las 25' es inválido (no rollover silencioso)", () => {
    const r = extractReminderAction("recuérdame comprar pan mañana a las 25");
    // Hora 25 inválida → dueAt null (no se inventa 01:00 del día siguiente)
    expect(r).not.toBeNull();
    expect(r!.dueAt).toBeNull();
  });

  it("M1 FIX: '10:75' es inválido (no rollover silencioso)", () => {
    const r = extractReminderAction("recuérdame llamar mañana a las 10:75");
    expect(r).not.toBeNull();
    expect(r!.dueAt).toBeNull();
  });
});

describe("0.1.19: recurrencia pedida y título 'para'", () => {
  it("'cada día recuérdame…' marca recurrenceRequested (se crea una vez y se avisa)", () => {
    const r = extractReminderAction("cada día recuérdame tomar la pastilla a las 9");
    expect(r).not.toBeNull();
    expect(r!.text).toContain("tomar la pastilla");
    expect(r!.dueAt).not.toBeNull();
    expect(r!.recurrenceRequested).toBe(true);
  });

  it("sin palabras de repetición, la marca no aparece", () => {
    const r = extractReminderAction("recuérdame tomar la pastilla a las 9");
    expect(r).not.toBeNull();
    expect(r!.recurrenceRequested).toBeUndefined();
  });

  it("'ponme un recordatorio para el viernes' no crea un recordatorio titulado 'para'", () => {
    expect(extractReminderAction("ponme un recordatorio para el viernes")).toBeNull();
  });

  it("con contenido, el 'para' inicial no contamina el título", () => {
    const r = extractReminderAction("ponme un recordatorio para comprar leche el viernes");
    expect(r).not.toBeNull();
    expect(r!.text).toBe("comprar leche");
    expect(r!.dueAt).not.toBeNull();
  });
});

describe("0.1.19: 'recuerda que' ambiguo y preguntas disfrazadas", () => {
  it("'recuerda que mañana tengo dentista' → recordatorio, no hecho", () => {
    const r = extractReminderAction("recuerda que mañana tengo dentista");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
    expect(r!.text.toLowerCase()).toContain("dentista");
    expect(r!.text.toLowerCase()).not.toContain("mañana");
  });

  it("'remember that tomorrow I have the dentist' → recordatorio", () => {
    const r = extractReminderAction("remember that tomorrow I have the dentist");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
  });

  it("sin evento en primera persona NO es recordatorio (sigue memoria)", () => {
    expect(extractReminderAction("recuerda que mi mamá se llama Marta")).toBeNull();
    expect(extractReminderAction("recuerda que el cumpleaños de mi mamá es el 15 de marzo")).toBeNull();
    expect(extractReminderAction("recuerda que me gusta el café")).toBeNull();
  });

  it("una pregunta no crea un recordatorio basura", () => {
    expect(extractReminderAction("recuérdame cómo se llama la capital de Francia")).toBeNull();
    expect(extractReminderAction("recuérdame qué día es hoy")).toBeNull();
    expect(extractReminderAction("remind me what time it is")).toBeNull();
  });
});

describe("0.1.19: la hora ANTES del verbo no se pierde", () => {
  it("'en media hora recuérdame la junta' → dueAt ≈ +30 min", () => {
    const before = Date.now();
    const r = extractReminderAction("en media hora recuérdame la junta");
    expect(r).not.toBeNull();
    expect(r!.text).toBe("la junta");
    expect(r!.dueAt).not.toBeNull();
    const d = new Date(r!.dueAt!).getTime();
    expect(d - before).toBeGreaterThan(25 * 60 * 1000);
    expect(d - before).toBeLessThan(35 * 60 * 1000);
  });

  it("'mañana recuérdame comprar pan' → dueAt mañana, no null", () => {
    const r = extractReminderAction("mañana recuérdame comprar pan");
    expect(r).not.toBeNull();
    expect(r!.text).toBe("comprar pan");
    expect(r!.dueAt).not.toBeNull();
    const d = new Date(r!.dueAt!);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(d.getDate()).toBe(tomorrow.getDate());
  });

  it("'en 20 minutos recuérdame sacar el pan' → dueAt ≈ +20 min", () => {
    const before = Date.now();
    const r = extractReminderAction("en 20 minutos recuérdame sacar el pan");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
    const d = new Date(r!.dueAt!).getTime();
    expect(d - before).toBeGreaterThan(15 * 60 * 1000);
    expect(d - before).toBeLessThan(25 * 60 * 1000);
  });

  it("sin hora en ninguna parte → dueAt sigue null (sin inventar)", () => {
    const r = extractReminderAction("por favor recuérdame comprar pan");
    expect(r).not.toBeNull();
    expect(r!.dueAt).toBeNull();
  });
});

describe("TESTFIX-2026-10-08: tiempos relativos y hora suelta", () => {
  it("parsea 'Recuerdame en 2 minutes tengo que salir' (evidencia física)", () => {
    const before = Date.now();
    const r = extractReminderAction("Recuerdame en 2 minutes tengo que salir");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
    const d = new Date(r!.dueAt!).getTime();
    // ~2 minutos en el futuro (tolerancia 90s)
    expect(d - before).toBeGreaterThan(30 * 1000);
    expect(d - before).toBeLessThan(210 * 1000);
    // El texto no debe contener el tiempo relativo
    expect(r!.text.toLowerCase()).not.toContain("2 minutes");
    expect(r!.text.toLowerCase()).toContain("tengo que salir");
  });

  it("parsea 'en dos minutos' con palabra numérica", () => {
    const before = Date.now();
    const r = extractReminderAction("recuérdame en dos minutos que tengo que salir");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
    const d = new Date(r!.dueAt!).getTime();
    expect(d - before).toBeGreaterThan(30 * 1000);
    expect(d - before).toBeLessThan(210 * 1000);
    expect(r!.text.toLowerCase()).not.toContain("dos minutos");
  });

  it("parsea 'en 1 hora' en inglés 'in 1 hour'", () => {
    const before = Date.now();
    const r = extractReminderAction("remember me to call mom in 1 hour");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
    const d = new Date(r!.dueAt!).getTime();
    expect(d - before).toBeGreaterThan(50 * 60 * 1000);
    expect(d - before).toBeLessThan(70 * 60 * 1000);
  });

  it("parsea hora suelta 'a las 6:02' como hoy (evidencia física)", () => {
    const r = extractReminderAction("recuérdame a las 23:59 que tengo que salir");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
    const d = new Date(r!.dueAt!);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    // Hoy o mañana (rollover M2 si ya pasó), nunca null
    const now = new Date();
    const diffDays = Math.floor((d.getTime() - now.getTime()) / 86400000);
    expect(diffDays).toBeLessThanOrEqual(1);
  });

  it("hora suelta pasada → mañana (rollover M2)", () => {
    const r = extractReminderAction("recuérdame a las 00:01 que es medianoche");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
    const d = new Date(r!.dueAt!);
    expect(d.getTime()).toBeGreaterThan(Date.now());
  });

  it("'en 0 minutos' no crea recordatorio en el pasado", () => {
    const r = extractReminderAction("recuérdame en 0 minutos algo");
    expect(r).not.toBeNull();
    expect(r!.dueAt).toBeNull();
  });

  it("sin tiempo → dueAt null (pregunta de seguimiento honesta)", () => {
    const r = extractReminderAction("recuérdame comprar pan");
    expect(r).not.toBeNull();
    expect(r!.dueAt).toBeNull();
  });
});

describe("0.1.14 — calculadora y recordatorios en inglés y portugués (guía)", () => {
  it("calculadora: what is / calculate / quanto é", () => {
    expect(extractCalcAction("what is 245 * 38")?.result).toBe(9310);
    expect(extractCalcAction("what is (100 + 50) * 2")?.result).toBe(300);
    expect(extractCalcAction("calculate 3^2")?.result).toBe(9);
    expect(extractCalcAction("quanto é 245 * 38")?.result).toBe(9310);
  });
  it("calculadora: nunca captura preguntas que no son cuentas", () => {
    expect(extractCalcAction("what is love")).toBeNull();
    expect(extractCalcAction("what's the capital of France")).toBeNull();
    expect(extractCalcAction("quanto é o dólar hoje")).toBeNull();
  });
  it("recordatorios: remind me (to) / me lembra de / lembre-me de", () => {
    expect(extractReminderAction("remind me to buy milk in 2 hours")?.text).toBe("buy milk");
    expect(extractReminderAction("remind me to call mom tomorrow at 5")?.text).toBe("call mom");
    expect(extractReminderAction("me lembra de comprar leite em 2 horas")?.text).toBe("comprar leite");
    expect(extractReminderAction("me lembra de comprar leite em 2 horas")?.dueAt).not.toBeNull();
    expect(extractReminderAction("lembre-me de ligar para a Ana amanhã às 5")?.text).toBe("ligar para a Ana");
  });
  it("'me lembra que X' es memoria, no recordatorio", () => {
    expect(extractReminderAction("me lembra que minha cor favorita é azul")).toBeNull();
  });
});

describe("0.1.20 (P3-11) — verbos de aviso crean recordatorio", () => {
  it("«avísame a las 3 de estudiar» → texto «estudiar» con hora", () => {
    const r = extractReminderAction("avísame a las 3 de estudiar");
    expect(r).not.toBeNull();
    expect(r!.text).toBe("estudiar");
    expect(r!.dueAt).not.toBeNull();
    expect(new Date(r!.dueAt!).getHours()).toBe(15);
  });

  it("«avísame cuando sean las 3» → aviso con la frase como título", () => {
    const r = extractReminderAction("avísame cuando sean las 3");
    expect(r).not.toBeNull();
    expect(r!.dueAt).not.toBeNull();
    expect(new Date(r!.dueAt!).getHours()).toBe(15);
    expect(r!.text).toBe("avísame cuando sean las 3");
  });

  it("«despiértame a las 7» → recordatorio a las 7", () => {
    const r = extractReminderAction("despiértame a las 7");
    expect(r).not.toBeNull();
    expect(new Date(r!.dueAt!).getHours()).toBe(7);
  });

  it("EN/PT: «wake me at 7» y «me acorde às 7»", () => {
    expect(extractReminderAction("wake me at 7")).not.toBeNull();
    expect(extractReminderAction("me acorde às 7")).not.toBeNull();
    const en = extractReminderAction("let me know at 3 to study");
    expect(en?.text).toBe("study");
  });

  it("la guardia de preguntas sigue intacta con los verbos nuevos", () => {
    expect(extractReminderAction("avísame cómo llegar al centro")).toBeNull();
  });
});

describe("0.1.20 (P3-14) — plan semanal: formas naturales", () => {
  it("las que faltaban ahora entran", () => {
    expect(extractWeeklyPlanAction("hazme un plan semanal")).not.toBeNull();
    expect(extractWeeklyPlanAction("quiero un plan semanal")).not.toBeNull();
    expect(extractWeeklyPlanAction("plan semanal")).not.toBeNull();
    expect(extractWeeklyPlanAction("hazme un plan para mi semana")).not.toBeNull();
    expect(extractWeeklyPlanAction("make me a weekly plan")).not.toBeNull();
    expect(extractWeeklyPlanAction("weekly plan")).not.toBeNull();
    expect(extractWeeklyPlanAction("faz um plano semanal")).not.toBeNull();
    expect(extractWeeklyPlanAction("planeja minha semana")).not.toBeNull();
    expect(extractWeeklyPlanAction("planifica la semana")).not.toBeNull();
  });

  it("las que ya funcionaban siguen", () => {
    expect(extractWeeklyPlanAction("planifica mi semana")).not.toBeNull();
    expect(extractWeeklyPlanAction("plan my week")).not.toBeNull();
  });

  it("trampas: preguntas y otros «planes» no generan plan", () => {
    expect(extractWeeklyPlanAction("¿cuánto cuesta el plan semanal del gimnasio?")).toBeNull();
    expect(extractWeeklyPlanAction("mi plan de datos es caro")).toBeNull();
    expect(extractWeeklyPlanAction("qué buen plan para el fin de semana")).toBeNull();
  });
});

describe("0.1.20 (P3-16) — temporizador", () => {
  it("formas explícitas en los tres idiomas, con y sin etiqueta", () => {
    expect(extractTimerAction("pon un temporizador de 10 minutos")).toEqual({ label: null, durationMs: 600_000 });
    expect(extractTimerAction("ponme un temporizador de 1 hora y 30 minutos para la pasta")).toEqual({ label: "la pasta", durationMs: 5_400_000 });
    expect(extractTimerAction("temporizador de 45 segundos")).toEqual({ label: null, durationMs: 45_000 });
    expect(extractTimerAction("pon un temporizador de media hora")).toEqual({ label: null, durationMs: 1_800_000 });
    expect(extractTimerAction("set a timer for 10 minutes")).toEqual({ label: null, durationMs: 600_000 });
    expect(extractTimerAction("set a timer for half an hour for the rice")).toEqual({ label: "the rice", durationMs: 1_800_000 });
    expect(extractTimerAction("coloca um temporizador de 10 minutos para a massa")).toEqual({ label: "a massa", durationMs: 600_000 });
    expect(extractTimerAction("pon un temporizador de diez minutos")).toEqual({ label: null, durationMs: 600_000 });
  });

  it("sin duración válida o con forma de pregunta, no hay temporizador", () => {
    expect(extractTimerAction("pon un temporizador")).toBeNull();
    expect(extractTimerAction("pon un temporizador de 2 días")).toBeNull();
    expect(extractTimerAction("¿cuánto dura un temporizador de cocina?")).toBeNull();
    expect(extractTimerAction("pon un temporizador de 10 minutos para 20 minutos")).toBeNull();
    expect(extractTimerAction("recuérdame en 10 minutos comprar pan")).toBeNull();
  });
});
