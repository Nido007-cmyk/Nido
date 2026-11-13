/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La superficie de programación de nido-notify: lo que NIDO pide y lo que
 * llega al lado nativo, con las mismas reglas que expo-notifications.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// notifications.ts importa la fachada; aquí basta su parte pura.
vi.mock("nido-notify", async () => await import("./triggers"));
import { reminderTrigger } from "../../src/notify/notifications";
import { toNativeRequest, toNativeTrigger, AndroidImportance, AndroidNotificationVisibility } from "./triggers";

describe("toNativeTrigger", () => {
  it("fecha fija: Date o número pasan a timestamp en milisegundos", () => {
    const at = new Date(2026, 10, 20, 9, 30);
    expect(toNativeTrigger({ type: "date", date: at, channelId: "nido-reminders" })).toEqual({
      trigger: { type: "date", timestamp: at.getTime() },
      channelId: "nido-reminders",
    });
    expect(toNativeTrigger({ type: "date", date: 1234 })).toEqual({ trigger: { type: "date", timestamp: 1234 } });
  });

  it("diario, semanal, mensual y anual llevan solo sus campos", () => {
    expect(toNativeTrigger({ type: "daily", hour: 8, minute: 0, channelId: "nido-briefing" })).toEqual({
      trigger: { type: "daily", hour: 8, minute: 0 },
      channelId: "nido-briefing",
    });
    expect(toNativeTrigger({ type: "weekly", weekday: 1, hour: 7, minute: 15 }).trigger).toEqual({
      type: "weekly",
      weekday: 1,
      hour: 7,
      minute: 15,
    });
    expect(toNativeTrigger({ type: "monthly", day: 15, hour: 10, minute: 5 }).trigger).toEqual({
      type: "monthly",
      day: 15,
      hour: 10,
      minute: 5,
    });
    expect(toNativeTrigger({ type: "yearly", month: 1, day: 29, hour: 9, minute: 0 }).trigger).toEqual({
      type: "yearly",
      month: 1,
      day: 29,
      hour: 9,
      minute: 0,
    });
  });

  it("null o solo canal: se muestra ahora", () => {
    expect(toNativeTrigger(null)).toEqual({ trigger: null });
    expect(toNativeTrigger({ channelId: "nido-messages" })).toEqual({ trigger: null, channelId: "nido-messages" });
  });

  it("undefined o un objeto sin type ni canal se rechazan, como en expo", () => {
    expect(() => toNativeTrigger(undefined)).toThrow(TypeError);
    expect(() => toNativeTrigger({} as never)).toThrow(TypeError);
  });

  it("rangos de expo: hora 0-23, minuto 0-59, día de la semana 1-7, mes 0-11", () => {
    expect(() => toNativeTrigger({ type: "daily", hour: 24, minute: 0 })).toThrow(RangeError);
    expect(() => toNativeTrigger({ type: "daily", hour: 8, minute: 60 })).toThrow(RangeError);
    expect(() => toNativeTrigger({ type: "weekly", weekday: 0, hour: 8, minute: 0 })).toThrow(RangeError);
    expect(() => toNativeTrigger({ type: "weekly", weekday: 8, hour: 8, minute: 0 })).toThrow(RangeError);
    expect(() => toNativeTrigger({ type: "yearly", month: 12, day: 1, hour: 8, minute: 0 })).toThrow(RangeError);
    expect(() => toNativeTrigger({ type: "daily", hour: "8", minute: 0 } as never)).toThrow(TypeError);
  });

  it("el 29 de febrero vale para un aviso anual (expo valida en el año 2000)", () => {
    expect(() => toNativeTrigger({ type: "yearly", month: 1, day: 29, hour: 9, minute: 0 })).not.toThrow();
    expect(() => toNativeTrigger({ type: "yearly", month: 1, day: 30, hour: 9, minute: 0 })).toThrow(RangeError);
    expect(() => toNativeTrigger({ type: "yearly", month: 3, day: 31, hour: 9, minute: 0 })).toThrow(RangeError);
  });

  describe("el día de un aviso mensual se valida contra el mes en curso, como expo", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it("en noviembre (30 días) el 31 no vale; en diciembre sí", () => {
      vi.setSystemTime(new Date(2026, 10, 13, 12, 0));
      expect(() => toNativeTrigger({ type: "monthly", day: 31, hour: 9, minute: 0 })).toThrow(RangeError);
      vi.setSystemTime(new Date(2026, 11, 1, 12, 0));
      expect(() => toNativeTrigger({ type: "monthly", day: 31, hour: 9, minute: 0 })).not.toThrow();
    });
  });
});

describe("toNativeRequest", () => {
  it("título, cuerpo, canal e identificador; sound solo si es «default»", () => {
    const at = new Date(Date.now() + 3_600_000);
    expect(
      toNativeRequest({
        identifier: "nido-reminder-r1",
        content: { title: "NIDO · Reminder", body: "Comprar pan", sound: "default" },
        trigger: { type: "date", date: at, channelId: "nido-reminders" },
      }),
    ).toEqual({
      identifier: "nido-reminder-r1",
      title: "NIDO · Reminder",
      body: "Comprar pan",
      channelId: "nido-reminders",
      sound: true,
      trigger: { type: "date", timestamp: at.getTime() },
    });
    expect(toNativeRequest({ content: { title: "t", body: "b" }, trigger: { channelId: "nido-reminders" } })).toEqual({
      title: "t",
      body: "b",
      channelId: "nido-reminders",
      sound: false,
      trigger: null,
    });
  });

  it("los disparadores que arma NIDO para cada repetición llegan bien al nativo", () => {
    const at = new Date(2026, 10, 20, 9, 30); // viernes
    const native = (r: Parameters<typeof reminderTrigger>[1]) =>
      toNativeRequest({ content: { title: "t", body: "b" }, trigger: reminderTrigger(at, r) });
    expect(native(null)).toMatchObject({ channelId: "nido-reminders", trigger: { type: "date", timestamp: at.getTime() } });
    expect(native("day").trigger).toEqual({ type: "daily", hour: 9, minute: 30 });
    expect(native("week").trigger).toEqual({ type: "weekly", weekday: 6, hour: 9, minute: 30 });
    expect(native("year").trigger).toEqual({ type: "yearly", month: 10, day: 20, hour: 9, minute: 30 });
  });
});

it("la numeración de importancia y visibilidad es la de expo (el nativo la traduce)", () => {
  expect(AndroidImportance.HIGH).toBe(6);
  expect(AndroidImportance.DEFAULT).toBe(5);
  expect(AndroidNotificationVisibility.SECRET).toBe(3);
});
