/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * smallTalk.ts — NIDO: pre-router determinístico de charla básica (es/en/pt).
 *
 * Evidencia física (Tab A9+, v0.1.6): "bien y tú como estás?" →
 *  1. se buscaba en la base de conocimiento (no es un saludo "puro" para
 *     classify.ts: "bien" y "tú como estás" no son frases de saludo);
 *  2. aparecía el letrero "No relevant offline sources found";
 *  3. el 0.5B contestaba otro saludo genérico en vez de responder.
 *
 * Causa raíz: las respuestas deterministas (cannedResponses.ts) solo corrían
 * dentro del agente (intención recordar/actuar). El chat normal —donde cae
 * toda la charla— nunca las consultaba, y no existía ninguna respuesta para
 * el turno natural de conversación ("bien, ¿y tú?").
 *
 * Disciplina: se compara el mensaje COMPLETO (anclado). "hola, recuérdame
 * comprar pan" o "hola, ¿qué es la fotosíntesis?" NO casan y siguen su
 * camino normal. Ante la duda, no se responde aquí.
 *
 * Marcado: el resultado es plantilla, nunca se presenta como generación del
 * modelo (mismo contrato que cannedResponses: deterministic: true).
 *
 * Puro, sin dependencias.
 */

export type SmallTalkLang = "es" | "en" | "pt";
export type SmallTalkKind =
  | "greeting"
  | "howAreYou"
  | "fineAndYou"
  | "fine"
  | "thanks"
  | "bye"
  | "ack"
  | "whatsUp"
  | "andYou";

export interface SmallTalkHit {
  kind: SmallTalkKind;
  lang: SmallTalkLang;
  text: string;
  deterministic: true;
}

