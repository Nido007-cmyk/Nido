/**
 * handlers.ts — NIDO: implementaciones reales de las herramientas locales.
 *
 * Cada handler corre 100% en el dispositivo. Ninguno toca la red.
 * Se inyectan en runAgentLoop() desde la UI (ChatScreen).
 *
 * Nota: este módulo toca módulos nativos (expo-sqlite vía memoryStore),
 * así que no se importa en tests — la lógica pura vive en dispatcher.ts
 * y agentLoop.ts, que sí están cubiertos.
 */

import {
  saveNote,
  listNotes,
  getNote,
  saveReminder,
  saveFact,
} from "../memory/memoryStore";
import { LOCAL_TOOLS } from "./manifest";
import type { ToolHandler } from "./dispatcher";
import { withConfirmation, type RequestConfirm } from "./confirm";
import {
  classifyOpenAppTarget,
  type OpenAppRejectReason,
} from "./externalLink";
import { evaluateExpression, formatNumber } from "./calc";
import { convertUnits } from "./convert";
import { loadSkill, listSkills } from "../skills/registry";
import { analyzeTable } from "./analyze";
import { NidoMessenger, PairingDisambiguationRequiredError } from "../../p2p/messenger";
import { StaleReplaceConflictError } from "../../p2p/store";
import { decodePairingPayload } from "../../p2p/pairing";
import { pairingBindingWarning, findPairingCollision } from "../../p2p/pairingCeremony";
import { findContactRowAny } from "../../p2p/store";
import { fingerprint, fromHex } from "../../p2p/crypto";
import {
  approveAgentTask,
  getPendingAgentTask,
  listPendingAgentTasks,
  rejectAgentTask,
} from "../../p2p/approvalInbox";

/**
 * i18n perezoso para los textos de los diálogos de confirmación. Este
 * módulo no es React y la cadena i18n/settings puede cargar módulos
 * nativos que los tests no pueden cargar (mismo patrón que
 * notifications.ts). Si la resolución falla, se usa inglés (el idioma
 * por defecto de la app).
 */
type ConfirmT = (key: string, opts?: Record<string, string>) => string;
const EN_CONFIRM_FALLBACK: Record<string, string> = {
  "agentConfirm.createEventTitle": "Create event",
  "agentConfirm.createEventMessage": "Create “{{title}}” in your calendar on {{start}}?",
  "agentConfirm.createEventMessageWithEnd":
    "Create “{{title}}” in your calendar on {{start}} until {{end}}?",
  "agentConfirm.sendMessageTitle": "Send NIDO message",
  "agentConfirm.sendMessageMessage": "Send to “{{to}}” via NIDO (encrypted)?\n\n“{{text}}”",
  "agentConfirm.pairTitle": "Pair NIDO contact",
  "agentConfirm.pairMessage":
    "Pair with “{{name}}”?\nFingerprint: {{fingerprint}}\n\nOnly confirm if you scanned this code in person.",
  "agentConfirm.pairInvalidCode":
    "This code doesn't look like a valid NIDO pairing code.",
  // TD-12b: advertencias de ligadura nombre↔identidad (M-5), antes solo en español.
  "agentConfirm.pairBindingKnownSameName":
    "This identity is already paired as “{{known}}”.",
  "agentConfirm.pairBindingKnownOtherName":
    "This identity is already paired as “{{known}}” (not as “{{name}}”).",
  "agentConfirm.pairBindingNameConflict":
    "Warning: you already have a contact named “{{name}}” with a DIFFERENT identity. Only confirm if you scanned this code in person, from the real device.",
  // UNIT B (F-4/F-5/F-6): desambiguación explícita de emparejamiento.
  "agentConfirm.pairDisambiguationTitle": "Disambiguate pairing",
  "agentConfirm.pairAmbiguousAsk":
    "This code is for “{{name}}” (fingerprint {{fingerprint}}), but you already have {{count}} live contact(s) with that name under a DIFFERENT identity: {{candidates}}. A name is not an identity — I cannot assume this is the same person.\n\nTell me explicitly (in chat):\n• “replace” — the same person with a new device: retire the old identity everywhere (destructive);\n• “different person” — a different person: give me a unique name for the new contact;\n• “cancel” — do nothing.\n\nIf you don't choose, I cancel. Nothing has been paired yet.",
  "agentConfirm.pairReplaceConfirmMessage":
    "REPLACE the identity of “{{name}}”?\nFingerprint: {{fingerprint}}\n\nThis retires the old identity EVERYWHERE: its routes, sessions and pending messages die, and its pending outbox is marked failed. Old messages stay readable. This cannot be undone. Confirm only if you verified this code in person.",
  "agentConfirm.pairDifferentPersonConfirmMessage":
    "Pair “{{name}}” as a DIFFERENT PERSON named “{{newName}}”?\nFingerprint: {{fingerprint}}\n\nBoth identities stay live. Confirm only if you scanned this code in person.",
  "agentConfirm.pairCancelled": "Pairing cancelled — nothing was written.",
  "agentConfirm.pairInvalidChoice":
    "Invalid disambiguation “{{choice}}”: use replace, different_person or cancel.",
  // M-6: diálogos de decisión sobre tareas remotas encoladas.
  "agentConfirm.approveTaskTitle": "Approve NIDO task",
  "agentConfirm.approveTaskMessage":
    "Approve this task from “{{sender}}”?\n\n{{action}}\n\nReceived: {{when}}.\nApproval only records your decision; the task is not executed automatically.",
  "agentConfirm.rejectTaskTitle": "Reject NIDO task",
  "agentConfirm.rejectTaskMessage": "Reject this task from “{{sender}}”?\n\n{{action}}",
  "agentConfirm.taskNotFound":
    "There is no pending task with that id (it may already have been decided).",
  // M-6: salidas de las herramientas de revisión/decisión (antes solo en español).
  "agentTasks.reviewEmpty": "There are no NIDO tasks pending approval.",
  "agentTasks.reviewHeader": "NIDO tasks pending your approval ({{count}}):",
  "agentTasks.reviewItem":
    "• id {{id}}\n  From: {{sender}} (id {{pkShort}}…)\n  Asks: {{action}}\n  Received: {{when}}",
  "agentTasks.reviewFooter":
    "To decide, use nido_approve_task or nido_reject_task with the id.",
  "agentTasks.decideMissingId":
    "Error: provide the task id (see nido_review_tasks).",
  "agentTasks.decideApproved":
    "Task {{id}} approved and recorded. Nothing was executed automatically.",
  "agentTasks.decideRejected": "Task {{id}} rejected and recorded.",
  "agentTasks.decideNotFound":
    "There is no pending task with id “{{id}}” (it may already have been decided).",
  "agentTasks.unknownSender": "Unknown NIDO contact",
  // P-F1: confirmación y rechazo explícito para open_app.
  "agentConfirm.openAppTitle": "Open external link",
  "agentConfirm.openAppMessage": "Open this link outside NIDO?\n\n{{target}}",
  "agentConfirm.openAppRejected":
    "NIDO can't open this link ({{reason}}). Allowed schemes: https, http, tel, sms, mailto.",
  "agentConfirm.openAppReason.empty": "it's empty",
  "agentConfirm.openAppReason.no-scheme": "it doesn't start with a valid scheme",
  "agentConfirm.openAppReason.scheme-not-allowed": "its scheme isn't allowed",
  "agentConfirm.openAppReason.unsafe-chars": "it contains unsafe characters",
};
function agentConfirmT(): ConfirmT {
  try {
    const i18n = require("../../i18n").default as {
      t(k: string, o?: unknown): string;
    };
    return (key, opts) => i18n.t(key, opts);
  } catch {
    return (key, opts) => {
      let s = EN_CONFIRM_FALLBACK[key] ?? key;
      for (const [k, v] of Object.entries(opts ?? {}))
        s = s.split(`{{${k}}}`).join(v);
      return s;
    };
  }
}

