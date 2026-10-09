/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requestPermissionsAsync: vi.fn(),
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  addNotificationReceivedListener: vi.fn(),
}));

vi.mock("expo-notifications", () => ({
  requestPermissionsAsync: mocks.requestPermissionsAsync,
  setNotificationHandler: mocks.setNotificationHandler,
  setNotificationChannelAsync: mocks.setNotificationChannelAsync,
  scheduleNotificationAsync: mocks.scheduleNotificationAsync,
  cancelScheduledNotificationAsync: mocks.cancelScheduledNotificationAsync,
  addNotificationReceivedListener: mocks.addNotificationReceivedListener,
  SchedulableTriggerInputTypes: { DATE: "date", DAILY: "daily" },
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  AndroidNotificationVisibility: { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 2, SECRET: 3 },
}));

const memMocks = vi.hoisted(() => ({
  completeReminder: vi.fn(),
}));

vi.mock("../agent/memory/memoryStore", () => ({
  completeReminder: memMocks.completeReminder,
}));

import {
  initNotifications,
  scheduleReminderNotification,
  cancelReminderNotification,
  refreshBriefingNotification,
  __resetNotificationsForTests,
} from "./notifications";

beforeEach(() => {
  vi.clearAllMocks();
  __resetNotificationsForTests();
  mocks.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
});

describe("initNotifications", () => {
  it("pide permiso y crea los canales cuando se concede", async () => {
    const ok = await initNotifications();
    expect(ok).toBe(true);
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalledWith(
      "nido-reminders",
      // Unit tests can't load the i18n chain: notifications fall back to
      // English, the app default.
      expect.objectContaining({ name: "NIDO Reminders" })
    );
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalledWith(
      "nido-briefing",
      expect.objectContaining({ name: "NIDO Daily Briefing" })
    );
    // M-1: el contenido de recordatorios y resumen no se lee en la
    // pantalla de bloqueo sin pasar la puerta biométrica.
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalledWith(
      "nido-reminders",
      expect.objectContaining({ lockscreenVisibility: 3 })
    );
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalledWith(
      "nido-briefing",
      expect.objectContaining({ lockscreenVisibility: 3 })
    );
  });

  it("devuelve false si no hay permiso", async () => {
    mocks.requestPermissionsAsync.mockResolvedValue({ status: "denied" });
    expect(await initNotifications()).toBe(false);
  });
});

describe("scheduleReminderNotification", () => {
  it("programa con identificador único por recordatorio", async () => {
    mocks.scheduleNotificationAsync.mockResolvedValue("abc");
    const ok = await scheduleReminderNotification("r1", "Comprar pan", new Date(Date.now() + 60000));
    expect(ok).toBe(true);
    expect(mocks.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "nido-reminder-r1",
        content: expect.objectContaining({ body: "Comprar pan" }),
      })
    );
  });

  it("devuelve false si falla el programado", async () => {
    mocks.scheduleNotificationAsync.mockRejectedValue(new Error("nope"));
    const ok = await scheduleReminderNotification("r1", "x", new Date());
    expect(ok).toBe(false);
  });
});

describe("cancelReminderNotification", () => {
  it("cancela por identificador", async () => {
    await cancelReminderNotification("r9");
    expect(mocks.cancelScheduledNotificationAsync).toHaveBeenCalledWith("nido-reminder-r9");
  });
});

describe("refreshBriefingNotification", () => {
  it("reemplaza el resumen anterior y lo programa", async () => {
    await refreshBriefingNotification("Tu día: 2 eventos.");
    expect(mocks.cancelScheduledNotificationAsync).toHaveBeenCalledWith("nido-daily-briefing");
    expect(mocks.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: "nido-daily-briefing",
        content: expect.objectContaining({ body: "Tu día: 2 eventos." }),
      })
    );
  });
});

describe("FIX 2026-10-08: notificación entregada marca el recordatorio", () => {
  it("registra un listener que completa el reminder al entregarse", async () => {
    const ok = await initNotifications();
    expect(ok).toBe(true);
    expect(mocks.addNotificationReceivedListener).toHaveBeenCalledTimes(1);
    const listener = mocks.addNotificationReceivedListener.mock.calls[0][0];
    expect(typeof listener).toBe("function");
  });

  it("el listener ignora notificaciones que no son de recordatorio", async () => {
    await initNotifications();
    const listener = mocks.addNotificationReceivedListener.mock.calls[0][0];
    // No debe lanzar aunque el identificador sea de otro tipo.
    await expect(
      listener({ request: { identifier: "nido-daily-briefing" } })
    ).resolves.toBeUndefined();
    await expect(
      listener({ request: { identifier: "otro" } })
    ).resolves.toBeUndefined();
    expect(memMocks.completeReminder).not.toHaveBeenCalled();
  });

  it("el listener completa el recordatorio cuando se entrega su aviso", async () => {
    await initNotifications();
    const listener = mocks.addNotificationReceivedListener.mock.calls[0][0];
    await listener({ request: { identifier: "nido-reminder-abc123" } });
    expect(memMocks.completeReminder).toHaveBeenCalledWith("abc123");
  });
});
