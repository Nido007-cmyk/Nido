/**
 * Deterministic self-knowledge: questions about NIDO itself are answered
 * from a BUNDLED canonical knowledge base — never from retrieval, never
 * from model improvisation.
 *
 * Live-evidence motivation (owner's Tab A9+, 2026-09-28): the app had no
 * self-grounding at all. Chat answered "What's Nido app" with a confident
 * description of a nonexistent student/educator app; Deep Research answered
 * "Nido app" with a Fate/Zero anime character backed by "OFFLINE VERIFIED
 * SOURCES". A small on-device model with no true match in the local index
 * free-associates into whatever its training data suggests — the only
 * robust fix is to not ask the model self-questions in the first place.
 *
 * Coverage (owner directive 2026-09-28): identity, capabilities,
 * advantages, roadmap (user-facing subset), and usage help — each in
 * en/es/pt. Everything else falls through to the normal retrieval/model
 * path unchanged.
 *
 * BRAND: all user-visible strings read the display name (and tagline)
 * from src/brand.ts — no hardcoded literals. Detection patterns key off
 * the NORMALIZED BRAND TOKEN, so a future rename keeps working without a
 * codebase hunt. Code identifiers are untouched (out of scope).
 *
 * SECURITY/PRIVACY REVIEW (2026-09-28, mandatory pre-commit pass):
 * - No private keys, key material, or exact crypto parameters (no
 *   iteration counts, key sizes, algorithm internals). "SQLCipher" and
 *   "device secure store" are named only — both are already published in
 *   docs/C1_SQLCIPHER.md and the app's own copy.
 * - No attack paths taught: confirmation requirements are described as
 *   user-facing behavior, never as internals to work around.
 * - No vulnerability details (internal M/T triage findings stay internal),
 *   no build/CI infrastructure, no other-user data, no internal
 *   codenames beyond NIDO.
 * - Capabilities describe ONLY what this build ships (src/agent/tools/
 *   manifest.ts + real UI). The Bluetooth phone-to-phone link is labeled
 *   experimental until proven on hardware — never claimed as working.
 * - Encryption at rest is stated as implemented design with an explicit
 *   "final on-device verification pending" qualifier (GATE-1 stays open
 *   for public-release claims; this in-app text must not read as
 *   device-verified).
 * - Roadmap is sanitized: direction only, no dates as promises, no
 *   internal IDs, no security-sensitive items.
 */

import { APP_DISPLAY_NAME, APP_TAGLINE, type BrandLocale } from "../brand";

/** @deprecated alias kept for the pre-expansion API — identical to BrandLocale. */
export type IdentityLocale = BrandLocale;
export type KnowledgeLocale = BrandLocale;

/** Maps a BCP-47-ish language tag to the closest supported knowledge locale. */
export function toIdentityLocale(language: string | undefined | null): IdentityLocale {
  const base = (language ?? "en").split("-")[0].toLowerCase();
  if (base === "es") return "es";
  if (base === "pt") return "pt";
  return "en";
}

/** Alias for the expanded knowledge-base API. */
export const toKnowledgeLocale = toIdentityLocale;

