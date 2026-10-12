/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * toolRouter.ts — NIDO: pre-router determinista para las herramientas que
 * todavía dependían de que el modelo 0.5B escribiera la llamada (es/en/pt).
 *
 * Auditoría 2026-10-11 de "Acerca de → permisos del agente": de 24
 * herramientas, solo recordatorios, memoria, calculadora y (desde 0.1.7)
 * contactos/llamadas/SMS se resolvían por código. El resto dependía del
 * 0.5B, que a menudo no genera la llamada, se equivoca de parámetros o la
 * convierte en prosa. Además:
 *  - "crea una nota…" / "crea un evento…" caían en el atajo de
 *    RECORDATORIOS (su regex acepta "crea …" sin exigir "recordatorio");
 *  - read_note exige un id interno que el usuario nunca ve.
 *
 * Mismo patrón que contactRouter/actionRouter: frase explícita y anclada →
 * acción por la compuerta única (dispatchToolCallDetailed: interruptor del
 * usuario, política, confirmación). Ante la duda, null y el flujo normal.
 *
 * Puro salvo las dependencias inyectadas. 100% testeable.
 */

import { convertUnits } from "../tools/convert";
import { parseReminderDateTime, stripDateWords } from "./actionRouter";
import type { DispatchStatus } from "./contactRouter";

export type RouterLang = "es" | "en" | "pt";

export type ToolAction =
  | { kind: "time"; what: "time" | "date"; lang: RouterLang }
  | { kind: "noteSave"; title: string; body: string; lang: RouterLang }
  | { kind: "noteList"; lang: RouterLang }
  | { kind: "noteRead"; query: string; lang: RouterLang }
  | { kind: "convert"; value: number; from: string; to: string; lang: RouterLang }
  | { kind: "calendarList"; from: string; to: string; label: CalendarRange; lang: RouterLang }
  | { kind: "calendarCreate"; title: string; start: string | null; lang: RouterLang }
  | { kind: "nidoSend"; to: string; text: string | null; lang: RouterLang }
  | { kind: "nidoInbox"; lang: RouterLang }
  | { kind: "nidoCode"; lang: RouterLang }
  | { kind: "nidoTasks"; lang: RouterLang }
  | { kind: "openLink"; url: string; lang: RouterLang }
  | { kind: "pickFile"; analyze: boolean; lang: RouterLang }
  | { kind: "reminderList"; lang: RouterLang; range?: "today" | "tomorrow" }
  | { kind: "noteDelete"; target: DeleteTarget; lang: RouterLang }
  | { kind: "reminderDelete"; target: DeleteTarget; range?: "today" | "tomorrow"; lang: RouterLang };

/**
 * 0.1.20 (P3-9): destino de un borrado.
 * - one: identificado por título/texto ("la nota de la receta").
 * - all: el conjunto completo (o el del día, si hay range).
 * - ask: el usuario no dijo cuál ("borra la nota"): si solo hay uno se
 *   borra ese (la confirmación protege); si hay varios, se listan.
 */
export type DeleteTarget = { type: "one"; query: string } | { type: "all" } | { type: "ask" };

export type CalendarRange = "today" | "tomorrow" | "week";

/** Herramienta del manifiesto que ejecuta cada acción (para interruptores y tareas programadas). */
export function toolForAction(a: ToolAction): string {
  switch (a.kind) {
    case "time":
      return "device_time";
    case "noteSave":
      return "save_note";
    case "noteList":
      return "list_notes";
    case "noteRead":
      return "read_note";
    case "convert":
      return "convert_units";
    case "calendarList":
      return "list_calendar_events";
    case "calendarCreate":
      return "create_calendar_event";
    case "nidoSend":
      return "nido_send_message";
    case "nidoInbox":
      return "nido_read_inbox";
    case "nidoCode":
      return "nido_my_code";
    case "nidoTasks":
      return "nido_review_tasks";
    case "openLink":
      return "open_app";
    case "pickFile":
      return "read_picked_file";
    // No separate tool: listing belongs to the reminders switch.
    case "reminderList":
      return "create_reminder";
    case "noteDelete":
      return "delete_note";
    case "reminderDelete":
      return "delete_reminder";
  }
}

