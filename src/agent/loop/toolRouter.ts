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

import { nextOccurrence } from "../memory/reminderRepeat";
import { convertUnits } from "../tools/convert";
import {
  extractCalcAction,
  extractReminderAction,
  extractTimerAction,
  parseReminderDateTime,
  reminderMissingText,
  stripDateWords,
} from "./actionRouter";
import type { ReminderRepeat } from "../memory/reminderRepeat";
import { extractImplicitFact, extractPeople, extractRememberFact } from "./rememberRouter";
import type { DispatchStatus } from "./contactRouter";

export type RouterLang = "es" | "en" | "pt";

export type ToolAction =
  | { kind: "time"; what: "time" | "date"; lang: RouterLang }
  /** 0.1.41: «qué día cae el 25 de diciembre» → día de la semana, calculado. */
  | { kind: "weekday"; year: number; month: number; day: number; lang: RouterLang }
  | { kind: "noteSave"; title: string; body: string; lang: RouterLang }
  | { kind: "noteList"; lang: RouterLang }
  | { kind: "noteRead"; query: string; lang: RouterLang; directId?: string }
  | { kind: "noteSearch"; query: string; lang: RouterLang }
  | { kind: "convert"; value: number; from: string; to: string; lang: RouterLang }
  | { kind: "currencyInfo"; lang: RouterLang }
  | { kind: "memoryForgetHelp"; lang: RouterLang }
  | { kind: "countdown"; target: string; label: string; lang: RouterLang }
  | { kind: "reminderOfferCreate"; range: "today" | "tomorrow" | null; lang: RouterLang }
  | { kind: "reminderFill"; text: string; dueAt: string; lang: RouterLang; repeat?: ReminderRepeat | null }
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
export type DeleteTarget = { type: "one"; query: string; directId?: string } | { type: "all" } | { type: "ask" };

export type CalendarRange = "today" | "tomorrow" | "week";

/**
 * 0.1.31 (auditoría del loop): el español y el portugués comparten verbos
 * («anota que…», «cancela…», «lista…»). La regla que casa primero fija el
 * idioma de la respuesta, así que «anota que preciso pagar a luz» con la
 * app en portugués respondía «Listo, guardé la nota». Si el idioma de la
 * regla es es/pt, el de la app es el otro y el texto no trae marcas propias
 * del idioma de la regla, se responde en el idioma de la app.
 */
const ES_ONLY = /[ñ¿¡]|\b(?:que diga|tengo|mis|mi|el|los|las|del|para el|hoy|mañana|ahora|llamar|comprar|pagar la|y)\b/i;
const PT_ONLY = /[ãõç]|\b(?:preciso|tenho|minhas?|meus?|você|não|amanhã|hoje|agora|ligar|comprar o|pagar a|e)\b|\bé\b/i;
export function settleSharedLang<T extends { lang: RouterLang }>(action: T, text: string, uiLang: RouterLang | undefined): T {
  if (!uiLang || uiLang === action.lang) return action;
  if (action.lang === "es" && uiLang === "pt" && !ES_ONLY.test(text)) return { ...action, lang: "pt" };
  if (action.lang === "pt" && uiLang === "es" && !PT_ONLY.test(text)) return { ...action, lang: "es" };
  return action;
}

/** Herramienta del manifiesto que ejecuta cada acción (para interruptores y tareas programadas). */
export function toolForAction(a: ToolAction): string {
  switch (a.kind) {
    case "time":
    case "weekday":
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
    case "noteSearch":
      return "list_notes";
    case "currencyInfo":
      // Sin herramienta propia: la respuesta honesta sale del router.
      // Se mapea a convert_units para el interruptor del usuario.
      return "convert_units";
    case "memoryForgetHelp":
      // Sin herramienta de borrado de memoria para el agente: se explica
      // dónde se borra. Va con el interruptor de la memoria.
      return "remember_fact";
    case "countdown":
      return "device_time";
    case "reminderOfferCreate":
    case "reminderFill":
      return "create_reminder";
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

// 0.1.32: «¿cuánto falta para Navidad?» lo respondía el modelo, que no
// sabe la fecha de hoy y podía inventar los días. Es una resta de fechas.
const COUNTDOWN_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:cu[aá]nto(?:\s+tiempo)?\s+(?:falta|queda)n?|cu[aá]ntos\s+d[ií]as\s+(?:faltan|quedan))\s+para\s+(?:el\s+|la\s+|los\s+)?(.+)$/i, lang: "es" },
  { re: /^(?:how\s+(?:long|many\s+days)(?:\s+(?:is\s+it|are\s+there|left))?\s+(?:until|till|to|before)|days\s+(?:until|till|left\s+until))\s+(.+)$/i, lang: "en" },
  { re: /^(?:quanto(?:\s+tempo)?\s+falta|quantos\s+dias\s+faltam)\s+(?:para|pro|pra)\s+(?:o\s+|a\s+)?(.+)$/i, lang: "pt" },
];

const NAMED_DAYS: Array<{ re: RegExp; month: number; day: number; label: Record<RouterLang, string> }> = [
  { re: /^(?:navidad|christmas(?:\s+day)?|natal)$/i, month: 11, day: 25, label: { es: "Navidad", en: "Christmas", pt: "o Natal" } },
  { re: /^(?:nochebuena|christmas\s+eve|v[eé]spera\s+de\s+natal)$/i, month: 11, day: 24, label: { es: "Nochebuena", en: "Christmas Eve", pt: "a véspera de Natal" } },
  { re: /^(?:a[ñn]o\s+nuevo|new\s+year'?s?(?:\s+day)?|ano\s+novo)$/i, month: 0, day: 1, label: { es: "Año Nuevo", en: "New Year's Day", pt: "o Ano Novo" } },
  { re: /^(?:nochevieja|new\s+year'?s\s+eve|r[eé]veillon)$/i, month: 11, day: 31, label: { es: "Nochevieja", en: "New Year's Eve", pt: "o Réveillon" } },
  { re: /^halloween$/i, month: 9, day: 31, label: { es: "Halloween", en: "Halloween", pt: "o Halloween" } },
];

/**
 * 0.1.34 (prueba física, Tab A9+): el autocorrector cambió «Cuánto» por
 * «Canton» y «Canton falta para navidad» acabó en la búsqueda offline
 * (citó «Cheti Chand»). Con una FECHA CON NOMBRE detrás, la palabra de
 * delante da igual: «falta para navidad», «cuanto falta pa navidad»,
 * «days till christmas», «falta pro natal». Solo para días con nombre:
 * con fechas sueltas se sigue exigiendo la pregunta completa.
 */
const LENIENT_COUNTDOWN_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:\S+\s+){0,2}(?:falta|queda)n?(?:\s+\S+)?\s+(?:para|pa)\s+(?:el\s+|la\s+)?(.+)$/i, lang: "es" },
  { re: /^(?:\S+\s+){0,3}(?:until|till|til|to)\s+(.+)$/i, lang: "en" },
  { re: /^(?:\S+\s+){0,2}falta(?:m)?(?:\s+\S+)?\s+(?:para|pro|pra)\s+(?:o\s+|a\s+)?(.+)$/i, lang: "pt" },
];

/**
 * 0.1.34 (prueba física, Tab A9+): tras «No tienes recordatorios para
 * mañana», «Haz uno» caía a la enciclopedia y respondía sobre el juego
 * UNO, en inglés. Durante 3 minutos tras una lista vacía, «haz uno» /
 * «crea uno» / «make one» / «faz um» es la oferta de crear uno: se explica
 * cómo pedirlo (sin inventar qué ni cuándo).
 */
let emptyReminderList: { range: "today" | "tomorrow" | null; lang: RouterLang; at: number; turn: number } | null = null;
const OFFER_WINDOW_MS = 3 * 60_000;

/**
 * 0.1.37 (auditoría del loop): los estados de seguimiento («¿qué te
 * recuerdo?», «Haz uno») valían 3 minutos para CUALQUIER mensaje, así que
 * «pon un temporizador de 5 minutos» dicho después se convertía en un
 * recordatorio para el lunes, incluso tras «Nuevo chat». Ahora solo valen
 * para el turno SIGUIENTE: la app llama a beginUserTurn() al empezar cada
 * envío (sin esa llamada —tests, tareas— rige solo la ventana de tiempo).
 */
let followupTurn = 0;
export function beginUserTurn(): void {
  followupTurn++;
}
/** Nuevo chat, cambio de conversación o de idioma: se olvida todo seguimiento. */
export function resetConversationState(): void {
  pendingAsk = null;
  emptyReminderList = null;
}
function followupExpired(at: number, turn: number, now: Date): boolean {
  const t = now.getTime();
  return t - at > OFFER_WINDOW_MS || t < at || followupTurn > turn + 1;
}
export function noteEmptyReminderList(range: "today" | "tomorrow" | null, lang: RouterLang, now: Date): void {
  emptyReminderList = { range, lang, at: now.getTime(), turn: followupTurn };
}
const OFFER_CREATE_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:s[ií],?\s+|vale,?\s+|ok,?\s+|bueno,?\s+)?(?:haz(?:me)?|crea(?:me)?|cr[eé]ame|pon(?:me)?|agr[eé]ga(?:me)?|a[ñn][aá]de(?:me)?)\s+(?:uno|un\s+recordatorio)$/i, lang: "es" },
  { re: /^(?:yes,?\s+|ok,?\s+|sure,?\s+)?(?:make|create|add|set)\s+(?:me\s+)?(?:one|a\s+reminder)$/i, lang: "en" },
  { re: /^(?:sim,?\s+|ok,?\s+)?(?:faz|fa[cç]a|cria|crie|p[oõ]e|coloca)\s+(?:um|um\s+lembrete)$/i, lang: "pt" },
];
function offerCreateAction(t: string, now: Date): ToolAction | null {
  const offer = emptyReminderList;
  if (!offer || followupExpired(offer.at, offer.turn, now)) return null;
  for (const { re, lang } of OFFER_CREATE_RULES) {
    if (re.test(t)) return { kind: "reminderOfferCreate", range: offer.range, lang };
  }
  return null;
}

/**
 * 0.1.35: «ponme un recordatorio para el lunes» → NIDO pregunta «¿Qué
 * quieres que te recuerde el lunes?». La respuesta («pagar la luz») era un
 * mensaje suelto que caía al modelo y el recordatorio nunca se creaba.
 * Durante 3 minutos, una respuesta corta que no es otra cosa se toma como
 * el contenido de ese recordatorio. «no», «cancela», «olvídalo» lo anulan.
 */
let pendingAsk: { dueAt: string; lang: RouterLang; at: number; turn: number; repeat: ReminderRepeat | null } | null = null;
export function notePendingReminderAsk(dueAt: string, lang: RouterLang, now: Date, repeat: ReminderRepeat | null = null): void {
  pendingAsk = { dueAt, lang, at: now.getTime(), turn: followupTurn, repeat };
}
/** Se creó el recordatorio por otra vía: la pregunta ya no está abierta. */
export function clearPendingReminderAsk(): void {
  pendingAsk = null;
}
// 0.1.37: «no, gracias», «no quiero nada», «no thanks», «não, obrigado»
// también anulan (antes solo la palabra exacta y se guardaba «no, gracias»).
const ASK_CANCEL_RE =
  /^(?:(?:no|nada|nope|nah|n[aã]o)(?:$|[\s,.!]+(?!olvid|te\s+olvid|forget|esque[cç])\S*)|cancela(?:r)?|olv[ií]dalo|d[eé]jalo|nevermind|never\s+mind|cancel|forget\s+it|nothing|deixa|esquece|cancelar)/iu;
