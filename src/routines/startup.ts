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
  snapshot as memorySnapshot,
} from "../agent/memory/memoryStore";
import {
  initNotifications,
  notifyNow,
  refreshBriefingNotification,
  cancelReminderNotification,
} from "../notify/notifications";
import { upcomingEventsForBriefing } from "../agent/tools/handlers";
import { formatDay } from "../agent/loop/toolRouter";

/** Construye el texto del resumen diario. */
async function buildBriefingBody(): Promise<string> {
  const parts: string[] = [];
  const now = new Date();
  parts.push(`Hoy es ${formatDay(now, "es")}.`);

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
      const events = await upcomingEventsForBriefing(5);
      if (events) parts.push(events);
    }
  } catch {
    // Sin calendario: el resumen sigue con lo demás.
  }

  try {
    const snap = await memorySnapshot();
    const factCount = snap.facts?.length ?? 0;
    if (factCount > 0) parts.push(`Tienes ${factCount} datos guardados en memoria.`);
  } catch {
    // Sin memoria: no pasa nada.
  }

  return parts.join("\n");
}

/**
 * Corre una vez al arrancar:
 * 1. Inicializa notificaciones locales.
 * 2. Avisa los recordatorios vencidos (y los marca como cumplidos).
 * 3. (Re)programa el resumen diario de las 8:00.
 */
export async function runStartupRoutines(): Promise<void> {
  const notifyOk = await initNotifications();

  try {
    const due = await getDueReminders();
    for (const r of due) {
      if (notifyOk) {
        await notifyNow("NIDO · Recordatorio", r.text);
      }
      await cancelReminderNotification(r.id);
      await completeReminder(r.id);
    }
  } catch {
    // La memoria aún no está lista: se reintentará en el próximo arranque.
  }

  try {
    if (notifyOk) {
      const body = await buildBriefingBody();
      await refreshBriefingNotification(body);
    }
  } catch {
    // El resumen seguirá disponible dentro del chat.
  }
}