function clean(text: string): string {
  return text
    .trim()
    .replace(/^[¡¿]+/, "")
    .replace(/[?!.¡¿]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const POLITE = "(?:(?:por favor|please|nido),?\\s+)?";

// --------------------------------------------------------------- tiempo

const TIME_RULES: Array<{ re: RegExp; what: "time" | "date"; lang: RouterLang }> = [
  { re: /^(?:qu[eé] hora es|qu[eé] horas son|tienes la hora|me dices la hora)$/i, what: "time", lang: "es" },
  { re: /^(?:qu[eé] (?:d[ií]a|fecha) es(?: hoy)?|a qu[eé] (?:d[ií]a|fecha) estamos|qu[eé] d[ií]a es hoy|cu[aá]l es la fecha(?: de hoy)?)$/i, what: "date", lang: "es" },
  { re: /^(?:what time is it|what(?:'s| is) the time|do you have the time)$/i, what: "time", lang: "en" },
  { re: /^(?:what(?:'s| is) (?:the date|today'?s date|the day)(?: today)?|what day is (?:it|today)|what(?:'s| is) today)$/i, what: "date", lang: "en" },
  { re: /^(?:que horas s[aã]o)$/i, what: "time", lang: "pt" },
  { re: /^(?:que dia [eé] hoje|qual [eé] a data(?: de hoje)?|que dia [eé] hoje\??)$/i, what: "date", lang: "pt" },
];

// ---------------------------------------------------------------- notas

const NOTE_SAVE_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  {
    re: new RegExp(
      `^${POLITE}(?:anota(?:me)?|apunta(?:me)?|toma nota|guarda una nota|crea una nota|haz una nota|escribe una nota|agrega una nota|a[ñn]ade una nota)(?:\\s+(?:que diga|diciendo|que|de|con)|:)?\\s+(.+)$`,
      "is",
    ),
    lang: "es",
  },
  {
    re: new RegExp(
      `^${POLITE}(?:take a note|make a note|write a note|save a note|add a note|create a note|write down|jot down|note)(?:\\s+(?:saying|that|of)|:)?\\s+(.+)$`,
      "is",
    ),
    lang: "en",
  },
  {
    re: new RegExp(
      `^${POLITE}(?:anote|tome nota|toma nota|salva uma nota|salve uma nota|cria uma nota|crie uma nota|escreve uma nota|escreva uma nota)(?:\\s+(?:dizendo|que|de)|:)?\\s+(.+)$`,
      "is",
    ),
    lang: "pt",
  },
];

const NOTE_LIST_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:(?:mu[eé]strame|lista|listar|ver|dame|ens[eé][ñn]ame|abre)\s+)?(?:mis|las|todas las|todas mis)\s+notas(?: guardadas)?$|^qu[eé] notas tengo$|^cu[aá]les son mis notas$|^notas$/i, lang: "es" },
  { re: /^(?:(?:show|list|see|open)(?: me)?\s+)?(?:my|all|all my)\s+notes$|^what notes do i have$/i, lang: "en" },
  { re: /^(?:(?:mostra|mostre|lista|listar|ver|abre)\s+)?(?:minhas|as|todas as)\s+notas$|^quais notas eu tenho$/i, lang: "pt" },
];

// 0.1.14 (guía de usuario): "qué recordatorios tengo" no tenía camino propio.
// 0.1.19: el alcance temporal ("…hoy", "…mañana", "…para hoy") rompía el
// anclaje y la frase caía al modelo (evidencia física en tablet + sonda de
// routing 2026-10-12). El alcance se separa ANTES de aplicar estas reglas
// (splitReminderScope) y la lista se filtra por día en el handler.
const REMINDER_LIST_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  {
    re: /^(?:(?:mu[eé]strame|lista|listar|ver|dame|ens[eé][ñn]ame)\s+)?(?:mis|los|todos los|todos mis)\s+recordatorios(?: pendientes)?$|^(?:qu[eé]|cu[aá]les)\s+recordatorios\s+(?:tengo|hay)(?: pendientes)?$|^cu[aá]les son mis recordatorios$|^recordatorios$|^lista de recordatorios$|^tengo alg[uú]n recordatorio$/i,
    lang: "es",
  },
  {
    re: /^(?:(?:show|list|see)(?: me)?\s+)?(?:my|all|all my)\s+reminders$|^what reminders do i have$|^do i have any reminders$/i,
    lang: "en",
  },
  {
    re: /^(?:(?:mostra|mostre|lista|listar|ver)\s+)?(?:meus|os|todos os)\s+lembretes$|^quais lembretes (?:eu )?tenho$/i,
    lang: "pt",
  },
];

const NOTE_READ_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:lee|leer|l[eé]eme|abre|mu[eé]strame|qu[eé] dice)\s+(?:la|mi)\s+nota\s+(?:de\s+|del\s+|sobre\s+|llamada\s+|que se llama\s+)?(.+)$/i, lang: "es" },
  { re: /^(?:read|open|show(?: me)?)\s+(?:the|my)\s+note\s+(?:about\s+|called\s+|named\s+|on\s+|for\s+)?(.+)$/i, lang: "en" },
  { re: /^(?:l[eê]|ler|leia|abre|abra|mostra|mostre)\s+(?:a|minha)\s+nota\s+(?:de\s+|do\s+|da\s+|sobre\s+|chamada\s+)?(.+)$/i, lang: "pt" },
];

/** Título corto a partir del texto de la nota: primeras palabras, sin puntuación final. */
export function noteTitleFrom(body: string): string {
  const words = body.replace(/[\r\n]+/g, " ").trim().split(/\s+/).slice(0, 6).join(" ");
  const t = words.replace(/[.,;:!?¡¿]+$/, "");
  return t.length > 50 ? `${t.slice(0, 47)}…` : t;
}

// ---------------------------------------------------------- conversión

const NUM = "(-?\\d+(?:[.,]\\d+)?)";
const UNIT = "((?:grados |degrees |graus )?[a-záéíóúâêôãõçñº°µ]+)";
// 0.1.19 (sonda de routing): la forma de PREGUNTA no llegaba — "cuántos
// pies son 2 metros" pone la unidad destino delante (reglas inv) y "cuánto
// es 70 kg en libras" no estaba entre los prefijos. La forma imperativa
// ("pasa 5 km a millas") sí funcionaba, así que el éxito en tablet
// dependía de cómo lo pidiera el usuario (o del modelo).
const CONVERT_RULES: Array<{ re: RegExp; lang: RouterLang; inv?: boolean }> = [
  { re: new RegExp(`^(?:convierte|pasa|cu[aá]nto(?:s|as)? son|cu[aá]nto es)?\\s*${NUM}\\s*${UNIT}\\s+(?:a|en)\\s+${UNIT}$`, "i"), lang: "es" },
  { re: new RegExp(`^(?:convert|how much is|what is)?\\s*${NUM}\\s*${UNIT}\\s+(?:to|in|into)\\s+${UNIT}$`, "i"), lang: "en" },
  { re: new RegExp(`^(?:converte|converta|quanto(?:s|as)? s[aã]o)?\\s*${NUM}\\s*${UNIT}\\s+(?:para|em)\\s+${UNIT}$`, "i"), lang: "pt" },
  { re: new RegExp(`^cu[aá]ntos?\\s+${UNIT}\\s+(?:son|hay(?:\\s+en)?)\\s+${NUM}\\s+${UNIT}$`, "i"), lang: "es", inv: true },
  { re: new RegExp(`^how many\\s+${UNIT}\\s+(?:are|is)(?:\\s+in)?\\s+${NUM}\\s+${UNIT}$`, "i"), lang: "en", inv: true },
  { re: new RegExp(`^quantos?\\s+${UNIT}\\s+s[aã]o\\s+${NUM}\\s+${UNIT}$`, "i"), lang: "pt", inv: true },
];