// Acuses que no son contenido («sí», «ok», «espera», «gracias»).
const ASK_ACK_RE =
  /^(?:s[ií]|ok(?:ay)?|vale|bueno|claro|espera|un\s+momento|gracias|yes|yeah|sure|wait|thanks|thank\s+you|sim|t[aá]|beleza|obrigad[oa]|perai|espera\s+a[ií])$/iu;
// Peticiones creativas o de conversación: no son lo que hay que recordar.
const ASK_NOT_CONTENT_RE =
  /^(?:escr[ií]be(?:me)?|crea(?:me)?|cu[eé]nta(?:me)?|dime|h[aá]blame|expl[ií]ca(?:me)?|traduce|resume|write|tell\s+me|make\s+up|explain|translate|summari[sz]e|escreva|conte|me\s+conta|fale|explique|traduza|resuma)(?![\p{L}])/iu;
function pendingFillAction(t: string, now: Date): ToolAction | null {
  const p = pendingAsk;
  if (!p || followupExpired(p.at, p.turn, now)) return null;
  const s = t.trim().replace(/[.!]+$/, "");
  if (ASK_CANCEL_RE.test(s)) {
    pendingAsk = null;
    return null;
  }
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 10 || /\?/.test(s)) return null;
  if (ASK_ACK_RE.test(s) || ASK_NOT_CONTENT_RE.test(s)) return null;
  // Una orden completa (temporizador, otro recordatorio, un dato para
  // recordar, una cuenta) es un mensaje nuevo, no la respuesta.
  if (
    extractTimerAction(s) ||
    extractReminderAction(s, now) ||
    reminderMissingText(s) ||
    extractCalcAction(s) ||
    extractPeople(s).length > 0 ||
    extractRememberFact(s) ||
    extractImplicitFact(s)
  ) {
    return null;
  }
  if (/^(?:qu[eé]|c[oó]mo|cu[aá]nto|cu[aá]ndo|d[oó]nde|por qu[eé]|qui[eé]n|cu[aá]l|what|how|when|where|why|who|which|o que|como|quanto|quando|onde|quem|qual)(?![\p{L}])/iu.test(s)) return null;
  const text = s.replace(/^(?:(?:para|de|to|for|que|that|about|sobre)\s+)+/i, "").trim();
  if (text.length < 2) return null;
  // No se consume aquí: la puerta del chat y el loop lo consultan los dos;
  // se borra al crear el recordatorio.
  return { kind: "reminderFill", text, dueAt: p.dueAt, lang: p.lang, repeat: p.repeat };
}

/** Fecha (00:00 local) de un día con nombre (Navidad, Año Nuevo…), o null. */
export function namedDayTarget(raw: string, now: Date, lang: RouterLang): { target: Date; label: string } | null {
  const t = raw.trim().replace(/[?.!]+$/, "");
  for (const n of NAMED_DAYS) {
    if (!n.re.test(t)) continue;
    const d = new Date(now.getFullYear(), n.month, n.day);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d.getTime() < today.getTime()) d.setFullYear(d.getFullYear() + 1);
    return { target: d, label: n.label[lang] };
  }
  return null;
}

/** Fecha (00:00 local) de lo nombrado, o null si no se entiende. */
export function countdownTarget(raw: string, now: Date, lang: RouterLang): { target: Date; label: string } | null {
  const t = raw.trim().replace(/[?.!]+$/, "");
  {
    const named = namedDayTarget(t, now, lang);
    if (named) return named;
  }
  // Desde el inicio del día: «el 13 de octubre» dicho el 13 a las 10 es HOY
  // (con la hora real, la hora por defecto de las 9 ya habría pasado y la
  // fecha saltaba a mañana).
  const iso = parseReminderDateTime(t, new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  if (!iso) return null;
  const at = new Date(iso);
  // Una fecha («el 25 de diciembre», «el viernes») no lleva etiqueta: la
  // respuesta ya nombra el día.
  return { target: new Date(at.getFullYear(), at.getMonth(), at.getDate()), label: "" };
}

const TIMER_CANCEL_RULES: Array<{ re: RegExp; q: string; lang: RouterLang }> = [
  { re: /^(?:cancela|cancelar|quita|quitar|borra|borrar|para|det[eé]n|apaga)\s+(?:el\s+|mi\s+)?temporizador$/i, q: "temporizador", lang: "es" },
  { re: /^(?:cancel|stop|delete|remove|turn off)\s+(?:the\s+|my\s+)?timer$/i, q: "timer", lang: "en" },
  { re: /^(?:cancela|cancele|cancelar|para|pare|parar|apaga|apague|desliga|desligue)\s+(?:o\s+|meu\s+)?temporizador$/i, q: "temporizador", lang: "pt" },
];

const MEMORY_FORGET_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:olvida|olv[ií]date de|borra de tu memoria|borra de la memoria)\s+(?!(?:eso|esto|lo)$).{2,}/i, lang: "es" },
  // «forget it» / «forget about it» es «déjalo», no una orden de memoria.
  { re: /^(?:forget|delete from your memory|erase from your memory)\s+(?!(?:it|that|about it|about that|this)$).{2,}/i, lang: "en" },
  { re: /^(?:esque[cç]a|esquece|apaga da sua mem[oó]ria|apague da mem[oó]ria)\s+(?!(?:isso|isto)$).{2,}/i, lang: "pt" },
];

// --------------------------------------------------------------- tiempo

