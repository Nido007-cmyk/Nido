/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

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
  deleteNote,
  saveReminder,
  deleteReminder,
  saveFact,
  MAX_FACT_CONTENT_CHARS,
  MAX_PERSON_NOTES_CHARS,
} from "../memory/memoryStore";
import { LOCAL_TOOLS } from "./manifest";
import type { ToolHandler } from "./dispatcher";
import { withConfirmation, type RequestConfirm } from "./confirm";
import { actionLog } from "../actionLog";
import {
  classifyOpenAppTarget,
  type OpenAppRejectReason,
} from "./externalLink";
import { evaluateExpression, formatNumber, isApproximate } from "./calc";
import { convertUnits, ConvertError, validUnits } from "./convert";
import { loadSkill, listSkills } from "../skills/registry";
import { analyzeTable } from "./analyze";
import { NidoMessenger, PairingDisambiguationRequiredError } from "../../p2p/messenger";
import { StaleReplaceConflictError } from "../../p2p/store";
import { decodePairingPayload } from "../../p2p/pairing";
import { pairingBindingWarning, findPairingCollision } from "../../p2p/pairingCeremony";
import { findContactRowAny } from "../../p2p/store";
import { fingerprint, fromHex } from "../../p2p/crypto";
import { withPermissionRequest } from "../../p2p/permissionGuard";
import type { ContactSearchResult } from "../loop/contactRouter";
import { ensureRuntimePermission, filterContacts } from "./contactSearch";
import { formatDay, formatTime, type RouterLang } from "../loop/toolRouter";
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
  // T-11 (m-54): place_call y send_sms se confirman en el handler.
  "agentConfirm.placeCallTitle": "Phone call",
  "agentConfirm.placeCallMessage": "Open the dialer with {{phone}}? One more tap starts the call.",
  "agentConfirm.sendSmsTitle": "Text message (SMS)",
  "agentConfirm.sendSmsMessage": "Open Messages to {{phone}} with this text ready to send?\n\n“{{text}}”",
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
    "The answer \"{{choice}}\" doesn't settle the pairing question: nothing has been done. Ask again and accept only \"replace\" (the same person with a new phone), \"different person\" (a different person) or \"cancel\" (do nothing).",
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
    "NIDO can't open this link ({{reason}}). Allowed schemes: https, tel, sms, mailto.",
  "agentConfirm.openAppReason.empty": "it's empty",
  "agentConfirm.openAppReason.no-scheme": "it doesn't start with a valid scheme",
  "agentConfirm.openAppReason.scheme-not-allowed": "its scheme isn't allowed",
  "agentConfirm.openAppReason.unsafe-chars": "it contains unsafe characters",
  "agentConfirm.openAppReason.insecure-http":
    "it is an unencrypted http link; the https version is the one to open",
};
/** Idioma vigente de la UI para formatear fechas en los diálogos. */
function confirmLang(): RouterLang {
  try {
    const i18n = require("../../i18n").default as { language?: string };
    const l = (i18n.language ?? "").slice(0, 2);
    if (l === "es" || l === "en" || l === "pt") return l;
  } catch { /* sin i18n: se cae al idioma de los textos de reserva */ }
  return "en";
}

/**
 * 0.1.25 (nota física del dueño, Tab A9+ 2026-10-12): el diálogo de
 * crear evento mostraba el instante en ISO crudo UTC
 * («2026-10-16T17:00:00.000Z») en vez de la fecha local legible. Se
 * formatea con los helpers sin Intl de siempre, en el idioma de la
 * UI y en la hora LOCAL del dispositivo (los getters de Date ya
 * trabajan en la zona del sistema).
 */
function fmtDialogWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const lang = confirmLang();
  const at = lang === "en" ? "at" : lang === "pt" ? "às" : "a las";
  return `${formatDay(d, lang)} ${at} ${formatTime(d, lang)}`;
}

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
/**
 * 0.1.31 (auditoría del loop): idioma de la UI para los textos que los
 * handlers devuelven y que el router muestra tal cual (fechas de notas,
 * mensajes NIDO, eventos, errores de calendario/conversión). Antes iban
 * siempre en español aunque la app estuviera en inglés o portugués. Sin
 * i18n (tests) se queda en español, como antes.
 */
let langOverrideForTest: RouterLang | null = null;
/** Solo tests: fija el idioma de la UI que ven los handlers (null = el real). */
export function setHandlerLangForTest(lang: RouterLang | null): void {
  langOverrideForTest = lang;
}

function uiLang(): RouterLang {
  if (langOverrideForTest) return langOverrideForTest;
  try {
    const i18n = require("../../i18n").default as { language?: string };
    const l = (i18n.language ?? "").slice(0, 2);
    if (l === "es" || l === "en" || l === "pt") return l;
  } catch { /* sin i18n */ }
  return "es";
}
const L = (es: string, en: string, pt: string): string => {
  const l = uiLang();
  return l === "en" ? en : l === "pt" ? pt : es;
};

export function fmtDateTime(iso: string | null): string {
  if (!iso) return L("sin fecha", "no date", "sem data");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // 0.1.8: sin Intl (CRASH-2026-10-10, ver el formato sin Intl en toolRouter.ts): en Hermes
  // para Android toLocale*String con opciones pasa por JNI y puede cerrar
  // la app. Solo getters de Date.
  const lang = uiLang();
  return `${formatDay(d, lang)}, ${formatTime(d, lang)}`;
}

/**
 * Hora actual del dispositivo, en el idioma de la UI.
 * T-11 (0.1.99, P-08): fijaba «es» y respondía en español con la app en
 * inglés o portugués; su vecino fmtDateTime ya usa uiLang().
 */
const deviceTime: ToolHandler = async () => {
  const now = new Date();
  const lang = uiLang();
  const time = formatTime(now, lang);
  const day = formatDay(now, lang);
  const year = now.getFullYear();
  return L(
    `Ahora son las ${time} del ${day} de ${year} (hora del dispositivo).`,
    `It is now ${time} on ${day}, ${year} (device time).`,
    `Agora são ${time} de ${day} de ${year} (hora do dispositivo).`,
  );
};

const saveNoteHandler: ToolHandler = async (args) => {
  const title = String(args.title ?? "").trim();
  const body = String(args.body ?? "");
  if (!title) return L("Error: falta el título de la nota.", "Error: the note title is missing.", "Erro: falta o título da nota.");
  const note = await saveNote({ title, body });
  actionLog.noteUndo("save_note", { kind: "note", id: note.id });
  return L(
    `Nota guardada: «${note.title}» (id ${note.id}).`,
    `Note saved: “${note.title}” (id ${note.id}).`,
    `Nota guardada: «${note.title}» (id ${note.id}).`,
  );
};

