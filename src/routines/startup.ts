/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * startup.ts — NIDO: rutinas proactivas que corren al abrir la app.
 *
 * Todo local: notificaciones del sistema, memoria cifrada en el
 * dispositivo, calendario del teléfono. Ningún servidor interviene.
 */

import {
  getDueReminders,
  completeReminder,
  listReminders,
  snapshot as memorySnapshot,
} from "../agent/memory/memoryStore";
import {
  initNotifications,
  notifyNow,
  refreshBriefingNotification,
  cancelBriefingNotification,
  cancelReminderNotification,
  scheduleReminderNotification,
  scheduleTaskNotification,
  reminderNotificationTitle,
  consumeEngineMigration,
} from "../notify/notifications";
import { upcomingEventsForBriefing } from "../agent/tools/handlers";
import { formatDay } from "../agent/loop/toolRouter";

/** Construye el texto del resumen diario, en el idioma de la app (0.1.60). */
async function buildBriefingBody(): Promise<string> {
  const parts: string[] = [];
  const now = new Date();
  const { getLanguageId } = await import("../models/settings");
  const lang = await getLanguageId().catch(() => "es" as const);
  parts.push(briefingDateLine(now, lang));

  // TOOLS-AUDIT 2026-10-11: el resumen respeta el interruptor "Listar
  // eventos del calendario" de Acerca de (antes lo ignoraba) y nunca pide
  // el permiso al arrancar ni mete textos de permiso/error en el resumen.
  // Los ajustes se leen aquí mismo: App.tsx los carga en paralelo y esta
  // rutina podía ganar la carrera.
  try {
    const { getDisabledToolNames } = await import("../models/settings");
    // Si no se pueden leer los ajustes, no se toca el calendario (fail-closed).
    const disabled = await getDisabledToolNames().catch(() => null);
    if (disabled && !disabled.includes("list_calendar_events")) {
      const events = await upcomingEventsForBriefing(5, lang);
      if (events) parts.push(events);
    }
  } catch {
    // Sin calendario: el resumen sigue con lo demás.
  }

  try {
    const snap = await memorySnapshot();
    const factCount = snap.facts?.length ?? 0;
    if (factCount > 0) parts.push(briefingFactsLine(factCount, lang));
  } catch {
    // Sin memoria: no pasa nada.
  }

  return parts.join("\n");
}

/** 0.1.60: líneas del resumen en es/en/pt (antes solo en español). */
export function briefingDateLine(now: Date, lang: "es" | "en" | "pt"): string {
  const day = formatDay(now, lang);
  return lang === "en" ? `Today is ${day}.` : lang === "pt" ? `Hoje é ${day}.` : `Hoy es ${day}.`;
}

export function briefingFactsLine(n: number, lang: "es" | "en" | "pt"): string {
  if (lang === "en") return n === 1 ? "You have 1 fact saved in memory." : `You have ${n} facts saved in memory.`;
  if (lang === "pt") return n === 1 ? "Você tem 1 dado salvo na memória." : `Você tem ${n} dados salvos na memória.`;
  return n === 1 ? "Tienes 1 dato guardado en memoria." : `Tienes ${n} datos guardados en memoria.`;
}

/**
 * Corre una vez al arrancar:
 * 1. Inicializa notificaciones locales.
 * 2. Avisa los recordatorios vencidos (y los marca como cumplidos).
 * 3. (Re)programa el resumen diario de las 8:00 si la persona lo activó
 *    (0.1.60: opcional y apagado por defecto); si no, lo quita.
 */