const TIME_RULES: Array<{ re: RegExp; what: "time" | "date"; lang: RouterLang }> = [
  // 0.1.30: «dime la hora» caía al conocimiento y el modelo inventaba la hora.
  { re: /^(?:qu[eé] hora es(?: ahora)?|qu[eé] horas son|tienes la hora|me (?:dices|das) la hora|d[ií]me la hora|la hora|hora|hora actual)$/i, what: "time", lang: "es" },
  { re: /^(?:qu[eé] (?:d[ií]a|fecha) es(?: hoy)?|a qu[eé] (?:d[ií]a|fecha) estamos|qu[eé] d[ií]a es hoy|cu[aá]l es la fecha(?: de hoy)?)$/i, what: "date", lang: "es" },
  { re: /^(?:what time is it(?: now)?|what(?:'s| is) the time(?: now)?|do you have the time|tell me the time|current time|time please|the time)$/i, what: "time", lang: "en" },
  { re: /^(?:what(?:'s| is) (?:the date|today'?s date|the day)(?: today)?|what day is (?:it|today)(?: today)?|what(?:'s| is) today)$/i, what: "date", lang: "en" },
  { re: /^(?:que horas s[aã]o(?: agora)?|me diz as horas|diga as horas|hora atual)$/i, what: "time", lang: "pt" },
  { re: /^(?:que dia [eé] hoje|qual [eé] a data(?: de hoje)?|que dia [eé] hoje\??)$/i, what: "date", lang: "pt" },
];

// ------------------------------------------------- día de la semana

// 0.1.41 (prueba física): «que dia cae el 25 de diciembre» caía al modelo,
// que contestó «está en el día de la Navidad» sin decir el día. Es una
// cuenta de calendario: se resuelve aquí, sin modelo.
const MONTH_LOOKUP: Record<string, number> = (() => {
  const names: Array<[string[], number]> = [
    [["enero", "january", "jan", "janeiro"], 1],
    [["febrero", "february", "feb", "fevereiro"], 2],
    [["marzo", "march", "mar", "marco", "março"], 3],
    [["abril", "april", "apr"], 4],
    [["mayo", "may", "maio"], 5],
    [["junio", "june", "jun", "junho"], 6],
    [["julio", "july", "jul", "julho"], 7],
    [["agosto", "august", "aug"], 8],
    [["septiembre", "setiembre", "september", "sep", "sept", "setembro"], 9],
    [["octubre", "october", "oct", "outubro"], 10],
    [["noviembre", "november", "nov", "novembro"], 11],
    [["diciembre", "december", "dec", "dezembro"], 12],
  ];
  const out: Record<string, number> = {};
  for (const [list, n] of names) for (const w of list) out[w] = n;
  return out;
})();

const WEEKDAY_RULES: Array<{ re: RegExp; lang: RouterLang; order: "dm" | "md-or-dm" }> = [
  {
    re: /^(?:en\s+)?qu[eé]\s+d[ií]a(?:\s+de\s+la\s+semana)?\s+(?:cae|es|ser[aá]|fue|toca)\s+(?:el\s+)?(\d{1,2})\s+de\s+([\p{L}]+)(?:\s+(?:de|del)\s+(\d{4}))?$/iu,
    lang: "es",
    order: "dm",
  },
  {
    re: /^(?:em\s+)?que\s+dia(?:\s+da\s+semana)?\s+(?:cai|[eé]|ser[aá]|foi)\s+(?:o\s+(?:dia\s+)?)?(\d{1,2})\s+de\s+([\p{L}]+)(?:\s+de\s+(\d{4}))?$/iu,
    lang: "pt",
    order: "dm",
  },
  {
    re: /^what\s+day(?:\s+of\s+the\s+week)?\s+(?:is|was|will\s+be|does)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+of\s+([a-z]+)(?:,?\s+(\d{4}))?(?:\s+fall\s+on)?$/i,
    lang: "en",
    order: "dm",
  },
  {
    re: /^what\s+day(?:\s+of\s+the\s+week)?\s+(?:is|was|will\s+be|does)\s+([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?:\s+fall\s+on)?$/i,
    lang: "en",
    order: "md-or-dm",
  },
];

function stripAccents(w: string): string {
  return w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** «qué día cae el 25 de diciembre» → { year, month, day } o null. */
export function weekdayAction(t: string, now: Date): ToolAction | null {
  const q = t.replace(/^[¿\s]+|[?\s.]+$/g, "");
  for (const { re, lang, order } of WEEKDAY_RULES) {
    const m = re.exec(q);
    if (!m) continue;
    const dayRaw = order === "dm" ? m[1] : m[2];
    const monthRaw = order === "dm" ? m[2] : m[1];
    const month = MONTH_LOOKUP[stripAccents(monthRaw)] ?? MONTH_LOOKUP[monthRaw.toLowerCase()];
    const day = Number(dayRaw);
    if (!month || !day) return null;
    let year = m[3] ? Number(m[3]) : now.getFullYear();
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day > daysInMonth && !(month === 2 && day === 29 && !m[3])) return null;
    if (!m[3]) {
      // Sin año: la próxima vez que llegue esa fecha (hoy cuenta).
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      while (new Date(year, month - 1, day) < today || new Date(year, month, 0).getDate() < day) year += 1;
    }
    return { kind: "weekday", year, month, day, lang };
  }
  return null;
}

// ---------------------------------------------------------------- notas

const NOTE_SAVE_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  {
    re: new RegExp(
      // 0.1.42 (barrido): «apúntame» con tilde; «anota en tu memoria…» es
      // memoria (rememberRouter), no una nota.
      `^${POLITE}(?!(?:anota|apunta|guarda)(?:lo)?\\s+en\\s+(?:tu|la)\\s+memoria)(?:an[oó]ta(?:me)?|ap[uú]nta(?:me)?|toma nota|guarda una nota|crea una nota|haz una nota|escribe una nota|agrega una nota|a[ñn]ade una nota)(?:\\s+(?:que diga|diciendo|que|de|con)|:)?\\s+(.+)$`,
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
    re: /^(?:(?:mu[eé]strame|lista|listar|ver|dame|ens[eé][ñn]ame)\s+)?(?:mis|los|todos los|todos mis)\s+recordatorios(?: pendientes)?$|^(?:qu[eé]|cu[aá]les)\s+recordatorios\s+(?:tengo|hay)(?: pendientes)?$|^cu[aá]les son mis recordatorios$|^recordatorios$|^lista de recordatorios$|^tengo alg[uú]n recordatorio$|^qu[eé] tengo pendiente$|^qu[eé] (?:me )?(?:queda|falta) pendiente$|^qu[eé] hay pendiente$/i,
    lang: "es",
  },
  {
    re: /^(?:(?:show|list|see)(?: me)?\s+)?(?:my|all|all my)\s+reminders$|^what reminders do i have$|^do i have any reminders$|^what'?s pending$|^what do i have pending$/i,
    lang: "en",
  },
  {
    re: /^(?:(?:mostra|mostre|lista|listar|ver)\s+)?(?:meus|os|todos os)\s+lembretes$|^(?:que|quais)\s+lembretes\s+(?:eu\s+)?tenho$|^tenho algum lembrete$|^o que (?:eu )?tenho pendente$|^o que (?:tem|h[aá]) pendente$/i,
    lang: "pt",
  },
];

const NOTE_READ_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:lee|leer|l[eé]eme|abre|mu[eé]strame|qu[eé] dice)\s+(?:la|mi)\s+nota\s+(?:de\s+|del\s+|sobre\s+|llamada\s+|que se llama\s+)?(.+)$/i, lang: "es" },
  { re: /^(?:read|open|show(?: me)?)\s+(?:the|my)\s+note\s+(?:about\s+|called\s+|named\s+|on\s+|for\s+)?(.+)$/i, lang: "en" },
  // 0.1.34: «read the shopping note» (el título delante de «note»).
  { re: /^(?:read|open|show(?: me)?)\s+(?:the|my)\s+(.+?)\s+note$/i, lang: "en" },
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
// 0.1.41 (prueba física): «cuantos grades fahrenheit son 30 grados» (con
// la errata «grades») no casaba, caía al modelo y éste contestó al revés
// («30 °F son 86 °C»). El prefijo admite las erratas habituales.
const UNIT = "((?:grad[oe]s? |degrees? |graus? )?[a-záéíóúâêôãõçñº°µ]+)";
// 0.1.19 (sonda de routing): la forma de PREGUNTA no llegaba — "cuántos
// pies son 2 metros" pone la unidad destino delante (reglas inv) y "cuánto
// es 70 kg en libras" no estaba entre los prefijos. La forma imperativa
// ("pasa 5 km a millas") sí funcionaba, así que el éxito en tablet
// dependía de cómo lo pidiera el usuario (o del modelo).
const CONVERT_RULES: Array<{ re: RegExp; lang: RouterLang; inv?: boolean }> = [
  { re: new RegExp(`^(?:convierte|pasa|cu[aá]nto(?:s|as)? son|cu[aá]nto es)?\\s*${NUM}\\s*${UNIT}\\s+(?:a|en)\\s+${UNIT}$`, "i"), lang: "es" },
  { re: new RegExp(`^(?:convert|how much is|what is)?\\s*${NUM}\\s*${UNIT}\\s+(?:to|in|into)\\s+${UNIT}$`, "i"), lang: "en" },
  { re: new RegExp(`^(?:converte|converta|quanto(?:s|as)? s[aã]o)?\\s*${NUM}\\s*${UNIT}\\s+(?:para|em)\\s+${UNIT}$`, "i"), lang: "pt" },
  // 0.1.30: también femenino («cuántas millas son 10 km»).
  { re: new RegExp(`^cu[aá]nt(?:o|a|os|as)\\s+${UNIT}\\s+(?:son|hay(?:\\s+en)?)\\s+${NUM}\\s+${UNIT}$`, "i"), lang: "es", inv: true },
  { re: new RegExp(`^how many\\s+${UNIT}\\s+(?:are|is)(?:\\s+in)?\\s+${NUM}\\s+${UNIT}$`, "i"), lang: "en", inv: true },
  { re: new RegExp(`^quant(?:o|a|os|as)\\s+${UNIT}\\s+s[aã]o\\s+${NUM}\\s+${UNIT}$`, "i"), lang: "pt", inv: true },
];

function unitWord(raw: string): string {
  // "grados celsius" → "celsius"; "°F" → "f".
  const w = raw.trim().toLowerCase().replace(/^(?:grad[oe]s?|degrees?|graus?)\s+/, "").replace(/[º°]/g, "");
  // «grades»/«grado» solos son la misma unidad que «grados».
  return /^grad[oe]s?$/.test(w) ? "grados" : w;
}

// ----------------------------------------------------------- calendario

// 0.1.31: «desta semana» (pt) — «minha agenda desta semana» caía al modelo.
const DAY_RE = "(hoy|ma[ñn]ana|esta semana|today|tomorrow|this week|hoje|amanh[aã]|esta semana|desta semana|nesta semana)";
const CAL_LIST_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  // 0.1.34 (barrido de paridad): «qué tengo en el calendario hoy» y «o que
  // tenho na agenda hoje» caían al modelo; el inglés sí casaba.
  { re: new RegExp(`^(?:qu[eé] tengo|qu[eé] hay en (?:mi|la) agenda|mi agenda|mis (?:eventos|citas)|mi calendario)(?: en (?:el|mi|la) (?:calendario|agenda))?(?: (?:de|para))? ${DAY_RE}(?: en (?:mi|la|el) (?:agenda|calendario))?$`, "i"), lang: "es" },
  { re: /^(?:mi agenda|mis eventos|mis citas|mi calendario)$/i, lang: "es" },
  { re: new RegExp(`^(?:what do i have|what'?s on my (?:calendar|agenda|schedule)|my (?:calendar|agenda|events|schedule))(?: for)? ${DAY_RE}$`, "i"), lang: "en" },
  { re: /^(?:my calendar|my agenda|my events|my schedule)$/i, lang: "en" },
  { re: new RegExp(`^(?:o que (?:eu )?tenho|minha agenda|meus (?:eventos|compromissos))(?: (?:na (?:minha )?agenda|no (?:meu )?calend[aá]rio))?(?: (?:de|para|para a))? ${DAY_RE}$`, "i"), lang: "pt" },
  { re: /^(?:minha agenda|meus eventos|meus compromissos)$/i, lang: "pt" },
];

const CAL_CREATE_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: new RegExp(`^${POLITE}(?:ag[eé]ndame|agenda|crea(?: un)? evento|crea una cita|a[ñn]ade (?:un |una )?(?:evento|cita)|agrega (?:un |una )?(?:evento|cita)|pon en (?:mi |el )?calendario)(?: (?:al|en (?:mi|el)) calendario)?(?::)?\\s+(.+)$`, "is"), lang: "es" },
  // 0.1.35 (barrido de paridad): «agrega una reunión el lunes a las 9» y
  // «adiciona uma reunião segunda às 9» (el inglés ya casaba).
  { re: new RegExp(`^${POLITE}(?:agrega|a[ñn]ade|pon|crea)\\s+(?:una?\\s+)?((?:reuni[oó]n|cita|llamada|junta)\\s+.+)$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}(?:adiciona|adicione|cria|crie|coloca)\\s+(?:uma\\s+|um\\s+)?((?:reuni[aã]o|consulta|encontro|compromisso)\\s+.+)$`, "is"), lang: "pt" },
  { re: new RegExp(`^${POLITE}(?:schedule|create an event|add (?:an? )?(?:event|appointment)(?: to my calendar)?|put on my calendar)(?::)?\\s+(.+)$`, "is"), lang: "en" },
  // 0.1.31: «add a meeting on monday at 9» / «marca reunião segunda às 9»
  // caían al conocimiento. El título conserva la palabra (meeting/reunião).
  { re: new RegExp(`^${POLITE}add\\s+(?:a|an)\\s+((?:meeting|call|appointment|event)\\s+.+)$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}(?:marca|marque|agenda)\\s+(?:uma\\s+|um\\s+)?((?:reuni[aã]o|consulta|encontro|compromisso)\\s+.+)$`, "is"), lang: "pt" },
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
  // 0.1.31 (auditoría del loop): la forma que la PROPIA app enseña cuando
  // falta el texto («Dímelo así: manda por nido a Ana que …») caía al
  // modelo y respondía «No supe qué acción hacer». También «envía por nido
  // a Ana: …» y «mándale a Ana por nido que …».
  { re: new RegExp(`^${POLITE}(?:m[aá]nda(?:le)?|env[ií]a(?:le)?|escr[ií]bele)\\s+(?:por|v[ií]a|con)\\s+nido\\s+(?:a|para)\\s+(.+?)(?:${SEP}(.+))?$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}(?:m[aá]nda(?:le)?|env[ií]a(?:le)?|escr[ií]bele)\\s+(?:a|para)\\s+(.+?)\\s+(?:por|v[ií]a|con)\\s+nido(?:${SEP}(.+))?$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}(?:m[aá]nda(?:le)?|env[ií]a(?:le)?|escr[ií]bele)\\s+(?:un\\s+)?mensaje\\s+(?:por|con|en|v[ií]a)\\s+nido\\s+(?:a|para)\\s+(.+?)(?:${SEP}(.+))?$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}(?:m[aá]nda(?:le)?|env[ií]a(?:le)?)\\s+(?:a|para)\\s+(.+?)\\s+(?:un\\s+)?mensaje\\s+(?:por|con|en|v[ií]a)\\s+nido(?:${SEP}(.+))?$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}d[ií]le\\s+a\\s+(.+?)\\s+(?:por|v[ií]a)\\s+nido(?:${SEP}|\\s+)(.+)$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}send\\s+(?:a\\s+)?nido\\s+message\\s+to\\s+(.+?)(?:${SEP}(.+))?$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}(?:send|message)\\s+(.+?)\\s+(?:on|via|through|by)\\s+nido(?:${SEP}(.+))?$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}(?:manda|mande|envia|envie)\\s+(?:uma\\s+)?mensagem\\s+(?:pelo|no|via)\\s+nido\\s+(?:para|pra|pro)\\s+(?:o\\s+|a\\s+)?(.+?)(?:${SEP}(.+))?$`, "is"), lang: "pt" },
  // 0.1.32 (paridad es/en/pt): las formas con marca que solo tenía un idioma.
  { re: new RegExp(`^${POLITE}(?:manda|mande|envia|envie|escreve|escreva)\\s+(?:pelo|via)\\s+nido\\s+(?:para|pra|pro)\\s+(?:o\\s+|a\\s+)?(.+?)(?:${SEP}(.+))?$`, "is"), lang: "pt" },
  { re: new RegExp(`^${POLITE}(?:send|write)\\s+(?:on|via|through|by)\\s+nido\\s+to\\s+(.+?)(?:${SEP}(.+))?$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}send\\s+(.+?)\\s+(?:a\\s+)?nido\\s+message(?:${SEP}(.+))?$`, "is"), lang: "en" },
  // 0.1.20 (P3-12): sin la marca «por NIDO». NIDO es el ÚNICO canal de
  // mensajería del agente (llamar y buscar contactos ya resuelven por
  // nombre sin pedir el canal), así que «manda un mensaje a Juan» es
  // este envío. La seguridad no cambia: nido_send_message es
  // irreversible y CONFIRMA antes de enviar, y si el nombre no es un
  // contacto NIDO emparejado el handler falla con honestidad.
  { re: new RegExp(`^${POLITE}(?:m[aá]nda(?:le)?|env[ií]a(?:le)?|escr[ií]bele)\\s+(?:un\\s+)?mensaje\\s+(?:a|para)\\s+(.+?)(?:${SEP}(.+))?$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}(?:m[aá]nda(?:le)?|env[ií]a(?:le)?)\\s+(?:a|para)\\s+(.+?)\\s+(?:un\\s+)?mensaje(?:${SEP}(.+))?$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}d[ií]le\\s+a\\s+(.+?)(?:${SEP}|\\s+)(.+)$`, "is"), lang: "es" },
  // 0.1.32 (paridad): «escríbele a Ana que…», «write to Ana that…»,
  // «diz/fala/escreve para a Ana que…» — antes solo «dile a» tenía forma corta.
  { re: new RegExp(`^${POLITE}escr[ií]bele\\s+a\\s+(.+?)(?:${SEP})(.+)$`, "is"), lang: "es" },
  { re: new RegExp(`^${POLITE}write\\s+to\\s+(.+?)(?:${SEP})(.+)$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}(?:diz|diga|fala|fale|escreve|escreva)\\s+(?:para|pra|pro|à|ao)\\s+(?:o\\s+|a\\s+)?(.+?)(?:${SEP})(.+)$`, "is"), lang: "pt" },
  { re: new RegExp(`^${POLITE}send\\s+(?:a\\s+)?message\\s+to\\s+(.+?)(?:${SEP}(.+))?$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}send\\s+(.+?)\\s+(?:a\\s+)?message(?:${SEP}(.+))?$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}message\\s+(.+?)(?:${SEP}(.+))?$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}tell\\s+(.+?)(?:${SEP})(.+)$`, "is"), lang: "en" },
  { re: new RegExp(`^${POLITE}(?:manda|mande|envia|envie)\\s+(?:uma\\s+)?mensagem\\s+(?:para|pra|pro)\\s+(?:o\\s+|a\\s+)?(.+?)(?:${SEP}(.+))?$`, "is"), lang: "pt" },
  { re: new RegExp(`^${POLITE}(?:manda|mande|envia|envie)\\s+(?:para|pra|pro)\\s+(?:o\\s+|a\\s+)?(.+?)\\s+(?:uma\\s+)?mensagem(?:${SEP}(.+))?$`, "is"), lang: "pt" },
];

const NIDO_INBOX_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(?:(?:lee|leer|l[eé]eme|revisa|mu[eé]strame|ver|abre)\s+)?(?:mis\s+)?mensajes(?:\s+(?:de\s+)?nido)?(?:\s+nuevos)?$|^(?:tengo|hay)\s+mensajes(?:\s+nuevos)?(?:\s+de\s+nido)?$|^(?:mi\s+)?bandeja(?:\s+de\s+entrada)?(?:\s+de\s+nido)?$/i, lang: "es" },
  { re: /^(?:(?:read|check|show(?: me)?|open)\s+)?my\s+(?:nido\s+)?(?:messages|inbox)$|^do i have (?:any )?(?:new )?messages$/i, lang: "en" },
  { re: /^(?:(?:l[eê]|ler|leia|ver|mostra|mostre|abre)\s+)?(?:minhas\s+)?mensagens(?:\s+(?:do\s+)?nido)?$|^tenho\s+mensagens(?:\s+novas)?$/i, lang: "pt" },
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
  // 0.1.30: también un dominio sin esquema («abre youtube.com»), que se
  // abre como https://. El diálogo de confirmación sigue mostrando la
  // dirección completa antes de abrir. Un nombre de archivo («notas.pdf»)
  // no cuenta como dominio.
  { re: /^(?:abre|abrir|abre el enlace|abre la p[aá]gina|ve a)\s+((?:https?:\/\/\S+|www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?!(?:pdf|txt|csv|docx?|xlsx?|pptx?|jpe?g|png|gif|mp[34]|json|md|zip|apk)(?:\/|$))[a-z]{2,}(?:\/\S*)?))$/i, lang: "es" },
  { re: /^(?:open|open the link|go to|visit)\s+((?:https?:\/\/\S+|www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?!(?:pdf|txt|csv|docx?|xlsx?|pptx?|jpe?g|png|gif|mp[34]|json|md|zip|apk)(?:\/|$))[a-z]{2,}(?:\/\S*)?))$/i, lang: "en" },
  { re: /^(?:abra|abrir|abre o link|v[aá] para)\s+((?:https?:\/\/\S+|www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?!(?:pdf|txt|csv|docx?|xlsx?|pptx?|jpe?g|png|gif|mp[34]|json|md|zip|apk)(?:\/|$))[a-z]{2,}(?:\/\S*)?))$/i, lang: "pt" },
];