function unitWord(raw: string): string {
  // "grados celsius" → "celsius"; "°F" → "f".
  return raw.trim().toLowerCase().replace(/^(grados|degrees|graus)\s+/, "").replace(/[º°]/g, "");
}

// ----------------------------------------------------------- calendario

const DAY_RE = "(hoy|ma[ñn]ana|esta semana|today|tomorrow|this week|hoje|amanh[aã]|esta semana)";
const CAL_LIST_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: new RegExp(`^(?:qu[eé] tengo|qu[eé] hay en (?:mi|la) agenda|mi agenda|mis (?:eventos|citas)|mi calendario)(?: (?:de|para))? ${DAY_RE}(?: en (?:mi|la) agenda)?$`, "i"), lang: "es" },
  { re: /^(?:mi agenda|mis eventos|mis citas|mi calendario)$/i, lang: "es" },
  { re: new RegExp(`^(?:what do i have|what'?s on my (?:calendar|agenda|schedule)|my (?:calendar|agenda|events|schedule))(?: for)? ${DAY_RE}$`, "i"), lang: "en" },
  { re: /^(?:my calendar|my agenda|my events|my schedule)$/i, lang: "en" },
  { re: new RegExp(`^(?:o que (?:eu )?tenho|minha agenda|meus (?:eventos|compromissos))(?: (?:de|para))? ${DAY_RE}$`, "i"), lang: "pt" },
  { re: /^(?:minha agenda|meus eventos|meus compromissos)$/i, lang: "pt" },
];

const CAL_CREATE_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: new RegExp(`^${POLITE}(?:ag[eé]ndame|agenda|crea(?: un)? evento|crea una cita|a[ñn]ade (?:un |una )?(?:evento|cita)|agrega (?:un |una )?(?:evento|cita)|pon en (?:mi |el )?calendario)(?: (?:al|en (?:mi|el)) calendario)?(?::)?\\s+(.+)$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}(?:schedule|create an event|add (?:an? )?(?:event|appointment)(?: to my calendar)?|put on my calendar)(?::)?\\s+(.+)$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}(?:agende|marca um compromisso|marque um compromisso|cria um evento|crie um evento|adiciona um evento|adicione um evento)(?::)?\\s+(.+)$`, "is"), lang: "pt" },
];

export function calendarRange(
  label: CalendarRange,
  now: Date,
): { from: string; to: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (label === "tomorrow") start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + (label === "week" ? 7 : 1));
  const from = label === "today" ? now : start;
  return { from: from.toISOString(), to: end.toISOString() };
}

function rangeLabel(word: string | undefined): CalendarRange {
  const w = (word ?? "").toLowerCase();
  if (/ma[ñn]ana|tomorrow|amanh/.test(w)) return "tomorrow";
  if (/semana|week/.test(w)) return "week";
  if (!w) return "week";
  return "today";
}

// ------------------------------------------------------------ mensajería

const SEP = "(?:\\s*:\\s*|\\s+que diga\\s+|\\s+diciendo\\s+|\\s+que\\s+|\\s+saying\\s+|\\s+that\\s+|\\s+dizendo\\s+)";
const NIDO_SEND_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: new RegExp(`^${POLITE}(?:m[aá]nda(?:le)?|env[ií]a(?:le)?|escr[ií]bele)\\s+(?:un\\s+)?mensaje\\s+(?:por|con|en)\\s+nido\\s+(?:a|para)\\s+(.+?)(?:${SEP}(.+))?$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}(?:m[aá]nda(?:le)?|env[ií]a(?:le)?)\\s+(?:a|para)\\s+(.+?)\\s+(?:un\\s+)?mensaje\\s+(?:por|con|en)\\s+nido(?:${SEP}(.+))?$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}d[ií]le\\s+a\\s+(.+?)\\s+por\\s+nido(?:${SEP}|\\s+)(.+)$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}send\\s+(?:a\\s+)?nido\\s+message\\s+to\\s+(.+?)(?:${SEP}(.+))?$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}(?:send|message)\\s+(.+?)\\s+(?:on|via|through|by)\\s+nido(?:${SEP}(.+))?$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}(?:manda|mande|envia|envie)\\s+(?:uma\\s+)?mensagem\\s+(?:pelo|no|via)\\s+nido\\s+(?:para|pra|pro)\\s+(?:o\\s+|a\\s+)?(.+?)(?:${SEP}(.+))?$`, "is"), lang: "pt" },
];

const NIDO_INBOX_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:(?:lee|leer|l[eé]eme|revisa|mu[eé]strame|ver|abre)\s+)?(?:mis\s+)?mensajes(?:\s+(?:de\s+)?nido)?(?:\s+nuevos)?$|^(?:tengo|hay)\s+mensajes(?:\s+nuevos)?(?:\s+de\s+nido)?$|^(?:mi\s+)?bandeja(?:\s+de\s+entrada)?(?:\s+de\s+nido)?$/i, lang: "es" },
  { re: /^(?:(?:read|check|show(?: me)?|open)\s+)?my\s+(?:nido\s+)?(?:messages|inbox)$|^do i have (?:any )?(?:new )?messages$/i, lang: "en" },
  { re: /^(?:(?:l[eê]|ler|leia|ver|mostra|mostre|abre)\s+)?(?:minhas\s+)?mensagens(?:\s+do\s+nido)?$|^tenho\s+mensagens(?:\s+novas)?$/i, lang: "pt" },
];

