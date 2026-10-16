/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * contactRouter.ts — NIDO: pre-router determinístico de contactos, llamadas
 * y SMS (es / en / pt).
 *
 * TOOLS-AUDIT 2026-10-11, evidencia física (Tab A9+, v0.1.6):
 *  - "Find my cellphone contacts" no casaba ningún patrón → iba al chat
 *    normal, cuyo prompt dice "no puedes actuar" → "no tengo acceso".
 *  - "Busca el contacto Ruben" sí llegaba al agente, pero el 0.5B tiene que
 *    escribir el JSON de la herramienta; lo escribía mal y luego convertía
 *    el error del despachador en prosa ("No puedo buscar contactos en la
 *    lista de herramientas"). La herramienta SÍ estaba registrada.
 *  - "llama a Ruben" exige encadenar buscar → llamar: un 0.5B no lo hace.
 *
 * Mismo patrón que calc/recordatorios (actionRouter.ts): el código detecta
 * la petición explícita y la resuelve sin depender del modelo. Si algo no
 * encaja con claridad, devuelve null y el flujo normal sigue igual.
 *
 * Alcance deliberado:
 *  - Mensajes NIDO (cifrados P2P) NO se tocan: cualquier texto que mencione
 *    "nido" devuelve null.
 *  - SMS solo con la palabra explícita (sms / mensaje de texto / text):
 *    "mándale un mensaje a Ana" es ambiguo entre SMS y mensaje NIDO y sigue
 *    su camino actual.
 *
 * Puro, sin dependencias, 100% testeable.
 */

export type RouterLang = "es" | "en" | "pt";

export type ContactAction =
  | { kind: "find"; query: string | null; lang: RouterLang }
  | { kind: "call"; target: string | null; lang: RouterLang }
  | { kind: "sms"; target: string | null; message: string | null; lang: RouterLang };

/** Palabras que no son un nombre: "busca mis contactos", "find all contacts". */
const GENERIC_QUERY_RE =
  /^(mis|mi|todos|todas|los|las|el|la|all|my|every|any|everyone|meus|minhas|todos os|tudo|of mine|de mi tel[eé]fono|en mi tel[eé]fono|on my phone|in my phone|no meu (telefone|celular))$/i;

/** Objetos que delatan que "call/llama" no es una llamada telefónica. */
const NOT_A_CALL_TARGET_RE =
  /^(me|it|this|that|them|him|her|la atenci[oó]n|mucho|poco|so|as|for|off|out|back|up)\b/i;

function cleanText(text: string): string {
  return text
    .trim()
    .replace(/^[¡¿]+/, "")
    .replace(/[?!.¡¿]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanTarget(raw: string | undefined): string | null {
  if (raw == null) return null;
  let s = raw.trim().replace(/^["'«“]+|["'»”]+$/g, "").trim();
  // Cola de cortesía o de lugar: "a Ana por favor", "Ana en mis contactos".
  s = s
    .replace(/\s*,?\s*(por favor|please|pls|por favor\.?)$/i, "")
    .replace(/\s+(en|in|nos|no) (mis |my |meus )?(contactos|contacts|contatos)$/i, "")
    .trim();
  if (!s || GENERIC_QUERY_RE.test(s)) return null;
  // Un nombre razonable: hasta 6 palabras y 60 caracteres.
  if (s.length > 60 || s.split(/\s+/).length > 6) return null;
  return s;
}

function cleanMessage(raw: string | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim().replace(/^["'«“]+|["'»”]+$/g, "").trim();
  return s.length > 0 ? s : null;
}

/**
 * En inglés "text"/"call" son también sustantivos ("text messages are…",
 * "call of duty"). Un destinatario real casi nunca contiene palabras
 * funcionales ni verbos copulativos: si las tiene, no es una petición.
 */
const EN_FUNCTION_WORD_RE =
  /\b(is|are|was|were|be|been|do|does|did|the|a|an|of|to|for|with|about|from|me|it|this|that|these|those|messages?|summar\w*)\b/i;

function isPlausibleEnglishTarget(raw: string): boolean {
  return !EN_FUNCTION_WORD_RE.test(raw.trim());
}

/** ¿Parece un número de teléfono? (6+ dígitos, separadores habituales). */
export function looksLikePhone(s: string): boolean {
  const t = s.trim();
  if (!/^\+?[\d\s\-().]+$/.test(t)) return false;
  return (t.match(/\d/g) ?? []).length >= 6;
}

/**
 * 0.1.43 (paso 2, enmienda del dueño; medido por el barrido): las
 * formas peladas «teléfono de X» / «X's number» se tragaban frases
 * enteras como si fueran el nombre del contacto — «el teléfono de
 * mi casa ya no funciona» buscaba el contacto «mi casa ya no
 * funciona», y «i lost Juan's number» buscaba «i lost Juan». Nadie
 * había pedido buscar nada. En estas formas la captura solo vale
 * si parece un nombre: hasta 3 palabras y ninguna palabra de frase
 * (negaciones, verbos sueltos, marcas de tiempo, pronombres).
 */
const NOT_A_NAME_RE =
  /\b(no|n[aã]o|nunca|jamais|ya|j[aá]|m[aá]s|mais|funciona|funcionam|works|working|perd[ií]|lost|ayer|ontem|yesterday|hoy|hoje|today|ma[ñn]ana|amanh[aã]|tomorrow|est[aá]|estava|era|fue|foi|was|were|is|are|es|[eé]|tiene|tem|tengo|tenho|have|has|quiero|quero|want|wants|s[eé]|sei|know|i|eu)\b/i;

function isPlausibleBareName(query: string): boolean {
  return query.split(/\s+/).length <= 3 && !NOT_A_NAME_RE.test(query);
}

// ------------------------------------------------------------------ FIND

const FIND_PATTERNS: Array<{ lang: RouterLang; re: RegExp; group: number | null; barePhone?: boolean }> = [
  // es: "busca el contacto Ruben", "busca mis contactos", "muéstrame los contactos de Ana"
  {
    lang: "es",
    re: /^(?:por favor,?\s+)?(?:busca(?:r|me)?|encuentra(?:me)?|mu[eé]stra(?:me)?|ens[eé][ñn]a(?:me)?|dame|abre)\s+(?:a\s+)?(?:el|los|un|mis|mi)?\s*contactos?(?:\s+(?:de|del|llamado|llamada|que se llama))?\s*(.*)$/i,
    group: 1,
  },
  // es: "busca a Ruben en mis contactos", "tengo a Ruben en mis contactos"
  {
    lang: "es",
    re: /^(?:busca(?:r|me)?|encuentra(?:me)?|tengo)\s+(?:a\s+)?(.+?)\s+en\s+(?:mis\s+)?contactos$/i,
    group: 1,
  },
  // es: "teléfono de Ana", "cuál es el número de teléfono de Ana", "número de contacto de Ana"
  {
    lang: "es",
    re: /^(?:cu[aá]l es\s+)?(?:el\s+)?(?:tel[eé]fono|celular|n[uú]mero de (?:tel[eé]fono|celular|contacto))\s+de\s+(.+)$/i,
    group: 1,
    barePhone: true,
  },
  // en: "find my cellphone contacts", "search contacts for Ruben", "show me contact Ana"
  {
    lang: "en",
    re: /^(?:please,?\s+)?(?:can you\s+|could you\s+)?(?:find|search(?:\s+for)?|look\s*up|show(?:\s+me)?|get|open|check)\s+(?:in\s+)?(?:my\s+)?(?:phone\s+|cell\s*phone\s+|mobile\s+)?contacts?(?:\s+(?:for|named|called))?\s*(.*)$/i,
    group: 1,
  },
  // en: "find Ruben in my contacts", "is Ruben in my contacts"
  {
    lang: "en",
    re: /^(?:please,?\s+)?(?:find|search\s+for|look\s*up|is)\s+(.+?)\s+in\s+(?:my\s+)?contacts$/i,
    group: 1,
  },
  // en: "what's Ruben's number", "what is Ana's phone number"
  {
    lang: "en",
    re: /^(?:what(?:'s| is)\s+)?(.+?)'s\s+(?:phone\s+|cell\s+|mobile\s+)?number$/i,
    group: 1,
    barePhone: true,
  },
  // en: "phone number of/for Ana"
  {
    lang: "en",
    re: /^(?:what(?:'s| is)\s+the\s+)?(?:phone|cell|mobile)\s+number\s+(?:of|for)\s+(.+)$/i,
    group: 1,
    barePhone: true,
  },
  // pt: "procura o contato Ruben", "mostra meus contatos"
  {
    lang: "pt",
    re: /^(?:por favor,?\s+)?(?:procura(?:r)?|procure|busca(?:r)?|encontra(?:r)?|encontre|mostra(?:r)?|mostre|me mostra|abre|abra)\s+(?:o|os|meu|meus|um)?\s*contatos?(?:\s+(?:de|do|da|chamado|chamada))?\s*(.*)$/i,
    group: 1,
  },
  // pt: "procura a Ana nos meus contatos"
  {
    lang: "pt",
    re: /^(?:procura(?:r)?|procure|busca(?:r)?|encontra(?:r)?|encontre)\s+(?:o\s+|a\s+)?(.+?)\s+nos?\s+(?:meus\s+)?contatos$/i,
    group: 1,
  },
  // pt: "telefone da Ana", "qual é o número de telefone do João"
  {
    lang: "pt",
    re: /^(?:qual [eé]\s+)?(?:o\s+)?(?:telefone|celular|n[uú]mero de (?:telefone|celular))\s+(?:de|do|da)\s+(.+)$/i,
    group: 1,
    barePhone: true,
  },
];

// ------------------------------------------------------------------ CALL

const CALL_PATTERNS: Array<{ lang: RouterLang; re: RegExp }> = [
  // es: "llama a Ruben", "llámale a Ana", "marca al 555 1234", "llama" (solo)
  // Exige "a/al" o un número: "llama la atención…" no es una llamada.
  {
    lang: "es",
    re: /^(?:por favor,?\s+)?(?:ll[aá]ma(?:le)?|m[aá]rca(?:le)?|haz una llamada|hazle una llamada)(?:\s+(?:a|al|para)\s+(.+)|\s+(\+?[\d\s\-().]{6,}))?$/i,
  },
  // en: "call Ruben", "please call mom", "phone Ana", "dial 555 1234", "call"
  {
    lang: "en",
    re: /^(?:please,?\s+)?(?:can you\s+|could you\s+)?(?:call|phone|dial|ring)(?:\s+(?!me\b|it\b|this\b|that\b|them\b|off\b|back\b|up\b|out\b|for\b)(.+))?$/i,
  },
  // pt: "liga para a Ana", "ligue pro João", "liga" (solo)
  {
    lang: "pt",
    re: /^(?:por favor,?\s+)?(?:liga|ligue|ligar|telefona|telefone)(?:\s+(?:para|pra|pro|ao|à|a)\s+(?:o\s+|a\s+)?(.+)|\s+(\+?[\d\s\-().]{6,}))?$/i,
  },
];

// ------------------------------------------------------------------- SMS

const SMS_SEP = "(?::|,|\\s+que diga|\\s+que dice|\\s+diciendo|\\s+dici[eé]ndole|\\s+que|\\s+saying|\\s+that|\\s+dizendo|\\s+falando)";

const SMS_PATTERNS: Array<{ lang: RouterLang; re: RegExp }> = [
  // es: "mándale un sms a Ana que llego tarde", "envía un mensaje de texto a Ana: hola"
  {
    lang: "es",
    re: new RegExp(
      `^(?:por favor,?\\s+)?(?:env[ií]a(?:le)?|m[aá]nda(?:le)?|escr[ií]be(?:le)?)\\s+(?:un\\s+)?(?:sms|mensaje de texto|texto)(?:\\s+(?:a|al|para)\\s+(.+?))?(?:${SMS_SEP}\\s*(.+))?$`,
      "i",
    ),
  },
  // en: "text Ana that I'm late", "send a text to Ana saying hi", "sms Ana"
  {
    lang: "en",
    re: new RegExp(
      `^(?:please,?\\s+)?(?:send\\s+(?:an?\\s+)?(?:sms|text(?:\\s+message)?)(?:\\s+to\\s+(.+?))?|text\\s+(.+?)|sms\\s+(.+?))(?:${SMS_SEP}\\s*(.+))?$`,
      "i",
    ),
  },
  // pt: "manda um sms para a Ana dizendo que chego tarde"
  // 0.1.43 (paso 2): «uma» también — «envia uma mensagem de texto…»
  // caía al modelo porque el patrón solo admitía el masculino «um».
  {
    lang: "pt",
    re: new RegExp(
      `^(?:por favor,?\\s+)?(?:manda|mande|envia|envie)\\s+(?:uma?\\s+)?(?:sms|torpedo|mensagem de texto)(?:\\s+(?:para|pra|pro|ao|à)\\s+(?:o\\s+|a\\s+)?(.+?))?(?:${SMS_SEP}\\s*(.+))?$`,
      "i",
    ),
  },
];

/**
 * Detecta una petición explícita de buscar contacto, llamar o mandar SMS.
 * Devuelve null si no hay patrón claro (el flujo normal sigue igual).
 */
export function extractContactAction(userText: string): ContactAction | null {
  const t = cleanText(userText ?? "");
  if (!t || t.length > 300) return null;
  // Mensajería NIDO (cifrada, P2P) tiene su propio flujo: no tocarla.
  if (/\bnido\b/i.test(t)) return null;

  for (const { lang, re } of SMS_PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    if (lang === "en") {
      const raw = m[1] ?? m[2] ?? m[3];
      // "text me the summary", "text messages are cool": no es un SMS.
      if (raw && !isPlausibleEnglishTarget(raw)) continue;
      return { kind: "sms", target: cleanTarget(raw), message: cleanMessage(m[4]), lang };
    }
    return { kind: "sms", target: cleanTarget(m[1]), message: cleanMessage(m[2]), lang };
  }

  for (const { lang, re } of CALL_PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    const raw = m[1] ?? m[2];
    // No es una llamada ("call me…", "llama la atención…"): se sigue
    // probando el resto de patrones ("phone number of Mike" es una búsqueda).
    if (raw && NOT_A_CALL_TARGET_RE.test(raw.trim())) continue;
    // "call of duty", "call it a day": en inglés "call" también es sustantivo.
    if (raw && lang === "en" && !looksLikePhone(raw) && !isPlausibleEnglishTarget(raw)) continue;
    return { kind: "call", target: cleanTarget(raw), lang };
  }

  for (const { lang, re, group, barePhone } of FIND_PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    const query = group ? cleanTarget(m[group]) : null;
    // Forma pelada («teléfono de X»): si lo capturado no parece un
    // nombre, no es una búsqueda — es una frase sobre un teléfono.
    if (barePhone && query && !isPlausibleBareName(query)) continue;
    return { kind: "find", query, lang };
  }
  return null;
}

// --------------------------------------------------------- user messages

export interface ContactMatch {
  name: string;
  phones: string[];
}

type Msg =
  | "askFind"
  | "askCall"
  | "askSms"
  | "askSmsText"
  | "notFound"
  | "found"
  | "noPhone"
  | "whichOne"
  | "disabled"
  | "callOpened"
  | "smsOpened"
  | "cancelled"
  | "failed"
  | "permDenied"
  | "permBlocked"
  | "permUnavailable";

const MESSAGES: Record<Msg, Record<RouterLang, string>> = {
  askFind: {
    es: "¿Qué nombre busco en tus contactos?",
    en: "Which name should I look for in your contacts?",
    pt: "Qual nome devo procurar nos seus contatos?",
  },
  askCall: {
    es: "¿A quién quieres llamar? Dime el nombre o el número, por ejemplo: «llama a Ana».",
    en: "Who do you want to call? Tell me a name or a number, for example: “call Ana”.",
    pt: "Para quem você quer ligar? Diga o nome ou o número, por exemplo: “liga para a Ana”.",
  },
  askSms: {
    es: "¿A quién le mando el SMS? Por ejemplo: «mándale un SMS a Ana que llego tarde».",
    en: "Who should I text? For example: “text Ana that I'm running late”.",
    pt: "Para quem mando o SMS? Por exemplo: “manda um SMS para a Ana dizendo que chego tarde”.",
  },
  askSmsText: {
    es: "¿Qué le escribo a {{name}}? Dímelo así: «mándale un SMS a {{name}} que …».",
    en: "What should I text {{name}}? Say it like: “text {{name}} that …”.",
    pt: "O que escrevo para {{name}}? Diga assim: “manda um SMS para {{name}} dizendo …”.",
  },
  notFound: {
    es: "No encontré a «{{name}}» en tus contactos.",
    en: "I couldn't find “{{name}}” in your contacts.",
    pt: "Não encontrei “{{name}}” nos seus contatos.",
  },
  found: {
    es: "Encontré esto en tus contactos:",
    en: "Here's what I found in your contacts:",
    pt: "Encontrei isto nos seus contatos:",
  },
  noPhone: {
    es: "{{name}} no tiene un teléfono guardado.",
    en: "{{name}} doesn't have a phone number saved.",
    pt: "{{name}} não tem um telefone salvo.",
  },
  whichOne: {
    es: "Hay varios contactos que coinciden. ¿Cuál? Dime el nombre completo o el número.",
    en: "Several contacts match. Which one? Tell me the full name or the number.",
    pt: "Vários contatos correspondem. Qual deles? Diga o nome completo ou o número.",
  },
  disabled: {
    es: "La herramienta «{{tool}}» está desactivada. Puedes activarla en Acerca de → Permisos del agente.",
    en: "The “{{tool}}” tool is turned off. You can turn it on in About → Agent permissions.",
    pt: "A ferramenta “{{tool}}” está desativada. Você pode ativá-la em Sobre → Permissões do agente.",
  },
  callOpened: {
    es: "Abrí el marcador con {{phone}}. Pulsa llamar para confirmar.",
    en: "I opened the dialer with {{phone}}. Tap call to confirm.",
    pt: "Abri o discador com {{phone}}. Toque em ligar para confirmar.",
  },
  smsOpened: {
    es: "Abrí Mensajes para {{phone}} con el texto listo. Tú decides si lo envías.",
    en: "I opened Messages for {{phone}} with the text ready. You decide whether to send it.",
    pt: "Abri Mensagens para {{phone}} com o texto pronto. Você decide se envia.",
  },
  cancelled: {
    es: "Entendido, no hice nada.",
    en: "Understood, I did nothing.",
    pt: "Entendido, não fiz nada.",
  },
  permDenied: {
    es: "No diste permiso de contactos, así que no puedo buscar. Puedes volver a pedírmelo cuando quieras.",
    en: "You didn't allow access to contacts, so I can't search them. You can ask me again anytime.",
    pt: "Você não permitiu o acesso aos contatos, então não posso procurar. Pode me pedir de novo quando quiser.",
  },
  permBlocked: {
    es: "El permiso de contactos está bloqueado para NIDO. Actívalo en Ajustes del teléfono → Apps → NIDO → Permisos → Contactos.",
    en: "Contacts permission is blocked for NIDO. Turn it on in your phone's Settings → Apps → NIDO → Permissions → Contacts.",
    pt: "A permissão de contatos está bloqueada para o NIDO. Ative em Configurações do telefone → Apps → NIDO → Permissões → Contatos.",
  },
  permUnavailable: {
    es: "No pude acceder a los contactos del teléfono.",
    en: "I couldn't access the phone's contacts.",
    pt: "Não consegui acessar os contatos do telefone.",
  },
  failed: {
    es: "No pude completar la acción: {{reason}}",
    en: "I couldn't complete the action: {{reason}}",
    pt: "Não consegui concluir a ação: {{reason}}",
  },
};

export function contactMessage(
  key: Msg,
  lang: RouterLang,
  vars: Record<string, string> = {},
): string {
  let s = MESSAGES[key][lang];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{{${k}}}`).join(v);
  return s;
}

export function formatContactList(matches: ContactMatch[], lang: RouterLang): string {
  const none = lang === "en" ? "no phone" : lang === "pt" ? "sem telefone" : "sin teléfono";
  return (
    contactMessage("found", lang) +
    "\n" +
    matches.map((c) => `• ${c.name} — ${c.phones[0] ?? none}`).join("\n")
  );
}

function searchFailureText(
  res: { message: string; reason?: "denied" | "blocked" | "unavailable" },
  lang: RouterLang,
): string {
  if (res.reason === "denied") return contactMessage("permDenied", lang);
  if (res.reason === "blocked") return contactMessage("permBlocked", lang);
  if (res.reason === "unavailable") return contactMessage("permUnavailable", lang);
  return contactMessage("failed", lang, { reason: res.message });
}

/** Coincidencia exacta (sin mayúsculas/acentos) para desempatar varios resultados. */
export function pickExactMatch(matches: ContactMatch[], target: string): ContactMatch | null {
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  const t = norm(target);
  const exact = matches.filter((m) => norm(m.name) === t);
  return exact.length === 1 ? exact[0] : null;
}

// ------------------------------------------------------------ execution

export type ContactSearchResult =
  | { ok: true; matches: ContactMatch[] }
  | {
      ok: false;
      message: string;
      /** Motivo estructurado (permiso) para responder en el idioma del usuario. */
      reason?: "denied" | "blocked" | "unavailable";
    };

export type DispatchStatus =
  | "executed"
  | "invalid"
  | "disabled"
  | "blocked"
  | "cancelled"
  | "failed";

export interface ContactActionDeps {
  /** Búsqueda estructurada en la agenda (permiso incluido). */
  search: (query: string) => Promise<ContactSearchResult>;
  /** Despacho por la compuerta única (validación + política + confirmación). */
  dispatch: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ status: DispatchStatus; text: string }>;
  isDisabled: (tool: string) => boolean;
  /** Registro de auditoría de la búsqueda (solo lectura, sin despacho). */
  recordFind?: (status: "executed" | "failed" | "disabled") => void;
}

export interface ContactActionOutcome {
  response: string;
  toolUses: { name: string; result: string }[];
}

const MAX_LISTED = 5;

/**
 * Ejecuta una ContactAction de forma determinística. Nunca lanza: todo error
 * se convierte en una respuesta honesta en el idioma del usuario.
 */
export async function runContactAction(
  action: ContactAction,
  deps: ContactActionDeps,
): Promise<ContactActionOutcome> {
  const { lang } = action;
  const say = (response: string, toolUses: ContactActionOutcome["toolUses"] = []) => ({
    response,
    toolUses,
  });

  try {
    // ---- find
    if (action.kind === "find") {
      if (!action.query) return say(contactMessage("askFind", lang));
      if (deps.isDisabled("find_contact")) {
        deps.recordFind?.("disabled");
        return say(contactMessage("disabled", lang, { tool: "find_contact" }));
      }
      const res = await deps.search(action.query);
      if (!res.ok) {
        deps.recordFind?.("failed");
        return say(searchFailureText(res, lang), [{ name: "find_contact", result: res.message }]);
      }
      deps.recordFind?.("executed");
      const text =
        res.matches.length === 0
          ? contactMessage("notFound", lang, { name: action.query })
          : formatContactList(res.matches.slice(0, MAX_LISTED), lang);
      return say(text, [{ name: "find_contact", result: text }]);
    }

    // ---- call / sms: resolver destinatario
    const tool = action.kind === "call" ? "place_call" : "send_sms";
    if (!action.target) {
      return say(contactMessage(action.kind === "call" ? "askCall" : "askSms", lang));
    }
    if (deps.isDisabled(tool)) {
      return say(contactMessage("disabled", lang, { tool }));
    }
    if (action.kind === "sms" && !action.message) {
      return say(contactMessage("askSmsText", lang, { name: action.target }));
    }

    const toolUses: ContactActionOutcome["toolUses"] = [];
    let phone: string;
    if (looksLikePhone(action.target)) {
      phone = action.target.trim();
    } else {
      if (deps.isDisabled("find_contact")) {
        deps.recordFind?.("disabled");
        return say(contactMessage("disabled", lang, { tool: "find_contact" }));
      }
      const res = await deps.search(action.target);
      if (!res.ok) {
        deps.recordFind?.("failed");
        return say(searchFailureText(res, lang), [{ name: "find_contact", result: res.message }]);
      }
      deps.recordFind?.("executed");
      toolUses.push({ name: "find_contact", result: `${res.matches.length} match(es)` });
      if (res.matches.length === 0) {
        return say(contactMessage("notFound", lang, { name: action.target }), toolUses);
      }
      const chosen =
        res.matches.length === 1 ? res.matches[0] : pickExactMatch(res.matches, action.target);
      if (!chosen) {
        return say(
          `${contactMessage("whichOne", lang)}\n${formatContactList(res.matches.slice(0, MAX_LISTED), lang)
            .split("\n")
            .slice(1)
            .join("\n")}`,
          toolUses,
        );
      }
      if (chosen.phones.length === 0) {
        return say(contactMessage("noPhone", lang, { name: chosen.name }), toolUses);
      }
      // Varios números para el mismo contacto: se usa el primero (el que el
      // sistema da como principal) y el diálogo de confirmación lo muestra.
      phone = chosen.phones[0];
    }

    const args: Record<string, unknown> =
      action.kind === "call" ? { phone } : { phone, message: action.message as string };
    const out = await deps.dispatch(tool, args);
    toolUses.push({ name: tool, result: out.text });
    // Los handlers de llamada/SMS devuelven texto también al fallar
    // ("No pude abrir el marcador…", "Error: falta…") sin lanzar.
    const handlerFailed = out.status === "executed" && /^(error|no pude)\b/i.test(out.text.trim());
    if (handlerFailed) {
      return say(contactMessage("failed", lang, { reason: out.text }), toolUses);
    }
    switch (out.status) {
      case "executed":
        return say(
          contactMessage(action.kind === "call" ? "callOpened" : "smsOpened", lang, { phone }),
          toolUses,
        );
      case "cancelled":
        return say(contactMessage("cancelled", lang), toolUses);
      case "disabled":
        return say(contactMessage("disabled", lang, { tool }), toolUses);
      default:
        return say(contactMessage("failed", lang, { reason: out.text }), toolUses);
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return say(contactMessage("failed", lang, { reason }));
  }
}