const PICK_FILE_RE: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^(lee|leer|abre|abrir|analiza|analizar|revisa|elige|escoge|selecciona)\s+(?:un|el|este|mi|una)\s+(?:archivo|documento|csv|excel|tabla)$/i, lang: "es" },
  { re: /^(read|open|analy[sz]e|check|pick|choose|select)\s+(?:a|the|this|my)\s+(?:file|document|csv|spreadsheet|table)$/i, lang: "en" },
  { re: /^(l[eê]|ler|leia|abre|abra|abrir|analisa|analise|analisar|escolha|escolhe|seleciona|selecione)\s+(?:um|o|este|meu|uma)\s+(?:arquivo|documento|csv|planilha|tabela)$/i, lang: "pt" },
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

const DELETE_VERB_ES = "(?:borra|borrar|elimina|eliminar|quita|quitar)";
const DELETE_VERB_ES_C = "(?:borra|borrar|elimina|eliminar|cancela|cancelar|quita|quitar)";
const DELETE_VERB_EN = "(?:delete|remove)";
const DELETE_VERB_EN_C = "(?:delete|remove|cancel)";
const DELETE_VERB_PT = "(?:apaga|apague|exclui|exclua|remove|remova)";
const DELETE_VERB_PT_C = "(?:apaga|apague|exclui|exclua|remove|remova|cancela|cancele)";

/**
 * 0.1.20 (P3-9): borrados por chat. La auditoría de routing confirmó
 * que no existía NINGUNA ruta para borrar («borra la nota del súper»
 * caía al modelo, que no tiene con qué). Las reglas exigen el sustantivo
 * (nota/recordatorio): «borra el mensaje» o «cancela el evento» no son
 * de esta ruta. El borrado real pasa siempre por el dispatcher con la
 * política irreversible (confirmación que nombra el ítem).
 */
function extractDeleteAction(t: string): ToolAction | null {
  type Rule = { re: RegExp; lang: RouterLang };
  const allRules: Array<{ re: RegExp; action: ToolAction }> = [
    { re: new RegExp(`^${POLITE}${DELETE_VERB_ES_C}\\s+(?:todos\\s+|todas\\s+)?(?:mis|los|las)\\s+recordatorios$`, "i"), action: { kind: "reminderDelete", target: { type: "all" }, lang: "es" } },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_ES}\\s+(?:todas\\s+)?(?:mis|las)\\s+notas$`, "i"), action: { kind: "noteDelete", target: { type: "all" }, lang: "es" } },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN_C}\\s+(?:all\\s+)?my\\s+reminders$`, "i"), action: { kind: "reminderDelete", target: { type: "all" }, lang: "en" } },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN}\\s+(?:all\\s+)?my\\s+notes$`, "i"), action: { kind: "noteDelete", target: { type: "all" }, lang: "en" } },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_PT_C}\\s+(?:todos\\s+)?(?:os\\s+)?meus\\s+lembretes$`, "i"), action: { kind: "reminderDelete", target: { type: "all" }, lang: "pt" } },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_PT}\\s+(?:todas\\s+)?(?:as\\s+)?minhas\\s+notas$`, "i"), action: { kind: "noteDelete", target: { type: "all" }, lang: "pt" } },
  ];
  for (const { re, action } of allRules) if (re.test(t)) return action;

  const bareRemSing: Rule[] = [
    { re: new RegExp(`^${POLITE}${DELETE_VERB_ES_C}\\s+(?:el|mi)?\\s*recordatorio$`, "i"), lang: "es" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN_C}\\s+(?:the|my)?\\s*reminder$`, "i"), lang: "en" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_PT_C}\\s+(?:o|meu)?\\s*lembrete$`, "i"), lang: "pt" },
  ];
  const bareRemPlur: Rule[] = [
    { re: new RegExp(`^${POLITE}${DELETE_VERB_ES_C}\\s+(?:los|mis)\\s+recordatorios$`, "i"), lang: "es" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN_C}\\s+(?:the|my)?\\s*reminders$`, "i"), lang: "en" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_PT_C}\\s+(?:os|meus)?\\s*lembretes$`, "i"), lang: "pt" },
  ];
  const titleRem: Rule[] = [
    { re: new RegExp(`^${POLITE}${DELETE_VERB_ES_C}\\s+(?:el|la|mi)?\\s*recordatorio\\s+(?:de|del|para|sobre)\\s+(.+)$`, "i"), lang: "es" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN_C}\\s+(?:the|my)\\s+reminder\\s+(?:to|about|for)\\s+(.+)$`, "i"), lang: "en" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_PT_C}\\s+(?:o|meu)\\s+lembrete\\s+(?:de|do|da|para|sobre)\\s+(.+)$`, "i"), lang: "pt" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_ES_C}\\s+(?:el|mi)\\s+recordatorio\\s+(.+)$`, "i"), lang: "es" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN_C}\\s+(?:the|my)\\s+reminder\\s+(.+)$`, "i"), lang: "en" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_PT_C}\\s+(?:o|meu)\\s+lembrete\\s+(.+)$`, "i"), lang: "pt" },
    // 0.1.24 (auditoría de alcanzabilidad, H-2): el inglés pone el
    // adjetivo ANTES del sustantivo — «delete the dentist reminder».
    // Sin esta regla la forma natural no casaba ninguna y el turno se
    // desviaba a conocimiento sin ni siquiera pedir confirmación.
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN_C}\\s+(?:the|my)\\s+(.+?)\\s+reminder$`, "i"), lang: "en" },
  ];
  const titleNote: Rule[] = [
    { re: new RegExp(`^${POLITE}${DELETE_VERB_ES}\\s+(?:la|mi)?\\s*nota\\s+(?:de|del|sobre|llamada)\\s+(.+)$`, "i"), lang: "es" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN}\\s+(?:the|my)\\s+note\\s+(?:about|called|named|on|for)\\s+(.+)$`, "i"), lang: "en" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_PT}\\s+(?:a|minha)\\s+nota\\s+(?:de|do|da|sobre|chamada)\\s+(.+)$`, "i"), lang: "pt" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_ES}\\s+(?:la|mi)\\s+nota\\s+(.+)$`, "i"), lang: "es" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN}\\s+(?:the|my)\\s+note\\s+(.+)$`, "i"), lang: "en" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_PT}\\s+(?:a|minha)\\s+nota\\s+(.+)$`, "i"), lang: "pt" },
    // 0.1.24 (H-2): «delete the birthday note» — adjetivo antes de
    // «note», la forma natural en inglés (ver titleRem).
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN}\\s+(?:the|my)\\s+(.+?)\\s+note$`, "i"), lang: "en" },
  ];
  const bareNote: Rule[] = [
    { re: new RegExp(`^${POLITE}${DELETE_VERB_ES}\\s+(?:la|mi)?\\s*nota$`, "i"), lang: "es" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_EN}\\s+(?:the|my)\\s+note$`, "i"), lang: "en" },
    { re: new RegExp(`^${POLITE}${DELETE_VERB_PT}\\s+(?:a|minha)?\\s*nota$`, "i"), lang: "pt" },
  ];

  const titleOf = (rules: Rule[], text: string): { q: string; lang: RouterLang } | null => {
    for (const { re, lang } of rules) {
      const m = re.exec(text);
      if (m && m[1].trim().length >= 2) {
        // «la nota de la receta»: la captura trae el artículo de la
        // segunda mención; fuera, o no casa con el título guardado.
        const q = m[1].trim().replace(/^(?:el|la|los|las|the|a|o|um|uma)\s+/i, "");
        if (q.length >= 2) return { q, lang };
      }
    }
    return null;
  };
  const bareOf = (rules: Rule[], text: string): RouterLang | null => {
    for (const { re, lang } of rules) if (re.test(text)) return lang;
    return null;
  };

  // Con alcance de día: «cancela el recordatorio de mañana».
  const scoped = splitReminderScope(t);
  if (scoped.range) {
    const sing = bareOf(bareRemSing, scoped.text);
    if (sing) return { kind: "reminderDelete", target: { type: "ask" }, range: scoped.range, lang: sing };
    const plur = bareOf(bareRemPlur, scoped.text);
    if (plur) return { kind: "reminderDelete", target: { type: "all" }, range: scoped.range, lang: plur };
    const tt = titleOf(titleRem, scoped.text);
    if (tt) return { kind: "reminderDelete", target: { type: "one", query: tt.q }, lang: tt.lang };
  }

  const tr = titleOf(titleRem, t);
  if (tr) return { kind: "reminderDelete", target: { type: "one", query: tr.q }, lang: tr.lang };
  const tn = titleOf(titleNote, t);
  if (tn) return { kind: "noteDelete", target: { type: "one", query: tn.q }, lang: tn.lang };

  const bn = bareOf(bareNote, t);
  if (bn) return { kind: "noteDelete", target: { type: "ask" }, lang: bn };
  const bs = bareOf(bareRemSing, t);
  if (bs) return { kind: "reminderDelete", target: { type: "ask" }, lang: bs };
  const bp = bareOf(bareRemPlur, t);
  if (bp) return { kind: "reminderDelete", target: { type: "all" }, lang: bp };
  return null;
}