const NIDO_CODE_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:(?:mu[eé]strame|dame|ens[eé][ñn]ame|cu[aá]l es|ver)\s+)?mi\s+c[oó]digo(?:\s+(?:de\s+emparejamiento|nido|qr|de\s+nido))?$|^mi\s+qr$/i, lang: "es" },
  { re: /^(?:(?:show(?: me)?|what(?:'s| is)|get)\s+)?my\s+(?:pairing|nido|qr)\s+code$|^my\s+qr$/i, lang: "en" },
  { re: /^(?:(?:mostra|mostre|qual [eé])\s+)?meu\s+c[oó]digo(?:\s+(?:de\s+pareamento|nido|qr))?$/i, lang: "pt" },
];

const NIDO_TASKS_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:(?:mu[eé]strame|revisa|ver)\s+)?(?:mis\s+|las\s+)?tareas\s+(?:pendientes|remotas)(?:\s+de\s+nido)?$/i, lang: "es" },
  { re: /^(?:(?:show(?: me)?|review|check)\s+)?(?:my\s+)?pending\s+(?:nido\s+)?tasks$/i, lang: "en" },
  { re: /^(?:(?:mostra|ver)\s+)?(?:minhas\s+|as\s+)?tarefas\s+pendentes$/i, lang: "pt" },
];

// --------------------------------------------------------- enlaces/archivos

const OPEN_LINK_RE: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:abre|abrir|abre el enlace|abre la p[aá]gina|ve a)\s+((?:https?:\/\/|www\.)\S+)$/i, lang: "es" },
  { re: /^(?:open|open the link|go to|visit)\s+((?:https?:\/\/|www\.)\S+)$/i, lang: "en" },
  { re: /^(?:abra|abrir|abre o link|v[aá] para)\s+((?:https?:\/\/|www\.)\S+)$/i, lang: "pt" },
];

const PICK_FILE_RE: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(lee|leer|abre|abrir|analiza|analizar|revisa)\s+(?:un|el|este|mi|una)\s+(?:archivo|documento|csv|excel|tabla)$/i, lang: "es" },
  { re: /^(read|open|analy[sz]e|check)\s+(?:a|the|this|my)\s+(?:file|document|csv|spreadsheet|table)$/i, lang: "en" },
  { re: /^(l[eê]|ler|leia|abre|abra|abrir|analisa|analise|analisar)\s+(?:um|o|este|meu|uma)\s+(?:arquivo|documento|csv|planilha|tabela)$/i, lang: "pt" },
];

/**
 * 0.1.19: separa el alcance temporal FINAL de una consulta de recordatorios
 * ("qué recordatorios tengo hoy" → texto "qué recordatorios tengo" + rango
 * "today"). Sin esto, el anclaje `$` de REMINDER_LIST_RULES rechazaba la
 * frase y caía al modelo 0.5B (que respondía con la base de conocimiento).
 * El alcance solo se busca al final y solo con hoy/mañana (+ de/para/for).
 */
export function splitReminderScope(t: string): { text: string; range: "today" | "tomorrow" | null } {
  const m = /\s+(?:(?:de|para|for)\s+)?(hoy|ma[ñn]ana|hoje|amanh[ãa]|today|tomorrow)$/i.exec(t);
  if (!m) return { text: t, range: null };
  const range = /ma[ñn]ana|amanh|tomorrow/i.test(m[1]) ? "tomorrow" : "today";
  return { text: t.slice(0, m.index).trim(), range };
}

/**
 * Detecta una petición explícita para una de las herramientas cubiertas.
 * null si no hay patrón claro (el flujo normal sigue igual).
 */
export function extractToolAction(userText: string, now: Date = new Date()): ToolAction | null {
  const t = clean(userText ?? "");
  if (!t || t.length > 600) return null;

  for (const { re, what, lang } of TIME_RULES) if (re.test(t)) return { kind: "time", what, lang };

  for (const { re, lang } of NOTE_LIST_RULES) if (re.test(t)) return { kind: "noteList", lang };
  const reminderQuery = splitReminderScope(t);
  for (const { re, lang } of REMINDER_LIST_RULES)
    if (re.test(reminderQuery.text))
      return reminderQuery.range
        ? { kind: "reminderList", lang, range: reminderQuery.range }
        : { kind: "reminderList", lang };
  for (const { re, lang } of NOTE_READ_RULES) {
    const m = re.exec(t);
    if (m && m[1].trim().length >= 2) return { kind: "noteRead", query: m[1].trim(), lang };
  }
  for (const { re, lang } of NOTE_SAVE_RULES) {
    const m = re.exec(t);
    if (!m) continue;
    const body = m[1].trim();
    // "anota que" sin nada, o una orden de recordatorio/calendario disfrazada: no.
    if (body.length < 2 || /^(?:un recordatorio|a reminder|um lembrete)\b/i.test(body)) return null;
    return { kind: "noteSave", title: noteTitleFrom(body), body, lang };
  }

  for (const { re, lang, inv } of CONVERT_RULES) {
    const m = re.exec(t);
    if (!m) continue;
    // inv: la pregunta nombra primero la unidad DESTINO ("cuántos pies son
    // 2 metros" → grupos: destino, valor, origen).
    const value = Number((inv ? m[2] : m[1]).replace(",", "."));
    const from = unitWord(inv ? m[3] : m[2]);
    const to = unitWord(inv ? m[1] : m[3]);
    try {
      convertUnits(value, from, to); // valida unidades y categoría
      return { kind: "convert", value, from, to, lang };
    } catch {
      return null;
    }
  }

  for (const { re, lang } of CAL_LIST_RULES) {
    const m = re.exec(t);
    if (!m) continue;
    const label = rangeLabel(m[1]);
    const { from, to } = calendarRange(label, now);
    return { kind: "calendarList", from, to, label, lang };
  }

  // Mensajería NIDO antes que calendario: "manda por nido…" nunca es un evento.
  for (const { re, lang } of NIDO_SEND_RULES) {
    const m = re.exec(t);
    if (!m) continue;
    const to = m[1].trim().replace(/^(?:a|para|to)\s+/i, "");
    if (!to || to.split(/\s+/).length > 5) return null;
    return { kind: "nidoSend", to, text: m[2]?.trim() || null, lang };
  }
  for (const { re, lang } of NIDO_INBOX_RULES) if (re.test(t)) return { kind: "nidoInbox", lang };
  for (const { re, lang } of NIDO_CODE_RULES) if (re.test(t)) return { kind: "nidoCode", lang };
  for (const { re, lang } of NIDO_TASKS_RULES) if (re.test(t)) return { kind: "nidoTasks", lang };

  for (const { re, lang } of CAL_CREATE_RULES) {
    const m = re.exec(t);
    if (!m) continue;
    const rest = m[1].trim();
    const start = parseReminderDateTime(rest, now);
    const title = (start ? stripDateWords(rest) : rest)
      .replace(/^(?:una?|um|uma|an?|the|el|la|o|a)\s+(?:cita|evento|event|compromisso|appointment)\s+(?:con|de|with|com)?\s*/i, "")
      .replace(/^(?:para|for|pro|pra|de|con|with|com)\s+/i, "")
      .trim();
    // "agenda de hoy", "agenda para mañana": es una consulta, no un evento.
    if (title.length < 3 || /^(de|del|para|for|of)$/i.test(title)) return null;
    return { kind: "calendarCreate", title, start, lang };
  }

  for (const { re, lang } of OPEN_LINK_RE) {
    const m = re.exec(t);
    if (!m) continue;
    const url = m[1].startsWith("www.") ? `https://${m[1]}` : m[1];
    return { kind: "openLink", url, lang };
  }

  for (const { re, lang } of PICK_FILE_RE) {
    const m = re.exec(t);
    if (!m) continue;
    return { kind: "pickFile", analyze: /^anali[sz]|^analy|^revisa|^check/i.test(m[1]), lang };
  }
  return null;
}

