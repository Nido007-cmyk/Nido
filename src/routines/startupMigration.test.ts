/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * 0.1.96: NIDO deja expo-notifications por su módulo propio. Lo que expo
 * tenía programado deja de sonar al actualizar (sus alarmas apuntan a un
 * receptor que ya no existe), así que el primer arranque lo programa de
 * nuevo, una sola vez.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  migrated: false,
  reminders: [] as Array<{ id: string; text: string; due_at: string | null; repeat: string | null; done: number }>,
  tasks: [] as Array<{ id: string; name: string; enabled: boolean; nextRunAt: number | null }>,
  scheduledReminders: [] as Array<[string, string, number, string | null | undefined]>,
  scheduledTasks: [] as Array<[string, string, string, number]>,
}));

vi.mock("../notify/notifications", () => ({
  initNotifications: async () => true,
  notifyNow: async () => {},
  refreshBriefingNotification: async () => {},
  cancelBriefingNotification: async () => {},
  cancelReminderNotification: async () => {},
  scheduleReminderNotification: async (id: string, text: string, at: Date, repeat?: string | null) => {
    state.scheduledReminders.push([id, text, at.getTime(), repeat]);
    return true;
  },
  scheduleTaskNotification: async (id: string, title: string, body: string, at: Date) => {
    state.scheduledTasks.push([id, title, body, at.getTime()]);
    return true;
  },
  reminderNotificationTitle: () => "",
  consumeEngineMigration: async () => state.migrated,
}));
vi.mock("../agent/memory/memoryStore", () => ({
  getDueReminders: async () => [],
  completeReminder: async () => {},
  listReminders: async () => state.reminders,
  snapshot: async () => ({ facts: [] }),
}));
vi.mock("../agent/scheduled/taskStore", () => ({ listTasks: async () => state.tasks }));
vi.mock("../agent/tools/handlers", () => ({ upcomingEventsForBriefing: async () => null }));
vi.mock("../models/settings", () => ({
  getDailySummaryEnabled: async () => false,
  getDisabledToolNames: async () => [],
  getLanguageId: async () => "en",
}));

import { resyncAfterEngineChange, runStartupRoutines } from "./startup";

const HOUR = 3_600_000;
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  state.migrated = false;
  state.scheduledReminders = [];
  state.scheduledTasks = [];
  state.reminders = [
    { id: "futuro", text: "Llamar al médico", due_at: iso(now + 2 * HOUR), repeat: null, done: 0 },
    { id: "pasado", text: "Ya vencido", due_at: iso(now - 2 * HOUR), repeat: null, done: 0 },
    { id: "sin-fecha", text: "Algún día", due_at: null, repeat: null, done: 0 },
    { id: "diario", text: "Pastilla", due_at: iso(now + HOUR), repeat: "day", done: 0 },
  ];
  state.tasks = [
    { id: "t-activa", name: "Resumen", enabled: true, nextRunAt: now + 3 * HOUR },
    { id: "t-apagada", name: "Apagada", enabled: false, nextRunAt: now + 3 * HOUR },
    { id: "t-sin-hora", name: "Sin hora", enabled: true, nextRunAt: null },
  ];
});

describe("resyncAfterEngineChange (parte pura)", () => {
  it("vuelve a programar solo los de una vez que aún no llegaron y las tareas activas con hora", async () => {
    const reminders: string[] = [];
    const tasks: string[] = [];
    const out = await resyncAfterEngineChange({
      reminders: state.reminders,
      tasks: state.tasks,
      now,
      scheduleReminder: async (r) => reminders.push(r.id),
      scheduleTask: async (t) => tasks.push(t.id),
    });
    expect(reminders).toEqual(["futuro"]);
    expect(tasks).toEqual(["t-activa"]);
    expect(out).toEqual({ reminders: 1, tasks: 1 });
  });

  it("un fallo al programar uno no corta los demás", async () => {
    const reminders = [
      { id: "a", text: "a", due_at: iso(now + HOUR), repeat: null },
      { id: "b", text: "b", due_at: iso(now + 2 * HOUR), repeat: null },
    ];
    const seen: string[] = [];
    await resyncAfterEngineChange({
      reminders,
      tasks: [],
      now,
      scheduleReminder: async (r) => {
        seen.push(r.id);
        if (r.id === "a") throw new Error("sin permiso");
      },
      scheduleTask: async () => {},
    });
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("runStartupRoutines", () => {
  it("sin migración: solo los repetidos, como siempre", async () => {
    await runStartupRoutines();
    expect(state.scheduledReminders.map(([id]) => id)).toEqual(["diario"]);
    expect(state.scheduledTasks).toEqual([]);
  });

  it("primer arranque tras actualizar: también el recordatorio futuro (de una vez) y la tarea activa", async () => {
    state.migrated = true;
    await runStartupRoutines();
    expect(state.scheduledReminders).toEqual([
      ["diario", "Pastilla", new Date(state.reminders[3].due_at as string).getTime(), "day"],
      ["futuro", "Llamar al médico", new Date(state.reminders[0].due_at as string).getTime(), null],
    ]);
    expect(state.scheduledTasks).toHaveLength(1);
    const [id, title, body, at] = state.scheduledTasks[0];
    expect(id).toBe("t-activa");
    // Los mismos textos que la pantalla de tareas (aquí, el inglés de respaldo).
    expect(title).toBe("NIDO · Resumen");
    expect(body).toMatch(/scheduled task/i);
    expect(at).toBe(now + 3 * HOUR);
  });
});