const listNotesHandler: ToolHandler = async () => {
  const notes = await listNotes(20);
  if (notes.length === 0) return L("No hay notas guardadas todavía.", "There are no saved notes yet.", "Ainda não há notas guardadas.");
  return (
    L("Notas guardadas:", "Saved notes:", "Notas guardadas:") +
    "\n" +
    notes.map((n) => `- «${n.title}» (id ${n.id}, ${fmtDateTime(n.created_at)})`).join("\n") +
    L("\nUsa read_note con el id para leer una completa.", "\nUse read_note with the id to read one in full.", "\nUsa read_note com o id para ler uma completa.")
  );
};

const readNoteHandler: ToolHandler = async (args) => {
  const id = String(args.id ?? "").trim();
  if (!id) return L("Error: falta el id de la nota.", "Error: the note id is missing.", "Erro: falta o id da nota.");
  const note = await getNote(id);
  if (!note) return L(`No encontré ninguna nota con id ${id}.`, `I couldn't find any note with id ${id}.`, `Não encontrei nenhuma nota com id ${id}.`);
  return `«${note.title}» (${fmtDateTime(note.created_at)}):\n${note.body || L("(sin contenido)", "(empty)", "(sem conteúdo)")}`;
};

/**
 * 0.1.20 (P3-9): borrar notas y recordatorios por la vía del agente.
 * Antes NO existía herramienta de borrado: "borra la nota de la receta"
 * caía al modelo y no pasaba nada. La confirmación la impone la política
 * (IRREVERSIBLE_TOOLS): el diálogo muestra el título/texto exacto
 * (confirmText.ts) y sin confirmación el dispatcher ni llega aquí.
 */
/**
 * 0.1.29 (auditoría 2026-10-13): el diálogo de confirmación muestra la
 * etiqueta que llega en los args (title/text). Por la ruta del modelo esa
 * etiqueta la escribe el modelo, que puede estar influido por contenido
 * externo: «borra la nota <id de tu nota importante>» con el título «nota
 * vieja de prueba» se confirmaba viendo un nombre y borraba otra cosa. Solo
 * se borra si lo que el usuario vio coincide con lo guardado; si no,
 * no se borra nada (se lanza: el dispatcher lo reporta como fallo, nunca
 * como borrado).
 */
function sameLabel(shown: unknown, stored: string): boolean {
  const n = (v: string) => v.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return typeof shown === "string" && n(shown).length > 0 && n(shown) === n(stored);
}

const deleteNoteHandler: ToolHandler = async (args) => {
  const id = String(args.id ?? "").trim();
  if (!id) return L("Error: falta el id de la nota.", "Error: the note id is missing.", "Erro: falta o id da nota.");
  const note = await getNote(id);
  if (!note) return L(`No encontré ninguna nota con id ${id}.`, `I couldn't find any note with id ${id}.`, `Não encontrei nenhuma nota com id ${id}.`);
  if (!sameLabel(args.title, note.title)) {
    throw new Error(L("la nota confirmada no coincide con la guardada; no se borró nada", "the confirmed note doesn't match the saved one; nothing was deleted", "a nota confirmada não coincide com a guardada; nada foi apagado"));
  }
  await deleteNote(id);
  return L(`Nota borrada: «${note.title}».`, `Note deleted: “${note.title}”.`, `Nota apagada: «${note.title}».`);
};

/**
 * Arreglos «todo es todo» (2026-11-03): olvidar un recuerdo desde el chat.
 * Como borrar una nota: irreversible (la política pide confirmación y el
 * diálogo muestra el recuerdo exacto) y solo se borra si lo confirmado
 * coincide con lo guardado.
 */
const deleteMemoryHandler: ToolHandler = async (args) => {
  const id = String(args.id ?? "").trim();
  const kind = args.kind === "person" ? "person" : "fact";
  if (!id) return L("Error: falta el id del recuerdo.", "Error: the memory id is missing.", "Erro: falta o id da lembrança.");
  const store = await import("../memory/memoryStore");
  if (kind === "person") {
    const person = (await store.getPeople()).find((p) => p.id === id);
    if (!person) return L(`No encontré ese recuerdo (id ${id}).`, `I couldn't find that memory (id ${id}).`, `Não encontrei essa lembrança (id ${id}).`);
    const label = person.relationship ? `${person.name} (${person.relationship})` : person.name;
    if (!sameLabel(args.content, label)) throw new Error(L("el recuerdo confirmado no coincide con el guardado; no se borró nada", "the confirmed memory doesn't match the saved one; nothing was deleted", "a lembrança confirmada não coincide com a guardada; nada foi apagado"));
    await store.deletePerson(id);
    return L(`Recuerdo borrado: «${label}».`, `Memory deleted: “${label}”.`, `Lembrança apagada: «${label}».`);
  }
  const fact = (await store.getFacts(500)).find((f) => f.id === id);
  if (!fact) return L(`No encontré ese recuerdo (id ${id}).`, `I couldn't find that memory (id ${id}).`, `Não encontrei essa lembrança (id ${id}).`);
  if (!sameLabel(args.content, fact.content)) throw new Error(L("el recuerdo confirmado no coincide con el guardado; no se borró nada", "the confirmed memory doesn't match the saved one; nothing was deleted", "a lembrança confirmada não coincide com a guardada; nada foi apagado"));
  await store.deleteFact(id);
  return L(`Recuerdo borrado: «${fact.content}».`, `Memory deleted: “${fact.content}”.`, `Lembrança apagada: «${fact.content}».`);
};

const deleteReminderHandler: ToolHandler = async (args) => {
  const id = String(args.id ?? "").trim();
  if (!id) return L("Error: falta el id del recordatorio.", "Error: the reminder id is missing.", "Erro: falta o id do lembrete.");
  const { listReminders } = await import("../memory/memoryStore");
  const reminder = (await listReminders(200)).find((r) => r.id === id);
  if (!reminder) return L(`No encontré ningún recordatorio con id ${id}.`, `I couldn't find any reminder with id ${id}.`, `Não encontrei nenhum lembrete com id ${id}.`);
  if (!sameLabel(args.text, reminder.text)) {
    throw new Error(L("el recordatorio confirmado no coincide con el guardado; no se borró nada", "the confirmed reminder doesn't match the saved one; nothing was deleted", "o lembrete confirmado não coincide com o guardado; nada foi apagado"));
  }
  // Cancelar el aviso del sistema ANTES de borrar: si quedara programado,
  // sonaría para un recordatorio que ya no existe.
  try {
    const { cancelReminderNotification } = await import("../../notify/notifications");
    await cancelReminderNotification(id);
  } catch {
    // Sin módulo de notificaciones disponible: el borrado sigue.
  }
  await deleteReminder(id);
  return L(`Recordatorio borrado: «${reminder.text}».`, `Reminder deleted: “${reminder.text}”.`, `Lembrete apagado: «${reminder.text}».`);
};

