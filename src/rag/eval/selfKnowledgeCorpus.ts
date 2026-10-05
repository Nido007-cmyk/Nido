/**
 * D-CLUSTER PHASE A — adversarial corpus for the self-knowledge classifier
 * boundary (baseline 0728bae, 2026-09-28). READ-ONLY eval infrastructure:
 * this file never touches production behavior. It is consumed by
 * selfKnowledgeCorpus.baseline.test.ts, which runs the CURRENT (unmodified)
 * classifyKnowledgeQuery over these cases and reports precision/recall.
 *
 * Conventions:
 * - expected "SK" = SELF_KNOWLEDGE: a correct classifier should answer
 *   from the bundled KB (bypass retrieval + model).
 * - expected "NP" = NORMAL_PIPELINE: a correct classifier must NOT
 *   intercept; the query belongs to retrieval/model/normal chat.
 * - expected "AMB" = genuinely ambiguous: reported separately, never
 *   forced into PASS/FAIL and excluded from precision/recall.
 * - "topic" is the semantic bucket the case probes, NOT the classifier's
 *   output.
 *
 * IMPORTANT — do not optimize against this corpus during Phase A:
 * no regex, fuzzy matching, thresholds, aliases, or exceptions were
 * added to production for any of these cases.
 */

export type ExpectedRoute = "SK" | "NP" | "AMB";
export type CorpusLang = "en" | "es" | "pt";

export interface CorpusCase {
  id: string;
  query: string;
  lang: CorpusLang;
  topic: string;
  expected: ExpectedRoute;
  note: string;
}