/** Exportado para las rutinas proactivas (resumen diario). */
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "sin fecha";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Hora actual del dispositivo, en español. */
const deviceTime: ToolHandler = async () => {
  const now = new Date();
  const fecha = now.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const hora = now.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Ahora es ${hora} del ${fecha} (hora del dispositivo).`;
};

const saveNoteHandler: ToolHandler = async (args) => {
  const title = String(args.title ?? "").trim();
  const body = String(args.body ?? "");
  if (!title) return "Error: falta el título de la nota.";
  const note = await saveNote({ title, body });
  return `Nota guardada: «${note.title}» (id ${note.id}).`;
};

const listNotesHandler: ToolHandler = async () => {
  const notes = await listNotes(20);
  if (notes.length === 0) return "No hay notas guardadas todavía.";
  return (
    "Notas guardadas:\n" +
    notes.map((n) => `- «${n.title}» (id ${n.id}, ${fmtDateTime(n.created_at)})`).join("\n") +
    "\nUsa read_note con el id para leer una completa."
  );
};

const readNoteHandler: ToolHandler = async (args) => {
  const id = String(args.id ?? "").trim();
  if (!id) return "Error: falta el id de la nota.";
  const note = await getNote(id);
  if (!note) return `No encontré ninguna nota con id ${id}.`;
  return `«${note.title}» (${fmtDateTime(note.created_at)}):\n${note.body || "(sin contenido)"}`;
};

const createReminderHandler: ToolHandler = async (args) => {
  const text = String(args.text ?? "").trim();
  if (!text) return "Error: falta el texto del recordatorio.";
  let dueAt: string | null = null;
  const at = args.at != null ? String(args.at).trim() : "";
  if (at) {
    const d = new Date(at);
    if (!Number.isNaN(d.getTime())) dueAt = d.toISOString();
  }
  const reminder = await saveReminder({ text, dueAt });
  const cuando = dueAt ? ` para ${fmtDateTime(dueAt)}` : " (sin fecha)";
  let aviso = "Te avisaré al abrir NIDO cuando llegue la hora.";
  if (dueAt) {
    // Aviso real del sistema, programado en el dispositivo (Fase C).
    try {
      const { scheduleReminderNotification } = await import("../../notify/notifications");
      const ok = await scheduleReminderNotification(reminder.id, reminder.text, new Date(dueAt));
      if (ok) aviso = "Te llegará un aviso del sistema a esa hora, aunque NIDO esté cerrado.";
    } catch {
      // Sin notificaciones: el recordatorio sigue guardado y se muestra al abrir.
    }
  }
  return `Recordatorio guardado${cuando}: «${reminder.text}». ${aviso}`;
};

/**
 * H11-2026-10-06: detector simple de fechas en texto (ES/EN).
 * Si un fact contiene una fecha, el resultado sugiere crear un recordatorio.
 * No intenta NLP completo; solo patrones comunes de fechas.
 */
const DATE_PATTERNS: RegExp[] = [
  /\b\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i,
  /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) \d{1,2}\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}\b/i,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,
];

export function containsDatePattern(text: string): boolean {
  return DATE_PATTERNS.some((re) => re.test(text));
}

const rememberFactHandler: ToolHandler = async (args) => {
  const content = String(args.content ?? "").trim();
  if (!content) return "Error: falta el contenido del hecho.";
  // M1-2026-10-06 (track 2): allowlist de categorías. El LLM puede enviar
  // cualquier string; sin validación se almacenan categorías bogus.
  const VALID_CATEGORIES = ["general", "preference", "goal", "event"] as const;
  const rawCategory = String(args.category ?? "general").trim() || "general";
  const category = (VALID_CATEGORIES as readonly string[]).includes(rawCategory)
    ? rawCategory
    : "general";
  await saveFact({ content, category: category as "general", source: "user" });
  let result = `Guardado en mi memoria: «${content}» (categoría: ${category}).`;
  // H11: puente memoria→notificación. Si hay una fecha, sugerir recordatorio.
  if (containsDatePattern(content)) {
    result += ` Veo que menciona una fecha — si quieres que te avise con tiempo, pídeme "créame un recordatorio para..."`;
  }
  return result;
};

const openAppHandler: ToolHandler = async (args) => {
  // P-F1: defensa en profundidad — se vuelve a clasificar aquí aunque el
  // diálogo de confirmación ya lo haya hecho; nunca se confía en el path.
  const c = classifyOpenAppTarget(args.link);
  if (!c.ok) {
    const t = agentConfirmT();
    return t("agentConfirm.openAppRejected", {
      reason: t(`agentConfirm.openAppReason.${c.reason}`),
    });
  }
  try {
    const { Linking } = await import("react-native");
    await Linking.openURL(c.normalized);
    return `Abriendo ${c.normalized}…`;
  } catch {
    return `No pude abrir ${c.normalized} desde NIDO.`;
  }
};

/** Clave i18n del motivo de rechazo de open_app según la clasificación. */
function openAppRejectReasonKey(reason: OpenAppRejectReason): string {
  return `agentConfirm.openAppReason.${reason}`;
}

/**
 * M-5: advertencia de ligadura nombre↔identidad para el diálogo de
 * emparejamiento. Implementación compartida en ../../p2p/pairingCeremony
 * (misma política para el path del agente y el path de UI — B/F3).
 */

/** Handlers listos para inyectar en runAgentLoop(). */
export function buildToolHandlers(opts?: {
  /** Canal de confirmación (ChatScreen lo inyecta con un Alert nativo). */
  requestConfirm?: RequestConfirm;
}): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {
    device_time: deviceTime,
    save_note: saveNoteHandler,
    list_notes: listNotesHandler,
    read_note: readNoteHandler,
    create_reminder: createReminderHandler,
    remember_fact: rememberFactHandler,
    // P-F1: abrir un enlace externo es una acción con efectos fuera de
    // NIDO (cambia de app) → confirmación explícita + allowlist de
    // esquemas. Sin confirmación no se ejecuta; esquemas no permitidos
    // fallan cerrados sin tocar el sistema.
    open_app: withConfirmation(
      "open_app",
      openAppHandler,
      opts?.requestConfirm,
      (args) => {
        const t = agentConfirmT();
        const c = classifyOpenAppTarget(args.link);
        if (!c.ok) {
          return {
            tool: "open_app",
            title: t("agentConfirm.openAppTitle"),
            message: t("agentConfirm.openAppRejected", {
              reason: t(openAppRejectReasonKey(c.reason)),
            }),
          };
        }
        return {
          tool: "open_app",
          title: t("agentConfirm.openAppTitle"),
          message: t("agentConfirm.openAppMessage", { target: c.normalized }),
        };
      },
    ),
    // Fase B
    calculate: calculateHandler,
    convert_units: convertUnitsHandler,
    create_calendar_event: withConfirmation(
      "create_calendar_event",
      createCalendarEventHandler,
      opts?.requestConfirm,
      (args) => {
        const t = agentConfirmT();
        const title = String(args.title ?? "").trim();
        const start = String(args.start ?? "").trim();
        const end = args.end ? String(args.end).trim() : "";
        return {
          tool: "create_calendar_event",
          title: t("agentConfirm.createEventTitle"),
          message: end
            ? t("agentConfirm.createEventMessageWithEnd", { title, start, end })
            : t("agentConfirm.createEventMessage", { title, start }),
        };
      },
    ),
    list_calendar_events: listCalendarEventsHandler,
    find_contact: findContactHandler,
    place_call: placeCallHandler, // el SO (marcador) confirma
    send_sms: sendSmsHandler, // el SO (app de mensajes) confirma
    read_picked_file: readPickedFileHandler, // el picker del sistema confirma
    // Fase D
    use_skill: useSkillHandler,
    analyze_table: analyzeTableHandler,
    // Fase E
    nido_send_message: withConfirmation(
      "nido_send_message",
      nidoSendMessageHandler,
      opts?.requestConfirm,
      (args) => {
        const t = agentConfirmT();
        const payload = nidoSendMessagePayload(args);
        return {
          tool: "nido_send_message",
          title: t("agentConfirm.sendMessageTitle"),
          // N2: el diálogo muestra el payload COMPLETO que se transmitirá —
          // nunca un resumen truncado. El texto largo es desplazable en el
          // diálogo nativo: el usuario puede inspeccionar los bytes exactos
          // antes de aprobar, y la ejecución usa la misma derivación.
          message: t("agentConfirm.sendMessageMessage", {
            to: payload.to,
            text: payload.text,
          }),
        };
      },
    ),
    nido_read_inbox: nidoReadInboxHandler,
    nido_my_code: nidoMyCodeHandler,
    nido_pair: withConfirmation(
      "nido_pair",
      nidoPairHandler,
      opts?.requestConfirm,
      async (args) => {
        const t = agentConfirmT();
        const code = String(args.code ?? "").trim();
        // UNIT B (R2): la elección de desambiguación es parte de los args
        // confirmados; el diálogo muestra la elección y sus consecuencias.
        const choice = String(args.disambiguation ?? "").trim().toLowerCase();
        const newName = String(args.new_name ?? "").trim();
        try {
          // Se decodifica aquí (sin emparejar todavía) para mostrarle al
          // usuario a QUIÉN está a punto de verificar: nombre + huella de
          // la clave de identidad, en el mismo formato que el otro NIDO
          // muestra en persona para cotejo verbal. M-5: además se avisa de
          // conflictos de ligadura nombre↔identidad ya conocidos.
          const payload = decodePairingPayload(code);
          const fp = fingerprint(fromHex(payload.pk));
          const warning = await pairingBindingWarning(
            t,
            payload.pk,
            payload.name,
            () => getNidoMessenger().contacts(),
          );
          // UNIT B (§10 Q10): la pk escaneada fue retirada antes — el
          // diálogo lo dice explícitamente (best-effort, no un gate).
          let revivalNote = "";
          try {
            const anyRow = await findContactRowAny(payload.pk);
            if (anyRow && anyRow.supersededBy) {
              revivalNote = t("agentConfirm.pairBindingWasRetired", { name: anyRow.name });
            }
          } catch {
            revivalNote = "";
          }
          const fullWarning = [warning, revivalNote].filter(Boolean).join("\n");
          // UNIT B: colisión de nombre sin elección explícita → el diálogo
          // muestra la pregunta de desambiguación (el handler la repetirá
          // por chat tras el diálogo). Nada se empareja sin la elección.
          const collision = await findPairingCollision(
            payload.pk,
            payload.name,
            () => getNidoMessenger().contacts(),
          );
          if (collision && !choice) {
            const candidates = collision.map((c) => `«${c.name}»`).join(", ");
            return {
              tool: "nido_pair",
              title: t("agentConfirm.pairDisambiguationTitle"),
              message: t("agentConfirm.pairAmbiguousAsk", {
                name: payload.name,
                fingerprint: fp,
                count: String(collision.length),
                candidates,
              }),
            };
          }
          let message =
            t("agentConfirm.pairMessage", {
              name: payload.name,
              fingerprint: fp,
            }) + (fullWarning ? `\n\n${fullWarning}` : "");
          if (choice === "replace") {
            message +=
              "\n\n" +
              t("agentConfirm.pairReplaceConfirmMessage", {
                name: payload.name,
                fingerprint: fp,
              });
          } else if (choice === "different_person") {
            message +=
              "\n\n" +
              t("agentConfirm.pairDifferentPersonConfirmMessage", {
                name: payload.name,
                fingerprint: fp,
                newName: newName || payload.name,
              });
          } else if (choice === "cancel") {
            message += `\n\n${t("agentConfirm.pairCancelled")}`;
          }
          return {
            tool: "nido_pair",
            title: choice
              ? t("agentConfirm.pairDisambiguationTitle")
              : t("agentConfirm.pairTitle"),
            message,
          };
        } catch {
          // QR inválido: se muestra igual el diálogo y el handler
          // devolverá el error concreto si el usuario confirma.
          return {
            tool: "nido_pair",
            title: t("agentConfirm.pairTitle"),
            message: t("agentConfirm.pairInvalidCode"),
          };
        }
      },
    ),
    // M-6: bandeja de aprobación para tareas remotas encoladas. Revisar es
    // solo lectura; aprobar/rechazar son acciones sensibles con confirmación.
    nido_review_tasks: async () => {
      const t = agentConfirmT();
      const pending = await listPendingAgentTasks();
      if (pending.length === 0) return t("agentTasks.reviewEmpty");
      return (
        t("agentTasks.reviewHeader", { count: String(pending.length) }) +
        "\n" +
        pending
          .map((task) => {
            const when = new Date(task.receivedAt).toLocaleString("es-MX", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            });
            return t("agentTasks.reviewItem", {
              id: task.id,
              sender: task.senderName,
              pkShort: task.senderPkShort,
              action: task.actionText,
              when,
            });
          })
          .join("\n") +
        "\n" +
        t("agentTasks.reviewFooter")
      );
    },
    nido_approve_task: withConfirmation(
      "nido_approve_task",
      async (args) => {
        const t = agentConfirmT();
        const id = String(args.id ?? "").trim();
        if (!id) return t("agentTasks.decideMissingId");
        const ok = await approveAgentTask(id);
        return ok
          ? t("agentTasks.decideApproved", { id })
          : t("agentTasks.decideNotFound", { id });
      },
      opts?.requestConfirm,
      async (args) => {
        const t = agentConfirmT();
        const id = String(args.id ?? "").trim();
        const task = id ? await getPendingAgentTask(id) : null;
        if (!task) {
          return {
            tool: "nido_approve_task",
            title: t("agentConfirm.approveTaskTitle"),
            message: t("agentConfirm.taskNotFound"),
          };
        }
        return {
          tool: "nido_approve_task",
          title: t("agentConfirm.approveTaskTitle"),
          message: t("agentConfirm.approveTaskMessage", {
            sender: `${task.senderName} (${task.senderPkShort}…)`,
            action: task.actionText,
            when: new Date(task.receivedAt).toLocaleString("es-MX", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            }),
          }),
        };
      },
    ),
    nido_reject_task: withConfirmation(
      "nido_reject_task",
      async (args) => {
        const t = agentConfirmT();
        const id = String(args.id ?? "").trim();
        if (!id) return t("agentTasks.decideMissingId");
        const ok = await rejectAgentTask(id);
        return ok
          ? t("agentTasks.decideRejected", { id })
          : t("agentTasks.decideNotFound", { id });
      },
      opts?.requestConfirm,
      async (args) => {
        const t = agentConfirmT();
        const id = String(args.id ?? "").trim();
        const task = id ? await getPendingAgentTask(id) : null;
        if (!task) {
          return {
            tool: "nido_reject_task",
            title: t("agentConfirm.rejectTaskTitle"),
            message: t("agentConfirm.taskNotFound"),
          };
        }
        return {
          tool: "nido_reject_task",
          title: t("agentConfirm.rejectTaskTitle"),
          message: t("agentConfirm.rejectTaskMessage", {
            sender: `${task.senderName} (${task.senderPkShort}…)`,
            action: task.actionText,
          }),
        };
      },
    ),
  };
  if (__DEV__) {
    // Contrato manifiesto <-> handlers: ninguna herramienta declarada
    // debe quedarse sin implementación real.
    for (const tool of LOCAL_TOOLS) {
      if (!handlers[tool.name]) {
        console.warn(`[handlers] herramienta sin handler real: ${tool.name}`);
      }
    }
  }
  return handlers;
}

// ---------------------------------------------------------------- Fase B
// Calendario, contactos, archivos, calculadora, llamadas/SMS.
// Los módulos nativos se importan de forma diferida: solo se cargan cuando
// la herramienta se usa de verdad, no al arrancar el chat.

const calculateHandler: ToolHandler = async (args) => {
  const expr = String(args.expression ?? "").trim();
  if (!expr) return "Error: falta la expresión a calcular.";
  try {
    return `${expr} = ${formatNumber(evaluateExpression(expr))}`;
  } catch (e) {
    return `No pude calcular eso: ${e instanceof Error ? e.message : String(e)}`;
  }
};

const convertUnitsHandler: ToolHandler = async (args) => {
  const value = Number(args.value);
  const from = String(args.from ?? "").trim();
  const to = String(args.to ?? "").trim();
  if (!Number.isFinite(value)) return "Error: el valor a convertir debe ser un número.";
  if (!from || !to) return "Error: indica la unidad de origen y la de destino.";
  try {
    const r = convertUnits(value, from, to);
    return `${formatNumber(value)} ${r.from} = ${formatNumber(r.value)} ${r.to}`;
  } catch (e) {
    return `No pude convertir eso: ${e instanceof Error ? e.message : String(e)}`;
  }
};

async function ensureCalendarAccess(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const Calendar = await import("expo-calendar");
    const perm = await Calendar.requestCalendarPermissions();
    if (!perm.granted) {
      return { ok: false, reason: "NIDO no tiene permiso de calendario. Actívalo en Ajustes del teléfono para que pueda crear y leer eventos." };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "El módulo de calendario no está disponible en este dispositivo." };
  }
}

async function pickWritableCalendar(): Promise<any | null> {
  const Calendar = await import("expo-calendar");
  const calendars = await Calendar.getCalendars();
  const writable = calendars.filter((c: any) => c.allowsModifications);
  return writable.find((c: any) => c.isPrimary) ?? writable[0] ?? null;
}

const createCalendarEventHandler: ToolHandler = async (args) => {
  const access = await ensureCalendarAccess();
  if (!access.ok) return access.reason!;
  const title = String(args.title ?? "").trim();
  if (!title) return "Error: falta el título del evento.";
  const start = new Date(String(args.start ?? ""));
  if (Number.isNaN(start.getTime())) {
    return "Error: la fecha de inicio no es válida. Usa formato ISO, p.ej. 2026-09-27T10:00:00.";
  }
  const endRaw = args.end != null ? String(args.end).trim() : "";
  const end = endRaw ? new Date(endRaw) : new Date(start.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(end.getTime()) || end <= start) {
    return "Error: la fecha de fin no es válida o es anterior al inicio.";
  }
  try {
    const cal = await pickWritableCalendar();
    if (!cal) return "No encontré ningún calendario donde escribir eventos.";
    await cal.createEvent({
      title,
      startDate: start,
      endDate: end,
      notes: args.notes != null ? String(args.notes) : undefined,
      location: args.location != null ? String(args.location) : undefined,
    });
    return `Evento creado: «${title}», ${fmtDateTime(start.toISOString())}.`;
  } catch (e) {
    return `No pude crear el evento: ${e instanceof Error ? e.message : String(e)}`;
  }
};

/** Exportado para las rutinas proactivas (resumen diario). */
export const listCalendarEventsHandler: ToolHandler = async (args) => {
  const access = await ensureCalendarAccess();
  if (!access.ok) return access.reason!;
  const now = new Date();
  const fromRaw = args.from != null ? String(args.from).trim() : "";
  const toRaw = args.to != null ? String(args.to).trim() : "";
  const from = fromRaw ? new Date(fromRaw) : now;
  const to = toRaw ? new Date(toRaw) : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return "Error: rango de fechas inválido. Usa formato ISO.";
  }
  const limit = Number(args.limit) > 0 ? Math.min(Math.floor(Number(args.limit)), 50) : 20;
  try {
    const Calendar = await import("expo-calendar");
    const calendars = await Calendar.getCalendars();
    if (calendars.length === 0) return "No hay calendarios en el teléfono.";
    const events = await Calendar.listEvents(calendars, from, to);
    const upcoming = events
      .slice(0, limit)
      .map((e: any) => {
        const s = e.startDate ? new Date(e.startDate) : null;
        return `- «${e.title ?? "(sin título)"}»${s ? ` — ${fmtDateTime(s.toISOString())}` : ""}${e.location ? ` @ ${e.location}` : ""}`;
      });
    if (upcoming.length === 0) return "No hay eventos en ese rango.";
    return `Próximos eventos:\n${upcoming.join("\n")}`;
  } catch (e) {
    return `No pude leer el calendario: ${e instanceof Error ? e.message : String(e)}`;
  }
};

const findContactHandler: ToolHandler = async (args) => {
  const query = String(args.query ?? "").trim().toLowerCase();
  if (!query) return "Error: falta el nombre a buscar.";
  try {
    const Contacts = await import("expo-contacts");
    const perm = await Contacts.requestPermissionsAsync();
    if (!perm.granted) {
      return "NIDO no tiene permiso de contactos. Actívalo en Ajustes del teléfono para buscar.";
    }
    const container = await Contacts.Container.getDefault();
    if (!container) return "No pude acceder a los contactos del teléfono.";
    const all = await container.getContacts();
    const matches = all
      .filter((c: any) => {
        const haystack = [c.name, c.firstName, c.lastName, ...(c.phoneNumbers ?? []).map((p: any) => p.number)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 5);
    if (matches.length === 0) return `No encontré ningún contacto que coincida con «${args.query}».`;
    return (
      "Contactos encontrados:\n" +
      matches
        .map((c: any) => {
          const phone = (c.phoneNumbers ?? [])[0]?.number ?? "sin teléfono";
          return `- ${c.name ?? `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim()} — ${phone}`;
        })
        .join("\n")
    );
  } catch (e) {
    return `No pude buscar contactos: ${e instanceof Error ? e.message : String(e)}`;
  }
};

function cleanPhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

const placeCallHandler: ToolHandler = async (args) => {
  const phone = cleanPhone(String(args.phone ?? ""));
  if (!phone) return "Error: falta un número de teléfono válido.";
  try {
    const { Linking } = await import("react-native");
    await Linking.openURL(`tel:${phone}`);
    return `Abriendo el marcador con ${phone}… confírmame tú la llamada.`;
  } catch {
    return "No pude abrir el marcador del teléfono.";
  }
};

const sendSmsHandler: ToolHandler = async (args) => {
  const phone = cleanPhone(String(args.phone ?? ""));
  const message = String(args.message ?? "").trim();
  if (!phone) return "Error: falta un número de teléfono válido.";
  if (!message) return "Error: falta el texto del mensaje.";
  try {
    const RN = await import("react-native");
    const sep = RN.Platform.OS === "ios" ? "&" : "?";
    await RN.Linking.openURL(`sms:${phone}${sep}body=${encodeURIComponent(message)}`);
    return `Abriendo mensajes para ${phone} con el texto listo… envíalo tú cuando quieras.`;
  } catch {
    return "No pude abrir la app de mensajes.";
  }
};

const MAX_PICKED_FILE_BYTES = 200 * 1024;

const readPickedFileHandler: ToolHandler = async () => {
  try {
    const DocumentPicker = await import("expo-document-picker");
    const picked = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.length) {
      return "No elegiste ningún archivo.";
    }
    const asset = picked.assets[0];
    if (asset.size != null && asset.size > MAX_PICKED_FILE_BYTES) {
      return `«${asset.name ?? "archivo"}» pesa más de 200 KB; elige un archivo de texto más pequeño.`;
    }
    const FS = await import("expo-file-system");
    const buf = await new FS.File(asset.uri).arrayBuffer();
    if (buf.byteLength > MAX_PICKED_FILE_BYTES) {
      return `«${asset.name ?? "archivo"}» es demasiado grande para leerlo aquí (máx. 200 KB).`;
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (!text.trim()) return `«${asset.name ?? "archivo"}» está vacío o no es texto legible.`;
    const shown = text.slice(0, 8000);
    return `Archivo «${asset.name ?? "sin nombre"}» (${Math.round(buf.byteLength / 1024)} KB):\n${shown}${text.length > shown.length ? "\n…(recortado)" : ""}`;
  } catch (e) {
    return `No pude leer el archivo: ${e instanceof Error ? e.message : String(e)}`;
  }
};