const createReminderHandler: ToolHandler = async (args) => {
  const text = String(args.text ?? "").trim();
  if (!text) return L("Error: falta el texto del recordatorio.", "Error: the reminder text is missing.", "Erro: falta o texto do lembrete.");
  let dueAt: string | null = null;
  const at = args.at != null ? String(args.at).trim() : "";
  if (at) {
    const d = new Date(at);
    if (!Number.isNaN(d.getTime())) {
      // FIX 2026-10-09 (A2): rechazar fechas en el pasado. El path
      // determinístico ya lo hace; el del modelo no.
      if (d.getTime() < Date.now() - 60_000) {
        return L("Error: la fecha del recordatorio está en el pasado. Usa una fecha futura.", "Error: the reminder date is in the past. Use a future date.", "Erro: a data do lembrete está no passado. Use uma data futura.");
      }
      dueAt = d.toISOString();
    } else {
      // T-11 (0.1.99, P-10b): un `at` no vacío e imposible se guardaba
      // SIN fecha y se presentaba como éxito («(sin fecha)»), así que
      // el aviso esperado nunca llegaba y nadie lo sabía. Ahora es un
      // error observable y no se guarda nada. Desde T-10 el dispatcher
      // ya rechaza el `at` que no sea ISO; esto es la segunda línea,
      // en el handler, como openAppHandler vuelve a clasificar.
      return L(
        `Error: no pude interpretar la fecha «${at}» y no guardé el recordatorio. Pide la fecha en un formato claro, por ejemplo 2026-11-20T09:00.`,
        `Error: I couldn't parse the date "${at}" and the reminder was NOT saved. Ask for the date in a clear format, for example 2026-11-20T09:00.`,
        `Erro: não consegui interpretar a data "${at}" e o lembrete NÃO foi guardado. Peça a data num formato claro, por exemplo 2026-11-20T09:00.`,
      );
    }
  }
  const reminder = await saveReminder({ text, dueAt });
  actionLog.noteUndo("create_reminder", { kind: "reminder", id: reminder.id });
  const cuando = dueAt
    ? L(` para ${fmtDateTime(dueAt)}`, ` for ${fmtDateTime(dueAt)}`, ` para ${fmtDateTime(dueAt)}`)
    : L(" (sin fecha)", " (no date)", " (sem data)");
  let aviso = L("Te avisaré al abrir NIDO cuando llegue la hora.", "I'll remind you when you open NIDO once it's time.", "Aviso você ao abrir o NIDO quando chegar a hora.");
  if (dueAt) {
    // Aviso real del sistema, programado en el dispositivo (Fase C).
    try {
      const { scheduleReminderNotification } = await import("../../notify/notifications");
      const ok = await scheduleReminderNotification(reminder.id, reminder.text, new Date(dueAt));
      if (ok) aviso = L("Te llegará un aviso del sistema a esa hora, aunque NIDO esté cerrado.", "You'll get a system notification at that time, even if NIDO is closed.", "Você receberá um aviso do sistema nessa hora, mesmo com o NIDO fechado.");
    } catch {
      // Sin notificaciones: el recordatorio sigue guardado y se muestra al abrir.
    }
  }
  return L(
    `Recordatorio guardado${cuando}: «${reminder.text}». ${aviso}`,
    `Reminder saved${cuando}: “${reminder.text}”. ${aviso}`,
    `Lembrete guardado${cuando}: «${reminder.text}». ${aviso}`,
  );
};

/**
 * H11-2026-10-06: detector simple de fechas en texto (ES/EN/PT).
 * Si un fact contiene una fecha, el resultado sugiere crear un recordatorio.
 * No intenta NLP completo; solo patrones comunes de fechas.
 */
// Auditoría de la 0.1.70: la tabla tenía es/en sin «setiembre» y sin
// portugués; las demás tablas de meses del árbol ya los traen.
const DATE_PATTERNS: RegExp[] = [
  /\b\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/i,
  /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre) \d{1,2}\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}\b/i,
  /\b\d{1,2}(?:st|nd|rd|th)? (?:of )?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b\d{1,2} de (janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i,
  /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/,
];

export function containsDatePattern(text: string): boolean {
  return DATE_PATTERNS.some((re) => re.test(text));
}

const rememberFactHandler: ToolHandler = async (args) => {
  const content = String(args.content ?? "").trim();
  if (!content) return L("Error: falta el contenido del hecho.", "Error: the fact content is missing.", "Erro: falta o conteúdo do fato.");
  // M1-2026-10-06 (track 2): allowlist de categorías. El LLM puede enviar
  // cualquier string; sin validación se almacenan categorías bogus.
  const VALID_CATEGORIES = ["general", "preference", "goal", "event"] as const;
  const rawCategory = String(args.category ?? "general").trim() || "general";
  const category = (VALID_CATEGORIES as readonly string[]).includes(rawCategory)
    ? rawCategory
    : "general";
  // T-11 (0.1.99, m-15): la confirmación cita lo GUARDADO (el Fact que
  // devuelve saveFact), no el argumento íntegro. El almacén recorta a
  // MAX_FACT_CONTENT_CHARS y la versión anterior confirmaba el texto
  // completo como si se hubiera guardado entero: el usuario creía
  // guardado lo que se perdió. Si la entrada superó el tope, se avisa.
  const saved = await saveFact({ content, category: category as "general", source: "user" });
  let result = L(
    `Guardado en mi memoria: «${saved.content}» (categoría: ${category}).`,
    `Saved in my memory: “${saved.content}” (category: ${category}).`,
    `Guardado na minha memória: «${saved.content}» (categoria: ${category}).`,
  );
  if (content.length > MAX_FACT_CONTENT_CHARS) {
    result += L(
      ` Aviso: el texto superaba el máximo de ${MAX_FACT_CONTENT_CHARS} caracteres y se guardó recortado.`,
      ` Note: the text exceeded the ${MAX_FACT_CONTENT_CHARS}-character maximum and was saved trimmed.`,
      ` Aviso: o texto excedia o máximo de ${MAX_FACT_CONTENT_CHARS} caracteres e foi guardado cortado.`,
    );
  }
  // H11: puente memoria→notificación. Si hay una fecha, sugerir recordatorio.
  if (containsDatePattern(saved.content)) {
    result += L(
      ` Veo que menciona una fecha — si quieres que te avise con tiempo, pídeme "créame un recordatorio para..."`,
      ` I see it mentions a date — if you want me to warn you ahead of time, ask me "create a reminder for..."`,
      ` Vejo que menciona uma data — se você quiser que eu avise com antecedência, peça "crie um lembrete para..."`,
    );
  }
  return result;
};