// ------------------------------------------------------------ respuestas

type Key =
  | "timeNow"
  | "dateToday"
  | "noteSaved"
  | "noNotes"
  | "notesHeader"
  | "noteNotFound"
  | "noteWhich"
  | "calNone"
  | "calHeader"
  | "calAskWhen"
  | "calCreated"
  | "nidoAskText"
  | "opened"
  | "disabled"
  | "cancelled"
  | "failed"
  | "fileTooLongCut"
  | "noReminders"
  | "noRemindersToday"
  | "noRemindersTomorrow"
  | "remindersHeader"
  | "remindersHeaderToday"
  | "remindersHeaderTomorrow"
  | "reminderNoDate"
  | "reminderSet"
  | "reminderOneTimeOnly"
  | "reminderSavedAskWhen"
  | "reminderWillNotify"
  | "reminderSaveFailed"
  | "personSaved"
  | "personDateNote"
  | "selfNameSaved"
  | "factSaved"
  | "factReminderNote";

const MSG: Record<Key, Record<RouterLang, string>> = {
  personSaved: {
    es: "Listo, guardé a {{name}}{{rel}} en mis contactos.",
    en: "Done, I saved {{name}}{{rel}} to my contacts.",
    pt: "Pronto, salvei {{name}}{{rel}} nos meus contatos.",
  },
  personDateNote: {
    es: " También guardé la fecha como recordatorio.",
    en: " I also saved the date as a reminder.",
    pt: " Também salvei a data como lembrete.",
  },
  selfNameSaved: {
    es: "Listo, {{name}}. Lo guardé en mi memoria.",
    en: "Done, {{name}}. I saved it to my memory.",
    pt: "Pronto, {{name}}. Salvei na minha memória.",
  },
  factSaved: {
    es: "Listo, lo guardé en mi memoria: «{{text}}».",
    en: "Done, I saved it to my memory: “{{text}}”.",
    pt: "Pronto, salvei na minha memória: “{{text}}”.",
  },
  factReminderNote: {
    es: " También te creé un recordatorio para esa fecha.",
    en: " I also created a reminder for that date.",
    pt: " Também criei um lembrete para essa data.",
  },
  timeNow: { es: "Son las {{time}} ({{day}}).", en: "It's {{time}} ({{day}}).", pt: "São {{time}} ({{day}})." },
  dateToday: { es: "Hoy es {{day}} de {{year}}.", en: "Today is {{day}}, {{year}}.", pt: "Hoje é {{day}} de {{year}}." },
  noteSaved: { es: "Listo, guardé la nota «{{title}}».", en: "Done, I saved the note “{{title}}”.", pt: "Pronto, salvei a nota “{{title}}”." },
  noNotes: { es: "Todavía no tienes notas guardadas.", en: "You don't have any saved notes yet.", pt: "Você ainda não tem notas salvas." },
  notesHeader: {
    es: "Tus notas (dime «lee la nota …» para abrir una):",
    en: "Your notes (say “read the note …” to open one):",
    pt: "Suas notas (diga “lê a nota …” para abrir uma):",
  },
  noteNotFound: { es: "No encontré ninguna nota que se llame «{{q}}».", en: "I couldn't find a note called “{{q}}”.", pt: "Não encontrei nenhuma nota chamada “{{q}}”." },
  noteWhich: { es: "Hay varias notas que coinciden. ¿Cuál?", en: "Several notes match. Which one?", pt: "Várias notas correspondem. Qual?" },
  calNone: {
    es: "No tienes eventos {{range}}.",
    en: "You have no events {{range}}.",
    pt: "Você não tem eventos {{range}}.",
  },
  calHeader: { es: "Tus eventos {{range}}:", en: "Your events {{range}}:", pt: "Seus eventos {{range}}:" },
  calAskWhen: {
    es: "¿Para cuándo? Dímelo así: «agenda {{title}} el viernes a las 10».",
    en: "When? Say it like: “schedule {{title}} on Friday at 10”.",
    pt: "Para quando? Diga assim: “agende {{title}} sexta às 10”.",
  },
  calCreated: { es: "Listo, agendé «{{title}}»{{when}}.", en: "Done, I scheduled “{{title}}”{{when}}.", pt: "Pronto, agendei “{{title}}”{{when}}." },
  nidoAskText: {
    es: "¿Qué le escribo a {{to}}? Dímelo así: «manda por nido a {{to}} que …».",
    en: "What should I send {{to}}? Say it like: “send a nido message to {{to}} saying …”.",
    pt: "O que escrevo para {{to}}? Diga assim: “manda uma mensagem pelo nido para {{to}} dizendo …”.",
  },
  opened: { es: "Abriendo {{url}}…", en: "Opening {{url}}…", pt: "Abrindo {{url}}…" },
  disabled: {
    es: "La herramienta «{{tool}}» está desactivada. Puedes activarla en Acerca de → Permisos del agente.",
    en: "The “{{tool}}” tool is turned off. You can turn it on in About → Agent permissions.",
    pt: "A ferramenta “{{tool}}” está desativada. Você pode ativá-la em Sobre → Permissões do agente.",
  },
  cancelled: { es: "Entendido, no hice nada.", en: "Understood, I did nothing.", pt: "Entendido, não fiz nada." },
  failed: { es: "No pude completar la acción: {{reason}}", en: "I couldn't complete the action: {{reason}}", pt: "Não consegui concluir a ação: {{reason}}" },
  fileTooLongCut: { es: "…(recortado)", en: "…(cut)", pt: "…(cortado)" },
  noReminders: { es: "No tienes recordatorios pendientes.", en: "You have no pending reminders.", pt: "Você não tem lembretes pendentes." },
  noRemindersToday: { es: "No tienes recordatorios para hoy.", en: "You have no reminders for today.", pt: "Você não tem lembretes para hoje." },
  noRemindersTomorrow: { es: "No tienes recordatorios para mañana.", en: "You have no reminders for tomorrow.", pt: "Você não tem lembretes para amanhã." },
  remindersHeader: { es: "Tus recordatorios pendientes:", en: "Your pending reminders:", pt: "Seus lembretes pendentes:" },
  remindersHeaderToday: { es: "Tus recordatorios de hoy:", en: "Your reminders for today:", pt: "Seus lembretes de hoje:" },
  remindersHeaderTomorrow: { es: "Tus recordatorios de mañana:", en: "Your reminders for tomorrow:", pt: "Seus lembretes de amanhã:" },
  reminderNoDate: { es: "sin fecha", en: "no date", pt: "sem data" },
  reminderSet: { es: "Listo, te recordaré{{when}}: «{{text}}».", en: "Done, I'll remind you{{when}}: “{{text}}”.", pt: "Pronto, vou te lembrar{{when}}: “{{text}}”." },
  reminderOneTimeOnly: {
    es: " Ojo: lo guardé como un recordatorio de una sola vez; los recordatorios que se repiten todavía no están soportados.",
    en: " Note: I saved it as a one-time reminder; repeating reminders are not supported yet.",
    pt: " Atenção: salvei como um lembrete único; lembretes repetidos ainda não são suportados.",
  },
  reminderSavedAskWhen: {
    es: "Listo, guardé: «{{text}}». ¿Para cuándo quieres que te avise?",
    en: "Done, I saved: “{{text}}”. When should I remind you?",
    pt: "Pronto, salvei: “{{text}}”. Para quando quer que eu te avise?",
  },
  reminderWillNotify: {
    es: " Te llegará un aviso aunque NIDO esté cerrado.",
    en: " You'll get a notification even if NIDO is closed.",
    pt: " Você vai receber um aviso mesmo com o NIDO fechado.",
  },
  reminderSaveFailed: {
    es: "No pude guardar el recordatorio por un problema con la base de datos. Inténtalo de nuevo.",
    en: "I couldn't save the reminder because of a database problem. Please try again.",
    pt: "Não consegui salvar o lembrete por um problema no banco de dados. Tente de novo.",
  },
};