// ---------------------------------------------------------------- Fase D
// Skills reutilizables e intérprete de datos.

const useSkillHandler: ToolHandler = async (args) => {
  const name = String(args.name ?? "").trim();
  if (!name) {
    const available = listSkills().map((s) => s.name).join(", ");
    return `Indica el nombre de la skill. Disponibles: ${available}.`;
  }
  const skill = loadSkill(name);
  if (!skill) {
    const available = listSkills().map((s) => s.name).join(", ");
    return `No conozco la skill «${name}». Disponibles: ${available}.`;
  }
  return `Skill «${skill.name}» cargada. Sigue estas instrucciones:\n\n${skill.instructions}`;
};

const analyzeTableHandler: ToolHandler = async (args) => {
  const text = String(args.text ?? "");
  if (!text.trim()) return "Error: falta el texto de la tabla a analizar.";
  if (text.length > 200 * 1024) {
    return "Error: la tabla supera los 200 KB. Pide al usuario un archivo más pequeño.";
  }
  try {
    return analyzeTable(text, {
      filter: args.filter != null ? String(args.filter) : undefined,
      sortBy: args.sort_by != null ? String(args.sort_by) : undefined,
      topN: args.top_n != null ? Number(args.top_n) : undefined,
    });
  } catch (e) {
    return `No pude analizar la tabla: ${e instanceof Error ? e.message : String(e)}`;
  }
};