/**
 * PEOPLE-FIX 2026-10-07: handler para guardar personas. savePerson existía
 * pero no tenía caller, herramienta ni flujo (reportado por el usuario).
 */
const savePersonHandler: ToolHandler = async (args) => {
  const { savePerson } = await import("../memory/memoryStore");
  const name = String(args.name ?? "").trim();
  if (!name) return L("Error: falta el nombre de la persona.", "Error: the person's name is missing.", "Erro: falta o nome da pessoa.");
  const relationship = args.relationship ? String(args.relationship).trim() : undefined;
  const notes = args.notes ? String(args.notes).trim() : undefined;
  const person = await savePerson({ name, relationship, notes });
  const rel = person.relationship ? ` (${person.relationship})` : "";
  let result = L(
    `Persona guardada: «${person.name}»${rel}.`,
    `Person saved: “${person.name}”${rel}.`,
    `Pessoa guardada: «${person.name}»${rel}.`,
  );
  // T-11 (m-15): mismo patrón que remember_fact — si las notas superaron
  // el tope del almacén, se avisa del recorte en vez de callarlo.
  if (notes && notes.length > MAX_PERSON_NOTES_CHARS) {
    result += L(
      ` Aviso: las notas superaban el máximo de ${MAX_PERSON_NOTES_CHARS} caracteres y se guardaron recortadas.`,
      ` Note: the notes exceeded the ${MAX_PERSON_NOTES_CHARS}-character maximum and were saved trimmed.`,
      ` Aviso: as notas excediam o máximo de ${MAX_PERSON_NOTES_CHARS} caracteres e foram guardadas cortadas.`,
    );
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
    return L(`Abriendo ${c.normalized}…`, `Opening ${c.normalized}…`, `Abrindo ${c.normalized}…`);
  } catch {
    return L(`No pude abrir ${c.normalized} desde NIDO.`, `I couldn't open ${c.normalized} from NIDO.`, `Não consegui abrir ${c.normalized} do NIDO.`);
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
    delete_note: deleteNoteHandler,
    create_reminder: createReminderHandler,
    delete_reminder: deleteReminderHandler,
    delete_memory: deleteMemoryHandler,
    remember_fact: rememberFactHandler,
    save_person: savePersonHandler,
    // T-11 (0.1.99, P-09): propose_negotiation ya NO se registra. Nunca
    // estuvo en el manifiesto (el modelo no podía invocarla) y la
    // negociación entre pares es territorio de las tandas P2P
    // (T-12/T-13): si un día se cablea, entrará con manifiesto, puerta
    // de política y confirmación pensados, no por un registro huérfano.
    // El servicio (p2p/negotiationService) queda intacto.
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
        const start = fmtDialogWhen(String(args.start ?? "").trim());
        const end = args.end ? fmtDialogWhen(String(args.end).trim()) : "";
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
    // T-11 (m-54): place_call y send_sms se confirman AQUÍ, con el
    // número (y el texto) completos. La justificación anterior («el SO
    // confirma») no aguantaba: el marcador abre con el número tecleado
    // pero nada confirma la llamada, y Mensajes abre con el texto
    // relleno. Con la envoltura, el dispatcher omite su pregunta
    // genérica (m-11) y queda UNA sola, la informada.
    place_call: withConfirmation(
      "place_call",
      placeCallHandler,
      opts?.requestConfirm,
      (args) => {
        const t = agentConfirmT();
        return {
          tool: "place_call",
          title: t("agentConfirm.placeCallTitle"),
          message: t("agentConfirm.placeCallMessage", {
            phone: cleanPhone(String(args.phone ?? "")),
          }),
        };
      },
    ),
    send_sms: withConfirmation(
      "send_sms",
      sendSmsHandler,
      opts?.requestConfirm,
      (args) => {
        const t = agentConfirmT();
        return {
          tool: "send_sms",
          title: t("agentConfirm.sendSmsTitle"),
          // N2: el diálogo muestra el texto COMPLETO que quedará listo
          // para enviar — nunca un resumen truncado.
          message: t("agentConfirm.sendSmsMessage", {
            phone: cleanPhone(String(args.phone ?? "")),
            text: String(args.message ?? "").trim(),
          }),
        };
      },
    ),
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
          const fp = fingerprint(fromHex(payload.pk), payload.spk ? fromHex(payload.spk) : null);
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
            const when = fmtDateTime(new Date(task.receivedAt).toISOString());
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
            when: fmtDateTime(new Date(task.receivedAt).toISOString()),
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
  if (typeof __DEV__ !== "undefined" && __DEV__) {
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
  if (!expr) return L("Error: falta la expresión a calcular.", "Error: the expression to calculate is missing.", "Erro: falta a expressão a calcular.");
  try {
    const value = evaluateExpression(expr);
    return `${expr} ${isApproximate(value) ? "≈" : "="} ${formatNumber(value)}`;
  } catch (e) {
    return `${L("No pude calcular eso: ", "I couldn't calculate that: ", "Não consegui calcular isso: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

const convertUnitsHandler: ToolHandler = async (args) => {
  const value = Number(args.value);
  const from = String(args.from ?? "").trim();
  const to = String(args.to ?? "").trim();
  if (!Number.isFinite(value)) return L("Error: el valor a convertir debe ser un número.", "Error: the value to convert must be a number.", "Erro: o valor a converter deve ser um número.");
  if (!from || !to) return L("Error: indica la unidad de origen y la de destino.", "Error: give the source unit and the target unit.", "Erro: indica a unidade de origem e a de destino.");
  try {
    const r = convertUnits(value, from, to);
    // 0.1.31 (auditoría del loop): «5 km = 3.1068559612 mi» → «3.1069 mi».
    // Cuatro decimales bastan para una conversión cotidiana; cantidades muy
    // pequeñas conservan 4 cifras significativas.
    const shown = Math.abs(r.value) >= 0.01 || r.value === 0 ? Number(r.value.toFixed(4)) : Number(r.value.toPrecision(4));
    return `${formatNumber(value)} ${r.from} = ${formatNumber(shown)} ${r.to}`;
  } catch (e) {
    const prefix = L("No pude convertir eso", "I couldn't convert that", "Não consegui converter isso");
    if (e instanceof ConvertError) {
      const d = e.detail;
      const why =
        e.code === "belowAbsoluteZero"
          ? L("está por debajo del cero absoluto (−273,15 °C); esa temperatura no existe", "it is below absolute zero (−273.15 °C); that temperature doesn't exist", "está abaixo do zero absoluto (−273,15 °C); essa temperatura não existe")
          : e.code === "unknownUnit"
            ? L(`no conozco la unidad «${d.unit}». Válidas: ${validUnits().join(", ")}`, `I don't know the unit “${d.unit}”. Valid: ${validUnits().join(", ")}`, `não conheço a unidade “${d.unit}”. Válidas: ${validUnits().join(", ")}`)
            : e.code === "mismatch"
              ? L(`${d.from} y ${d.to} miden cosas distintas`, `${d.from} and ${d.to} measure different things`, `${d.from} e ${d.to} medem coisas diferentes`)
              : L("el valor no es un número", "the value isn't a number", "o valor não é um número");
      return `${prefix}: ${why}.`;
    }
    return `${prefix}: ${e instanceof Error ? e.message : String(e)}`;
  }
};

const CALENDAR_PERMISSION_TEXT: Record<"denied" | "blocked" | "unavailable", () => string> = {
  denied: () =>
    L(
      "No diste permiso de calendario, así que no puedo crear ni leer eventos. Puedes volver a pedírmelo cuando quieras.",
      "You didn't give calendar permission, so I can't create or read events. You can ask me again whenever you want.",
      "Você não deu permissão de calendário, então não posso criar nem ler eventos. Pode me pedir de novo quando quiser.",
    ),
  blocked: () =>
    L(
      "El permiso de calendario está bloqueado para NIDO. Actívalo en Ajustes del teléfono → Apps → NIDO → Permisos → Calendario.",
      "Calendar permission is blocked for NIDO. Turn it on in phone Settings → Apps → NIDO → Permissions → Calendar.",
      "A permissão de calendário está bloqueada para o NIDO. Ative em Configurações do telefone → Apps → NIDO → Permissões → Calendário.",
    ),
  unavailable: () =>
    L(
      "El módulo de calendario no está disponible en este dispositivo.",
      "The calendar isn't available on this device.",
      "O calendário não está disponível neste dispositivo.",
    ),
};

async function ensureCalendarAccess(): Promise<{ ok: boolean; reason?: string }> {
  let Calendar: typeof import("expo-calendar");
  try {
    Calendar = await import("expo-calendar");
  } catch {
    return { ok: false, reason: CALENDAR_PERMISSION_TEXT.unavailable() };
  }
  const perm = await ensureRuntimePermission({
    get: () => Calendar.getCalendarPermissions(),
    request: () => Calendar.requestCalendarPermissions(),
  });
  return perm.ok ? { ok: true } : { ok: false, reason: CALENDAR_PERMISSION_TEXT[perm.reason]() };
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
  if (!title) return L("Error: falta el título del evento.", "Error: the event title is missing.", "Erro: falta o título do evento.");
  const start = new Date(String(args.start ?? ""));
  if (Number.isNaN(start.getTime())) {
    return L("Error: la fecha de inicio no es válida. Usa formato ISO, p.ej. 2026-09-27T10:00:00.", "Error: the start date isn't valid. Use ISO format, e.g. 2026-09-27T10:00:00.", "Erro: a data de início não é válida. Use o formato ISO, p.ex. 2026-09-27T10:00:00.");
  }
  const endRaw = args.end != null ? String(args.end).trim() : "";
  const end = endRaw ? new Date(endRaw) : new Date(start.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(end.getTime()) || end <= start) {
    return L("Error: la fecha de fin no es válida o es anterior al inicio.", "Error: the end date isn't valid or is before the start.", "Erro: a data de fim não é válida ou é anterior ao início.");
  }
  try {
    const cal = await pickWritableCalendar();
    if (!cal) return L("No encontré ningún calendario donde escribir eventos.", "I didn't find any calendar I can write events to.", "Não encontrei nenhum calendário onde escrever eventos.");
    await cal.createEvent({
      title,
      startDate: start,
      endDate: end,
      notes: args.notes != null ? String(args.notes) : undefined,
      location: args.location != null ? String(args.location) : undefined,
    });
    return L(
      `Evento creado: «${title}», ${fmtDateTime(start.toISOString())}.`,
      `Event created: “${title}”, ${fmtDateTime(start.toISOString())}.`,
      `Evento criado: «${title}», ${fmtDateTime(start.toISOString())}.`,
    );
  } catch (e) {
    return `${L("No pude crear el evento: ", "I couldn't create the event: ", "Não consegui criar o evento: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

/**
 * Resumen diario (src/routines/startup.ts): lee los próximos eventos SOLO si
 * el permiso ya está concedido. Nunca abre el diálogo de permiso al arrancar
 * la app y nunca devuelve textos de error/permiso (el resumen los mostraría
 * como si fueran eventos). Devuelve null si no hay nada que mostrar.
 */
export async function upcomingEventsForBriefing(limit = 5, lang?: RouterLang): Promise<string | null> {
  // 0.1.60: el resumen diario salía en español para todos.
  const T = (es: string, en: string, pt: string) => {
    const l = lang ?? uiLang();
    return l === "en" ? en : l === "pt" ? pt : es;
  };
  try {
    const Calendar = await import("expo-calendar");
    const perm = await Calendar.getCalendarPermissions();
    if (!perm.granted) return null;
    const calendars = await Calendar.getCalendars();
    if (calendars.length === 0) return null;
    const now = new Date();
    const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const events = await Calendar.listEvents(calendars, now, to);
    const upcoming = events.slice(0, limit).map((e: any) => {
      const s = e.startDate ? new Date(e.startDate) : null;
      return `- «${e.title ?? T("(sin título)", "(untitled)", "(sem título)")}»${s ? ` — ${fmtDateTime(s.toISOString())}` : ""}${e.location ? ` @ ${e.location}` : ""}`;
    });
    return upcoming.length > 0 ? `${T("Próximos eventos:", "Upcoming events:", "Próximos eventos:")}\n${upcoming.join("\n")}` : null;
  } catch {
    return null;
  }
}

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
    return L("Error: rango de fechas inválido. Usa formato ISO.", "Error: invalid date range. Use ISO format.", "Erro: intervalo de datas inválido. Use o formato ISO.");
  }
  const limit = Number(args.limit) > 0 ? Math.min(Math.floor(Number(args.limit)), 50) : 20;
  try {
    const Calendar = await import("expo-calendar");
    const calendars = await Calendar.getCalendars();
    if (calendars.length === 0) return L("No hay calendarios en el teléfono.", "There are no calendars on the phone.", "Não há calendários no telefone.");
    // 0.1.75: en orden de inicio (el sistema no promete el orden) y, si
    // hay más de los que se muestran, se dice cuántos faltan (antes un mes
    // con 30 eventos enseñaba 20 sin avisar).
    const events = [...(await Calendar.listEvents(calendars, from, to))].sort(
      (a: any, b: any) => new Date(a.startDate ?? 0).getTime() - new Date(b.startDate ?? 0).getTime(),
    );
    const hidden = Math.max(0, events.length - limit);
    const upcoming = events
      .slice(0, limit)
      .map((e: any) => {
        const s = e.startDate ? new Date(e.startDate) : null;
        return `- «${e.title ?? L("(sin título)", "(untitled)", "(sem título)")}»${s ? ` — ${fmtDateTime(s.toISOString())}` : ""}${e.location ? ` @ ${e.location}` : ""}`;
      });
    if (upcoming.length === 0) return L("No hay eventos en ese rango.", "There are no events in that range.", "Não há eventos nesse intervalo.");
    const more = hidden > 0 ? `\n${L(`… y ${hidden} más.`, `… and ${hidden} more.`, `… e mais ${hidden}.`)}` : "";
    return `${L("Próximos eventos:", "Upcoming events:", "Próximos eventos:")}\n${upcoming.join("\n")}${more}`;
  } catch (e) {
    return `${L("No pude leer el calendario", "I couldn't read the calendar", "Não consegui ler o calendário")}: ${e instanceof Error ? e.message : String(e)}`;
  }
};

const CONTACTS_PERMISSION_TEXT: Record<"denied" | "blocked" | "unavailable", () => string> = {
  denied: () =>
    L(
      "No diste permiso de contactos, así que no puedo buscar. Puedes volver a pedírmelo cuando quieras.",
      "You didn't give contacts permission, so I can't search. You can ask me again whenever you want.",
      "Você não deu permissão de contatos, então não posso buscar. Pode me pedir de novo quando quiser.",
    ),
  blocked: () =>
    L(
      "El permiso de contactos está bloqueado para NIDO. Actívalo en Ajustes del teléfono → Apps → NIDO → Permisos → Contactos.",
      "Contacts permission is blocked for NIDO. Turn it on in phone Settings → Apps → NIDO → Permissions → Contacts.",
      "A permissão de contatos está bloqueada para o NIDO. Ative em Configurações do telefone → Apps → NIDO → Permissões → Contatos.",
    ),
  unavailable: () =>
    L(
      "No pude acceder a los contactos del teléfono.",
      "I couldn't access the phone contacts.",
      "Não consegui acessar os contatos do telefone.",
    ),
};

/**
 * Búsqueda estructurada en la agenda (la usa el pre-router determinístico de
 * contactos y también find_contact). Pide el permiso solo si falta.
 */
export async function searchPhoneContacts(query: string): Promise<ContactSearchResult> {
  const q = String(query ?? "").trim();
  if (!q) return { ok: false, message: L("Error: falta el nombre a buscar.", "Error: the name to search for is missing.", "Erro: falta o nome a buscar.") };
  let Contacts: typeof import("expo-contacts");
  try {
    Contacts = await import("expo-contacts");
  } catch {
    return { ok: false, message: CONTACTS_PERMISSION_TEXT.unavailable(), reason: "unavailable" };
  }
  const perm = await ensureRuntimePermission({
    get: () => Contacts.getPermissionsAsync(),
    request: () => Contacts.requestPermissionsAsync(),
  });
  if (!perm.ok) return { ok: false, message: CONTACTS_PERMISSION_TEXT[perm.reason](), reason: perm.reason };
  try {
    // TOOLS-AUDIT 2026-10-11 (causa raíz de find_contact roto en Android):
    // el código usaba `Contacts.Container.getDefault()`, que en expo-contacts
    // SDK 57 es SOLO iOS (ContactsModule.ts: "@platform ios"; en Android cae
    // en FallbackContainer, que lanza "Not implemented"). Además
    // `getContacts()` devuelve objetos nativos, no {name, phoneNumbers}.
    // La API multiplataforma correcta es Contact.getAllDetails(campos, filtro).
    const fields = ["fullName", "phones"] as const;
    const getAllDetails = (Contacts.Contact as any).getAllDetails as (
      f: readonly string[],
      o?: { name?: string; limit?: number },
    ) => Promise<any[]>;
    // 1) Filtro nativo por nombre (rápido, sin leer toda la agenda).
    let matches = filterContacts(await getAllDetails(fields, { name: q, limit: 25 }), q);
    // 2) Sin resultados: el filtro nativo distingue acentos ("Ruben" ≠
    //    "Rubén") y no busca por número. Se lee nombre+teléfonos y se filtra
    //    aquí, en el teléfono; solo salen como mucho 5 coincidencias.
    if (matches.length === 0) {
      matches = filterContacts(await getAllDetails(fields, { limit: 5000 }), q);
    }
    return { ok: true, matches };
  } catch (e) {
    return { ok: false, message: `${L("No pude buscar contactos: ", "I couldn't search contacts: ", "Não consegui buscar contatos: ")}${e instanceof Error ? e.message : String(e)}` };
  }
}

const findContactHandler: ToolHandler = async (args) => {
  const res = await searchPhoneContacts(String(args.query ?? ""));
  if (!res.ok) return res.message;
  if (res.matches.length === 0) return L(`No encontré ningún contacto que coincida con «${args.query}».`, `I couldn't find any contact matching “${args.query}”.`, `Não encontrei nenhum contato que corresponda a «${args.query}».`);
  return (
    L("Contactos encontrados:", "Contacts found:", "Contatos encontrados:") +
    "\n" +
    res.matches.map((c) => `- ${c.name} — ${c.phones[0] ?? L("sin teléfono", "no phone", "sem telefone")}`).join("\n")
  );
};

function cleanPhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "");
}

