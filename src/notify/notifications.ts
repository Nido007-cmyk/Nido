/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * notifications.ts — NIDO: rutinas proactivas 100% locales.
 *
 * Notificaciones programadas en el dispositivo (AlarmManager del sistema
 * vía expo-notifications). Ningún servidor interviene: el teléfono decide
 * y dispara solo.
 *
 * - Recordatorios: al crear uno con fecha se programa un aviso real.
 * - Resumen diario: se (re)programa cada vez que se abre la app, con el
 *   contenido del día (eventos + recordatorios vencidos).
 */

import * as Notifications from "expo-notifications";

const REMINDER_PREFIX = "nido-reminder-";
const BRIEFING_IDENTIFIER = "nido-daily-briefing";
/** Tope para programar un aviso (ms): nunca bloquear la respuesta del chat. */
export const SCHEDULE_TIMEOUT_MS = 5_000;

/** Resuelve con `fallback` si `p` no termina a tiempo; nunca rechaza. */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p.catch(() => fallback), deadline]).finally(() => clearTimeout(timer));
}

/**
 * Notification copy in the user's language. Resolved lazily — never a
 * top-level import — because the i18n/settings chain pulls native modules
 * that unit tests cannot load. If resolution fails, English (the app
 * default) is used.
 */
interface NotifyStrings {
  reminderChannel: string;
  briefingChannel: string;
  reminderTitle: string;
  briefingTitle: string;
}

const EN_STRINGS: NotifyStrings = {
  reminderChannel: "NIDO Reminders",
  briefingChannel: "NIDO Daily Briefing",
  reminderTitle: "NIDO · Reminder",
  briefingTitle: "NIDO · Your day",
};

function notifyStrings(): NotifyStrings {
  try {
    const i18n = require("../i18n").default as { t(k: string): string };
    return {
      reminderChannel: i18n.t("notifications.reminderChannel"),
      briefingChannel: i18n.t("notifications.briefingChannel"),
      reminderTitle: i18n.t("notifications.reminderTitle"),
      briefingTitle: i18n.t("notifications.briefingTitle"),
    };
  } catch {
    return EN_STRINGS;
  }
}

/** Permisos + canales. Llamar una vez al arrancar la app. */
// FIX 2026-10-09 (N2): guard contra doble inicialización (Fast Refresh,
// re-init). Sin esto se apilan listeners duplicados.
let notificationsInitialized = false;
/** Solo para tests: resetea el guard de inicialización. */
export function __resetNotificationsForTests(): void {
  notificationsInitialized = false;
}
export async function initNotifications(): Promise<boolean> {
  if (notificationsInitialized) return true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return false;
    await Notifications.setNotificationChannelAsync("nido-reminders", {
      name: notifyStrings().reminderChannel,
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      sound: "default",
      // M-1: el contenido (textos de recordatorios) no debe leerse en la
      // pantalla de bloqueo sin pasar la puerta biométrica de NIDO.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
    });
    await Notifications.setNotificationChannelAsync("nido-briefing", {
      name: notifyStrings().briefingChannel,
      importance: Notifications.AndroidImportance.DEFAULT,
      // M-1: el resumen diario incluye eventos del calendario y datos de
      // memoria; oculto en la pantalla de bloqueo por defecto.
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.SECRET,
    });
    // FIX 2026-10-08: marcar el recordatorio como completado cuando su
    // notificación programada se entrega. Antes nada lo marcaba: al
    // reiniciar la app, getDueReminders() lo encontraba pendiente+vencido
    // y lo disparaba OTRA VEZ con notifyNow (duplicado reportado en
    // pruebas físicas). El listener solo corre si la app está viva al
    // entregarse; si no, el fallback de startup (getDueReminders) sigue
    // funcionando igual.
    Notifications.addNotificationReceivedListener(async (notification) => {
      try {
        const identifier = notification.request.identifier ?? "";
        if (!identifier.startsWith(REMINDER_PREFIX)) return;
        const reminderId = identifier.slice(REMINDER_PREFIX.length);
        if (!reminderId) return;
        const { completeReminder } = await import("../agent/memory/memoryStore");
        await completeReminder(reminderId);
      } catch {
        // Best-effort: si falla, el fallback de startup lo avisará.
      }
    });
    notificationsInitialized = true;
    return true;
  } catch {
    return false;
  }
}

