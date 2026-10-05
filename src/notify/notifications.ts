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
export async function initNotifications(): Promise<boolean> {
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
    return true;
  } catch {
    return false;
  }
}

/** Programa el aviso de un recordatorio. Devuelve false si no se pudo. */
export async function scheduleReminderNotification(
  reminderId: string,
  text: string,
  at: Date
): Promise<boolean> {
  try {
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
 * (Re)programa el resumen diario para las próximas 8:00 con el contenido
 * ya calculado. Se llama al abrir la app para que el contenido esté fresco.
 */
export async function refreshBriefingNotification(body: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(BRIEFING_IDENTIFIER);
    const next = new Date();
    next.setHours(8, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    await Notifications.scheduleNotificationAsync({
      identifier: BRIEFING_IDENTIFIER,
      content: {
        title: notifyStrings().briefingTitle,
        body: body.slice(0, 4000),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: next,
        channelId: "nido-briefing",
      },
    });
  } catch {
    // Sin permiso: el resumen seguirá disponible dentro del chat.
  }
}