const placeCallHandler: ToolHandler = async (args) => {
  const phone = cleanPhone(String(args.phone ?? ""));
  if (!phone) return L("Error: falta un número de teléfono válido.", "Error: a valid phone number is missing.", "Erro: falta um número de telefone válido.");
  try {
    const { Linking } = await import("react-native");
    await Linking.openURL(`tel:${phone}`);
    return L(`Abriendo el marcador con ${phone}… confírmame tú la llamada.`, `Opening the dialer with ${phone}… you confirm the call.`, `Abrindo o discador com ${phone}… confirme você a chamada.`);
  } catch {
    return L("No pude abrir el marcador del teléfono.", "I couldn't open the phone dialer.", "Não consegui abrir o discador do telefone.");
  }
};

const sendSmsHandler: ToolHandler = async (args) => {
  const phone = cleanPhone(String(args.phone ?? ""));
  const message = String(args.message ?? "").trim();
  if (!phone) return L("Error: falta un número de teléfono válido.", "Error: a valid phone number is missing.", "Erro: falta um número de telefone válido.");
  if (!message) return L("Error: falta el texto del mensaje.", "Error: the message text is missing.", "Erro: falta o texto da mensagem.");
  try {
    const RN = await import("react-native");
    const sep = RN.Platform.OS === "ios" ? "&" : "?";
    await RN.Linking.openURL(`sms:${phone}${sep}body=${encodeURIComponent(message)}`);
    return L(`Abriendo mensajes para ${phone} con el texto listo… envíalo tú cuando quieras.`, `Opening messages for ${phone} with the text ready… send it yourself whenever you want.`, `Abrindo mensagens para ${phone} com o texto pronto… envie você quando quiser.`);
  } catch {
    return L("No pude abrir la app de mensajes.", "I couldn't open the messages app.", "Não consegui abrir o app de mensagens.");
  }
};