// 0.1.33: estas tablas vivían DENTRO de extractToolAction y se volvían a
// construir (con la interpolación de CUR_SRC) en cada mensaje.
const NOTE_SEARCH_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  { re: /^busca(?:r)?\s+(.+?)\s+en\s+(?:mis\s+|tus\s+)?notas$/i, lang: "es" },
  { re: /^busca(?:r)?\s+(?:en\s+)?(?:mis\s+|las\s+)?notas?\s+(?:sobre\s+|de\s+|la\s+|el\s+)?(.+)$/i, lang: "es" },
  { re: /^encuentra\s+(?:en\s+)?(?:mis\s+)?notas?\s+(?:sobre\s+|de\s+)?(.+)$/i, lang: "es" },
  { re: /^search\s+(.+?)\s+in\s+(?:my\s+)?notes$/i, lang: "en" },
  { re: /^search\s+(?:my\s+)?notes?\s+(?:for\s+|about\s+)?(.+)$/i, lang: "en" },
  { re: /^find\s+(.+?)\s+in\s+(?:my\s+)?notes$/i, lang: "en" },
  { re: /^find\s+(?:in\s+)?(?:my\s+)?notes?\s+(?:about\s+|for\s+)?(.+)$/i, lang: "en" },
  { re: /^procur(?:a|e|ar)\s+(.+?)\s+nas\s+(?:minhas\s+)?notas$/i, lang: "pt" },
  { re: /^procur(?:a|e|ar)\s+(?:nas\s+)?(?:minhas\s+)?notas?\s+(?:sobre\s+|por\s+)?(.+)$/i, lang: "pt" },
  { re: /^busc(?:a|e|ar)\s+(?:nas\s+)?(?:minhas\s+)?notas?\s+(?:sobre\s+)?(.+)$/i, lang: "pt" },
];
const CUR_SRC = "pesos?|d[oó]lar(?:es)?|dollars?|euros?|reales|reais|libras?|pounds?|yenes?|yens?|francos?|francs?|soles|quetzales|bol[ií]vares|usd|mxn|eur|brl|gbp|jpy|cad|chf";
const CURRENCY_RULES: Array<{ re: RegExp; lang: RouterLang }> = [
  // Dos monedas con verbo entre ellas, o el precio de UNA moneda
  // («¿cuánto vale un dólar?»): «¿cuántos pesos son 5 kilos?» no entra.
  { re: new RegExp(`\\bcu[aá]nt[oa]s?\\b[^.?!]{0,40}\\b(?:${CUR_SRC})\\b[^.?!]{0,30}\\b(?:son|es|vale|valen|equivale)\\b[^.?!]{0,40}\\b(?:${CUR_SRC})\\b`, "i"), lang: "es" },
  { re: new RegExp(`\\bcu[aá]nt[oa]s?\\b[^.?!]{0,30}\\b(?:vale|valen|cuesta)\\b[^.?!]{0,30}\\b(?:${CUR_SRC})\\b`, "i"), lang: "es" },
  { re: new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*(?:${CUR_SRC})\\s+(?:en|a)\\s+(?:${CUR_SRC})\\b`, "i"), lang: "es" },
  { re: new RegExp(`\\b(?:convierte|convertir|cambi[ao]r?)\\b[^.?!]{0,40}\\b(?:${CUR_SRC})\\b`, "i"), lang: "es" },
  { re: /\b(?:tipo de cambio|cotizaci[oó]n del)\b/i, lang: "es" },
  { re: new RegExp(`\\bhow\\s+(?:much|many)\\b[^.?!]{0,60}\\b(?:${CUR_SRC})\\b`, "i"), lang: "en" },
  { re: new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*(?:${CUR_SRC})\\s+(?:in|to)\\s+(?:${CUR_SRC})\\b`, "i"), lang: "en" },
  { re: new RegExp(`\\bconvert\\b[^.?!]{0,40}\\b(?:${CUR_SRC})\\b`, "i"), lang: "en" },
  { re: /\bexchange rate\b/i, lang: "en" },
  { re: new RegExp(`\\bquant[oa]s?\\b[^.?!]{0,60}\\b(?:${CUR_SRC})\\b`, "i"), lang: "pt" },
  { re: new RegExp(`\\b\\d+(?:[.,]\\d+)?\\s*(?:${CUR_SRC})\\s+(?:em|para)\\s+(?:${CUR_SRC})\\b`, "i"), lang: "pt" },
  { re: new RegExp(`\\b(?:converter|converta|trocar)\\b[^.?!]{0,40}\\b(?:${CUR_SRC})\\b`, "i"), lang: "pt" },
  { re: /\btaxa de c[aâ]mbio\b/i, lang: "pt" },
];

/**
 * Detecta una petición explícita para una de las herramientas cubiertas.
 * null si no hay patrón claro (el flujo normal sigue igual).
 */
export function extractToolAction(userText: string, now: Date = new Date()): ToolAction | null {
  const t = clean(userText ?? "");
  if (!t || t.length > 600) return null;

  for (const { re, what, lang } of TIME_RULES) if (re.test(t)) return { kind: "time", what, lang };
  const weekday = weekdayAction(t, now);
  if (weekday) return weekday;

  // 0.1.31 (auditoría del loop): «cancela el temporizador» caía al
  // conocimiento y el modelo podía decir que lo había cancelado sin hacer
  // nada. Un temporizador es un recordatorio llamado «Temporizador»/«Timer»:
  // se cancela por la ruta de borrado (con su confirmación y su «¿cuál?»).
  const offer = offerCreateAction(t, now);
  if (offer) return offer;
  for (const { re, lang } of COUNTDOWN_RULES) {
    const m = re.exec(t);
    if (!m) continue;
    const c = countdownTarget(m[1], now, lang);
    if (c) return { kind: "countdown", target: c.target.toISOString(), label: c.label, lang };
  }
  for (const { re, lang } of LENIENT_COUNTDOWN_RULES) {
    const m = re.exec(t);
    if (!m) continue;
    const c = namedDayTarget(m[1], now, lang);
    if (c) return { kind: "countdown", target: c.target.toISOString(), label: c.label, lang };
  }
  for (const { re, q, lang } of TIMER_CANCEL_RULES) if (re.test(t)) return { kind: "reminderDelete", target: { type: "one", query: q }, lang };
  // «olvida mi color favorito»: el agente no borra memoria por sí solo. Antes
  // caía al modelo, que podía responder «listo, lo olvidé» sin borrar nada.
  // Respuesta honesta: dónde se borra.
  for (const { re, lang } of MEMORY_FORGET_RULES) if (re.test(t)) return { kind: "memoryForgetHelp", lang };

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
  // 0.1.20 (P3-10): buscar DENTRO de las notas. Listar y abrir ya
  // existían; «busca en mis notas la receta» caía al modelo, que no
  // puede buscar en una base que no ve.
  for (const { re, lang } of NOTE_SEARCH_RULES) {
    const m = re.exec(t);
    if (m && m[1].trim().length >= 2) {
      // «busca la receta en mis notas»: el artículo inicial no es
      // parte de lo buscado.
      // 0.1.24: tampoco el relleno «algo sobre…» / «something
      // about…» / «alguma coisa sobre…» — con él dentro, la consulta
      // multitérmino exigía «algo» y «sobre» en la nota y no
      // encontraba nada (lo cazó el test de composición de H-10).
      const q = m[1]
        .trim()
        .replace(/^(?:algo\s+(?:sobre|de)|something\s+about|alguma\s+coisa\s+(?:sobre|de))\s+/i, "")
        .replace(/^(?:la|el|los|las|the|a|o|um|uma)\s+/i, "");
      if (q.length >= 2) return { kind: "noteSearch", query: q, lang };
    }
  }
  // 0.1.20 (P3-9): borrados (tras guardar/leer notas, antes de convertir).
  const deleteAction = extractDeleteAction(t);
  if (deleteAction) return deleteAction;
  // 0.1.20 (P3-15): moneda. Las conversiones de unidades excluyen la
  // moneda A PROPÓSITO, pero sin ruta la pregunta caía al modelo y el
  // modelo INVENTABA un tipo de cambio. Aquí la respuesta honesta es
  // determinista: sin conexión no hay tasas, y no se inventan.
  // «libras» es moneda y también peso: si la frase ES una conversión
  // de unidades válida («convierte 3,5 kilos a libras»), manda la
  // conversión. Se replica la validación del bucle de abajo sin su
  // «return null» (esa salida mataría preguntas de moneda con la misma
  // forma: «cuántos dólares son 100 pesos»).
  let isConversion = false;
  for (const { re, inv } of CONVERT_RULES) {
    const m = re.exec(t);
    if (!m) continue;
    const value = Number((inv ? m[2] : m[1]).replace(",", "."));
    try {
      convertUnits(value, unitWord(inv ? m[3] : m[2]), unitWord(inv ? m[1] : m[3]));
      isConversion = true;
    } catch {
      /* forma de conversión, unidades no: puede ser moneda */
    }
    break;
  }
  if (!isConversion) {
    for (const { re, lang } of CURRENCY_RULES) {
      if (re.test(t)) return { kind: "currencyInfo", lang };
    }
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
    // 0.1.24 (auditoría de alcanzabilidad, H-5): la marca de canal al
    // FINAL («manda un mensaje a Juan por nido: …») no tiene regla
    // con marca y la captura sin marca se la tragaba: el destinatario
    // salía «Juan por nido» y el mensaje no llegaba a nadie. Se pela
    // la marca trailing de cualquier captura, en los tres idiomas.
    const to = m[1]
      .trim()
      .replace(/^(?:a|para|to)\s+/i, "")
      .replace(/\s+(?:por|con|en|v[ií]a|on|via|through|by|pelo|no)\s+(?:nido|la app)$/i, "");
    if (!to || to.split(/\s+/).length > 5) return null;
    // 0.1.32: «tell me that…», «diz pra mim que…», «dime que…» hablan
    // CONMIGO: no son un mensaje a un contacto llamado «me».
    if (/^(?:me|m[ií]|mim|myself|us|n[oó]s|nosotros)$/i.test(to)) return null;
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
    const url = /^https?:\/\//i.test(m[1]) ? m[1] : `https://${m[1]}`;
    return { kind: "openLink", url, lang };
  }

  for (const { re, lang } of PICK_FILE_RE) {
    const m = re.exec(t);
    if (!m) continue;
    return { kind: "pickFile", analyze: /^anali[sz]|^analy|^revisa|^check/i.test(m[1]), lang };
  }
  // Al final: solo si nada más casó, la respuesta a «¿qué te recuerdo?».
  return pendingFillAction(t, now);
}

