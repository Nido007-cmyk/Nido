/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * dispatcher.t30.test.ts — TANDA T-30 (0.1.99): la validación
 * «iso-datetime» de M-17 aceptaba fechas de calendario INEXISTENTES.
 *
 * Hallazgo H-Z5-1 de la re-auditoría (zona 5, variante V-A3):
 * isIsoDateTime comprobaba rangos sueltos (mes 1-12, día 1-31) y fiaba
 * el resto a Date.parse como «segunda red» declarada
 * «engine-independiente». No lo es: en V8, Date.parse NORMALIZA el
 * día desbordado (2027-02-30 → 2027-03-02) en vez de devolver NaN, y
 * el handler solo descarta NaN, así que el recordatorio o el evento
 * se creaba en la fecha corrida, en silencio: la familia del crítico
 * C-01 («fecha correcta o aviso honesto, nunca otra fecha en
 * silencio») por la vía de las herramientas del agente.
 *
 * La cura: el día se contrasta con los días que tiene su mes (tabla
 * con bisiestos gregorianos) SIN fiarse de Date.parse. Esta sonda es
 * la regresión permanente: los casos imposibles de V-A3, los
 * controles sanos y el barrido de la clase entera (los cinco campos
 * con format: "iso-datetime" del manifiesto pasan por la misma
 * validación central, no solo los dos medidos por la re-auditoría).
 */
import { describe, it, expect } from "vitest";
import { validateToolCall } from "./dispatcher";

const reminderAt = (at: string) =>
  validateToolCall({ name: "create_reminder", arguments: { text: "revisión", at } });
const eventStart = (start: string) =>
  validateToolCall({ name: "create_calendar_event", arguments: { title: "cita", start } });
const eventEnd = (end: string) =>
  validateToolCall({
    name: "create_calendar_event",
    arguments: { title: "cita", start: "2026-09-27T10:00:00", end },
  });
const listFrom = (from: string) =>
  validateToolCall({ name: "list_calendar_events", arguments: { from } });
const listTo = (to: string) =>
  validateToolCall({ name: "list_calendar_events", arguments: { to } });

describe("H-Z5-1: una fecha de calendario inexistente no es un iso-datetime válido (V-A3)", () => {
  it("create_reminder.at con 30 de febrero se rechaza", () => {
    expect(reminderAt("2027-02-30T10:00:00").ok).toBe(false);
  });

  it("create_reminder.at con 31 de abril se rechaza", () => {
    expect(reminderAt("2026-04-31T10:00:00").ok).toBe(false);
  });

  it("create_reminder.at con 29 de febrero en año NO bisiesto se rechaza", () => {
    expect(reminderAt("2026-02-29T10:00:00").ok).toBe(false);
  });

  it("create_calendar_event.start con 30 de febrero se rechaza", () => {
    expect(eventStart("2027-02-30T09:00:00").ok).toBe(false);
  });

  it("control: el 29 de febrero bisiesto de verdad sigue siendo válido", () => {
    expect(reminderAt("2028-02-29T10:00:00").ok).toBe(true);
  });

  it("control: una fecha ordinaria sigue siendo válida", () => {
    expect(reminderAt("2026-12-25T10:30").ok).toBe(true);
  });

  it("control: mes 13 y hora 24 se siguen rechazando por rango", () => {
    expect(reminderAt("2026-13-10T10:00:00").ok).toBe(false);
    expect(reminderAt("2026-12-10T24:00:00").ok).toBe(false);
  });
});

describe("H-Z5-1: barrido de la clase — los cinco campos iso-datetime comparten la cura", () => {
  it("create_calendar_event.end con 31 de junio se rechaza", () => {
    expect(eventEnd("2026-06-31T11:00:00").ok).toBe(false);
    expect(eventEnd("2026-06-30T11:00:00").ok).toBe(true);
  });

  it("list_calendar_events.from con 29 de febrero no bisiesto se rechaza", () => {
    expect(listFrom("2026-02-29T00:00:00").ok).toBe(false);
    expect(listFrom("2026-02-28T00:00:00").ok).toBe(true);
  });

  it("list_calendar_events.to con 31 de septiembre se rechaza", () => {
    expect(listTo("2026-09-31T23:59:59").ok).toBe(false);
    expect(listTo("2026-09-30T23:59:59").ok).toBe(true);
  });

  it("los meses de 30 días no admiten el 31; los de 31 sí", () => {
    for (const mes of ["04", "06", "09", "11"]) {
      expect(reminderAt(`2026-${mes}-31T10:00:00`).ok).toBe(false);
      expect(reminderAt(`2026-${mes}-30T10:00:00`).ok).toBe(true);
    }
    for (const mes of ["01", "03", "05", "07", "08", "10", "12"]) {
      expect(reminderAt(`2026-${mes}-31T10:00:00`).ok).toBe(true);
    }
  });

  it("febrero: la regla gregoriana completa (÷4 sí, ÷100 no, ÷400 sí)", () => {
    expect(reminderAt("2024-02-29T10:00:00").ok).toBe(true);
    expect(reminderAt("2025-02-29T10:00:00").ok).toBe(false);
    expect(reminderAt("2100-02-29T10:00:00").ok).toBe(false);
    expect(reminderAt("2000-02-29T10:00:00").ok).toBe(true);
    expect(reminderAt("2027-02-28T10:00:00").ok).toBe(true);
  });

  it("el sufijo de zona no salva una fecha imposible", () => {
    expect(reminderAt("2027-02-30T10:00:00Z").ok).toBe(false);
    expect(reminderAt("2027-02-30T10:00:00+05:00").ok).toBe(false);
    expect(reminderAt("2028-02-29T10:00:00Z").ok).toBe(true);
  });
});
