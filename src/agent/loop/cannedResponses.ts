/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * cannedResponses.ts — deterministic responses for high-confidence intents.
 *
 * A 0.5B model burns a full generation (latency + battery) on inputs with
 * zero ambiguity: pure greetings, "who are you", "what can you do". Serving
 * these from templates gives exact bilingual quality, zero latency, and zero
 * hallucination risk on first impressions.
 *
 * MARKING (do not remove): every canned hit is flagged `deterministic: true`
 * on the result. Telemetry (P2.4) and evals must be able to distinguish
 * template responses from model generations. Canned text must NEVER be
 * presented as model output.
 *
 * Trigger discipline: patterns are anchored to the WHOLE message (or the
 * message must consist entirely of greeting phrases, same rule as
 * src/routing/classify.ts). "hola, recuérdame comprar pan" is NOT a pure
 * greeting and falls through to the normal loop. When in doubt, don't match.
 *
 * Pure, no dependencies, fully unit-tested.
 */

export type CannedKind = "greeting" | "identity" | "help";
export type CannedLang = "es" | "en";

export interface CannedHit {
  kind: CannedKind;
  lang: CannedLang;
  text: string;
  /** Always true — marks this response as template-served, not model-generated. */
  deterministic: true;
}

// One greeting phrase, trailing punctuation only (mirrors classify.ts).
const GREETING_PHRASE_RE =
  /^[¡¿]?(hi|hello|hey|hey there|yo|sup|wake up|good (morning|afternoon|evening|night)|how(?:'s| is| are) it going|how are you|what'?s up|thanks?( you)?|thank you|bye|goodbye|see ya|see you|ok(ay)?|cool|nice|hola|buen(os|as) d[ií]as|buen d[ií]a|buenas (tardes|noches)|buenas|qu[eé] tal|c[oó]mo (est[aá]s|est[aá]|vas?|te va)|qu[eé] (pasa|hay|cuentas)|saludos|adi[oó]s|hasta luego|nos vemos|hasta pronto|gracias|muchas gracias|mil gracias|de nada)[!.?~]*$/i;

function isPureGreeting(trimmed: string): boolean {
  const segments = trimmed
    .split(/[,;]|\band\b|\by\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return segments.length > 0 && segments.every((seg) => GREETING_PHRASE_RE.test(seg));
}

// Anchored: the whole message must BE the question, not contain it.
// Leading ¡/¿ allowed for Spanish usage.
const IDENTITY_RE =
  /^[¡¿]?(quién eres|quien eres|qu[eé] eres|c[oó]mo te llamas|como te llamas|cu[aá]l es tu nombre|who are you|what are you|your name|what'?s your name|who is nido)[?.!]*$/i;

const HELP_RE =
  /^[¡¿]?(ayuda|help|qu[eé] puedes hacer|que puedes hacer|cu[aá]les son tus funciones|c[oó]mo funcionas|what can you do|what do you do|how do you work)[?.!]*$/i;

const TEMPLATES: Record<CannedKind, Record<CannedLang, string>> = {
  greeting: {
    es: "¡Hola! Soy NIDO. ¿En qué te ayudo?",
    en: "Hey! I'm NIDO. What can I do for you?",
  },
  identity: {
    es: "Soy NIDO, tu asistente personal. Vivo en tu teléfono, funciono sin internet y todo lo que hablamos se queda aquí, en privado.",
    en: "I'm NIDO, your personal assistant. I live on your phone, work fully offline, and everything we talk about stays here, private.",
  },
  help: {
    es: "Puedo ayudarte con recordatorios, notas, cálculos, responder preguntas y recordar cosas por ti. Dime qué necesitas.",
    en: "I can help with reminders, notes, calculations, answering questions, and remembering things for you. Just tell me what you need.",
  },
};

/** Detects the response language from the input. Spanish-first app: default 'es'. */
function detectLang(text: string): CannedLang {
  // Explicit English markers → English. Everything else → Spanish (default).
  if (/^(hi|hello|hey|yo|sup|who are you|what are you|your name|help|what can you do|how do you work|good (morning|afternoon|evening|night)|thanks|thank you|bye|goodbye|see ya|see you|okay|ok|cool|nice|wake up)\b/i.test(text.trim())) {
    return "en";
  }
  return "es";
}

/**
 * Returns a canned response for high-confidence intents, or null to fall
 * through to the normal agent loop. Pure function.
 */
export function matchCanned(userText: string): CannedHit | null {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  let kind: CannedKind | null = null;
  if (isPureGreeting(trimmed)) kind = "greeting";
  else if (IDENTITY_RE.test(trimmed)) kind = "identity";
  else if (HELP_RE.test(trimmed)) kind = "help";
  if (!kind) return null;

  const lang = detectLang(trimmed);
  return { kind, lang, text: TEMPLATES[kind][lang], deterministic: true };
}
