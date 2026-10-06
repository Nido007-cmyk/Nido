import { TaskType } from "./types";

/**
 * Deterministic, rule-based task classification - per the build plan,
 * explicitly NOT an LLM call ("do not initially ask an LLM to freely invent
 * a pipeline"). Heuristic and imperfect by nature (keyword/shape matching on
 * a short query string can't really "understand" intent), but deterministic
 * and testable, which is the actual requirement for Phase 3's router: same
 * input always produces the same plan.
 */
const PATTERNS: Array<{ type: TaskType; test: RegExp }> = [
  { type: "compare", test: /\b(compare|versus|vs\.?|difference between|which is better)\b/i },
  { type: "summarize", test: /\b(summarize|summarise|summary of|tl;?dr)\b/i },
  { type: "translate", test: /\btranslate\b/i },
  { type: "code", test: /```|\b(write (a |some )?code|debug this|refactor|fix this function|regex for)\b/i },
  { type: "calculate", test: /\b(calculate|compute|how much is)\b|\d+\s*[+\-*/×÷]\s*\d/i },
  { type: "extract", test: /\b(extract|list all|pull out|find every)\b/i },
];

// Matches ONE greeting phrase, trailing punctuation only - not the whole
// query. Anchored per-segment (see isGreeting below), not per-query: "hi,
// can you compare X and Y" must NOT classify as greeting overall, but a
// literal single phrase like "hi" must. Bilingual EN/ES: the app UI is
// Spanish-first and "Hola" must not fall through to knowledge retrieval
// (T-saludo-2026-10-06). Leading ¡/¿ allowed for Spanish usage ("¡Hola!").
const GREETING_PHRASE_RE =
  /^[¡¿]?(hi|hello|hey|hey there|yo|sup|wake up|good (morning|afternoon|evening|night)|how(?:'s| is| are) it going|how are you|what'?s up|thanks?( you)?|thank you|bye|goodbye|see ya|see you|ok(ay)?|cool|nice|hola|buen(os|as) d[ií]as|buen d[ií]a|buenas (tardes|noches)|buenas|qu[eé] tal|c[oó]mo (est[aá]s|est[aá]|vas?|te va)|qu[eé] (pasa|hay|cuentas)|saludos|adi[oó]s|hasta luego|nos vemos|hasta pronto|gracias|muchas gracias|mil gracias|de nada)[!.?~]*$/i;

/**
 * A query counts as a pure greeting if it's made up ENTIRELY of greeting
 * phrases - including a compound one like "hey, what's up?" (two phrases
 * joined by a comma), not just a single literal match. Splitting on common
 * connectors (comma/semicolon/"and") and requiring every resulting segment
 * to independently match GREETING_PHRASE_RE generalizes to any combination
 * of the known phrases without hardcoding each combination as its own
 * literal string - "hi, can you compare X and Y" still correctly fails,
 * since "can you compare X" isn't a greeting segment.
 */
function isGreeting(trimmed: string): boolean {
  const segments = trimmed
    .split(/[,;]|\band\b|\by\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return segments.length > 0 && segments.every((seg) => GREETING_PHRASE_RE.test(seg));
}

const CONVERSATION_RE =
  /\b(tell me a joke|make me laugh|another joke|who are you|what are you|your name|how old are you|where are you from|what time is it|what(?:'s| is) the (time|date|day))\b/i;

/**
 * A query counts as conversation (chit-chat) if it matches conversational
 * patterns about the assistant itself, jokes, or time/date - things that
 * never benefit from knowledge-base retrieval.
 */
function isConversation(trimmed: string): boolean {
  return CONVERSATION_RE.test(trimmed);
}

export function classifyTask(query: string): TaskType {
  const trimmed = query.trim();
  if (!trimmed) return "unknown";

  if (isGreeting(trimmed)) return "greeting";
  if (isConversation(trimmed)) return "conversation";

  for (const { type, test } of PATTERNS) {
    if (test.test(trimmed)) return type;
  }

  const wordCount = trimmed.split(/\s+/).length;
  if (/^(who|what|when|where|which)\b/i.test(trimmed) && wordCount <= 12) {
    return "lookup";
  }
  if (wordCount > 25 || /\b(research|analyze|analyse|investigate|explore|explain in depth)\b/i.test(trimmed)) {
    return "research";
  }
  return "chat";
}

/**
 * Whether local-knowledge-base retrieval is genuinely irrelevant for this
 * task type - shared between the (unwired) router and the live chat path
 * (`ChatScreen.tsx`) so the rule lives in exactly one place. A translation,
 * calculation, code request, pure greeting, or conversational chit-chat
 * doesn't get better by retrieving unrelated knowledge-base chunks; every
 * other task type (including the broad "chat" fallback, which also catches
 * real informational requests phrased as commands) still retrieves.
 */
export function isRetrievalIrrelevant(taskType: TaskType): boolean {
  return (
    taskType === "calculate" ||
    taskType === "translate" ||
    taskType === "code" ||
    taskType === "greeting" ||
    taskType === "conversation"
  );
}