/** Minúsculas, sin acentos ni puntuación, espacios colapsados. */
export function normalizeSmallTalk(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GREET =
  "(?:hola|holi|hey|hi|hello|hiya|ola|oi|buenas|buenos dias|buen dia|buenas tardes|buenas noches|good morning|good afternoon|good evening|bom dia|boa tarde|boa noite|saludos|que onda)";
const NAME = "(?: nido)?";
const HOW =
  "(?:(?:y )?(?:como|que tal) (?:estas|esta usted|te va|vas|andas|sigues)(?: tu| hoy)?|que tal|como te encuentras|how are you(?: doing| today)?|how are u|how r u|hows it going|how is it going|how you doing|how do you do|whats up|wassup|sup|como vai(?: voce)?|como voce esta|como vc ta|tudo bem|tudo bom|tudo certo|e ai)";
const FINE =
  "(?:(?:yo )?(?:estoy )?(?:muy |super |bastante )?(?:bien|genial|excelente|de maravilla|perfecto|feliz|contento|contenta)|todo bien|todo perfecto|aqui (?:bien|andando|todo bien)|(?:i am |im |i m )?(?:really |very |pretty )?(?:good|fine|great|ok|okay|well|alright|doing (?:good|well|great|fine))|not bad|all good|(?:eu )?(?:estou|to|tou) (?:muito )?bem|(?:muito )?bem|tudo (?:bem|bom|otimo|tranquilo|certo)|otimo|beleza)";
const THANKS_TAIL = "(?: (?:y )?(?:muchas )?gracias| thanks| thank you| thx| obrigad[oa])?";
const AND_YOU =
  "(?:y tu(?: como estas| que tal| como te va)?|y usted|y vos|and you|and u|you|how about you|what about you|and yourself|and how are you|e voce(?: como esta| como vai)?|e vc|e tu)";

const RULES: Array<{ kind: SmallTalkKind; re: RegExp }> = [
  { kind: "fineAndYou", re: new RegExp(`^(?:${GREET} )?${FINE}${THANKS_TAIL} ${AND_YOU}$`) },
  { kind: "howAreYou", re: new RegExp(`^(?:${GREET}${NAME} )?${HOW}${NAME}$`) },
  // 0.1.8 (evidencia: "Been y tu?" — el corrector cambió "Bien"): cualquier
  // respuesta corta (hasta 3 palabras) que termine devolviendo la pregunta
  // recibe una respuesta neutra, sin suponer cómo está el usuario.
  { kind: "andYou", re: new RegExp(`^(?:\\S+ ){1,3}${AND_YOU}$`) },
  // "ok" / "perfecto" son acuse, no "estoy bien": va antes que "fine".
  {
    kind: "ack",
    re: /^(?:ok|okay|okey|oki|vale|va|perfecto|genial|listo|entendido|de acuerdo|claro|sale|cool|nice|great|got it|alright|sounds good|beleza|certo|show|entendi|combinado)$/,
  },
  { kind: "fine", re: new RegExp(`^${FINE}${THANKS_TAIL}$`) },
  {
    kind: "thanks",
    re: /^(?:(?:muchas|mil|muchisimas) )?gracias(?: (?:por todo|por tu ayuda|nido))?$|^(?:thanks|thank you|thx|ty|thanks a lot|thank you so much|many thanks)(?: nido)?$|^(?:muito )?obrigad[oa](?: mesmo)?$|^valeu$/,
  },
  {
    kind: "bye",
    re: /^(?:adios|chao|chau|hasta luego|hasta pronto|hasta manana|nos vemos|bye|goodbye|bye bye|see you|see ya|good night|tchau|ate logo|ate mais|falou)(?: nido)?$/,
  },
  {
    kind: "whatsUp",
    re: /^(?:que haces|que estas haciendo|what are you doing|what are you up to|o que voce esta fazendo|que voce ta fazendo)(?: nido)?$/,
  },
  { kind: "greeting", re: new RegExp(`^${GREET}(?: ${GREET})*${NAME}$`) },
];

const REPLIES: Record<SmallTalkKind, Record<SmallTalkLang, string>> = {
  greeting: {
    es: "¡Hola! Soy NIDO. ¿En qué te ayudo?",
    en: "Hey! I'm NIDO. What can I do for you?",
    pt: "Olá! Sou NIDO. Como posso ajudar?",
  },
  howAreYou: {
    es: "¡Muy bien, gracias por preguntar! ¿Y tú? ¿En qué te ayudo?",
    en: "I'm doing well, thanks for asking! How about you? What can I do for you?",
    pt: "Tudo ótimo, obrigado por perguntar! E você? Como posso ajudar?",
  },
  fineAndYou: {
    es: "¡Bien también, gracias! Me alegra que estés bien. ¿En qué te ayudo?",
    en: "Doing well too, thanks! Glad you're good. What can I do for you?",
    pt: "Tudo bem por aqui também, obrigado! Que bom que você está bem. Como posso ajudar?",
  },
  fine: {
    es: "¡Me alegra! ¿En qué te ayudo?",
    en: "Glad to hear it! What can I do for you?",
    pt: "Que bom! Como posso ajudar?",
  },
  thanks: {
    es: "¡De nada! Aquí estoy si necesitas algo más.",
    en: "You're welcome! I'm here if you need anything else.",
    pt: "De nada! Estou aqui se precisar de mais alguma coisa.",
  },
  bye: {
    es: "¡Hasta luego! Aquí estaré cuando me necesites.",
    en: "See you! I'll be here whenever you need me.",
    pt: "Até logo! Estarei aqui quando precisar.",
  },
  ack: {
    es: "Perfecto. Dime si necesitas algo más.",
    en: "Great. Let me know if you need anything else.",
    pt: "Perfeito. Me diga se precisar de mais alguma coisa.",
  },
  andYou: {
    es: "¡Yo muy bien, gracias por preguntar! ¿En qué te ayudo?",
    en: "I'm doing well, thanks for asking! What can I do for you?",
    pt: "Eu estou muito bem, obrigado por perguntar! Como posso ajudar?",
  },
  whatsUp: {
    es: "Aquí, listo para ayudarte. ¿Qué necesitas?",
    en: "Just here, ready to help. What do you need?",
    pt: "Aqui, pronto para ajudar. Do que você precisa?",
  },
};

const EN_MARKERS =
  /\b(hi|hey|hello|hiya|good|morning|afternoon|evening|how|you|doing|thanks|thank|thx|ty|bye|goodbye|see|fine|great|well|okay|cool|nice|got|alright|sounds|what|whats|sup|wassup|not bad|im|am|all)\b/;
const PT_MARKERS =
  /\b(ola|oi|bom|boa|noite|tarde|tudo|voce|vc|obrigad[oa]|valeu|tchau|ate|estou|to|tou|bem|otimo|beleza|certo|show|entendi|combinado|e ai|vai|falou|muito|fazendo|ta)\b/;
const ES_MARKERS =
  /\b(hola|holi|buenas|buenos|buen|dia|dias|como|estas|que|tal|tu|usted|vos|bien|gracias|adios|chao|chau|hasta|vemos|vale|perfecto|genial|listo|entendido|acuerdo|claro|sale|haces|estoy|muy|todo|aqui|saludos|onda)\b/;

function detectLang(n: string, uiLang: SmallTalkLang | null): SmallTalkLang {
  const es = ES_MARKERS.test(n);
  const pt = PT_MARKERS.test(n);
  const en = EN_MARKERS.test(n);
  // Solo marcadores de un idioma → ese idioma. Si hay mezcla o ninguno
  // ("ok"), manda el idioma de la UI.
  if (pt && !es && !en) return "pt";
  if (en && !es && !pt) return "en";
  if (es && !en && !pt) return "es";
  if (uiLang) return uiLang;
  if (pt && !en) return "pt";
  if (en && !pt) return "en";
  return "es";
}

/**
 * Devuelve una respuesta determinista para charla básica, o null para que
 * el mensaje siga su camino normal (agente, RAG, modelo).
 */
export function matchSmallTalk(
  userText: string,
  uiLang: SmallTalkLang | null = null,
): SmallTalkHit | null {
  const raw = (userText ?? "").trim();
  if (!raw || raw.length > 80) return null;
  const n = normalizeSmallTalk(raw);
  if (!n) return null;
  for (const { kind, re } of RULES) {
    if (!re.test(n)) continue;
    const lang = detectLang(n, uiLang);
    let text = REPLIES[kind][lang];
    // "hola, ¿cómo estás?" → saludar antes de contestar.
    if (kind === "howAreYou" && new RegExp(`^${GREET}`).test(n)) {
      const hi = lang === "en" ? "Hi! " : lang === "pt" ? "Olá! " : "¡Hola! ";
      text = hi + text;
    }
    return { kind, lang, text, deterministic: true };
  }
  return null;
}

/** Título de sesión determinista para una charla breve. */
export function smallTalkSessionTitle(lang: SmallTalkLang): string {
  return lang === "en" ? "Chat" : lang === "pt" ? "Conversa" : "Charla";
}
