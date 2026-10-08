import { describe, it, expect } from "vitest";
import { extractCalcAction, extractReminderAction, extractWeeklyPlanAction, generateWeeklyPlan } from "./actionRouter";

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

  it("genera 7 días sin traslapes", () => {
    const plan = generateWeeklyPlan({ workStart: 9, workEnd: 18, exerciseDays: 3, wantsFamilyTime: true });
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
});