function normalizeQuery(query: string): string {
  return (
    query
      .toLowerCase()
      // Strip diacritics so "qué"/"quién"/"é" match their plain forms.
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // "what's" -> "whats" (keep it one token); other punctuation -> space.
      .replace(/['‘’]/g, "")
      .replace(/[?!¡¿.,;:()"«»—–-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The brand token detection patterns key off: the display name, run
 * through the same normalization as queries. Built once at module load,
 * so a brand rename automatically re-keys detection (a vi.mock'ed brand
 * in tests proves it).
 */
const BRAND = escapeRegExp(normalizeQuery(APP_DISPLAY_NAME));

export type KnowledgeCategory = "identity" | "capabilities" | "advantages" | "roadmap" | "usage";

/**
 * Identity patterns. Bare "who are you"-style patterns are anchored (so
 * "who are you voting for" does NOT match); every unanchored pattern
 * requires the brand token, which makes false positives unlikely. Bare
 * brand name alone is deliberately NOT matched — it may be a research
 * D-CLUSTER PHASE B (2026-09-28) — Design 1 + Design 2.
 *
 * Baseline (Phase A @ 0728bae): precision 68.1%, recall 75.4%,
 * FP rate 41.8%. Root cause: the non-identity families (usage/roadmap/
 * capabilities/advantages) matched generic phrasing ("how do I use X",
 * "what's next for X") with no brand context, hijacking unrelated queries.
 *
 * Design 1 — brand-context anchoring (non-identity families only):
 * a pattern match routes to SELF_KNOWLEDGE only when the match covers the
 * whole query (bare form, e.g. "what's next") or the unmatched remainder
 * attributes the subject to NIDO: the brand token, a NIDO-distinctive
 * feature noun (deep research, settings, pairing, qr, voice, ...), or a
 * deictic+app-noun phrase ("this app", "the app", "esta app", ...).
 * Bare deictics ("this", "these") and generic tech nouns ("bluetooth",
 * "chat") deliberately do NOT count — "what are you building these days"
 * and "como funciona el bluetooth" must stay in the normal pipeline.
 *
 * Design 2 — bounded typo tolerance (identity ONLY): a token at edit
 * distance <= 1 from the normalized brand token ("nidoo", "nid") is
 * treated as the brand BEFORE identity patterns run. Never applied to
 * the generic families, so it cannot manufacture new false positives
 * there. Known residual: pathological 1-edit collisions with real words
 * ("nino" -> "nido") are accepted and documented, not special-cased.
 *
 * What is NOT touched (owner directive): retrieval thresholds, prompts,
 * Deep Research, title generation, model behavior. NO Design 3.
 */
const IDENTITY_PATTERNS: RegExp[] = [
  // English — what-is / whats / who-is + brand (typo-tolerant via substitution)
  new RegExp(`\\bwhat\\s+is\\s+${BRAND}\\b`),
  new RegExp(`\\bwhats\\s+${BRAND}\\b`),
  new RegExp(`\\bwho\\s+is\\s+${BRAND}\\b`),
  new RegExp(`\\btell\\s+me\\s+about\\s+${BRAND}\\b`),
  // Deictic identity: "tell me about this/the app" (context-permitted in-app)
  /\btell\s+me\s+about\s+(this|the)\s+app\b/,
  // Bare anchored second-person identity (must not match compounds)
  /^who\s+are\s+you$/,
  /^what\s+are\s+you$/,
  // Spanish (diacritics already stripped by normalizeQuery)
  new RegExp(`\\bque\\s+es\\s+${BRAND}\\b`),
  new RegExp(`\\bque\\s+es\\s+(la\\s+)?(app|aplicacion)\\s+${BRAND}\\b`),
  new RegExp(`\\bcuentame\\s+(de|sobre)\\s+${BRAND}\\b`),
  new RegExp(`\\bquien\\s+(creo|hizo)\\s+${BRAND}\\b`),
  /^quien\s+eres$/,
  // Portuguese
  new RegExp(`\\bo\\s+que\\s+e\\s+(o\\s+)?(app\\s+)?${BRAND}\\b`),
  new RegExp(`\\b(me\\s+)?fala\\s+sobre\\s+(o\\s+)?${BRAND}\\b`),
  new RegExp(`\\bquem\\s+(criou|fez)\\s+(o\\s+)?${BRAND}\\b`),
  /^quem\s+e\s+voce$/,
  /^o\s+que\s+voce\s+e$/,
  // Creator / pricing / explain paraphrases (EN; ES/PT creator above)
  new RegExp(`\\bwho\\s+(created|made|built|developed)\\s+${BRAND}\\b`),
  new RegExp(`\\b(is|are)\\s+${BRAND}\\s+(open\\s+source|free)\\b`),
  new RegExp(`\\bdoes\\s+${BRAND}\\s+cost\\b`),
  new RegExp(`\\b(explain|describe)\\s+${BRAND}\\b`),
  // Brand+app noun: start- AND end-anchored. "Nido app" and
  // "what is the Nido app" match; "download the Nido app" and
  // "nido app review" (action/trailing content) do not.
  new RegExp(`^((what\\s+is|whats)\\s+(the\\s+)?|tell\\s+me\\s+about\\s+)?${BRAND}\\s+app$`),
];

/**
 * NIDO-distinctive feature nouns (normalized forms). Used ONLY as
 * attribution anchors in the unmatched remainder of a generic-pattern
 * match — never as standalone match triggers. Generic tech nouns
 * (bluetooth, chat, model, offline) are deliberately absent.
 */
const FEATURE_NOUNS: string[] = [
  // EN
  "deep research", "settings", "memory", "pairing", "qr",
  "voice", "lock", "biometric", "reminder", "calculator", "calendar",
  "notes", "notification",
  // ES
  "ajustes", "memoria", "emparejar", "emparejo", "voz", "bloqueo",
  "biometrico", "recordatorio", "calculadora", "calendario", "notas",
  "notificacion",
  // PT
  "configuracoes", "pareamento", "emparelhamento", "emparelhar",
  "bloqueio", "biometria", "lembrete", "notificacao",
];

/**
 * Deictic+app-noun phrases: the only deictic form that counts as
 * attribution. Bare "this"/"these"/"that" do not.
 */
const DEICTIC_APP_PHRASES: string[] = [
  "this app", "the app",
  "esta app", "este app", "esta aplicacion", "este aplicativo",
  "esse app", "este aplicativo",
];

/** Matches when the remainder attributes the query subject to NIDO. */
const ATTRIBUTION_RE = new RegExp(
  `\\b(?:${[BRAND, ...FEATURE_NOUNS.map(escapeRegExp), ...DEICTIC_APP_PHRASES.map(escapeRegExp)].join("|")})\\b`,
);

/**
 * Tries each pattern; returns the first whose match is either bare (covers
 * the whole query) or leaves a remainder with NIDO attribution.
 */
function matchAnchored(patterns: RegExp[], normalized: string): RegExp | null {
  for (const re of patterns) {
    const m = re.exec(normalized);
    if (!m) continue;
    const rest = `${normalized.slice(0, m.index)} ${normalized.slice(m.index + m[0].length)}`
      .trim()
      .replace(/\s+/g, " ");
    if (rest === "" || ATTRIBUTION_RE.test(rest)) return re;
  }
  return null;
}

/** Usage questions: how to use the app and its features. */
const USAGE_PATTERNS: RegExp[] = [
  // English
  /\bhow\s+(do|can)\s+i\s+use\b/,
  /\bhow\s+to\s+use\b/,
  /\bhow\s+does\s+(it|this|the\s+app|deep\s+research)\s+work\b/,
  /\bhow\s+do\s+i\s+(enable|turn\s+on|activate|start)\b/,
  /\bwhat\s+is\s+deep\s+research\b/,
  /\bwhere\s+(is|are)\s+(my\s+|the\s+)?(settings|ajustes|configuracoes|notes|notas|reminders|recordatorios|lembretes)\b/,
  // Spanish
  /\bcomo\s+(uso|usar|se\s+usa)\b/,
  /\bcomo\s+funciona\b/,
  /\bcomo\s+(activo|habilito)\b/,
  /\bcomo\s+(emparejar|emparejo)\b/,
  /\bque\s+es\s+(el\s+)?deep\s+research\b/,
  /\bdonde\s+(esta|estan)\s+(los\s+)?ajustes\b/,
  // Portuguese
  /\bcomo\s+(usar|uso|funciona)\b/,
  /\bcomo\s+(ativo|habilito)\b/,
  /\bo\s+que\s+e\s+(o\s+)?deep\s+research\b/,
  /\bonde\s+(fica|ficam)\s+(as\s+)?configuracoes\b/,
];

/** Roadmap questions: what's coming (sanitized, no promises). */
const ROADMAP_PATTERNS: RegExp[] = [
  // English (longer "coming next" forms before their prefixes)
  /\broadmap\b/,
  /\bwhats\s+coming(\s+next)?\b/,
  /\bwhats\s+next\b/,
  /\bwhat\s+is\s+coming\s+next\b/,
  /\bwhat\s+is\s+coming\b/,
  /\bwhat(?:s|\s+is)\s+the\s+product\s+roadmap\b/,
  /\bwhat\s+(will|are)\s+you\s+(add|planning|building)\b/,
  /\bfuture\s+(plans|features)\b/,
  // Spanish
  /\bque\s+(viene|sigue|vendra)\b/,
  /\bque\s+hay\s+de\s+nuevo\b/,
  /\bproximas?\s+funciones\b/,
  /\bfuturas?\s+funciones\b/,
  /\b(futuros?\s+planes|planes\s+futuros)\b/,
  /\bcual\s+es\s+(la\s+)?hoja\s+de\s+ruta\b/,
  // Portuguese
  /\bo\s+que\s+vem\s+(por\s+ai|a\s+seguir)\b/,
  /\bproximos\s+recursos\b/,
  /\bfuturos\s+recursos\b/,
];

/** Capability questions: what the app can do. */
const CAPABILITY_PATTERNS: RegExp[] = [
  // English
  /\bwhat\s+can\s+you\s+do\b/,
  /\bwhat\s+are\s+your\s+(features|capabilities|tools)\b/,
  /\bwhat\s+features\b/,
  /\bwhat\s+do\s+you\s+offer\b/,
  /\blist\s+your\s+(features|capabilities|tools)\b/,
  /\btell\s+me\s+about\s+your\s+(features|capabilities|tools)\b/,
  /\bwhat\s+can\s+(this|the)\s+app\s+do\b/,
  // How it works offline / without internet
  /\bhow\s+do\s+you\s+work\s+without\s+internet\b/,
  /\bhow\s+does\s+(this|the)\s+app\s+work\s+offline\b/,
  /\bdo\s+you\s+work\s+offline\b/,
  /\bdo\s+you\s+need\s+internet\b/,
  // Spanish
  /\bque\s+puedes\s+hacer\b/,
  /\bque\s+sabes\s+hacer\b/,
  /\bcuales\s+son\s+tus\s+(funciones|caracteristicas|capacidades)\b/,
  /\bcomo\s+funcionas\s+sin\s+internet\b/,
  /\bfuncionas\s+sin\s+internet\b/,
  // Portuguese
  /\bo\s+que\s+voce\s+pode\s+fazer\b/,
  /\bo\s+que\s+voce\s+sabe\s+fazer\b/,
  /\bquais\s+sao\s+(seus\s+)?(recursos|funcionalidades|capacidades)\b/,
];

/** Privacy questions: where data is stored, who can see it. */
const PRIVACY_PATTERNS: RegExp[] = [
  // English
  /\bwhere\s+is\s+my\s+data\s+stored\b/,
  /\bwho\s+can\s+see\s+my\s+data\b/,
  /\bwho\s+can\s+access\s+my\s+(data|information|chats)\b/,
  /\bis\s+my\s+data\s+private\b/,
  /\bdo\s+you\s+send\s+my\s+data\b/,
  /\bis\s+my\s+(data|information)\s+sent\s+to\b/,
  // Spanish
  /\bdonde\s+se\s+guardan\s+mis\s+datos\b/,
  /\bquien\s+puede\s+ver\s+mis\s+datos\b/,
  /\bmis\s+datos\s+son\s+privados\b/,
  /\benvias\s+mis\s+datos\b/,
  // Portuguese
  /\bonde\s+meus\s+dados\s+(sao|ficam)\b/,
  /\bquem\s+pode\s+ver\s+meus\s+dados\b/,
];

/** Advantage questions: why use NIDO over a cloud assistant. */
const ADVANTAGE_PATTERNS: RegExp[] = [
  // English (longest "this/the app" alternative first)
  new RegExp(`\\bwhy\\s+(should\\s+i\\s+)?use\\s+(this\\s+app|the\\s+app|you|this|it|${BRAND})\\b`),
  new RegExp(`\\bwhy\\s+${BRAND}\\b`),
  /\bwhat\s+are\s+the\s+(advantages|benefits)\b/,
  /\badvantages?\s+of\s+(this\s+app|the\s+app|this)\b/,
  // Spanish
  new RegExp(`\\bpor\\s+que\\s+(deberia\\s+)?usar(te)?\\b`),
  new RegExp(`\\bpor\\s+que\\s+${BRAND}\\b`),
  /\bcuales\s+son\s+las\s+ventajas\b/,
  /\bventajas\s+de\s+(esta\s+app|la\s+app|esta)\b/,
  // Portuguese
  new RegExp(`\\bpor\\s+que\\s+(devo\\s+)?usar\\b`),
  new RegExp(`\\bpor\\s+que\\s+${BRAND}\\b`),
  /\bquais\s+(sao\s+)?(as\s+)?vantagens\b/,
];

/** Classification order for the anchored families (identity is separate). */
const CATEGORY_PATTERNS: Array<{ category: KnowledgeCategory; patterns: RegExp[] }> = [
  { category: "usage", patterns: USAGE_PATTERNS },
  { category: "roadmap", patterns: ROADMAP_PATTERNS },
  { category: "capabilities", patterns: CAPABILITY_PATTERNS },
  { category: "advantages", patterns: [...ADVANTAGE_PATTERNS, ...PRIVACY_PATTERNS] },
];

/** Max edit distance for brand-typo tolerance (Design 2). Frozen at 1. */
const MAX_BRAND_TYPO_DISTANCE = 1;

/** Classic Levenshtein distance (short tokens only). */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > MAX_BRAND_TYPO_DISTANCE) return MAX_BRAND_TYPO_DISTANCE + 1;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Design 2: replaces tokens within edit distance <= 1 of the normalized
 * brand token ("nidoo", "nid" -> "nido") so identity patterns catch
 * reasonable typos. Applied ONLY before identity matching — the generic
 * families below never see substituted text.
 */
function substituteBrandTypos(normalized: string): string {
  if (!BRAND || /[^a-z0-9]/.test(BRAND)) return normalized;
  return normalized
    .split(" ")
    .map((word) => {
      if (word === BRAND || word.length === 0) return word;
      if (/[^a-z0-9]/.test(word)) return word;
      if (Math.abs(word.length - BRAND.length) > MAX_BRAND_TYPO_DISTANCE) return word;
      return editDistance(word, BRAND) <= MAX_BRAND_TYPO_DISTANCE ? BRAND : word;
    })
    .join(" ");
}

/** Eval diagnosis: which rule classified a query and why (not used in prod path). */
export interface ClassificationDebug {
  category: KnowledgeCategory;
  /** re.source of the matching pattern — the exact producing rule. */
  pattern: string;
  matchedText: string;
  /** Unmatched remainder ("" for bare matches / identity). */
  rest: string;
  /** Whether the remainder carried NIDO attribution (always true for identity). */
  attributed: boolean;
  /** Whether brand-typo substitution altered the query before matching. */
  typoSubstituted: boolean;
}

export function debugClassify(query: string): ClassificationDebug | null {
  const normalized = normalizeQuery(query);
  if (normalized.length === 0) return null;
  // Design 2: typo tolerance feeds identity matching only.
  const substituted = substituteBrandTypos(normalized);
  for (const re of IDENTITY_PATTERNS) {
    const m = re.exec(substituted);
    if (m) {
      return {
        category: "identity",
        pattern: re.source,
        matchedText: m[0],
        rest: "",
        attributed: true,
        typoSubstituted: substituted !== normalized,
      };
    }
  }
  // Design 1: generic families need bare match or NIDO attribution.
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    const re = matchAnchored(patterns, normalized);
    if (re) {
      const m = re.exec(normalized) as RegExpExecArray;
      const rest = `${normalized.slice(0, m.index)} ${normalized.slice(m.index + m[0].length)}`
        .trim()
        .replace(/\s+/g, " ");
      return {
        category,
        pattern: re.source,
        matchedText: m[0],
        rest,
        attributed: rest === "" || ATTRIBUTION_RE.test(rest),
        typoSubstituted: false,
      };
    }
  }
  return null;
}

/** Deterministic: the knowledge category a query asks about, or null. */
export function classifyKnowledgeQuery(query: string): KnowledgeCategory | null {
  const d = debugClassify(query);
  return d ? d.category : null;
}

/** Deterministic: true when the query is asking about NIDO's identity. */
export function isIdentityQuestion(query: string): boolean {
  return classifyKnowledgeQuery(query) === "identity";
}

type AnswerTable = Record<KnowledgeCategory, Record<BrandLocale, string>>;

const ANSWERS: AnswerTable = {
  identity: {
    en:
      `I'm ${APP_DISPLAY_NAME}. ${APP_TAGLINE.en} ` +
      "I'm an offline-first, private AI assistant that runs entirely on this device. " +
      "I don't need the internet to work: your chats and memory stay on your device, " +
      "and nothing is ever sent to the cloud. My built-in knowledge is limited to " +
      "what's stored offline, so if a question falls outside my local sources, I'll tell you.",
    es:
      `Soy ${APP_DISPLAY_NAME}. ${APP_TAGLINE.es} ` +
      "Soy un asistente de IA privado que funciona sin conexión y corre por completo " +
      "en este dispositivo. No necesito internet: tus chats y tu memoria se quedan en " +
      "tu dispositivo y nada se envía a ninguna nube. Mi conocimiento integrado se " +
      "limita a lo que está guardado offline; si una pregunta cae fuera de mis " +
      "fuentes locales, te lo diré.",
    pt:
      `Eu sou o ${APP_DISPLAY_NAME}. ${APP_TAGLINE.pt} ` +
      "Sou um assistente de IA privado, offline-first, que roda inteiramente neste " +
      "dispositivo. Não preciso de internet: suas conversas e sua memória ficam no " +
      "seu dispositivo e nada é enviado para a nuvem. Meu conhecimento integrado se " +
      "limita ao que está armazenado offline; se uma pergunta estiver fora das " +
      "minhas fontes locais, avisarei.",
  },
  capabilities: {
    en:
      `Here's what I can do — everything below runs on this device, offline:\n\n` +
      "• Chat with you about anything in my offline knowledge.\n" +
      "• Deep Research: for complex questions I break them into parts, research each " +
      "one against my offline sources, and write one unified answer with citations " +
      "(turn it on in Settings).\n" +
      "• Memory: I remember facts, preferences and goals you tell me, and keep notes " +
      "you can save, list and read back.\n" +
      "• Reminders through the system alarm, and the device's date and time.\n" +
      "• Math: a calculator and a unit converter; I can also analyze tables or CSV " +
      "files you share with me.\n" +
      "• Calendar: create and list events (with your permission); search your " +
      "contacts; open other apps; place calls or prepare text messages — you always " +
      "confirm before anything happens.\n" +
      `• Phone-to-phone: pair another ${APP_DISPLAY_NAME} device by scanning its QR ` +
      "code and exchange encrypted messages. The Bluetooth link is still being " +
      "proven on real hardware, so treat this as experimental.\n\n" +
      "I ask for confirmation before any sensitive action.",
    es:
      "Esto es lo que puedo hacer — todo funciona en este dispositivo, sin conexión:\n\n" +
      "• Conversar contigo sobre lo que esté en mi conocimiento offline.\n" +
      "• Deep Research: ante preguntas complejas las divido en partes, investigo cada " +
      "una en mis fuentes offline y redacto una respuesta unificada con citas (se " +
      "activa en Ajustes).\n" +
      "• Memoria: recuerdo datos, preferencias y metas que me cuentes, y guardo notas " +
      "que puedes guardar, listar y leer.\n" +
      "• Recordatorios con la alarma del sistema, y la fecha y hora del dispositivo.\n" +
      "• Matemáticas: calculadora y conversor de unidades; también puedo analizar " +
      "tablas o archivos CSV que me compartas.\n" +
      "• Calendario: crear y listar eventos (con tu permiso); buscar contactos; abrir " +
      "otras apps; marcar números o preparar mensajes — siempre confirmas tú antes " +
      "de que pase nada.\n" +
      `• De teléfono a teléfono: empareja otro dispositivo ${APP_DISPLAY_NAME} ` +
      "escaneando su código QR e intercambia mensajes cifrados. El enlace Bluetooth " +
      "aún está en pruebas en hardware real, así que trátalo como experimental.\n\n" +
      "Pido confirmación antes de cualquier acción sensible.",
    pt:
      "Isto é o que posso fazer — tudo roda neste dispositivo, offline:\n\n" +
      "• Conversar com você sobre o que estiver no meu conhecimento offline.\n" +
      "• Deep Research: diante de perguntas complexas, divido em partes, pesquiso " +
      "cada uma nas minhas fontes offline e redijo uma resposta unificada com " +
      "citações (ative em Ajustes).\n" +
      "• Memória: lembro de fatos, preferências e metas que você me contar, e guardo " +
      "notas que você pode salvar, listar e ler.\n" +
      "• Lembretes pelo alarme do sistema, e a data e hora do dispositivo.\n" +
      "• Matemática: calculadora e conversor de unidades; também analiso tabelas ou " +
      "arquivos CSV que você compartilhar.\n" +
      "• Calendário: criar e listar eventos (com sua permissão); buscar contatos; " +
      "abrir outros apps; ligar ou preparar mensagens — você sempre confirma antes " +
      "de qualquer coisa acontecer.\n" +
      `• De telefone a telefone: emparelhe outro dispositivo ${APP_DISPLAY_NAME} ` +
      "escaneando o código QR e troque mensagens criptografadas. O link Bluetooth " +
      "ainda está em testes em hardware real, então trate como experimental.\n\n" +
      "Peço confirmação antes de qualquer ação sensível.",
  },
  advantages: {
    en:
      `Why ${APP_DISPLAY_NAME} instead of a cloud assistant:\n\n` +
      "• Offline-first, zero network by design: after the one-time model download, " +
      "everything runs on this device. No account, no subscription, no analytics.\n" +
      "• Your data stays yours: chats, notes and memory live only on this device — " +
      "nothing is uploaded to any cloud, and system backups of the app are disabled.\n" +
      "• Encrypted local storage: the app's database is encrypted (SQLCipher) and " +
      "its key is kept in the device's secure store, which refuses to silently " +
      "regenerate a damaged key. (Final on-device verification of encryption at " +
      "rest is still pending.)\n" +
      "• The AI model is a replaceable part: your identity, memory, permissions and " +
      "tools don't depend on any single model or provider.\n" +
      "• Measurable on your own phone: built-in evaluation and execution telemetry " +
      "show model load time, tokens per second and which sources each answer used.",
    es:
      `Por qué ${APP_DISPLAY_NAME} en lugar de un asistente en la nube:\n\n` +
      "• Offline primero, cero red por diseño: tras la descarga inicial del modelo, " +
      "todo corre en tu dispositivo. Sin cuenta, sin suscripción, sin analíticas.\n" +
      "• Tus datos siguen siendo tuyos: chats, notas y memoria viven solo en este " +
      "dispositivo — nada se sube a ninguna nube y las copias de seguridad del " +
      "sistema están desactivadas para la app.\n" +
      "• Almacenamiento local cifrado: la base de datos de la app está cifrada " +
      "(SQLCipher) y su clave la guarda el almacén seguro del dispositivo, que se " +
      "niega a regenerar en silencio una clave dañada. (La verificación final del " +
      "cifrado en reposo en el hardware aún está pendiente.)\n" +
      "• El modelo de IA es una pieza reemplazable: tu identidad, memoria, permisos " +
      "y herramientas no dependen de ningún modelo ni proveedor concreto.\n" +
      "• Medible en tu propio teléfono: la evaluación integrada y la telemetría de " +
      "ejecución muestran el tiempo de carga del modelo, tokens por segundo y qué " +
      "fuentes usó cada respuesta.",
    pt:
      `Por que ${APP_DISPLAY_NAME} em vez de um assistente na nuvem:\n\n` +
      "• Offline primeiro, zero rede por design: após o download inicial do modelo, " +
      "tudo roda no seu dispositivo. Sem conta, sem assinatura, sem analytics.\n" +
      "• Seus dados continuam seus: conversas, notas e memória vivem apenas neste " +
      "dispositivo — nada é enviado para nenhuma nuvem e os backups do sistema " +
      "estão desativados para o app.\n" +
      "• Armazenamento local criptografado: o banco de dados do app é criptografado " +
      "(SQLCipher) e sua chave fica no cofre seguro do dispositivo, que se recusa " +
      "a regenerar silenciosamente uma chave danificada. (A verificação final da " +
      "criptografia em repouso no hardware ainda está pendente.)\n" +
      "• O modelo de IA é uma peça substituível: sua identidade, memória, " +
      "permissões e ferramentas não dependem de nenhum modelo ou provedor " +
      "específico.\n" +
      "• Mensurável no seu próprio telefone: a avaliação integrada e a telemetria " +
      "de execução mostram o tempo de carregamento do modelo, tokens por segundo " +
      "e quais fontes cada resposta usou.",
  },
  roadmap: {
    en:
      `Where ${APP_DISPLAY_NAME} is heading — direction, not promises (planned / ` +
      "in exploration, no dates):\n\n" +
      `• Phone-to-phone messaging between ${APP_DISPLAY_NAME} devices with no ` +
      "internet at all: opt-in, encrypted — in development.\n" +
      "• Keep your identity, memory and permissions when you change phones — in " +
      "exploration.\n" +
      "• More local models to choose from, with easier switching.\n" +
      "• More interface languages (today: English, Spanish, Portuguese).\n" +
      "• Richer search over your own documents.\n" +
      "• Delegate tasks to your other devices, with your explicit approval each " +
      "time.\n\n" +
      "Features land when they're proven — including on a real phone.",
    es:
      `Hacia dónde va ${APP_DISPLAY_NAME} — dirección, no promesas (planeado / ` +
      "en exploración, sin fechas):\n\n" +
      `• Mensajería de teléfono a teléfono entre dispositivos ${APP_DISPLAY_NAME} ` +
      "sin internet: opt-in y cifrada — en desarrollo.\n" +
      "• Conservar tu identidad, memoria y permisos al cambiar de teléfono — en " +
      "exploración.\n" +
      "• Más modelos locales para elegir, con cambio más fácil entre ellos.\n" +
      "• Más idiomas de interfaz (hoy: inglés, español, portugués).\n" +
      "• Búsqueda más potente en tus propios documentos.\n" +
      "• Delegar tareas a tus otros dispositivos, con tu aprobación explícita cada " +
      "vez.\n\n" +
      "Las funciones llegan cuando están probadas — también en un teléfono real.",
    pt:
      `Para onde ${APP_DISPLAY_NAME} está indo — direção, não promessas ` +
      "(planejado / em exploração, sem datas):\n\n" +
      `• Mensagens de telefone a telefone entre dispositivos ${APP_DISPLAY_NAME} ` +
      "sem internet: opt-in e criptografadas — em desenvolvimento.\n" +
      "• Manter sua identidade, memória e permissões ao trocar de telefone — em " +
      "exploração.\n" +
      "• Mais modelos locais para escolher, com troca mais fácil entre eles.\n" +
      "• Mais idiomas de interface (hoje: inglês, espanhol, português).\n" +
      "• Busca mais poderosa nos seus próprios documentos.\n" +
      "• Delegar tarefas aos seus outros dispositivos, com sua aprovação explícita " +
      "a cada vez.\n\n" +
      "Os recursos chegam quando estiverem testados — inclusive em um telefone real.",
  },
  usage: {
    en:
      `How to use ${APP_DISPLAY_NAME}'s main features:\n\n` +
      "• Chat: just type and send. Use the stop button to interrupt. Long-press one " +
      "of your messages to reuse it. Rate answers with thumbs up or down — it helps " +
      "improve the app.\n" +
      "• Deep Research: turn it on in Settings, then ask a complex question. It " +
      "breaks the question into parts, researches each one against your offline " +
      "sources, and writes one unified answer with citations.\n" +
      "• Memory: tell me “remember that…” and I'll keep it for future chats. Memory " +
      "settings control session titles, conversation summaries and how many sessions " +
      "are kept — and you can review or clear everything there.\n" +
      "• Voice: enable voice input in Settings to dictate instead of typing; " +
      "read-aloud speaks answers back to you.\n" +
      "• Lock: the app asks for your system biometrics or PIN when opened and after " +
      "being in the background for a while, so someone picking up your unlocked " +
      "phone still can't open it.",
    es:
      `Cómo usar las funciones principales de ${APP_DISPLAY_NAME}:\n\n` +
      "• Chat: escribe y envía. Usa el botón de detener para interrumpir. Mantén " +
      "pulsado uno de tus mensajes para reutilizarlo. Valora las respuestas con " +
      "pulgar arriba/abajo — ayuda a mejorar la app.\n" +
      "• Deep Research: actívalo en Ajustes y haz una pregunta compleja. La divide " +
      "en partes, investiga cada una en tus fuentes offline y redacta una respuesta " +
      "unificada con citas.\n" +
      "• Memoria: dime «recuerda que…» y lo guardaré para futuros chats. Los ajustes " +
      "de memoria controlan los títulos de sesión, los resúmenes de conversación y " +
      "cuántas sesiones se guardan — y puedes revisar o borrar todo ahí.\n" +
      "• Voz: activa la entrada de voz en Ajustes para dictar en vez de escribir; la " +
      "lectura en voz alta te lee las respuestas.\n" +
      "• Bloqueo: la app pide tu biometría o PIN del sistema al abrirla y tras " +
      "estar un rato en segundo plano, así alguien con tu teléfono desbloqueado no " +
      "puede abrirla.",
    pt:
      `Como usar os recursos principais do ${APP_DISPLAY_NAME}:\n\n` +
      "• Chat: digite e envie. Use o botão de parar para interromper. Toque e segure " +
      "uma das suas mensagens para reutilizá-la. Avalie as respostas com joinha " +
      "para cima/baixo — ajuda a melhorar o app.\n" +
      "• Deep Research: ative em Ajustes e faça uma pergunta complexa. Ele divide a " +
      "pergunta em partes, pesquisa cada uma nas suas fontes offline e redige uma " +
      "resposta unificada com citações.\n" +
      "• Memória: diga «lembre-se de que…» e guardarei para conversas futuras. Os " +
      "ajustes de memória controlam os títulos de sessão, os resumos de conversa e " +
      "quantas sessões são mantidas — e você pode revisar ou apagar tudo lá.\n" +
      "• Voz: ative a entrada de voz em Ajustes para ditar em vez de digitar; a " +
      "leitura em voz alta lê as respostas para você.\n" +
      "• Bloqueio: o app pede sua biometria ou PIN do sistema ao abrir e depois de " +
      "um tempo em segundo plano, então alguém com seu telefone desbloqueado não " +
      "consegue abri-lo.",
  },
};

/**
 * Returns the canonical knowledge-base answer in the requested locale, or
 * null when the query is not a self-question. Callers must bypass
 * retrieval AND the model entirely when this returns non-null.
 */
export function answerKnowledgeQuery(
  query: string,
  locale: KnowledgeLocale = "en"
): string | null {
  return answerKnowledgeQueryWithCategory(query, locale)?.answer ?? null;
}

/**
 * Returns the canonical identity-card answer in the requested locale, or
 * null when the query is not an identity question. (Legacy entry point;
 * prefer answerKnowledgeQuery.)
 */
export function answerIdentityQuestion(
  query: string,
  locale: IdentityLocale = "en"
): string | null {
  if (!isIdentityQuestion(query)) return null;
  return ANSWERS.identity[locale];
}

/** The canonical identity-card text for a locale (used by tests and previews). */
export function identityCard(locale: IdentityLocale = "en"): string {
  return ANSWERS.identity[locale];
}

/**
 * A self-knowledge answer together with the category that produced it, so
 * callers get deterministic routing metadata without classifying twice.
 * Returns null when the query is not a self-question.
 */
export function answerKnowledgeQueryWithCategory(
  query: string,
  locale: KnowledgeLocale = "en"
): { answer: string; category: KnowledgeCategory } | null {
  const category = classifyKnowledgeQuery(query);
  if (category === null) return null;
  return { answer: ANSWERS[category][locale], category };
}

/**
 * D/F3 (2026-09-28) — deterministic session titles for deterministic
 * self-knowledge responses.
 *
 * The KB answer path is model-free, but creating a new session for one
 * used to invoke the model purely to generate a title (generateSessionTitle
 * -> llamaEngine.generate). That made a deterministic path depend on the
 * model for bookkeeping. These titles are derived from the already-trusted
 * classification category — no model call, no classifier, no heuristics.
 * The brand display name is interpolated so a rename re-keys the titles.
 */
const KNOWLEDGE_TITLES: Record<KnowledgeLocale, Record<KnowledgeCategory, string>> = {
  en: {
    identity: `About ${APP_DISPLAY_NAME}`,
    capabilities: `What ${APP_DISPLAY_NAME} can do`,
    advantages: `Why ${APP_DISPLAY_NAME}`,
    roadmap: `${APP_DISPLAY_NAME} roadmap`,
    usage: `Using ${APP_DISPLAY_NAME}`,
  },
  es: {
    identity: `Acerca de ${APP_DISPLAY_NAME}`,
    capabilities: `Qué puede hacer ${APP_DISPLAY_NAME}`,
    advantages: `Ventajas de ${APP_DISPLAY_NAME}`,
    roadmap: `Hoja de ruta de ${APP_DISPLAY_NAME}`,
    usage: `Cómo usar ${APP_DISPLAY_NAME}`,
  },
  pt: {
    identity: `Sobre o ${APP_DISPLAY_NAME}`,
    capabilities: `O que o ${APP_DISPLAY_NAME} pode fazer`,
    advantages: `Vantagens do ${APP_DISPLAY_NAME}`,
    roadmap: `Roteiro do ${APP_DISPLAY_NAME}`,
    usage: `Como usar o ${APP_DISPLAY_NAME}`,
  },
};

/** Safe deterministic fallback titles (same default as createSession). */
const FALLBACK_TITLES: Record<KnowledgeLocale, string> = {
  en: "New chat",
  es: "Nuevo chat",
  pt: "Nova conversa",
};

function isKnowledgeCategory(value: unknown): value is KnowledgeCategory {
  return (
    typeof value === "string" &&
    (value === "identity" ||
      value === "capabilities" ||
      value === "advantages" ||
      value === "roadmap" ||
      value === "usage")
  );
}

/**
 * Deterministic title for a self-knowledge category. Pure — no model, no
 * retrieval, no I/O. Malformed or unknown categories (defensive: the type
 * only allows the five known ones, but JS callers can pass anything) fall
 * back to a safe localized default instead of throwing or producing an
 * empty title.
 */
export function titleForKnowledgeCategory(
  category: unknown,
  locale: KnowledgeLocale = "en"
): string {
  if (isKnowledgeCategory(category)) return KNOWLEDGE_TITLES[locale][category];
  return FALLBACK_TITLES[locale];
}

/**
 * Deterministic title for a self-knowledge session from the user query.
 * Pure and model-free by construction: it only runs the same classifier
 * that already produced the answer. Returns the safe fallback title when
 * the query is not a self-question (callers on the KB path always have a
 * category, but the fallback keeps the function total).
 */
export function knowledgeSessionTitle(
  query: string,
  locale: KnowledgeLocale = "en"
): string {
  const category = classifyKnowledgeQuery(query);
  return titleForKnowledgeCategory(category, locale);
}