// ---------------------------------------------------------------- Fase E
// Mensajería NIDO a NIDO: cifrada, teléfono a teléfono, cero red.
// El transporte nativo (Bluetooth) aún no está compilado: los mensajes se
// cifran al enviar y quedan en la cola de salida hasta que el peer esté
// al alcance. Nada se finge enviado.
//
// El messenger es un singleton compartido con la UI (NidoScreen): las
// sesiones viven en memoria y dos instancias las duplicarían.
import { getSharedNidoMessenger } from "../../services/nidoMessenger";
function getNidoMessenger(): NidoMessenger {
  return getSharedNidoMessenger();
}

/**
 * N2: derivación canónica del payload de nido_send_message.
 *
 * La descripción para el diálogo de confirmación Y el handler usan esta
 * MISMA función: no existe una segunda derivación que pueda divergir
 * (p. ej. truncar para mostrar pero enviar completo). El invariante se
 * verifica además de punta a punta en consentParity.test.ts.
 */
export function nidoSendMessagePayload(args: Record<string, unknown>): {
  to: string;
  text: string;
} {
  return {
    to: String(args.to ?? "").trim(),
    text: String(args.text ?? "").trim(),
  };
}

const nidoSendMessageHandler: ToolHandler = async (args) => {
  // N2: la MISMA derivación canónica que el diálogo de confirmación
  // mostró al usuario. Lo aprobado === lo transmitido.
  const { to, text } = nidoSendMessagePayload(args);
  if (!to) return "Error: indica el nombre del contacto NIDO.";
  if (!text) return "Error: el mensaje está vacío.";
  try {
    const m = getNidoMessenger();
    await m.ensureIdentity();
    const { queued } = await m.sendChat(to, text);
    return queued
      ? `Mensaje para «${to}» guardado cifrado en la cola de salida: se entregará cuando su NIDO esté al alcance (Bluetooth).`
      : `Mensaje enviado a «${to}» por NIDO (cifrado de extremo a extremo).`;
  } catch (e) {
    return `No pude enviar el mensaje NIDO: ${e instanceof Error ? e.message : String(e)}`;
  }
};

