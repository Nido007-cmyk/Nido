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
import { listCalendarEventsHandler } from "../agent/tools/handlers";
import { fmtDateTime } from "../agent/tools/handlers";

/** Construye el texto del resumen diario. */
async function buildBriefingBody(): Promise<string> {
  const parts: string[] = [];
  const now = new Date();
  parts.push(`Hoy es ${fmtDateTime(now.toISOString()).split(",")[0]}.`);

  try {
    const events = await listCalendarEventsHandler({ limit: 5 });
    if (!events.startsWith("No hay") && !events.startsWith("No pude") && !events.startsWith("NIDO no")) {
      parts.push(events);
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