// ------------------------------------------------------------ respuestas

type Key =
  | "timeNow"
  | "dateToday"
  | "weekdayOf"
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
  | "reminderAskWhat"
  | "factReminderYearlyNote"
  | "reminderHowTo"
  | "reminderWillNotify"
  | "reminderSaveFailed"
  | "personSaved"
  | "personDateNote"
  | "selfNameSaved"
  | "noteDeleted"
  | "reminderDeleted"
  | "notesDeletedMany"
  | "remindersDeletedMany"
  | "deletedPartial"
  | "reminderNotFound"
  | "reminderWhich"
  | "deleteWhichNote"
  | "deleteWhichReminder"
  | "noteSearchHeader"
  | "noteSearchNone"
  | "currencyOffline"
  | "memoryForgetHelp"
  | "countdownToday"
  | "countdownOne"
  | "countdownMany"
  | "countdownDateOne"
  | "countdownDateMany"
  | "timerSet"
  | "timerLabel"
  | "factSaved"
  | "factReminderNote";

const MSG: Record<Key, Record<RouterLang, string>> = {
  // 0.1.31: «en mis contactos» hacía pensar en los contactos del teléfono;
  // la persona se guarda en la memoria de NIDO.
  personSaved: {
    es: "Listo, recordaré a {{name}}{{rel}}.",
    en: "Done, I'll remember {{name}}{{rel}}.",
    pt: "Pronto, vou lembrar de {{name}}{{rel}}.",
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
  noteDeleted: {
    es: "Listo, borré la nota «{{title}}».",
    en: "Done, I deleted the note “{{title}}”.",
    pt: "Pronto, apaguei a nota “{{title}}”.",
  },
  reminderDeleted: {
    es: "Listo, borré el recordatorio «{{text}}».",
    en: "Done, I deleted the reminder “{{text}}”.",
    pt: "Pronto, apaguei o lembrete “{{text}}”.",
  },
  notesDeletedMany: {
    es: "Listo, borré {{count}} notas.",
    en: "Done, I deleted {{count}} notes.",
    pt: "Pronto, apaguei {{count}} notas.",
  },
  remindersDeletedMany: {
    es: "Listo, borré {{count}} recordatorios.",
    en: "Done, I deleted {{count}} reminders.",
    pt: "Pronto, apaguei {{count}} lembretes.",
  },
  deletedPartial: {
    es: "Me detuve: borré {{done}} de {{total}}.",
    en: "I stopped: I deleted {{done}} of {{total}}.",
    pt: "Parei: apaguei {{done}} de {{total}}.",
  },
  reminderNotFound: {
    es: "No encontré ningún recordatorio que coincida con «{{q}}».",
    en: "I couldn't find a reminder matching “{{q}}”.",
    pt: "Não encontrei nenhum lembrete correspondente a “{{q}}”.",
  },
  reminderWhich: {
    es: "Hay varios recordatorios que coinciden. ¿Cuál?",
    en: "Several reminders match. Which one?",
    pt: "Vários lembretes correspondem. Qual?",
  },
  deleteWhichNote: {
    es: "¿Cuál nota quieres borrar?",
    en: "Which note do you want to delete?",
    pt: "Qual nota você quer apagar?",
  },
  deleteWhichReminder: {
    es: "¿Cuál recordatorio quieres borrar?",
    en: "Which reminder do you want to delete?",
    pt: "Qual lembrete você quer apagar?",
  },
  noteSearchHeader: {
    es: "Esto encontré en tus notas sobre «{{q}}»:",
    en: "Here's what I found in your notes about “{{q}}”:",
    pt: "Isto é o que encontrei nas suas notas sobre “{{q}}”:",
  },
  noteSearchNone: {
    es: "No encontré nada en tus notas sobre «{{q}}».",
    en: "I didn't find anything in your notes about “{{q}}”.",
    pt: "Não encontrei nada nas suas notas sobre “{{q}}”.",
  },
  countdownToday: { es: "¡Es hoy! ({{label}})", en: "It's today! ({{label}})", pt: "É hoje! ({{label}})" },
  countdownOne: {
    es: "Falta 1 día para {{label}} ({{day}}).",
    en: "1 day until {{label}} ({{day}}).",
    pt: "Falta 1 dia para {{label}} ({{day}}).",
  },
  countdownMany: {
    es: "Faltan {{n}} días para {{label}} ({{day}}).",
    en: "{{n}} days until {{label}} ({{day}}).",
    pt: "Faltam {{n}} dias para {{label}} ({{day}}).",
  },
  countdownDateOne: { es: "Falta 1 día para el {{day}}.", en: "1 day until {{day}}.", pt: "Falta 1 dia para {{day}}." },
  countdownDateMany: { es: "Faltan {{n}} días para el {{day}}.", en: "{{n}} days until {{day}}.", pt: "Faltam {{n}} dias para {{day}}." },
  memoryForgetHelp: {
    es: "No borro recuerdos por mi cuenta. Para olvidar algo, abre el menú → «Mi memoria» y bórralo ahí: verás exactamente qué se elimina.",
    en: "I don't delete memories on my own. To forget something, open the menu → “My Memory” and delete it there: you'll see exactly what gets removed.",
    pt: "Eu não apago lembranças por conta própria. Para esquecer algo, abra o menu → “Minha Memória” e apague por lá: você verá exatamente o que será removido.",
  },
  currencyOffline: {
    es: "Sin conexión no tengo tipos de cambio, así que no te voy a inventar una cifra. Cambian todo el tiempo; cuando tengas internet, consúltalo y te ayudo con la cuenta.",
    en: "Offline I don't have exchange rates, so I won't make up a number for you. They change all the time; when you have internet, look it up and I'll help with the math.",
    pt: "Sem conexão eu não tenho taxas de câmbio, então não vou inventar um número para você. Elas mudam o tempo todo; quando tiver internet, consulte e eu ajudo com a conta.",
  },
  timerSet: {
    es: "Temporizador puesto{{when}}.",
    en: "Timer set{{when}}.",
    pt: "Temporizador definido{{when}}.",
  },
  timerLabel: {
    es: " Para: {{label}}.",
    en: " For: {{label}}.",
    pt: " Para: {{label}}.",
  },
  factSaved: {
    es: "Listo, lo guardé en mi memoria: «{{text}}».",
    en: "Done, I saved it to my memory: “{{text}}”.",
    pt: "Pronto, salvei na minha memória: “{{text}}”.",
  },
  factReminderYearlyNote: {
    es: " También te creé un recordatorio que se repite cada año en esa fecha.",
    en: " I also created a reminder that repeats every year on that date.",
    pt: " Também criei um lembrete que se repete todo ano nessa data.",
  },
  factReminderNote: {
    es: " También te creé un recordatorio para esa fecha.",
    en: " I also created a reminder for that date.",
    pt: " Também criei um lembrete para essa data.",
  },
  timeNow: { es: "Son las {{time}} ({{day}}).", en: "It's {{time}} ({{day}}).", pt: "São {{time}} ({{day}})." },
  dateToday: { es: "Hoy es {{day}} de {{year}}.", en: "Today is {{day}}, {{year}}.", pt: "Hoje é {{day}} de {{year}}." },
  weekdayOf: {
    es: "El {{date}} de {{year}} cae en {{weekday}}.",
    en: "{{date}}, {{year}} falls on a {{weekday}}.",
    pt: "O dia {{date}} de {{year}} cai {{weekday}}.",
  },
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
    es: " Ojo: lo guardé como un recordatorio de una sola vez; puedo repetirlos cada día, semana, mes o año, pero no cada varios días.",
    en: " Note: I saved it as a one-time reminder; I can repeat reminders every day, week, month or year, but not every few days.",
    pt: " Atenção: salvei como um lembrete único; consigo repetir lembretes todo dia, semana, mês ou ano, mas não a cada vários dias.",
  },
  reminderHowTo: {
    es: "Claro. Dime qué y cuándo en una frase, por ejemplo: «recuérdame{{when}} a las 9 llamar al médico».",
    en: "Sure. Tell me what and when in one go, for example: “remind me{{when}} at 9 to call the doctor”.",
    pt: "Claro. Diga o quê e quando numa frase só, por exemplo: “me lembra{{when}} às 9 de ligar para o médico”.",
  },
  reminderAskWhat: {
    es: "¿Qué quieres que te recuerde{{when}}? Respóndeme solo con eso, por ejemplo: «pagar la luz».",
    en: "What should I remind you of{{when}}? Just reply with it, for example: “pay the bill”.",
    pt: "O que você quer que eu te lembre{{when}}? Responda só com isso, por exemplo: “pagar a luz”.",
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

/** 0.1.32: « cada lunes a las 9:00» / « every day at 9:00» / « toda segunda-feira às 9:00». */
export function reminderRepeatWhen(iso: string, repeat: "day" | "week" | "month" | "year", lang: RouterLang): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = formatTime(d, lang);
  const day = DAYS[lang][d.getDay()];
  // 0.1.35: cada mes / cada año.
  if (repeat === "month") {
    const n = d.getDate();
    if (lang === "en") return ` every month on the ${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"} at ${time}`;
    if (lang === "pt") return ` todo mês no dia ${n} às ${time}`;
    return ` cada mes el día ${n} a las ${time}`;
  }
  if (repeat === "year") {
    const m = MONTHS[lang][d.getMonth()];
    if (lang === "en") return ` every year on ${m} ${d.getDate()} at ${time}`;
    if (lang === "pt") return ` todo ano em ${d.getDate()} de ${m} às ${time}`;
    return ` cada año el ${d.getDate()} de ${m} a las ${time}`;
  }
  if (lang === "en") return repeat === "day" ? ` every day at ${time}` : ` every ${day} at ${time}`;
  if (lang === "pt") {
    if (repeat === "day") return ` todos os dias às ${time}`;
    // sábado e domingo são masculinos.
    return ` ${d.getDay() === 0 || d.getDay() === 6 ? "todo" : "toda"} ${day} às ${time}`;
  }
  return repeat === "day" ? ` cada día a las ${time}` : ` cada ${day} a las ${time}`;
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
  /** Notas con cuerpo, para buscar DENTRO de las notas (P3-10). */
  listNotesFull?: () => Promise<Array<{ id: string; title: string; body: string }>>;
  /** Recordatorios pendientes, para "qué recordatorios tengo" y para
   *  resolver los borrados por texto (0.1.20: con id). */
  listReminders?: () => Promise<Array<{ id: string; text: string; dueAt: string | null; repeat?: "day" | "week" | "month" | "year" | null }>>;
  now?: () => Date;
  /**
   * 0.1.25: almacén de la elección pendiente («¿cuál nota?») entre
   * turnos. La app lo crea una vez y lo pasa siempre; sin él (tareas
   * programadas, tests de un turno) la pregunta queda como hoy.
   */
  choiceStore?: ChoiceStore;
}

export interface ToolRouterOutcome {
  response: string;
  toolUses: { name: string; result: string }[];
}

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

// 0.1.24 (auditoría de alcanzabilidad, H-4): leer/buscar/borrar notas
// casaba LITERAL en el título: la nota «cumpleaños de Ana» respondía
// «I couldn't find a note called "birthday"» — un negativo engañoso
// para un dueño bilingüe que guarda en un idioma y pregunta en otro.
// Tabla pequeña y curada de equivalencias ES/EN/PT (formas ya
// normalizadas, palabra única): la consulta se expande a sus
// equivalentes y basta que UNA variante esté en el título/cuerpo. Es
// estrictamente aditiva — el matching literal de hoy no cambia — y no
// pretende ser un diccionario: cubre el vocabulario de notas típico.
const XWORD_GROUPS: string[][] = [
  ["cumpleanos", "birthday", "aniversario"],
  ["flores", "flowers"],
  ["receta", "recipe", "receita"],
  ["compras", "shopping", "groceries"],
  ["viaje", "trip", "viagem"],
  ["dentista", "dentist"],
  ["trabajo", "work", "trabalho"],
  ["regalo", "gift", "presente"],
  ["fiesta", "party", "festa"],
  ["escuela", "school", "escola"],
  ["coche", "car", "carro"],
  ["perro", "dog", "cachorro"],
  ["gato", "cat"],
  ["medicina", "medicine", "remedio"],
  ["leche", "milk", "leite"],
  ["pan", "bread", "pao"],
  ["casa", "house"],
  ["dinero", "money", "dinheiro"],
];

/** La consulta normalizada más sus equivalentes entre idiomas. */
function queryVariants(query: string): string[] {
  const q = norm(query);
  const out = new Set<string>([q]);
  for (const w of q.split(" ")) {
    for (const g of XWORD_GROUPS) {
      if (g.includes(w)) for (const v of g) out.add(v);
    }
  }
  return [...out];
}

// 0.1.25 (hallazgo físico del dueño, Tab A9+ 2026-10-12): cuando leer
// o borrar coincide con varias notas o recordatorios, el router
// pregunta «¿cuál?» — pero la pregunta no guardaba NINGÚN estado: la
// respuesta («cumpleaños», «la primera») arrancaba un turno nuevo,
// caía a conocimiento («El cumpleaños está en tu lista de
// actividades») y la elección se perdía. Ahora la pregunta deja una
// elección pendiente en un almacén que la app pasa entre turnos: el
// turno siguiente la consume por título, por ordinal o la cancela,
// en los tres idiomas.
export interface ChoiceCandidate {
  id: string;
  /** Lo que se muestra en la lista de la pregunta. */
  label: string;
  /** Texto para casar la respuesta del usuario (el título del ítem). */
  match: string;
}
export interface PendingChoice {
  action: "noteRead" | "noteDelete" | "reminderDelete";
  candidates: ChoiceCandidate[];
  lang: RouterLang;
  /** 0.1.37: cuándo se preguntó (caduca a los 3 minutos). */
  at?: number;
}
export interface ChoiceStore {
  current: PendingChoice | null;
}

function stashChoice(
  deps: ToolRouterDeps,
  action: PendingChoice["action"],
  candidates: ChoiceCandidate[],
  lang: RouterLang
): void {
  if (deps.choiceStore) deps.choiceStore.current = { action, candidates, lang, at: Date.now() };
}

const CHOICE_CANCEL_WORDS = new Set([
  "cancelar", "cancela", "cancel", "ninguno", "ninguna", "none", "neither",
  "nenhum", "nenhuma", "deixa", "esquece", "olvidalo", "never",
]);
const CHOICE_ORDINALS: Record<string, number> = {
  primero: 0, primera: 0, primer: 0, first: 0, primeiro: 0, primeira: 0,
  segundo: 1, segunda: 1, second: 1,
  tercero: 2, tercera: 2, tercer: 2, third: 2, terceiro: 2, terceira: 2,
  cuarto: 3, cuarta: 3, fourth: 3, quarto: 3, quarta: 3,
};

export type ChoiceResolution = { type: "pick"; index: number } | { type: "cancel" } | null;

/**
 * Resuelve la respuesta del usuario contra las candidatas de una
 * elección pendiente: cancelación, número u ordinal («2», «la
 * primera», «the first one», «a segunda»), o el título — la igualdad
 * exacta gana sobre las coincidencias parciales, y las parciales
 * usan las mismas equivalencias entre idiomas que la búsqueda.
 */
export function resolveChoiceReply(text: string, candidates: ChoiceCandidate[]): ChoiceResolution {
  const t = norm(text);
  if (!t) return null;
  const tokens = t.split(" ");
  if (tokens.length <= 3 && tokens.some((w) => CHOICE_CANCEL_WORDS.has(w))) return { type: "cancel" };
  // 0.1.37 (auditoría): un mensaje largo solo resuelve por título exacto.
  // Antes cualquier número u ordinal dentro de una orden nueva («pon un
  // temporizador de 2 minutos», «limpiar el cuarto», «na quarta») elegía
  // una nota para borrar.
  if (tokens.length > 3) {
    const exactLong = candidates.findIndex((c) => norm(c.match) === t);
    return exactLong >= 0 ? { type: "pick", index: exactLong } : null;
  }
  for (const w of tokens) {
    if (/^\d+$/.test(w)) {
      const idx = Number(w) - 1;
      if (idx >= 0 && idx < candidates.length) return { type: "pick", index: idx };
    }
    const ord = CHOICE_ORDINALS[w];
    if (ord !== undefined && ord < candidates.length) return { type: "pick", index: ord };
  }
  const exact = candidates.findIndex((c) => norm(c.match) === t);
  if (exact >= 0) return { type: "pick", index: exact };
  const variants = queryVariants(t);
  const hits = candidates.filter((c) => {
    const m = norm(c.match);
    return variants.some((v) => v.length >= 3 && m.includes(v)) || (t.length >= 4 && t.includes(m));
  });
  if (hits.length === 1) return { type: "pick", index: candidates.indexOf(hits[0]) };
  return null;
}

/**
 * ¿Este mensaje es la respuesta a la elección pendiente? «resolve»
 * la consume, «reask» es una respuesta corta que no resuelve (se
 * repite la pregunta), «none» es un mensaje nuevo: la elección
 * caduca y el turno sigue su curso normal.
 */
export function choiceTurnKind(text: string, pending: PendingChoice, now: Date = new Date()): "resolve" | "reask" | "none" {
  // 0.1.37: la elección caduca a los 3 minutos (antes no caducaba nunca).
  if (pending.at !== undefined && (now.getTime() - pending.at > OFFER_WINDOW_MS || now.getTime() < pending.at)) return "none";
  if (resolveChoiceReply(text, pending.candidates)) return "resolve";
  // Una orden nueva corta («qué hora es», «pon un temporizador») no es la
  // respuesta: no se repite la pregunta.
  if (isNewCommand(text, now)) return "none";
  return text.trim().split(/\s+/).length <= 4 ? "reask" : "none";
}

function isNewCommand(text: string, now: Date): boolean {
  const t = text.trim();
  return Boolean(
    extractToolAction(t, now) ||
      extractTimerAction(t) ||
      extractReminderAction(t, now) ||
      reminderMissingText(t) ||
      extractCalcAction(t),
  );
}

/** El texto de la pregunta «¿cuál?», para repetirla tal cual se hizo. */
export function choiceQuestionText(pending: PendingChoice): string {
  const key = pending.action === "reminderDelete" ? "reminderWhich" : "noteWhich";
  return `${routerMessage(key, pending.lang)}\n${pending.candidates.map((c) => `• ${c.label}`).join("\n")}`;
}

/** ¿El término (o su equivalente en otro idioma) está en el texto? */
function termMatches(haystackNorm: string, termNorm: string): boolean {
  return queryVariants(termNorm).some((v) => haystackNorm.includes(v));
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
      /^Mensaje para «(.+?)» guardado cifrado en la cola de salida: se entregará cuando su NIDO esté al alcance(?: \(Bluetooth\))?\.$/m,
      (_m, to) => L(`Message for “${to}” saved encrypted in the outbox: it will be delivered when their NIDO is in range.`, `Mensagem para “${to}” salva criptografada na fila: será entregue quando o NIDO dessa pessoa estiver ao alcance.`),
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

  // 0.1.20 (P3-9): borrado en conjunto, ítem por ítem. Cada ítem pasa
  // por el dispatcher completo (política irreversible → confirmación
  // que NOMBRA el ítem). Al primer "no" o fallo se para: lo ya borrado
  // se reporta como parcial, nunca se sigue en silencio.
  const deleteSet = async (
    items: Array<{ id: string; label: string }>,
    toolName: "delete_note" | "delete_reminder",
    labelArg: "title" | "text",
    single: (label: string) => string,
    many: (n: number) => string
  ): Promise<ToolRouterOutcome> => {
    let done = 0;
    for (const it of items) {
      const out = await run(toolName, { id: it.id, [labelArg]: it.label });
      if (!out.ok) {
        if (done === 0) return failure(out);
        return say(routerMessage("deletedPartial", lang, { done: String(done), total: String(items.length) }));
      }
      done++;
    }
    return say(done === 1 ? single(items[0].label) : many(done));
  };

  try {
    switch (action.kind) {
      case "reminderFill": {
        pendingAsk = null;
        const out = await run("create_reminder", { text: action.text, at: action.dueAt });
        if (!out.ok) return failure(out);
        const aviso = /aunque NIDO est[eé] cerrado/.test(out.text) ? routerMessage("reminderWillNotify", lang) : "";
        return say(routerMessage("reminderSet", lang, { when: reminderWhen(action.dueAt, lang), text: action.text }) + aviso);
      }

      case "reminderOfferCreate": {
        const when =
          action.range === "tomorrow"
            ? { es: " mañana", en: " tomorrow", pt: " amanhã" }[lang]
            : action.range === "today"
              ? { es: " hoy", en: " today", pt: " hoje" }[lang]
              : { es: " mañana", en: " tomorrow", pt: " amanhã" }[lang];
        return say(routerMessage("reminderHowTo", lang, { when }));
      }

      case "countdown": {
        const target = new Date(action.target);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);
        uses.push({ name: "device_time", result: now.toISOString() });
        const day = formatDay(target, lang);
        if (days === 0) return say(routerMessage("countdownToday", lang, { label: action.label || day }));
        if (!action.label) {
          return say(routerMessage(days === 1 ? "countdownDateOne" : "countdownDateMany", lang, { n: String(days), day }));
        }
        return say(
          routerMessage(days === 1 ? "countdownOne" : "countdownMany", lang, { n: String(days), label: action.label, day }),
        );
      }

      case "time": {
        // Hora del sistema leída aquí (determinista); se registra como device_time.
        uses.push({ name: "device_time", result: now.toISOString() });
        return action.what === "time"
          ? say(routerMessage("timeNow", lang, { time: formatTime(now, lang), day: formatDay(now, lang) }))
          : say(routerMessage("dateToday", lang, { day: formatDay(now, lang), year: String(now.getFullYear()) }));
      }

      case "weekday": {
        const d = new Date(action.year, action.month - 1, action.day);
        const date =
          lang === "en" ? `${MONTHS.en[action.month - 1]} ${action.day}` : `${action.day} de ${MONTHS[lang][action.month - 1]}`;
        uses.push({ name: "device_time", result: `${action.year}-${action.month}-${action.day} → ${DAYS.en[d.getDay()]}` });
        const wd = DAYS[lang][d.getDay()];
        // pt: «num sábado/domingo», «numa segunda-feira…».
        const weekday = lang === "pt" ? `${d.getDay() === 0 || d.getDay() === 6 ? "num" : "numa"} ${wd}` : wd;
        return say(routerMessage("weekdayOf", lang, { date, year: String(action.year), weekday }));
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
        // 0.1.25: elección ya resuelta por el turno siguiente.
        if (action.directId) {
          const chosen = notes.find((n) => n.id === action.directId);
          if (!chosen) return say(routerMessage("noteNotFound", lang, { q: action.query }));
          const out = await run("read_note", { id: chosen.id });
          return out.ok ? say(out.text) : failure(out);
        }
        const q = norm(action.query);
        // 0.1.24 (H-4): la consulta se expande a sus equivalentes
        // ES/EN/PT — la nota puede estar guardada en otro idioma.
        const matches = notes.filter(
          (n) => queryVariants(q).some((v) => norm(n.title).includes(v)) || (q.length >= 4 && q.includes(norm(n.title))),
        );
        const exact = matches.filter((n) => norm(n.title) === q);
        const chosen = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
        if (!chosen) {
          if (matches.length === 0) return say(routerMessage("noteNotFound", lang, { q: action.query }));
          stashChoice(deps, "noteRead", matches.slice(0, 8).map((n) => ({ id: n.id, label: n.title, match: n.title })), lang);
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
            // 0.1.32: uno que se repite cuenta si alguna de sus veces cae ese día.
            if (r.repeat) return nextOccurrence(new Date(r.dueAt), r.repeat, new Date(f - 1)).getTime() < u;
            const d = new Date(r.dueAt).getTime();
            return d >= f && d < u;
          });
        }
        uses.push({ name: "list_reminders", result: `${items.length} pending` });
        if (items.length === 0) {
          // 0.1.34: «Haz uno» justo después buscaba «Uno» (el juego de
          // cartas) en la enciclopedia. Se recuerda la oferta un rato.
          noteEmptyReminderList(action.range ?? null, lang, now);
          return say(
            routerMessage(
              action.range === "today" ? "noRemindersToday" : action.range === "tomorrow" ? "noRemindersTomorrow" : "noReminders",
              lang,
            ),
          );
        }
        const lines = items.slice(0, 20).map((r) => {
          const when = r.dueAt
            ? (r.repeat ? reminderRepeatWhen(r.dueAt, r.repeat, lang) : reminderWhen(r.dueAt, lang)).trim()
            : routerMessage("reminderNoDate", lang);
          return `• ${r.text} (${when})`;
        });
        const header =
          action.range === "today" ? "remindersHeaderToday" : action.range === "tomorrow" ? "remindersHeaderTomorrow" : "remindersHeader";
        return say(`${routerMessage(header, lang)}\n${lines.join("\n")}`);
      }

      case "noteDelete": {
        const notes = (await deps.listNotes?.()) ?? [];
        if (action.target.type === "one") {
          // 0.1.25: elección ya resuelta por el turno siguiente.
          const directId = action.target.directId;
          if (directId) {
            const chosen = notes.find((n) => n.id === directId);
            if (!chosen) return say(routerMessage("noteNotFound", lang, { q: action.target.query }));
            return deleteSet([{ id: chosen.id, label: chosen.title }], "delete_note", "title",
              (label) => routerMessage("noteDeleted", lang, { title: label }), () => "");
          }
          const q = norm(action.target.query);
          // 0.1.24 (H-4): equivalentes entre idiomas también al borrar.
          const matches = notes.filter(
            (n) => queryVariants(q).some((v) => norm(n.title).includes(v)) || (q.length >= 4 && q.includes(norm(n.title))),
          );
          const exact = matches.filter((n) => norm(n.title) === q);
          const chosen = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
          if (!chosen) {
            if (matches.length === 0) return say(routerMessage("noteNotFound", lang, { q: action.target.query }));
            stashChoice(deps, "noteDelete", matches.slice(0, 8).map((n) => ({ id: n.id, label: n.title, match: n.title })), lang);
            return say(`${routerMessage("noteWhich", lang)}\n${matches.slice(0, 8).map((n) => `• ${n.title}`).join("\n")}`);
          }
          return deleteSet([{ id: chosen.id, label: chosen.title }], "delete_note", "title",
            (label) => routerMessage("noteDeleted", lang, { title: label }), () => "");
        }
        if (notes.length === 0) return say(routerMessage("noNotes", lang));
        if (action.target.type === "ask" && notes.length > 1) {
          stashChoice(deps, "noteDelete", notes.slice(0, 20).map((n) => ({ id: n.id, label: n.title, match: n.title })), lang);
          return say(`${routerMessage("deleteWhichNote", lang)}\n${notes.slice(0, 20).map((n) => `• ${n.title}`).join("\n")}`);
        }
        return deleteSet(notes.map((n) => ({ id: n.id, label: n.title })), "delete_note", "title",
          (label) => routerMessage("noteDeleted", lang, { title: label }),
          (n) => routerMessage("notesDeletedMany", lang, { count: String(n) }));
      }

      case "reminderDelete": {
        if (!deps.listReminders) return say(routerMessage("failed", lang, { reason: "reminders unavailable" }));
        const all = await deps.listReminders();
        if (action.target.type === "one") {
          // 0.1.25: elección ya resuelta por el turno siguiente.
          const directId = action.target.directId;
          if (directId) {
            const chosen = all.find((r) => r.id === directId);
            if (!chosen) return say(routerMessage("reminderNotFound", lang, { q: action.target.query }));
            return deleteSet([{ id: chosen.id, label: chosen.text }], "delete_reminder", "text",
              (label) => routerMessage("reminderDeleted", lang, { text: label }), () => "");
          }
          const q = norm(action.target.query);
          const matches = all.filter((r) => norm(r.text).includes(q) || (q.length >= 4 && q.includes(norm(r.text))));
          const chosen = matches.length === 1 ? matches[0] : null;
          if (!chosen) {
            if (matches.length === 0) return say(routerMessage("reminderNotFound", lang, { q: action.target.query }));
            stashChoice(deps, "reminderDelete", matches.slice(0, 8).map((r) => {
              const when = r.dueAt
            ? (r.repeat ? reminderRepeatWhen(r.dueAt, r.repeat, lang) : reminderWhen(r.dueAt, lang)).trim()
            : routerMessage("reminderNoDate", lang);
              return { id: r.id, label: `${r.text} (${when})`, match: r.text };
            }), lang);
            const lines = matches.slice(0, 8).map((r) => {
              const when = r.dueAt
            ? (r.repeat ? reminderRepeatWhen(r.dueAt, r.repeat, lang) : reminderWhen(r.dueAt, lang)).trim()
            : routerMessage("reminderNoDate", lang);
              return `• ${r.text} (${when})`;
            });
            return say(`${routerMessage("reminderWhich", lang)}\n${lines.join("\n")}`);
          }
          return deleteSet([{ id: chosen.id, label: chosen.text }], "delete_reminder", "text",
            (label) => routerMessage("reminderDeleted", lang, { text: label }), () => "");
        }
        let items = all;
        if (action.range) {
          const start = new Date(now);
          start.setHours(0, 0, 0, 0);
          if (action.range === "tomorrow") start.setDate(start.getDate() + 1);
          const end = new Date(start);
          end.setDate(end.getDate() + 1);
          const f = start.getTime();
          const u = end.getTime();
          items = all.filter((r) => {
            if (!r.dueAt) return false;
            // 0.1.32: uno que se repite cuenta si alguna de sus veces cae ese día.
            if (r.repeat) return nextOccurrence(new Date(r.dueAt), r.repeat, new Date(f - 1)).getTime() < u;
            const d = new Date(r.dueAt).getTime();
            return d >= f && d < u;
          });
        }
        if (items.length === 0)
          return say(
            routerMessage(
              action.range === "today" ? "noRemindersToday" : action.range === "tomorrow" ? "noRemindersTomorrow" : "noReminders",
              lang
            )
          );
        if (action.target.type === "ask" && items.length > 1) {
          stashChoice(deps, "reminderDelete", items.slice(0, 20).map((r) => {
            const when = r.dueAt
            ? (r.repeat ? reminderRepeatWhen(r.dueAt, r.repeat, lang) : reminderWhen(r.dueAt, lang)).trim()
            : routerMessage("reminderNoDate", lang);
            return { id: r.id, label: `${r.text} (${when})`, match: r.text };
          }), lang);
          const lines = items.slice(0, 20).map((r) => {
            const when = r.dueAt
            ? (r.repeat ? reminderRepeatWhen(r.dueAt, r.repeat, lang) : reminderWhen(r.dueAt, lang)).trim()
            : routerMessage("reminderNoDate", lang);
            return `• ${r.text} (${when})`;
          });
          return say(`${routerMessage("deleteWhichReminder", lang)}\n${lines.join("\n")}`);
        }
        return deleteSet(items.map((r) => ({ id: r.id, label: r.text })), "delete_reminder", "text",
          (label) => routerMessage("reminderDeleted", lang, { text: label }),
          (n) => routerMessage("remindersDeletedMany", lang, { count: String(n) }));
      }

      case "noteSearch": {
        // Sin proveedor con cuerpo, se degrada a buscar en títulos
        // (honesto: menos alcance, nunca un «no pude» seco).
        const full = await deps.listNotesFull?.().catch(() => null);
        const notes = full ?? ((await deps.listNotes?.()) ?? []).map((n) => ({ id: n.id, title: n.title, body: "" }));
        uses.push({ name: "list_notes", result: `${notes.length} notes searched` });
        if (notes.length === 0) return say(routerMessage("noNotes", lang));
        const q = norm(action.query);
        const terms = q.split(" ").filter((w) => w.length >= 3);
        const hay = (n: { title: string; body: string }) => `${norm(n.title)} ${norm(n.body)}`;
        // 0.1.24 (H-4): un término casa también por su equivalente en
        // otro idioma («flowers» encuentra la nota de «flores»).
        let matches = notes.filter((n) => hay(n).includes(q) || (terms.length === 1 && termMatches(hay(n), terms[0])));
        if (matches.length === 0 && terms.length > 1) {
          matches = notes
            .map((n) => ({ n, score: terms.reduce((acc, w) => acc + (termMatches(hay(n), w) ? 1 : 0), 0) }))
            .filter((x) => x.score === terms.length)
            .map((x) => x.n);
        }
        if (matches.length === 0) return say(routerMessage("noteSearchNone", lang, { q: action.query }));
        const lines = matches.slice(0, 8).map((n) => {
          const body = n.body.trim();
          const excerpt = body && norm(body) !== norm(n.title) ? body.slice(0, 160) : "";
          return `• ${n.title}${excerpt ? `: ${excerpt}` : ""}`;
        });
        return say(`${routerMessage("noteSearchHeader", lang, { q: action.query })}\n${lines.join("\n")}`);
      }

      case "memoryForgetHelp":
        return say(routerMessage("memoryForgetHelp", lang));

      case "currencyInfo": {
        // Sin dispatch: no hay herramienta de tipos de cambio (la app es
        // cero-red). La respuesta honesta ES la función (P3-15).
        uses.push({ name: "convert_units", result: "Moneda: sin tipos de cambio offline; respuesta honesta." });
        return say(routerMessage("currencyOffline", lang));
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