const nidoReadInboxHandler: ToolHandler = async () => {
  try {
    const m = getNidoMessenger();
    await m.ensureIdentity();
    const contacts = await m.contacts();
    const names = new Map(contacts.map((c) => [c.pkHex.toLowerCase(), c.name]));
    const unread = await m.readInbox();
    if (unread.length === 0) return "No tienes mensajes NIDO sin leer.";
    return unread
      .map((msg) => {
        const who = names.get(msg.peerPk.toLowerCase()) ?? "Contacto NIDO";
        const when = new Date(msg.ts).toLocaleString("es-MX", {
          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        });
        // M-6: la tarea sigue "queued" (readInbox ya no la marca como leída);
        // se muestra como pendiente de decisión explícita.
        if (msg.type === "agent_task" && msg.status === "queued") {
          return (
            `• ${who} (${when}): ${msg.text}\n` +
            `  Pendiente de tu aprobación — revísala con nido_review_tasks (id ${msg.id}).`
          );
        }
        return `• ${who} (${when}): ${msg.text}`;
      })
      .join("\n");
  } catch (e) {
    return `No pude leer la bandeja NIDO: ${e instanceof Error ? e.message : String(e)}`;
  }
};

const nidoMyCodeHandler: ToolHandler = async () => {
  try {
    const m = getNidoMessenger();
    const { fingerprint: fp } = await m.ensureIdentity();
    const code = await m.myPairingCode();
    return (
      "Tu código de emparejamiento NIDO (muéstralo como QR para que el otro teléfono lo escanee):\n" +
      `${code}\nHuella para verificar en persona: ${fp}`
    );
  } catch (e) {
    return `No pude generar tu código: ${e instanceof Error ? e.message : String(e)}`;
  }
};

