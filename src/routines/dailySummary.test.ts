/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.60: el resumen diario de las 8:00 es opcional y viene apagado
 * (constitución de NIDO §9: las notificaciones son las que la persona pide).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const calls: string[] = [];
let enabledSetting: boolean | undefined;

vi.mock("../notify/notifications", () => ({
  initNotifications: async () => true,
  notifyNow: async () => {},
  refreshBriefingNotification: async () => { calls.push("schedule"); },
  cancelBriefingNotification: async () => { calls.push("cancel"); },
  cancelReminderNotification: async () => {},
  scheduleReminderNotification: async () => {},
  reminderNotificationTitle: () => "",
}));
vi.mock("../agent/memory/memoryStore", () => ({
  getDueReminders: async () => [],
  completeReminder: async () => {},
  listReminders: async () => [],
  snapshot: async () => ({ facts: [] }),
}));
vi.mock("../agent/tools/handlers", () => ({ upcomingEventsForBriefing: async () => null }));
vi.mock("../models/settings", () => ({
  getDailySummaryEnabled: async () => enabledSetting ?? false,
  getDisabledToolNames: async () => [],
  getLanguageId: async () => "en",
}));

import { applyDailySummarySetting, briefingDateLine, briefingFactsLine, decideDailySummary, runStartupRoutines } from "./startup";

beforeEach(() => {
  calls.length = 0;
  enabledSetting = undefined;
});

describe("resumen diario: opcional", () => {
  it("sin tocar el ajuste, el arranque NO lo programa y quita uno viejo", async () => {
    await runStartupRoutines();
    expect(calls).toEqual(["cancel"]);
  });

  it("activado, el arranque lo programa", async () => {
    enabledSetting = true;
    await runStartupRoutines();
    expect(calls).toEqual(["schedule"]);
  });

  it("el interruptor aplica el cambio al momento", async () => {
    enabledSetting = true;
    await applyDailySummarySetting();
    enabledSetting = false;
    await applyDailySummarySetting();
    expect(calls).toEqual(["schedule", "cancel"]);
  });

  it("parte pura", async () => {
    const log: string[] = [];
    const deps = { schedule: async () => { log.push("s"); }, cancel: async () => { log.push("c"); } };
    expect(await decideDailySummary(true, deps)).toBe("scheduled");
    expect(await decideDailySummary(false, deps)).toBe("cancelled");
    expect(log).toEqual(["s", "c"]);
  });

  it("el arranque ya no programa el resumen por su cuenta", () => {
    const src = readFileSync(join(__dirname, "startup.ts"), "utf8");
    const body = src.slice(src.indexOf("export async function runStartupRoutines"), src.indexOf("export async function applyDailySummarySetting"));
    expect(body).not.toContain("refreshBriefingNotification(");
  });
});

describe("resumen diario: en el idioma de la app", () => {
  const d = new Date(2026, 9, 29);
  it("fecha", () => {
    expect(briefingDateLine(d, "en")).toMatch(/^Today is /);
    expect(briefingDateLine(d, "pt")).toMatch(/^Hoje é /);
    expect(briefingDateLine(d, "es")).toMatch(/^Hoy es /);
  });
  it("datos guardados, singular y plural", () => {
    expect(briefingFactsLine(1, "en")).toBe("You have 1 fact saved in memory.");
    expect(briefingFactsLine(3, "pt")).toBe("Você tem 3 dados salvos na memória.");
    expect(briefingFactsLine(2, "es")).toBe("Tienes 2 datos guardados en memoria.");
  });
});