/** " el viernes, 17 de octubre a las 10:00" / " on Friday, October 17 at 10:00 AM" / " na sexta-feira…" */
export function reminderWhen(iso: string, lang: RouterLang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (lang === "en") return ` on ${formatDay(d, lang)} at ${formatTime(d, lang)}`;
  if (lang === "pt") return ` em ${formatDay(d, lang)} às ${formatTime(d, lang)}`;
  return ` el ${formatDay(d, lang)} a las ${formatTime(d, lang)}`;
}

const RANGE_WORDS: Record<CalendarRange, Record<RouterLang, string>> = {
  today: { es: "hoy", en: "today", pt: "hoje" },
  tomorrow: { es: "mañana", en: "tomorrow", pt: "amanhã" },
  week: { es: "en los próximos 7 días", en: "in the next 7 days", pt: "nos próximos 7 dias" },
};

export function routerMessage(key: Key, lang: RouterLang, vars: Record<string, string> = {}): string {
  let s = MSG[key][lang];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(v);
  return s;
}

// ------------------------------------------------- fechas sin Intl (crash)

const DAYS: Record<RouterLang, string[]> = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  pt: ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"],
};
const MONTHS: Record<RouterLang, string[]> = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  pt: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
};

/**
 * CRASH-2026-10-10 (reminderFormat.ts): toLocale*String con opciones pasa
 * por Intl/JNI en Hermes-Android y un fallo ahí cierra la app. Aquí solo
 * getters de Date.
 */
export function formatDay(d: Date, lang: RouterLang): string {
  const day = DAYS[lang][d.getDay()];
  const month = MONTHS[lang][d.getMonth()];
  return lang === "en" ? `${day}, ${month} ${d.getDate()}` : `${day}, ${d.getDate()} de ${month}`;
}

export function formatTime(d: Date, lang: RouterLang): string {
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (lang === "en") {
    const h = d.getHours();
    return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
  }
  return `${d.getHours()}:${mm}`;
}

// ------------------------------------------------------------- ejecución

export interface NoteSummary {
  id: string;
  title: string;
}

export interface ToolRouterDeps {
  dispatch: (name: string, args: Record<string, unknown>) => Promise<{ status: DispatchStatus; text: string }>;
  isDisabled: (tool: string) => boolean;
  /** Notas guardadas (id + título), para resolver "lee la nota X" por título. */
  listNotes?: () => Promise<NoteSummary[]>;
  /** Recordatorios pendientes, para "qué recordatorios tengo". */
  listReminders?: () => Promise<Array<{ text: string; dueAt: string | null }>>;
  now?: () => Date;
}