export async function runStartupRoutines(): Promise<void> {
  const notifyOk = await initNotifications();

  try {
    const due = await getDueReminders();
    for (const r of due) {
      // 0.1.32: un recordatorio que se repite lo avisa el sistema con su
      // disparador diario/semanal aunque la app esté cerrada; aquí solo se
      // avanza su fecha. Ni se repite el aviso ni se cancela (cancelarlo
      // apagaría todas las veces siguientes).
      if (r.repeat) {
        await completeReminder(r.id);
        continue;
      }
      if (notifyOk) {
        await notifyNow(reminderNotificationTitle(), r.text);
      }
      await cancelReminderNotification(r.id);
      await completeReminder(r.id);
    }
  } catch {
    // La memoria aún no está lista: se reintentará en el próximo arranque.
  }

  // 0.1.32: los repetidos se vuelven a programar al arrancar (mismo
  // identificador, así que no se duplican). Cubre un aviso que no se pudo
  // programar al crearlo y una copia de seguridad recién restaurada.
  if (notifyOk) {
    try {
      const pending = await listReminders(200);
      for (const r of pending) {
        if (r.repeat && r.due_at) {
          await scheduleReminderNotification(r.id, r.text, new Date(r.due_at), r.repeat);
        }
      }
    } catch {
      // Sin memoria o sin permiso: siguen guardados y se reintenta al abrir.
    }
  }

  // 0.1.96: NIDO deja expo-notifications por su módulo propio. La primera
  // vez que arranca tras actualizar, lo que expo tenía programado ya no
  // sonará (sus alarmas apuntan a un receptor que no existe): se programa
  // de nuevo una vez, con el mismo identificador, lo que el bloque de
  // arriba no cubre.
  if (notifyOk && (await consumeEngineMigration())) {
    try {
      const { listTasks } = await import("../agent/scheduled/taskStore");
      const [pending, tasks] = await Promise.all([listReminders(200), listTasks()]);
      const strings = taskNotifyStrings();
      await resyncAfterEngineChange({
        reminders: pending,
        tasks,
        now: Date.now(),
        scheduleReminder: (r) => scheduleReminderNotification(r.id, r.text, new Date(r.due_at as string), null),
        scheduleTask: (t) =>
          scheduleTaskNotification(t.id, strings.dueTitle(t.name), strings.dueBody, new Date(t.nextRunAt as number)),
      });
    } catch {
      // Sin memoria todavía: los vencidos se avisan al abrir, como siempre.
    }
  }

  try {
    if (notifyOk) await applyDailySummarySetting();
  } catch {
    // El resumen seguirá disponible dentro del chat.
  }
}

/** Textos del aviso de una tarea: los mismos que usa la pantalla de tareas. */
function taskNotifyStrings(): { dueTitle(name: string): string; dueBody: string } {
  try {
    const i18n = require("../i18n").default as { t(k: string, o?: Record<string, string>): string };
    return {
      dueTitle: (name) => i18n.t("scheduledTasks.notifyDue", { name }),
      dueBody: i18n.t("scheduledTasks.notifyDueBody"),
    };
  } catch {
    return { dueTitle: (name) => `NIDO · ${name}`, dueBody: "A scheduled task is ready. Open NIDO to run it." };
  }
}

/**
 * Parte pura de la migración de 0.1.96 (para los tests): vuelve a programar
 * los recordatorios de una sola vez que aún no han llegado y los avisos de
 * las tareas activas. Los repetidos ya los programa cada arranque.
 */
export async function resyncAfterEngineChange(deps: {
  reminders: ReadonlyArray<{ id: string; text: string; due_at?: string | null; repeat?: string | null }>;
  tasks: ReadonlyArray<{ id: string; name: string; enabled: boolean; nextRunAt: number | null }>;
  now: number;
  scheduleReminder: (r: { id: string; text: string; due_at?: string | null }) => Promise<unknown>;
  scheduleTask: (t: { id: string; name: string; nextRunAt: number | null }) => Promise<unknown>;
}): Promise<{ reminders: number; tasks: number }> {
  let reminders = 0;
  let tasks = 0;
  for (const r of deps.reminders) {
    if (r.repeat || !r.due_at) continue;
    if (new Date(r.due_at).getTime() <= deps.now) continue;
    await deps.scheduleReminder(r).catch(() => {});
    reminders += 1;
  }
  for (const t of deps.tasks) {
    if (!t.enabled || !t.nextRunAt || t.nextRunAt <= deps.now) continue;
    await deps.scheduleTask(t).catch(() => {});
    tasks += 1;
  }
  return { reminders, tasks };
}

/**
 * 0.1.60: programa o quita el resumen diario según el interruptor de
 * Ajustes. Lo llaman el arranque y el propio interruptor. Sin poder leer
 * los ajustes no se programa nada (fail-closed): nunca se avisa sin que la
 * persona lo haya pedido.
 */
export async function applyDailySummarySetting(): Promise<void> {
  const { getDailySummaryEnabled } = await import("../models/settings");
  const enabled = await getDailySummaryEnabled().catch(() => false);
  await decideDailySummary(enabled, {
    schedule: async () => refreshBriefingNotification(await buildBriefingBody()),
    cancel: cancelBriefingNotification,
  });
}

/** Parte pura, para los tests: encendido → programa; apagado → quita. */
export async function decideDailySummary(
  enabled: boolean,
  deps: { schedule: () => Promise<void>; cancel: () => Promise<void> },
): Promise<"scheduled" | "cancelled"> {
  if (enabled) {
    await deps.schedule();
    return "scheduled";
  }
  await deps.cancel();
  return "cancelled";
}
