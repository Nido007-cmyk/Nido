/*
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * La parte pura de nido-notify: convierte la petición de NIDO en lo que
 * recibe el lado nativo, y la valida. Sin módulos nativos: se prueba en
 * vitest (triggers.test.ts).
 *
 * Mismas formas y mismas reglas que expo-notifications 57.0.24
 * (build/scheduleNotificationAsync.js, parseTrigger y
 * validateDateComponentsInTrigger), para que nada cambie al quitarlo:
 *  - una hora de 0 a 23, un minuto de 0 a 59, un día de la semana de 1
 *    (domingo) a 7, un mes de 0 a 11;
 *  - el día del mes se valida contra los días del mes indicado o, si no
 *    lo hay, del mes en curso, en el año 2000 (bisiesto), como expo;
 *  - un disparador sin `type` pero con `channelId` (o `null`) es «ahora».
 */

export const SchedulableTriggerInputTypes = {
  DATE: "date",
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
} as const;

/** Numeración de expo (no la de Android): el lado nativo la traduce. */
export enum AndroidImportance {
  UNKNOWN = 0,
  UNSPECIFIED = 1,
  NONE = 2,
  MIN = 3,
  LOW = 4,
  DEFAULT = 5,
  HIGH = 6,
  MAX = 7,
}

export enum AndroidNotificationVisibility {
  UNKNOWN = 0,
  PUBLIC = 1,
  PRIVATE = 2,
  SECRET = 3,
}

type Channel = { channelId?: string };
export type DateTriggerInput = Channel & { type: "date"; date: Date | number };
export type DailyTriggerInput = Channel & { type: "daily"; hour: number; minute: number };
export type WeeklyTriggerInput = Channel & { type: "weekly"; weekday: number; hour: number; minute: number };
export type MonthlyTriggerInput = Channel & { type: "monthly"; day: number; hour: number; minute: number };
export type YearlyTriggerInput = Channel & {
  type: "yearly";
  month: number;
  day: number;
  hour: number;
  minute: number;
};
export type NotificationTriggerInput =
  | null
  | Channel
  | DateTriggerInput
  | DailyTriggerInput
  | WeeklyTriggerInput
  | MonthlyTriggerInput
  | YearlyTriggerInput;

export interface NotificationRequestInput {
  identifier?: string;
  content: { title?: string | null; body?: string | null; sound?: string | boolean | null };
  trigger: NotificationTriggerInput;
}

export interface NativeTrigger {
  type: "date" | "daily" | "weekly" | "monthly" | "yearly";
  timestamp?: number;
  hour?: number;
  minute?: number;
  weekday?: number;
  day?: number;
  month?: number;
}

export interface NativeRequest {
  identifier?: string;
  title?: string;
  body?: string;
  channelId?: string;
  /** content.sound === "default": el lado nativo solo lo usa antes de Android 8. */
  sound: boolean;
  /** null: mostrar ahora. */
  trigger: NativeTrigger | null;
}

function daysInMonth(month = 0, year?: number): number {
  return new Date(year ?? 2000, month + 1, 0).getDate();
}

function validate(trigger: Record<string, unknown>, components: string[]): void {
  for (const component of components) {
    if (!(component in trigger)) throw new TypeError(`The ${component} parameter needs to be present`);
    const value = trigger[component];
    if (typeof value !== "number") throw new TypeError(`The ${component} parameter should be a number`);
    switch (component) {
      case "month":
        if (value < 0 || value > 11) throw new RangeError(`The month parameter needs to be between 0 and 11. Found: ${value}`);
        break;
      case "day": {
        const month = typeof trigger.month === "number" ? trigger.month : new Date().getMonth();
        const max = daysInMonth(month);
        if (value < 1 || value > max)
          throw new RangeError(`The day parameter for month ${month} must be between 1 and ${max}. Found: ${value}`);
        break;
      }
      case "weekday":
        if (value < 1 || value > 7) throw new RangeError(`The weekday parameter needs to be between 1 and 7. Found: ${value}`);
        break;
      case "hour":
        if (value < 0 || value > 23) throw new RangeError(`The hour parameter needs to be between 0 and 23. Found: ${value}`);
        break;
      case "minute":
        if (value < 0 || value > 59) throw new RangeError(`The minute parameter needs to be between 0 and 59. Found: ${value}`);
        break;
    }
  }
}

/** Disparador de NIDO → disparador nativo, o null para «ahora». */
export function toNativeTrigger(trigger: NotificationTriggerInput | undefined): {
  trigger: NativeTrigger | null;
  channelId?: string;
} {
  if (trigger === null) return { trigger: null };
  if (trigger === undefined)
    throw new TypeError("Encountered an `undefined` notification trigger. Pass `null` to show it now.");
  if (typeof trigger !== "object" || !("type" in trigger || "channelId" in trigger))
    throw new TypeError("The `trigger` object needs a `type` or `channelId` entry.");
  const t = trigger as Record<string, unknown>;
  const channelId = typeof t.channelId === "string" && t.channelId ? t.channelId : undefined;
  switch (t.type) {
    case "date": {
      if (!("date" in t)) break;
      const date = t.date as Date | number;
      return { trigger: { type: "date", timestamp: date instanceof Date ? date.getTime() : date }, channelId };
    }
    case "daily":
      validate(t, ["hour", "minute"]);
      return { trigger: { type: "daily", hour: t.hour as number, minute: t.minute as number }, channelId };
    case "weekly":
      validate(t, ["weekday", "hour", "minute"]);
      return {
        trigger: { type: "weekly", weekday: t.weekday as number, hour: t.hour as number, minute: t.minute as number },
        channelId,
      };
    case "monthly":
      validate(t, ["day", "hour", "minute"]);
      return {
        trigger: { type: "monthly", day: t.day as number, hour: t.hour as number, minute: t.minute as number },
        channelId,
      };
    case "yearly":
      validate(t, ["month", "day", "hour", "minute"]);
      return {
        trigger: {
          type: "yearly",
          month: t.month as number,
          day: t.day as number,
          hour: t.hour as number,
          minute: t.minute as number,
        },
        channelId,
      };
  }
  // Sin tipo programable: «ahora», en su canal (como expo en Android).
  return { trigger: null, channelId };
}

export function toNativeRequest(request: NotificationRequestInput): NativeRequest {
  const { trigger, channelId } = toNativeTrigger(request.trigger);
  const out: NativeRequest = { sound: request.content.sound === "default", trigger };
  if (request.identifier) out.identifier = request.identifier;
  if (request.content.title != null) out.title = request.content.title;
  if (request.content.body != null) out.body = request.content.body;
  if (channelId) out.channelId = channelId;
  return out;
}