export const SELF_KNOWLEDGE_CORPUS: CorpusCase[] = [
  // ── IDENTITY: should be caught (SK) ──────────────────────────────
  { id: "id-en-01", query: "What is Nido?", lang: "en", topic: "identity", expected: "SK", note: "canonical identity question" },
  { id: "id-en-02", query: "What's Nido app", lang: "en", topic: "identity", expected: "SK", note: "live-evidence case 1 (chat photo)" },
  { id: "id-en-03", query: "Nido app", lang: "en", topic: "identity", expected: "SK", note: "live-evidence case 2 (Deep Research photo)" },
  { id: "id-en-04", query: "Who is Nido", lang: "en", topic: "identity", expected: "SK", note: "who-is variant" },
  { id: "id-en-05", query: "Tell me about Nido", lang: "en", topic: "identity", expected: "SK", note: "tell-me-about variant" },
  { id: "id-en-06", query: "Who are you", lang: "en", topic: "identity", expected: "SK", note: "anchored bare identity" },
  { id: "id-en-07", query: "What are you", lang: "en", topic: "identity", expected: "SK", note: "anchored bare identity" },
  { id: "id-en-08", query: "what is the nido app", lang: "en", topic: "identity", expected: "SK", note: "determiner between what-is and brand" },
  { id: "id-en-09", query: "WHAT IS NIDO", lang: "en", topic: "identity", expected: "SK", note: "case normalization" },
  { id: "id-en-10", query: "what is nido app?", lang: "en", topic: "identity", expected: "SK", note: "trailing punctuation" },
  { id: "id-es-01", query: "¿Qué es Nido?", lang: "es", topic: "identity", expected: "SK", note: "diacritics + inverted marks" },
  { id: "id-es-02", query: "¿Quién eres?", lang: "es", topic: "identity", expected: "SK", note: "anchored ES identity" },
  { id: "id-es-03", query: "qué es la app nido", lang: "es", topic: "identity", expected: "SK", note: "brand + app noun, ES" },
  { id: "id-pt-01", query: "o que é o Nido", lang: "pt", topic: "identity", expected: "SK", note: "canonical PT identity" },
  { id: "id-pt-02", query: "quem é você", lang: "pt", topic: "identity", expected: "SK", note: "anchored PT identity" },
  { id: "id-pt-03", query: "o que você é", lang: "pt", topic: "identity", expected: "SK", note: "anchored PT identity variant" },

  // ── IDENTITY: typos / paraphrases — should be caught, currently missed ──
  { id: "fn-typo-01", query: "what is nidoo app", lang: "en", topic: "identity-typo", expected: "SK", note: "D/F2 demonstrated false negative" },
  { id: "fn-typo-02", query: "what is nid app", lang: "en", topic: "identity-typo", expected: "SK", note: "dropped-letter typo" },
  { id: "fn-typo-03", query: "whats nidoo", lang: "en", topic: "identity-typo", expected: "SK", note: "typo + contraction" },
  { id: "fn-typo-04", query: "qué es nidoo", lang: "es", topic: "identity-typo", expected: "SK", note: "ES typo" },
  { id: "fn-typo-05", query: "que es nidoo app", lang: "es", topic: "identity-typo", expected: "SK", note: "ES typo + app noun" },
  { id: "fn-para-01", query: "Explain Nido to me", lang: "en", topic: "identity-paraphrase", expected: "SK", note: "natural paraphrase, no matching pattern" },
  { id: "fn-para-02", query: "who created Nido", lang: "en", topic: "identity-paraphrase", expected: "SK", note: "identity-adjacent (provenance)" },
  { id: "fn-para-03", query: "is Nido open source", lang: "en", topic: "identity-paraphrase", expected: "SK", note: "identity-adjacent (licensing)" },
  { id: "fn-para-04", query: "does Nido cost money", lang: "en", topic: "identity-paraphrase", expected: "SK", note: "identity-adjacent (pricing)" },
  { id: "fn-para-05", query: "cuéntame de Nido", lang: "es", topic: "identity-paraphrase", expected: "SK", note: "ES natural paraphrase" },
  { id: "fn-para-06", query: "me fala sobre o Nido", lang: "pt", topic: "identity-paraphrase", expected: "SK", note: "PT natural paraphrase" },
  { id: "fn-para-07", query: "o que é o app Nido", lang: "pt", topic: "identity-paraphrase", expected: "SK", note: "PT: determiner breaks the o-que-e pattern" },
  { id: "fn-indirect-01", query: "what can this app do", lang: "en", topic: "capabilities-indirect", expected: "SK", note: "context-permitted 'this app' = NIDO (in-app chat)" },
  { id: "fn-indirect-02", query: "tell me about this app", lang: "en", topic: "identity-indirect", expected: "SK", note: "context-permitted 'this app' = NIDO (in-app chat)" },
  { id: "fn-usage-01", query: "show me how to pair another phone", lang: "en", topic: "usage-paraphrase", expected: "SK", note: "NIDO usage question, no matching pattern" },

  // ── CAPABILITIES: should be caught (SK) ──────────────────────────
  { id: "cap-en-01", query: "what can you do", lang: "en", topic: "capabilities", expected: "SK", note: "canonical capabilities" },
  { id: "cap-en-02", query: "what are your features", lang: "en", topic: "capabilities", expected: "SK", note: "features variant" },
  { id: "cap-en-03", query: "tell me about your features", lang: "en", topic: "capabilities", expected: "SK", note: "tell-me-about features" },
  { id: "cap-en-04", query: "list your tools", lang: "en", topic: "capabilities", expected: "SK", note: "list tools" },
  { id: "cap-en-05", query: "what do you offer", lang: "en", topic: "capabilities", expected: "SK", note: "offer variant" },
  { id: "cap-es-01", query: "qué puedes hacer", lang: "es", topic: "capabilities", expected: "SK", note: "ES canonical" },
  { id: "cap-es-02", query: "cuáles son tus funciones", lang: "es", topic: "capabilities", expected: "SK", note: "ES functions variant" },
  { id: "cap-pt-01", query: "o que você pode fazer", lang: "pt", topic: "capabilities", expected: "SK", note: "PT canonical" },
  { id: "cap-pt-02", query: "quais são seus recursos", lang: "pt", topic: "capabilities", expected: "SK", note: "PT recursos variant" },

  // ── USAGE: should be caught (SK) ─────────────────────────────────
  { id: "use-en-01", query: "how do I use Nido", lang: "en", topic: "usage", expected: "SK", note: "canonical usage" },
  { id: "use-en-02", query: "how to use this app", lang: "en", topic: "usage", expected: "SK", note: "context-permitted 'this app'" },
  { id: "use-en-03", query: "how does deep research work", lang: "en", topic: "usage", expected: "SK", note: "deep research usage" },
  { id: "use-en-04", query: "what is deep research", lang: "en", topic: "usage", expected: "SK", note: "deep research identity" },
  { id: "use-en-05", query: "where are the settings", lang: "en", topic: "usage", expected: "SK", note: "settings usage" },
  { id: "use-en-06", query: "how do i enable deep research", lang: "en", topic: "usage", expected: "SK", note: "enable variant" },
  { id: "use-es-01", query: "¿cómo se usa?", lang: "es", topic: "usage", expected: "SK", note: "ES canonical" },
  { id: "use-es-02", query: "cómo activo la voz", lang: "es", topic: "usage", expected: "SK", note: "ES activate variant" },
  { id: "use-pt-01", query: "como usar", lang: "pt", topic: "usage", expected: "SK", note: "PT canonical" },
  { id: "use-pt-02", query: "onde ficam as configurações", lang: "pt", topic: "usage", expected: "SK", note: "PT settings" },

  // ── ROADMAP: should be caught (SK) ──────────────────────────────
  { id: "rd-en-01", query: "what's next", lang: "en", topic: "roadmap", expected: "SK", note: "canonical roadmap" },
  { id: "rd-en-02", query: "what is the product roadmap", lang: "en", topic: "roadmap", expected: "SK", note: "roadmap noun" },
  { id: "rd-en-03", query: "future plans", lang: "en", topic: "roadmap", expected: "SK", note: "future plans" },
  { id: "rd-es-01", query: "qué viene", lang: "es", topic: "roadmap", expected: "SK", note: "ES canonical" },
  { id: "rd-es-02", query: "futuras funciones", lang: "es", topic: "roadmap", expected: "SK", note: "ES future functions" },
  { id: "rd-pt-01", query: "o que vem por aí", lang: "pt", topic: "roadmap", expected: "SK", note: "PT canonical" },
  { id: "rd-pt-02", query: "próximos recursos", lang: "pt", topic: "roadmap", expected: "SK", note: "PT próximos recursos" },

  // ── ADVANTAGES: should be caught (SK) ───────────────────────────
  { id: "adv-en-01", query: "why should I use Nido", lang: "en", topic: "advantages", expected: "SK", note: "canonical advantages" },
  { id: "adv-en-02", query: "why use you", lang: "en", topic: "advantages", expected: "SK", note: "short advantage form" },
  { id: "adv-en-03", query: "what are the advantages", lang: "en", topic: "advantages", expected: "SK", note: "bare advantages" },
  { id: "adv-en-04", query: "what are the advantages of the app", lang: "en", topic: "advantages", expected: "SK", note: "context-permitted 'the app' = NIDO" },
  { id: "adv-es-01", query: "cuáles son las ventajas", lang: "es", topic: "advantages", expected: "SK", note: "ES canonical" },
  { id: "adv-es-02", query: "ventajas de esta app", lang: "es", topic: "advantages", expected: "SK", note: "ES esta app" },
  { id: "adv-pt-01", query: "quais são as vantagens", lang: "pt", topic: "advantages", expected: "SK", note: "PT canonical" },
  { id: "adv-pt-02", query: "por que usar o Nido", lang: "pt", topic: "advantages", expected: "SK", note: "PT por que usar" },

  // ── HIJACK: must NOT be caught (NP) — unanchored patterns ───────
  { id: "fp-use-01", query: "how can I use a VPN?", lang: "en", topic: "usage-hijack", expected: "NP", note: "D/F1 demonstrated false positive" },
  { id: "fp-use-02", query: "how to use WhatsApp", lang: "en", topic: "usage-hijack", expected: "NP", note: "third-party usage hijacked by how-to-use" },
  { id: "fp-use-03", query: "how do I use a toaster", lang: "en", topic: "usage-hijack", expected: "NP", note: "generic usage hijacked by how-do-i-use" },
  { id: "fp-use-04", query: "how can I use this phone", lang: "en", topic: "usage-hijack", expected: "NP", note: "device usage hijacked" },
  { id: "fp-use-05", query: "what is deep research in AI", lang: "en", topic: "usage-hijack", expected: "NP", note: "general AI concept, not the NIDO feature" },
  { id: "fp-use-06", query: "where are the settings on Android", lang: "en", topic: "usage-hijack", expected: "NP", note: "OS settings hijacked" },
  { id: "fp-use-07", query: "como funciona un motor", lang: "es", topic: "usage-hijack", expected: "NP", note: "ES: generic como-funciona hijacked" },
  { id: "fp-use-08", query: "como se usa un taladro", lang: "es", topic: "usage-hijack", expected: "NP", note: "ES: generic como-se-usa hijacked" },
  { id: "fp-use-09", query: "cómo usar WhatsApp", lang: "es", topic: "usage-hijack", expected: "NP", note: "ES: third-party usage hijacked" },
  { id: "fp-cap-01", query: "what features does Netflix have", lang: "en", topic: "capabilities-hijack", expected: "NP", note: "third-party features hijacked by what-features" },
  { id: "fp-cap-02", query: "what are the features of the new iPhone", lang: "en", topic: "capabilities-hijack", expected: "NP", note: "product features hijacked" },
  { id: "fp-rd-01", query: "what's next on Netflix", lang: "en", topic: "roadmap-hijack", expected: "NP", note: "whats-next hijacked" },
  { id: "fp-rd-02", query: "what is coming to Disney+", lang: "en", topic: "roadmap-hijack", expected: "NP", note: "what-is-coming hijacked" },
  { id: "fp-rd-03", query: "future features of iOS", lang: "en", topic: "roadmap-hijack", expected: "NP", note: "future-features hijacked" },
  { id: "fp-rd-04", query: "what are you building these days", lang: "en", topic: "roadmap-hijack", expected: "NP", note: "personal chat hijacked by what-are-you-building" },
  { id: "fp-rd-05", query: "o que vem por aí na Netflix", lang: "pt", topic: "roadmap-hijack", expected: "NP", note: "PT: o-que-vem hijacked" },
  { id: "fp-rd-06", query: "que sigue en la serie", lang: "es", topic: "roadmap-hijack", expected: "NP", note: "ES: que-sigue hijacked" },
  { id: "fp-adv-01", query: "what are the advantages of solar panels", lang: "en", topic: "advantages-hijack", expected: "NP", note: "generic advantages hijacked" },
  { id: "fp-adv-02", query: "cuáles son las ventajas del teletrabajo", lang: "es", topic: "advantages-hijack", expected: "NP", note: "ES: generic ventajas hijacked" },
  { id: "fp-adv-03", query: "quais são as vantagens da energia solar", lang: "pt", topic: "advantages-hijack", expected: "NP", note: "PT: generic vantagens hijacked" },
  { id: "fp-adv-04", query: "por que usar um gerenciador de senhas", lang: "pt", topic: "advantages-hijack", expected: "NP", note: "PT: por-que-usar hijacked" },
  { id: "fp-id-01", query: "download the Nido app", lang: "en", topic: "identity-hijack", expected: "NP", note: "install request, not an identity question" },
  { id: "fp-id-02", query: "is the Nido app on iOS", lang: "en", topic: "identity-hijack", expected: "NP", note: "platform question caught as identity" },

  // ── HARD "nido": common word / other entity (NP) ────────────────
  { id: "hard-01", query: "nido", lang: "en", topic: "hard-nido", expected: "NP", note: "bare brand may be a research query (existing test)" },
  { id: "hard-02", query: "Nido is Spanish for a bird's nest, right?", lang: "en", topic: "hard-nido", expected: "NP", note: "'nido' as common Spanish noun" },
  { id: "hard-03", query: "el nido del águila", lang: "es", topic: "hard-nido", expected: "NP", note: "'nido' as eagle's nest" },
  { id: "hard-04", query: "Nidoqueen or Nidoking, which is stronger", lang: "en", topic: "hard-nido", expected: "NP", note: "'nido' inside Pokémon names" },
  { id: "hard-05", query: "Hotel Nido booking confirmation", lang: "en", topic: "hard-nido", expected: "NP", note: "'nido' as part of another entity" },
  { id: "hard-06", query: "nido milk powder for babies", lang: "en", topic: "hard-nido", expected: "NP", note: "'nido' as Nestlé milk brand, no identity pattern" },
  { id: "hard-07", query: "nido soup recipe", lang: "en", topic: "hard-nido", expected: "NP", note: "recipe query, no pattern match" },

  // ── NORMAL conversation: must never be hijacked (NP) ────────────
  { id: "norm-01", query: "hi", lang: "en", topic: "normal", expected: "NP", note: "greeting" },
  { id: "norm-02", query: "hello, how are you", lang: "en", topic: "normal", expected: "NP", note: "greeting" },
  { id: "norm-03", query: "thanks", lang: "en", topic: "normal", expected: "NP", note: "thanks" },
  { id: "norm-04", query: "what is photosynthesis", lang: "en", topic: "normal", expected: "NP", note: "general knowledge (existing test)" },
  { id: "norm-05", query: "how does photosynthesis work", lang: "en", topic: "normal", expected: "NP", note: "general how-does-X-work (existing test)" },
  { id: "norm-06", query: "who are you voting for", lang: "en", topic: "normal", expected: "NP", note: "anchored who-are-you must not match (existing test)" },
  { id: "norm-07", query: "who are you and what do you want", lang: "en", topic: "normal", expected: "NP", note: "anchored pattern must not match compound" },
  { id: "norm-08", query: "tell me about the Roman Empire", lang: "en", topic: "normal", expected: "NP", note: "general tell-me-about" },
  { id: "norm-09", query: "calculate 12 * 34", lang: "en", topic: "normal", expected: "NP", note: "calculator" },
  { id: "norm-10", query: "translate hello to Spanish", lang: "en", topic: "normal", expected: "NP", note: "translation" },
  { id: "norm-11", query: "how do I bake sourdough bread", lang: "en", topic: "normal", expected: "NP", note: "how-do-I without 'use'" },
  { id: "norm-12", query: "what time is it", lang: "en", topic: "normal", expected: "NP", note: "time query" },
  { id: "norm-13", query: "write a poem about the sea", lang: "en", topic: "normal", expected: "NP", note: "creative writing" },
  { id: "norm-14", query: "list your top 10 movies", lang: "en", topic: "normal", expected: "NP", note: "list-your without features/capabilities/tools" },
  { id: "norm-15", query: "what can your model do", lang: "en", topic: "normal", expected: "NP", note: "not the canonical what-can-you-do" },
  { id: "norm-16", query: "why should I use Signal over WhatsApp", lang: "en", topic: "normal", expected: "NP", note: "why-should-I-use without you/this/it/brand" },
  { id: "norm-17", query: "why use a password manager", lang: "en", topic: "normal", expected: "NP", note: "why-use without anchor" },
  { id: "norm-18", query: "what are you planning for the weekend", lang: "en", topic: "roadmap-hijack", expected: "NP", note: "personal chat hijacked by what-are-you-(planning) — corpus-found FP" },
  { id: "norm-19", query: "advantages of the Tesla app", lang: "en", topic: "normal", expected: "NP", note: "third-party app, pattern needs 'the app' adjacent" },
  { id: "norm-20", query: "hola", lang: "es", topic: "normal", expected: "NP", note: "ES greeting" },
  { id: "norm-21", query: "¿qué hora es?", lang: "es", topic: "normal", expected: "NP", note: "ES time query" },
  { id: "norm-22", query: "oi", lang: "pt", topic: "normal", expected: "NP", note: "PT greeting" },
  { id: "norm-23", query: "que horas são", lang: "pt", topic: "normal", expected: "NP", note: "PT time query" },
  { id: "norm-24", query: "me ajuda a escrever um email", lang: "pt", topic: "normal", expected: "NP", note: "PT writing help" },
  { id: "norm-25", query: "", lang: "en", topic: "normal", expected: "NP", note: "empty query (existing test)" },

  // ── AMBIGUOUS: genuinely ambiguous — never forced to PASS/FAIL ──
  { id: "amb-01", query: "what is this app", lang: "en", topic: "ambiguous", expected: "AMB", note: "'this app' attribution depends on context" },
  { id: "amb-02", query: "what is Nido milk", lang: "en", topic: "ambiguous", expected: "AMB", note: "real brand collision: Nestlé NIDO milk vs the assistant" },
  { id: "amb-03", query: "nido features", lang: "en", topic: "ambiguous", expected: "AMB", note: "shorthand could be NIDO's features or a research query" },
  { id: "amb-04", query: "advantages", lang: "en", topic: "ambiguous", expected: "AMB", note: "single word, unknown referent" },
  { id: "amb-05", query: "roadmap", lang: "en", topic: "ambiguous", expected: "AMB", note: "single word: NIDO roadmap or research subject" },
  { id: "amb-06", query: "use", lang: "en", topic: "ambiguous", expected: "AMB", note: "single word, unknown referent" },
  { id: "amb-07", query: "who made this app", lang: "en", topic: "ambiguous", expected: "AMB", note: "'this app' maker — context-dependent" },
];