const MAX_PICKED_FILE_BYTES = 200 * 1024;

const readPickedFileHandler: ToolHandler = async () => {
  try {
    const DocumentPicker = await import("expo-document-picker");
    // TOOLS-AUDIT 2026-10-11: el selector del sistema es otra actividad →
    // NIDO pasa a "background" y el gate bloqueaba al volver (el archivo
    // elegido se perdía detrás de "NIDO locked"). Mismo guard que permisos.
    const picked = await withPermissionRequest(() =>
      DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      }),
    );
    if (picked.canceled || !picked.assets?.length) {
      return L("No elegiste ningún archivo.", "You didn't choose any file.", "Você não escolheu nenhum arquivo.");
    }
    const asset = picked.assets[0];
    const fallbackName = asset.name ?? L("archivo", "file", "arquivo");
    if (asset.size != null && asset.size > MAX_PICKED_FILE_BYTES) {
      return L(
        `«${fallbackName}» pesa más de 200 KB; elige un archivo de texto más pequeño.`,
        `“${fallbackName}” is over 200 KB; choose a smaller text file.`,
        `«${fallbackName}» pesa mais de 200 KB; escolha um arquivo de texto menor.`,
      );
    }
    const FS = await import("expo-file-system");
    const buf = await new FS.File(asset.uri).arrayBuffer();
    if (buf.byteLength > MAX_PICKED_FILE_BYTES) {
      return L(
        `«${fallbackName}» es demasiado grande para leerlo aquí (máx. 200 KB).`,
        `“${fallbackName}” is too large to read here (max. 200 KB).`,
        `«${fallbackName}» é grande demais para ler aqui (máx. 200 KB).`,
      );
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (!text.trim()) return L(`«${fallbackName}» está vacío o no es texto legible.`, `“${fallbackName}” is empty or isn't readable text.`, `«${fallbackName}» está vazio ou não é texto legível.`);
    const shown = text.slice(0, 8000);
    const shownName = asset.name ?? L("sin nombre", "unnamed", "sem nome");
    return `${L(`Archivo «${shownName}»`, `File “${shownName}”`, `Arquivo «${shownName}»`)} (${Math.round(buf.byteLength / 1024)} KB):\n${shown}${text.length > shown.length ? L("\n…(recortado)", "\n…(trimmed)", "\n…(cortado)") : ""}`;
  } catch (e) {
    return `${L("No pude leer el archivo: ", "I couldn't read the file: ", "Não consegui ler o arquivo: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

// ---------------------------------------------------------------- Fase D
// Skills reutilizables e intérprete de datos.

const useSkillHandler: ToolHandler = async (args) => {
  const name = String(args.name ?? "").trim();
  if (!name) {
    const available = listSkills().map((s) => s.name).join(", ");
    return L(`Indica el nombre de la skill. Disponibles: ${available}.`, `Give the skill name. Available: ${available}.`, `Indica o nome da skill. Disponíveis: ${available}.`);
  }
  const skill = loadSkill(name);
  if (!skill) {
    const available = listSkills().map((s) => s.name).join(", ");
    return L(`No conozco la skill «${name}». Disponibles: ${available}.`, `I don't know the skill “${name}”. Available: ${available}.`, `Não conheço a skill «${name}». Disponíveis: ${available}.`);
  }
  // T-11 (0.1.99, P-11): el resultado se presentaba con un imperativo
  // («Sigue estas instrucciones:») que el bucle envuelve en un bloque
  // <untrusted>: una ORDEN dentro de un bloque definido como «solo
  // datos», que el propio marco de M-19 marca como no confiable. El
  // contenido se presenta como lo que es — el documento de
  // procedimiento de la skill — sin moverlo a un canal confiable: el
  // envoltorio del bucle no cambia.
  // Bloque 4 (auditoría 0.1.112): el procedimiento en el idioma del
  // turno; las aprendidas sin gemelas siguen con su texto único.
  return L(
    `Skill «${skill.name}» cargada. Este es su procedimiento:\n\n${skill.instructions}`,
    `Skill “${skill.name}” loaded. Here is its procedure:\n\n${skill.instructionsI18n?.en ?? skill.instructions}`,
    `Skill «${skill.name}» carregada. Este é o seu procedimento:\n\n${skill.instructionsI18n?.pt ?? skill.instructions}`,
  );
};

