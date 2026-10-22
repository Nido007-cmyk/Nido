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
  SchedulableTriggerInputTypes: { DATE: "date", DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" },
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

describe("withTimeout (CRASH-2026-10-10)", () => {
  it("devuelve el resultado si llega a tiempo", async () => {
    const { withTimeout } = await import("./notifications");
    await expect(withTimeout(Promise.resolve(true), 50, false)).resolves.toBe(true);
  });

  it("devuelve el valor de reserva si el nativo nunca responde", async () => {
    const { withTimeout } = await import("./notifications");
    await expect(withTimeout(new Promise<boolean>(() => {}), 20, false)).resolves.toBe(false);
  });

  it("un rechazo se convierte en el valor de reserva (nunca lanza)", async () => {
    const { withTimeout } = await import("./notifications");
    await expect(withTimeout(Promise.reject(new Error("x")), 50, false)).resolves.toBe(false);
  });
});

describe("notifyNow (0.1.29)", () => {
  it("va por el canal de recordatorios (oculto en la pantalla de bloqueo), no por el canal por defecto", async () => {
    const { notifyNow } = await import("./notifications");
    mocks.scheduleNotificationAsync.mockClear();
    mocks.scheduleNotificationAsync.mockResolvedValue("x");
    await notifyNow("Tarea lista", "Tus notas dicen…");
    const call = mocks.scheduleNotificationAsync.mock.calls[0][0];
    expect(call.trigger).toEqual({ channelId: "nido-reminders" });
    expect(call.content.body).toBe("Tus notas dicen…");
  });
});

describe("0.1.32: recordatorios que se repiten", () => {
  it("cada día → DAILY a esa hora, mismo identificador", async () => {
    mocks.scheduleNotificationAsync.mockResolvedValue("id");
    const at = new Date(2026, 9, 14, 8, 30);
    const ok = await scheduleReminderNotification("r1", "pastilla", at, "day");
    expect(ok).toBe(true);
    const arg = mocks.scheduleNotificationAsync.mock.calls[0][0];
    expect(arg.identifier).toBe("nido-reminder-r1");
    expect(arg.trigger).toEqual({ type: "daily", hour: 8, minute: 30, channelId: "nido-reminders" });
  });

  it("cada semana → WEEKLY con el día de expo (1 = domingo)", async () => {
    mocks.scheduleNotificationAsync.mockResolvedValue("id");
    const at = new Date(2026, 9, 19, 9, 0); // lunes
    await scheduleReminderNotification("r2", "basura", at, "week");
    const arg = mocks.scheduleNotificationAsync.mock.calls[0][0];
    expect(arg.trigger).toEqual({ type: "weekly", weekday: 2, hour: 9, minute: 0, channelId: "nido-reminders" });
  });

  it("uno repetido con base pasada se programa igual (no tiene «pasado»)", async () => {
    mocks.scheduleNotificationAsync.mockResolvedValue("id");
    const ok = await scheduleReminderNotification("r3", "x", new Date(2020, 0, 1, 9, 0), "day");
    expect(ok).toBe(true);
  });

  it("sin repetición sigue siendo DATE y rechaza el pasado", async () => {
    const ok = await scheduleReminderNotification("r4", "x", new Date(2020, 0, 1, 9, 0));
    expect(ok).toBe(false);
    expect(mocks.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe("0.1.35: cada mes / cada año", () => {
  it("mensual → MONTHLY con el día; anual → YEARLY con mes base 0", async () => {
    mocks.scheduleNotificationAsync.mockResolvedValue("id");
    await scheduleReminderNotification("m1", "alquiler", new Date(2026, 10, 1, 9, 30), "month");
    expect(mocks.scheduleNotificationAsync.mock.calls[0][0].trigger).toEqual({ type: "monthly", day: 1, hour: 9, minute: 30, channelId: "nido-reminders" });
    await scheduleReminderNotification("y1", "cumpleaños", new Date(2027, 2, 15, 9, 0), "year");
    expect(mocks.scheduleNotificationAsync.mock.calls[1][0].trigger).toEqual({ type: "yearly", month: 2, day: 15, hour: 9, minute: 0, channelId: "nido-reminders" });
  });
});

describe("0.1.47: aviso de mensaje NIDO", () => {
  it("canal propio oculto en la pantalla de bloqueo", async () => {
    await initNotifications();
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalledWith(
      "nido-messages",
      expect.objectContaining({ lockscreenVisibility: 3 }),
    );
  });

  it("un solo aviso, sin remitente ni texto del mensaje", async () => {
    const { notifyIncomingP2P } = await import("./notifications");
    await notifyIncomingP2P();
    await notifyIncomingP2P();
    expect(mocks.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    for (const [arg] of mocks.scheduleNotificationAsync.mock.calls) {
      expect(arg.identifier).toBe("nido-p2p-message");
      expect(arg.content).toEqual({ title: "NIDO", body: "New NIDO message", sound: "default" });
      expect(arg.trigger).toEqual({ channelId: "nido-messages" });
    }
  });
});