const nidoPairHandler: ToolHandler = async (args) => {
  const code = String(args.code ?? "").trim();
  if (!code) return "Error: falta el código del otro NIDO.";
  const t = agentConfirmT();
  // UNIT B (R2): la elección de desambiguación forma parte de los args
  // confirmados. Sin elección explícita ante una colisión de nombre,
  // pairWith falla cerrado (PairingDisambiguationRequiredError) y aquí se
  // le pide la elección al usuario por chat, con el QR ya decodificado
  // (nombre + huella). Default = cancel: jamás se asume "replace".
  const rawChoice = String(args.disambiguation ?? "").trim().toLowerCase();
  const disambiguation =
    rawChoice === ""
      ? undefined
      : rawChoice === "replace" || rawChoice === "different_person" || rawChoice === "cancel"
        ? rawChoice
        : "invalid";
  if (disambiguation === "invalid") {
    return t("agentConfirm.pairInvalidChoice", { choice: String(args.disambiguation) });
  }
  const newName = String(args.new_name ?? "").trim();
  try {
    const m = getNidoMessenger();
    await m.ensureIdentity();
    // UNIT B concurrency closure: fija por PK las identidades que el
    // usuario confirmó retirar (colisión calculada aquí, en el momento del
    // handler). Si alguna ya no está viva, pairWith falla cerrado con
    // StaleReplaceConflictError; el SQL decide la carrera.
    let replaceTargets: string[] | undefined;
    if (disambiguation === "replace") {
      try {
        const payload = decodePairingPayload(code);
        const collision = await findPairingCollision(
          payload.pk,
          payload.name,
          () => m.contacts(),
        );
        replaceTargets = (collision ?? []).map((c) => c.pkHex);
      } catch {
        replaceTargets = undefined;
      }
    }
    const contact = await m.pairWith(
      code,
      disambiguation ? { disambiguation, newName, replaceTargets } : undefined,
    );
    // null = el usuario eligió "cancel": nada se escribió.
    if (!contact) return t("agentConfirm.pairCancelled");
    const replacedNote =
      disambiguation === "replace"
        ? " La identidad anterior quedó retirada en todas partes: murieron sus rutas, sesiones y mensajes pendientes; los mensajes antiguos siguen legibles."
        : "";
    return `Contacto «${contact.name}» emparejado y verificado. Ya pueden enviarse mensajes cifrados de NIDO a NIDO, sin internet.${replacedNote}`;
  } catch (e) {
    if (e instanceof StaleReplaceConflictError) {
      // UNIT B concurrency closure: otro Replace retiró ya la identidad
      // que se pretendía reemplazar. Nada se escribió (rollback); el
      // usuario debe decidir con el estado actual, no reintentar a ciegas.
      return (
        "No pude emparejar: la identidad que se pretendía reemplazar ya fue " +
        "retirada por otro emparejamiento. Nada se escribió. Revisa tus " +
        "contactos y, si aún quieres emparejar este código, hazlo de nuevo " +
        "con la información actualizada."
      );
    }
    if (e instanceof PairingDisambiguationRequiredError) {
      let payloadName = "?";
      let fp = "?";
      try {
        const payload = decodePairingPayload(code);
        payloadName = payload.name;
        fp = fingerprint(fromHex(payload.pk));
      } catch {
        // Si el QR ni siquiera decodifica, el mensaje de abajo ya no
        // aplica; se devuelve el error original.
        return `No pude emparejar: ${e instanceof Error ? e.message : String(e)}`;
      }
      const candidates = e.candidates.map((c) => `«${c.name}»`).join(", ");
      return t("agentConfirm.pairAmbiguousAsk", {
        name: payloadName,
        fingerprint: fp,
        count: String(e.candidates.length),
        candidates,
      });
    }
    return `No pude emparejar: ${e instanceof Error ? e.message : String(e)}`;
  }
};