export interface ToolRouterOutcome {
  response: string;
  toolUses: { name: string; result: string }[];
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * 0.1.9: las salidas de varios handlers están solo en español. Para en/pt
 * se traducen las frases fijas conocidas (los datos del usuario —nombres,
 * mensajes, códigos— no se tocan). Exportada para tests.
 */
export function localizeHandlerText(text: string, lang: RouterLang): string {
  if (lang === "es") return text;
  const L = (en: string, pt: string) => (lang === "en" ? en : pt);
  return text
    .replace(/^No tienes mensajes NIDO sin leer\.$/m, L("You have no unread NIDO messages.", "Você não tem mensagens NIDO não lidas."))
    .replace(
      /Pendiente de tu aprobación — revísala con nido_review_tasks \(id ([^)]+)\)\./g,
      (_m, id) => L(`Waiting for your approval — say “pending tasks” (id ${id}).`, `Aguardando sua aprovação — diga “tarefas pendentes” (id ${id}).`),
    )
    .replace(
      /^Tu código de emparejamiento NIDO \(muéstralo como QR para que el otro teléfono lo escanee\):/m,
      L("Your NIDO pairing code (show it as a QR so the other phone can scan it):", "Seu código de pareamento NIDO (mostre como QR para o outro telefone escanear):"),
    )
    .replace(/Huella para verificar en persona:/g, L("Fingerprint to check in person:", "Impressão digital para conferir pessoalmente:"))
    .replace(
      /^Mensaje para «(.+?)» guardado cifrado en la cola de salida: se entregará cuando su NIDO esté al alcance \(Bluetooth\)\.$/m,
      (_m, to) => L(`Message for “${to}” saved encrypted in the outbox: it will be delivered when their NIDO is in range.`, `Mensagem para “${to}” salva criptografada na fila: será entregue quando o NIDO dele estiver ao alcance.`),
    )
    .replace(
      /^Mensaje enviado a «(.+?)» por NIDO \(cifrado de extremo a extremo\)\.$/m,
      (_m, to) => L(`Message sent to “${to}” via NIDO (end-to-end encrypted).`, `Mensagem enviada para “${to}” pelo NIDO (criptografia de ponta a ponta).`),
    )
    .replace(/^No elegiste ningún archivo\.$/m, L("You didn't pick a file.", "Você não escolheu nenhum arquivo."))
    .replace(/^Archivo «(.+?)» \((\d+) KB\):/m, (_m, n, kb) => L(`File “${n}” (${kb} KB):`, `Arquivo “${n}” (${kb} KB):`))
    .replace(/^No hay tareas NIDO pendientes[^\n]*$/m, L("There are no NIDO tasks pending approval.", "Não há tarefas NIDO aguardando aprovação."));
}

/** Traducción mínima de las salidas en español de list_calendar_events. */
function localizeCalendarList(text: string, label: CalendarRange, lang: RouterLang): string {
  const range = RANGE_WORDS[label][lang];
  if (/^No hay eventos/i.test(text)) return routerMessage("calNone", lang, { range });
  if (/^Próximos eventos:/i.test(text)) {
    return text.replace(/^Próximos eventos:/i, routerMessage("calHeader", lang, { range }));
  }
  return text;
}

/**
 * Ejecuta una ToolAction. Nunca lanza: los errores se convierten en una
 * respuesta honesta en el idioma del usuario.
 */