/** Programa el aviso de un recordatorio. Devuelve false si no se pudo. */
// 2026-10-10: variable eliminada junto con el Alert (ver abajo).
export async function scheduleReminderNotification(
  reminderId: string,
  text: string,
  at: Date
): Promise<boolean> {
  // FIX 2026-10-09 (N4): rechazar fechas pasadas. Un trigger DATE en el
  // pasado tiene comportamiento indefinido según el backend.
  if (at.getTime() < Date.now() - 60_000) {
    return false;
  }
  try {
    // CRASH-2026-10-10: eliminada también la consulta a `exact-alarm`. Ese
    // módulo nativo no se compila en el APK (no tiene build.gradle), así que
    // la llamada solo fallaba en silencio; el resultado no se usaba.
    // expo-notifications ya decide solo entre alarma exacta e inexacta.
    // CRASH-2026-10-10: el aviso se programa con tope de tiempo. Si el lado
    // nativo nunca responde, la confirmación del recordatorio no se queda
    // colgada: el recordatorio ya está guardado y se avisa al abrir la app.
    const scheduled = (async () => {
      await cancelReminderNotification(reminderId);
      await Notifications.scheduleNotificationAsync({
        identifier: REMINDER_PREFIX + reminderId,
        content: {
          title: notifyStrings().reminderTitle,
          body: text,
          sound: "default",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: at,
          channelId: "nido-reminders",
        },
      });
      return true;
    })();
    return await withTimeout(scheduled, SCHEDULE_TIMEOUT_MS, false);
  } catch {
    return false;
  }
}

/** Cancela el aviso programado de un recordatorio. */
export async function cancelReminderNotification(reminderId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_PREFIX + reminderId);
  } catch {
    // No estaba programado: nada que hacer.
  }
}

/** Aviso inmediato (p.ej. recordatorios ya vencidos al abrir la app). */
export async function notifyNow(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default" },
      trigger: null,
    });
  } catch {
    // Sin permiso o sin módulo: silencioso.
  }
}

/**
 * (Re)programa el resumen diario para las 8:00 con el contenido ya calculado.
 * FIX 2026-10-09 (N3): usar trigger DAILY en vez de DATE one-shot. El DATE
 * solo disparaba si la app abría para re-programar; si el usuario no abría
 * por 3 días, no había briefing esos días. Con DAILY el SO lo dispara aunque
 * la app no abra. El contenido se refresca en cada startup (híbrido).
 * Se llama al abrir la app para que el contenido esté fresco.
 */
export async function refreshBriefingNotification(body: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(BRIEFING_IDENTIFIER);
    await Notifications.scheduleNotificationAsync({
      identifier: BRIEFING_IDENTIFIER,
      content: {
        title: notifyStrings().briefingTitle,
        body: body.slice(0, 4000),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 8,
        minute: 0,
        channelId: "nido-briefing",
      },
    });
  } catch {
    // Sin permiso: el resumen seguirá disponible dentro del chat.
  }
}

const TASK_PREFIX = "nido-task-";

/**
 * Aviso a la hora de una tarea programada. La tarea corre dentro de NIDO,
 * así que si la app está cerrada este aviso es lo que invita a abrirla.
 * El texto es genérico a propósito: no revela la instrucción en la pantalla.
 */
export async function scheduleTaskNotification(
  taskId: string,
  title: string,
  body: string,
  at: Date | null,
): Promise<boolean> {
  try {
    await Notifications.cancelScheduledNotificationAsync(TASK_PREFIX + taskId).catch(() => {});
    if (!at || at.getTime() < Date.now() - 60_000) return false;
    await Notifications.scheduleNotificationAsync({
      identifier: TASK_PREFIX + taskId,
      content: { title, body, sound: "default" },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId: "nido-reminders",
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelTaskNotification(taskId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(TASK_PREFIX + taskId);
  } catch {
    // No estaba programado: nada que hacer.
  }
}