/**
 * FROZEN MIRROR of the production detection patterns in
 * src/rag/selfKnowledge.ts @ baseline 0728bae — EVAL DIAGNOSIS ONLY.
 * Used to attribute each FP/FN to the exact rule that produced it.
 * If production patterns change, this mirror must be re-synced manually
 * (the baseline test asserts the mirror against the corpus report).
 * BRAND = normalized APP_DISPLAY_NAME = "nido".
 */
export const BASELINE_PATTERN_MIRROR: Array<{
  category: string;
  label: string;
  re: RegExp;
}> = [
  { category: "identity", label: "what-is-BRAND", re: /\bwhat\s+is\s+nido\b/ },
  { category: "identity", label: "whats-BRAND", re: /\bwhats\s+nido\b/ },
  { category: "identity", label: "who-is-BRAND", re: /\bwho\s+is\s+nido\b/ },
  { category: "identity", label: "tell-me-about-BRAND", re: /\btell\s+me\s+about\s+nido\b/ },
  { category: "identity", label: "BRAND-app", re: /\bnido\s+app\b/ },
  { category: "identity", label: "^who-are-you$", re: /^who\s+are\s+you$/ },
  { category: "identity", label: "^what-are-you$", re: /^what\s+are\s+you$/ },
  { category: "identity", label: "que-es-BRAND", re: /\bque\s+es\s+nido\b/ },
  { category: "identity", label: "BRAND+asistente/app/aplicacion", re: /\bnido\b.*\b(asistente|app|aplicacion)\b/ },
  { category: "identity", label: "^quien-eres$", re: /^quien\s+eres$/ },
  { category: "identity", label: "^que-eres$", re: /^que\s+eres$/ },
  { category: "identity", label: "o-que-e-BRAND", re: /\bo\s+que\s+e\s+(o\s+)?nido\b/ },
  { category: "identity", label: "^quem-e-voce$", re: /^quem\s+e\s+voce$/ },
  { category: "identity", label: "^o-que-voce-e$", re: /^o\s+que\s+voce\s+e$/ },
  { category: "usage", label: "how-(do|can)-i-use", re: /\bhow\s+(do|can)\s+i\s+use\b/ },
  { category: "usage", label: "how-to-use", re: /\bhow\s+to\s+use\b/ },
  { category: "usage", label: "how-does-X-work", re: /\bhow\s+does\s+(it|this|the\s+app|deep\s+research)\s+work\b/ },
  { category: "usage", label: "how-do-i-enable", re: /\bhow\s+do\s+i\s+(enable|turn\s+on|activate|start)\b/ },
  { category: "usage", label: "what-is-deep-research", re: /\bwhat\s+is\s+deep\s+research\b/ },
  { category: "usage", label: "where-settings", re: /\bwhere\s+(is|are)\s+(the\s+)?settings\b/ },
  { category: "usage", label: "como-uso/usar/se-usa", re: /\bcomo\s+(uso|usar|se\s+usa)\b/ },
  { category: "usage", label: "como-funciona", re: /\bcomo\s+funciona\b/ },
  { category: "usage", label: "como-activo/habilito", re: /\bcomo\s+(activo|habilito)\b/ },
  { category: "usage", label: "que-es-deep-research", re: /\bque\s+es\s+(el\s+)?deep\s+research\b/ },
  { category: "usage", label: "donde-ajustes", re: /\bdonde\s+(esta|estan)\s+(los\s+)?ajustes\b/ },
  { category: "usage", label: "como-usar/uso/funciona", re: /\bcomo\s+(usar|uso|funciona)\b/ },
  { category: "usage", label: "como-ativo/habilito", re: /\bcomo\s+(ativo|habilito)\b/ },
  { category: "usage", label: "o-que-e-deep-research", re: /\bo\s+que\s+e\s+(o\s+)?deep\s+research\b/ },
  { category: "usage", label: "onde-configuracoes", re: /\bonde\s+(fica|ficam)\s+(as\s+)?configuracoes\b/ },
  { category: "roadmap", label: "roadmap", re: /\broadmap\b/ },
  { category: "roadmap", label: "whats-next/coming", re: /\bwhats\s+(next|coming)\b/ },
  { category: "roadmap", label: "what-is-coming", re: /\bwhat\s+is\s+coming\b/ },
  { category: "roadmap", label: "what-are-you-adding/planning/building", re: /\bwhat\s+(will|are)\s+you\s+(add|planning|building)\b/ },
  { category: "roadmap", label: "future-features/plans", re: /\bfuture\s+(features|plans)\b/ },
  { category: "roadmap", label: "hoja-de-ruta", re: /\bhoja\s+de\s+ruta\b/ },
  { category: "roadmap", label: "que-viene/sigue/vendra", re: /\bque\s+(viene|sigue|vendra)\b/ },
  { category: "roadmap", label: "futuras-funciones/planes", re: /\bfuturas?\s+(funciones|planes)\b/ },
  { category: "roadmap", label: "o-que-vem", re: /\bo\s+que\s+vem\s+(por\s+ai|a\s+seguir)\b/ },
  { category: "roadmap", label: "proximos-recursos", re: /\bproximos\s+recursos\b/ },
  { category: "roadmap", label: "futuros-recursos", re: /\bfuturos\s+recursos\b/ },
  { category: "capabilities", label: "what-can-you-do", re: /\bwhat\s+can\s+you\s+do\b/ },
  { category: "capabilities", label: "what-are-your-features/capabilities", re: /\bwhat\s+are\s+your\s+(features|capabilities)\b/ },
  { category: "capabilities", label: "what-features", re: /\bwhat\s+features\b/ },
  { category: "capabilities", label: "what-do-you-offer", re: /\bwhat\s+do\s+you\s+offer\b/ },
  { category: "capabilities", label: "list-your-X", re: /\blist\s+your\s+(features|capabilities|tools)\b/ },
  { category: "capabilities", label: "tell-me-about-your-X", re: /\btell\s+me\s+about\s+your\s+(features|capabilities)\b/ },
  { category: "capabilities", label: "que-puedes-hacer", re: /\bque\s+puedes\s+hacer\b/ },
  { category: "capabilities", label: "que-sabes-hacer", re: /\bque\s+sabes\s+hacer\b/ },
  { category: "capabilities", label: "cuales-son-tus-X", re: /\bcuales\s+son\s+tus\s+(funciones|caracteristicas|capacidades)\b/ },
  { category: "capabilities", label: "o-que-voce-pode-fazer", re: /\bo\s+que\s+voce\s+pode\s+fazer\b/ },
  { category: "capabilities", label: "o-que-voce-sabe-fazer", re: /\bo\s+que\s+voce\s+sabe\s+fazer\b/ },
  { category: "capabilities", label: "quais-sao-seus-X", re: /\bquais\s+sao\s+(seus\s+)?(recursos|funcionalidades|capacidades)\b/ },
  { category: "advantages", label: "why-use-you/this/it/BRAND", re: /\bwhy\s+(should\s+i\s+)?use\s+(you|this|it|nido)\b/ },
  { category: "advantages", label: "why-BRAND", re: /\bwhy\s+nido\b/ },
  { category: "advantages", label: "what-are-the-advantages", re: /\bwhat\s+are\s+the\s+advantages\b/ },
  { category: "advantages", label: "advantages-of-this/the-app", re: /\badvantages?\s+of\s+(this|the\s+app)\b/ },
  { category: "advantages", label: "por-que-usar", re: /\bpor\s+que\s+(deberia\s+)?usar(te)?\b/ },
  { category: "advantages", label: "por-que-BRAND", re: /\bpor\s+que\s+nido\b/ },
  { category: "advantages", label: "cuales-son-las-ventajas", re: /\bcuales\s+son\s+las\s+ventajas\b/ },
  { category: "advantages", label: "ventajas-de-esta/la-app", re: /\bventajas\s+de\s+(esta|la\s+app)\b/ },
  { category: "advantages", label: "por-que-usar-pt", re: /\bpor\s+que\s+(devo\s+)?usar\b/ },
  { category: "advantages", label: "por-que-BRAND-pt", re: /\bpor\s+que\s+nido\b/ },
  { category: "advantages", label: "quais-vantagens", re: /\bquais\s+(sao\s+)?(as\s+)?vantagens\b/ },
];