const analyzeTableHandler: ToolHandler = async (args) => {
  const text = String(args.text ?? "");
  if (!text.trim()) return L("Error: falta el texto de la tabla a analizar.", "Error: the table text to analyze is missing.", "Erro: falta o texto da tabela a analisar.");
  if (text.length > 200 * 1024) {
    return L("Error: la tabla supera los 200 KB. Pide al usuario un archivo más pequeño.", "Error: the table exceeds 200 KB. Ask the user for a smaller file.", "Erro: a tabela ultrapassa os 200 KB. Peça ao usuário um arquivo menor.");
  }
  try {
    return analyzeTable(text, {
      filter: args.filter != null ? String(args.filter) : undefined,
      sortBy: args.sort_by != null ? String(args.sort_by) : undefined,
      topN: args.top_n != null ? Number(args.top_n) : undefined,
    });
  } catch (e) {
    return `${L("No pude analizar la tabla: ", "I couldn't analyze the table: ", "Não consegui analisar a tabela: ")}${e instanceof Error ? e.message : String(e)}`;
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
  if (!to) return L("Error: indica el nombre del contacto NIDO.", "Error: give the NIDO contact name.", "Erro: indica o nome do contato NIDO.");
  if (!text) return L("Error: el mensaje está vacío.", "Error: the message is empty.", "Erro: a mensagem está vazia.");
  try {
    const m = getNidoMessenger();
    await m.ensureIdentity();
    const { queued } = await m.sendChat(to, text);
    return queued
      ? L(
          `Mensaje para «${to}» guardado cifrado en la cola de salida: se entregará cuando su NIDO esté al alcance.`,
          `Message for “${to}” saved encrypted in the outbox: it will be delivered when their NIDO is in range.`,
          `Mensagem para “${to}” guardada criptografada na fila de saída: será entregue quando o NIDO dessa pessoa estiver ao alcance.`,
        )
      : L(
          `Mensaje enviado a «${to}» por NIDO (cifrado de extremo a extremo).`,
          `Message sent to “${to}” over NIDO (end-to-end encrypted).`,
          `Mensagem enviada a “${to}” pelo NIDO (criptografia de ponta a ponta).`,
        );
  } catch (e) {
    return `${L("No pude enviar el mensaje NIDO: ", "I couldn't send the NIDO message: ", "Não consegui enviar a mensagem NIDO: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

const nidoReadInboxHandler: ToolHandler = async () => {
  try {
    const m = getNidoMessenger();
    await m.ensureIdentity();
    const contacts = await m.contacts();
    const names = new Map(contacts.map((c) => [c.pkHex.toLowerCase(), c.name]));
    const { messages: unread, hiddenTemporal } = await m.readInboxWithHidden();
    // 0.1.46: los mensajes temporales no pasan por el asistente (quedarían en
    // su historial sin temporizador): solo se avisa de que hay.
    const temporalNote =
      hiddenTemporal > 0
        ? L(
            `Hay ${hiddenTemporal} mensaje(s) temporal(es) sin leer: ábrelos en el chat NIDO.`,
            `There are ${hiddenTemporal} unread disappearing message(s): open them in the NIDO chat.`,
            `Há ${hiddenTemporal} mensagem(ns) temporária(s) não lida(s): abra-as no chat NIDO.`,
          )
        : "";
    if (unread.length === 0) return temporalNote || L("No tienes mensajes NIDO sin leer.", "You have no unread NIDO messages.", "Você não tem mensagens NIDO não lidas.");
    return unread
      .map((msg) => {
        const who = names.get(msg.peerPk.toLowerCase()) ?? L("Contacto NIDO", "NIDO contact", "Contato NIDO");
        const when = fmtDateTime(new Date(msg.ts).toISOString());
        // M-6: la tarea sigue "queued" (readInbox ya no la marca como leída);
        // se muestra como pendiente de decisión explícita.
        if (msg.type === "agent_task" && msg.status === "queued") {
          return (
            `• ${who} (${when}): ${msg.text}\n` +
            L(
              `  Pendiente de tu aprobación — revísala con nido_review_tasks (id ${msg.id}).`,
              `  Pending your approval — review it with nido_review_tasks (id ${msg.id}).`,
              `  Pendente da sua aprovação — revise com nido_review_tasks (id ${msg.id}).`,
            )
          );
        }
        return `• ${who} (${when}): ${msg.text}`;
      })
      .join("\n") + (temporalNote ? `\n${temporalNote}` : "");
  } catch (e) {
    return `${L("No pude leer la bandeja NIDO", "I couldn't read the NIDO inbox", "Não consegui ler a caixa do NIDO")}: ${e instanceof Error ? e.message : String(e)}`;
  }
};

const nidoMyCodeHandler: ToolHandler = async () => {
  try {
    const m = getNidoMessenger();
    const { fingerprint: fp } = await m.ensureIdentity();
    const code = await m.myPairingCode();
    return L(
      `Tu código de emparejamiento NIDO (muéstralo como QR para que el otro teléfono lo escanee):\n${code}\nHuella para verificar en persona: ${fp}`,
      `Your NIDO pairing code (show it as a QR so the other phone can scan it):\n${code}\nFingerprint to verify in person: ${fp}`,
      `Seu código de emparelhamento NIDO (mostre-o como QR para que o outro telefone o escaneie):\n${code}\nImpressão digital para verificar em pessoa: ${fp}`,
    );
  } catch (e) {
    return `${L("No pude generar tu código: ", "I couldn't generate your code: ", "Não consegui gerar seu código: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};

const nidoPairHandler: ToolHandler = async (args) => {
  const code = String(args.code ?? "").trim();
  if (!code) return L("Error: falta el código del otro NIDO.", "Error: the other NIDO's code is missing.", "Erro: falta o código do outro NIDO.");
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
        ? L(
            " La identidad anterior quedó retirada en todas partes: murieron sus rutas, sesiones y mensajes pendientes; los mensajes antiguos siguen legibles.",
            " The previous identity was retired everywhere: its routes, sessions and pending messages are gone; old messages stay readable.",
            " A identidade anterior foi retirada de todos os lugares: suas rotas, sessões e mensagens pendentes deixaram de existir; as mensagens antigas continuam legíveis.",
          )
        : "";
    return L(
      `Contacto «${contact.name}» emparejado, sin verificar todavía. Ya pueden enviarse mensajes cifrados de NIDO a NIDO, sin internet. Para verificarlo, comparen la huella en persona y pulsa «Verificar» en NIDO › Contactos.${replacedNote}`,
      `Contact “${contact.name}” paired, not verified yet. You can now send encrypted NIDO-to-NIDO messages, with no internet. To verify it, compare the fingerprint in person and tap “Verify” in NIDO › Contacts.${replacedNote}`,
      `Contato “${contact.name}” emparelhado, ainda sem verificar. Já podem enviar mensagens criptografadas de NIDO a NIDO, sem internet. Para verificar, compare a impressão digital pessoalmente e toque em «Verificar» em NIDO › Contatos.${replacedNote}`,
    );
  } catch (e) {
    if (e instanceof StaleReplaceConflictError) {
      // UNIT B concurrency closure: otro Replace retiró ya la identidad
      // que se pretendía reemplazar. Nada se escribió (rollback); el
      // usuario debe decidir con el estado actual, no reintentar a ciegas.
      return L(
        "No pude emparejar: la identidad que se pretendía reemplazar ya fue retirada por otro emparejamiento. Nada se escribió. Revisa tus contactos y, si aún quieres emparejar este código, hazlo de nuevo con la información actualizada.",
        "I couldn't pair: the identity that was to be replaced was already retired by another pairing. Nothing was written. Check your contacts and, if you still want to pair this code, do it again with the updated information.",
        "Não consegui emparelhar: a identidade que se pretendia substituir já foi retirada por outro emparelhamento. Nada foi escrito. Verifique seus contatos e, se ainda quiser emparelhar este código, faça de novo com as informações atualizadas.",
      );
    }
    if (e instanceof PairingDisambiguationRequiredError) {
      let payloadName = "?";
      let fp = "?";
      try {
        const payload = decodePairingPayload(code);
        payloadName = payload.name;
        fp = fingerprint(fromHex(payload.pk), payload.spk ? fromHex(payload.spk) : null);
      } catch {
        // Si el QR ni siquiera decodifica, el mensaje de abajo ya no
        // aplica; se devuelve el error original.
        return `${L("No pude emparejar: ", "I couldn't pair: ", "Não consegui emparelhar: ")}${e instanceof Error ? e.message : String(e)}`;
      }
      const candidates = e.candidates.map((c) => `«${c.name}»`).join(", ");
      return t("agentConfirm.pairAmbiguousAsk", {
        name: payloadName,
        fingerprint: fp,
        count: String(e.candidates.length),
        candidates,
      });
    }
    return `${L("No pude emparejar: ", "I couldn't pair: ", "Não consegui emparelhar: ")}${e instanceof Error ? e.message : String(e)}`;
  }
};