export async function runToolAction(action: ToolAction, deps: ToolRouterDeps): Promise<ToolRouterOutcome> {
  const { lang } = action;
  const now = deps.now?.() ?? new Date();
  const tool = toolForAction(action);
  const uses: ToolRouterOutcome["toolUses"] = [];
  const say = (response: string) => ({ response, toolUses: uses });

  if (deps.isDisabled(tool)) return say(routerMessage("disabled", lang, { tool }));

  const run = async (name: string, args: Record<string, unknown>) => {
    const out = await deps.dispatch(name, args);
    uses.push({ name, result: out.text });
    const text = out.text.trim();
    // Los diálogos propios de algunos handlers (calendario, enlaces,
    // mensajes NIDO) devuelven su cancelación como texto, sin lanzar.
    if (out.status === "executed" && /no hice nada|did nothing|n[aã]o fiz nada/i.test(text)) {
      return { status: "cancelled" as DispatchStatus, text: out.text, ok: false };
    }
    const handlerFailed = out.status === "executed" && /^(error|no pude|no encontr[eé]|nido no)\b/i.test(text);
    return { ...out, ok: out.status === "executed" && !handlerFailed };
  };
  const failure = (out: { status: DispatchStatus; text: string }) => {
    if (out.status === "cancelled") return say(routerMessage("cancelled", lang));
    if (out.status === "disabled") return say(routerMessage("disabled", lang, { tool }));
    return say(routerMessage("failed", lang, { reason: out.text }));
  };

  try {
    switch (action.kind) {
      case "time": {
        // Hora del sistema leída aquí (determinista); se registra como device_time.
        uses.push({ name: "device_time", result: now.toISOString() });
        return action.what === "time"
          ? say(routerMessage("timeNow", lang, { time: formatTime(now, lang), day: formatDay(now, lang) }))
          : say(routerMessage("dateToday", lang, { day: formatDay(now, lang), year: String(now.getFullYear()) }));
      }

      case "noteSave": {
        const out = await run("save_note", { title: action.title, body: action.body });
        return out.ok ? say(routerMessage("noteSaved", lang, { title: action.title })) : failure(out);
      }

      case "noteList": {
        if (deps.listNotes) {
          const notes = await deps.listNotes();
          uses.push({ name: "list_notes", result: `${notes.length} notes` });
          if (notes.length === 0) return say(routerMessage("noNotes", lang));
          return say(`${routerMessage("notesHeader", lang)}\n${notes.slice(0, 20).map((n) => `• ${n.title}`).join("\n")}`);
        }
        const out = await run("list_notes", {});
        return out.ok || /^No hay notas/.test(out.text) ? say(out.text) : failure(out);
      }

      case "noteRead": {
        const notes = (await deps.listNotes?.()) ?? [];
        const q = norm(action.query);
        const matches = notes.filter((n) => norm(n.title).includes(q) || (q.length >= 4 && q.includes(norm(n.title))));
        const exact = matches.filter((n) => norm(n.title) === q);
        const chosen = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
        if (!chosen) {
          if (matches.length === 0) return say(routerMessage("noteNotFound", lang, { q: action.query }));
          return say(`${routerMessage("noteWhich", lang)}\n${matches.slice(0, 8).map((n) => `• ${n.title}`).join("\n")}`);
        }
        const out = await run("read_note", { id: chosen.id });
        return out.ok ? say(out.text) : failure(out);
      }

      case "reminderList": {
        if (!deps.listReminders) return say(routerMessage("failed", lang, { reason: "reminders unavailable" }));
        const all = await deps.listReminders();
        let items = all;
        if (action.range) {
          // 0.1.19: con alcance ("hoy"/"mañana") se filtra por día LOCAL
          // completo (00:00–24:00): un recordatorio de hoy a las 9 sigue
          // siendo "de hoy" aunque ya sean las 12. Los sin fecha no cuentan
          // como de un día concreto y quedan fuera del filtro.
          const now = deps.now?.() ?? new Date();
          const start = new Date(now);
          start.setHours(0, 0, 0, 0);
          if (action.range === "tomorrow") start.setDate(start.getDate() + 1);
          const end = new Date(start);
          end.setDate(end.getDate() + 1);
          const f = start.getTime();
          const u = end.getTime();
          items = all.filter((r) => {
            if (!r.dueAt) return false;
            const d = new Date(r.dueAt).getTime();
            return d >= f && d < u;
          });
        }
        uses.push({ name: "list_reminders", result: `${items.length} pending` });
        if (items.length === 0)
          return say(
            routerMessage(
              action.range === "today" ? "noRemindersToday" : action.range === "tomorrow" ? "noRemindersTomorrow" : "noReminders",
              lang,
            ),
          );
        const lines = items.slice(0, 20).map((r) => {
          const when = r.dueAt ? reminderWhen(r.dueAt, lang).trim() : routerMessage("reminderNoDate", lang);
          return `• ${r.text} (${when})`;
        });
        const header =
          action.range === "today" ? "remindersHeaderToday" : action.range === "tomorrow" ? "remindersHeaderTomorrow" : "remindersHeader";
        return say(`${routerMessage(header, lang)}\n${lines.join("\n")}`);
      }

      case "convert": {
        const out = await run("convert_units", { value: action.value, from: action.from, to: action.to });
        return out.ok ? say(out.text) : failure(out);
      }

      case "calendarList": {
        const out = await run("list_calendar_events", { from: action.from, to: action.to });
        if (out.status !== "executed") return failure(out);
        return say(localizeCalendarList(out.text, action.label, lang));
      }

      case "calendarCreate": {
        if (!action.start) return say(routerMessage("calAskWhen", lang, { title: action.title }));
        const out = await run("create_calendar_event", { title: action.title, start: action.start });
        if (!out.ok) {
          // El diálogo propio del handler devuelve su texto de cancelación.
          if (/no hice nada|did nothing/i.test(out.text)) return say(routerMessage("cancelled", lang));
          return failure(out);
        }
        const d = new Date(action.start);
        const when =
          lang === "en"
            ? ` for ${formatDay(d, lang)} at ${formatTime(d, lang)}`
            : lang === "pt"
              ? ` para ${formatDay(d, lang)} às ${formatTime(d, lang)}`
              : ` para el ${formatDay(d, lang)} a las ${formatTime(d, lang)}`;
        return say(routerMessage("calCreated", lang, { title: action.title, when }));
      }

      case "nidoSend": {
        if (!action.text) return say(routerMessage("nidoAskText", lang, { to: action.to }));
        const out = await run("nido_send_message", { to: action.to, text: action.text });
        if (out.status !== "executed") return failure(out);
        return say(localizeHandlerText(out.text, lang));
      }

      case "nidoInbox":
      case "nidoCode":
      case "nidoTasks": {
        const out = await run(tool, {});
        return out.status === "executed" ? say(localizeHandlerText(out.text, lang)) : failure(out);
      }

      case "openLink": {
        const out = await run("open_app", { link: action.url });
        if (out.status !== "executed") return failure(out);
        if (/^Abriendo /.test(out.text)) return say(routerMessage("opened", lang, { url: action.url }));
        if (/no hice nada|did nothing/i.test(out.text)) return say(routerMessage("cancelled", lang));
        return say(out.text);
      }

      case "pickFile": {
        const out = await run("read_picked_file", {});
        if (out.status !== "executed") return failure(out);
        const text = out.text;
        const nl = text.indexOf("\n");
        const content = nl >= 0 ? text.slice(nl + 1) : "";
        // ¿Parece una tabla (CSV/TSV)? Entonces, si pidió analizar, se analiza.
        const lines = content.split(/\r?\n/).filter((l) => l.trim());
        const tabular = lines.length >= 2 && lines.slice(0, 3).every((l) => /[,;\t]/.test(l));
        if (action.analyze && tabular && !deps.isDisabled("analyze_table")) {
          const res = await run("analyze_table", { text: content.replace(/\n…\(recortado\)$/, "") });
          if (res.status === "executed") return say(`${text.slice(0, nl >= 0 ? nl : text.length)}\n\n${res.text}`);
        }
        const shown = text.length > 1500 ? `${text.slice(0, 1500)}\n${routerMessage("fileTooLongCut", lang)}` : text;
        return say(localizeHandlerText(shown, lang));
      }
    }
  } catch (e) {
    return say(routerMessage("failed", lang, { reason: e instanceof Error ? e.message : String(e) }));
  }
  return say(routerMessage("failed", lang, { reason: "?" }));
}
