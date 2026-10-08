/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * D-CLUSTER PHASE B — HELD-OUT eval set (frozen 2026-09-28, BEFORE tuning).
 *
 * Purpose: measure generalization of the Design 1 + Design 2 classifier
 * changes on queries the tuner never saw. This file was authored and
 * committed BEFORE any production rule was modified for Phase B, and it
 * must NEVER be used to guide rule design ("no peeking"): it is executed
 * exactly once, after the frozen training corpus passes its gates.
 *
 * Conventions (same as the Phase A corpus):
 * - expected "SK" = SELF_KNOWLEDGE: a correct classifier should answer
 *   from the bundled KB (bypass retrieval + model).
 * - expected "NP" = NORMAL_PIPELINE: a correct classifier must NOT
 *   intercept; the query belongs to retrieval/model/normal chat.
 * - expected "AMB" = genuinely ambiguous: reported separately, never
 *   forced into PASS/FAIL and excluded from precision/recall.
 * - "topic" is the semantic bucket the case probes, NOT the classifier's
 *   output.
 *
 * Coverage: EN/ES/PT, identity typos/paraphrases/creator/pricing,
 * deictic capability questions, canonical + natural roadmap/advantages
 * variants, external-product hijack analogues, normal conversation,
 * hard "nido"-as-common-word cases, typo traps ("el niño juega",
 * "download the nidoo app"). No query duplicates the Phase A corpus.
 *
 * Phase B gates (owner directive 2026-09-28): precision ≥93%,
 * recall ≥88%, every FP/FN reported verbatim.
 */

import type { CorpusCase } from "./selfKnowledgeCorpus";

export const SELF_KNOWLEDGE_HELDOUT: CorpusCase[] = [
  // ── IDENTITY SK: canonical variants, typos, paraphrases ──────────────
  { id: "ho-id-01", query: "What is the Nido app?", lang: "en", topic: "identity", expected: "SK", note: "canonical: determiner + app noun" },
  { id: "ho-id-02", query: "whats the nido app", lang: "en", topic: "identity", expected: "SK", note: "contraction + determiner + app noun" },
  { id: "ho-id-03", query: "who is nidoo", lang: "en", topic: "identity-typo", expected: "SK", note: "who-is + doubled-letter typo" },
  { id: "ho-id-04", query: "tell me about nidoo", lang: "en", topic: "identity-typo", expected: "SK", note: "tell-me-about + typo" },
  { id: "ho-id-05", query: "qué es niddo", lang: "es", topic: "identity-typo", expected: "SK", note: "ES identity + typo" },
  { id: "ho-id-06", query: "o que e nidoo", lang: "pt", topic: "identity-typo", expected: "SK", note: "PT identity, no diacritics + typo" },
  { id: "ho-id-07", query: "Explain Nido", lang: "en", topic: "identity-paraphrase", expected: "SK", note: "bare explain paraphrase" },
  { id: "ho-id-08", query: "who made Nido", lang: "en", topic: "identity-paraphrase", expected: "SK", note: "creator paraphrase (made)" },
  { id: "ho-id-09", query: "is Nido free", lang: "en", topic: "identity-paraphrase", expected: "SK", note: "pricing paraphrase" },
  { id: "ho-id-10", query: "does Nido cost anything", lang: "en", topic: "identity-paraphrase", expected: "SK", note: "pricing paraphrase (cost)" },
  { id: "ho-id-11", query: "cuéntame sobre Nido", lang: "es", topic: "identity-paraphrase", expected: "SK", note: "ES tell-me-about with 'sobre'" },
  { id: "ho-id-12", query: "fala sobre o Nido", lang: "pt", topic: "identity-paraphrase", expected: "SK", note: "PT tell-me-about without 'me'" },
  { id: "ho-id-13", query: "que es la aplicacion nido", lang: "es", topic: "identity", expected: "SK", note: "ES app-noun + brand word order" },
  { id: "ho-id-14", query: "what is nidoo", lang: "en", topic: "identity-typo", expected: "SK", note: "bare what-is + typo, no app noun" },
  { id: "ho-id-15", query: "describe Nido to me", lang: "en", topic: "identity-paraphrase", expected: "SK", note: "describe paraphrase" },
  { id: "ho-id-16", query: "tell me about the app", lang: "en", topic: "identity-deictic", expected: "SK", note: "deictic 'the app' variant of corpus fn-indirect-02" },
  { id: "ho-id-17", query: "quién creó Nido", lang: "es", topic: "identity-paraphrase", expected: "SK", note: "ES creator paraphrase" },
  { id: "ho-id-18", query: "quem criou o Nido", lang: "pt", topic: "identity-paraphrase", expected: "SK", note: "PT creator paraphrase" },

  // ── USAGE SK: feature-anchored variants ──────────────────────────────
  { id: "ho-use-01", query: "how can i turn on deep research", lang: "en", topic: "usage", expected: "SK", note: "how-can-i + feature anchor" },
  { id: "ho-use-02", query: "how do I activate voice input", lang: "en", topic: "usage", expected: "SK", note: "activate + voice feature anchor" },
  { id: "ho-use-03", query: "como habilito la voz", lang: "es", topic: "usage", expected: "SK", note: "ES habilitar + voz anchor" },
  { id: "ho-use-04", query: "how to use the app", lang: "en", topic: "usage", expected: "SK", note: "deictic 'the app' usage variant" },
  { id: "ho-use-05", query: "where are my notes", lang: "en", topic: "usage", expected: "SK", note: "where-are + notes feature" },
  { id: "ho-use-06", query: "como ativo o pareamento", lang: "pt", topic: "usage", expected: "SK", note: "PT ativar + pareamento anchor" },

  // ── CAPABILITIES SK ──────────────────────────────────────────────────
  { id: "ho-cap-01", query: "what are your tools", lang: "en", topic: "capabilities", expected: "SK", note: "what-are-your + tools variant" },
  { id: "ho-cap-02", query: "tell me about your tools", lang: "en", topic: "capabilities", expected: "SK", note: "tell-me-about-your + tools" },

  // ── ROADMAP SK ───────────────────────────────────────────────────────
  { id: "ho-road-01", query: "what is coming next", lang: "en", topic: "roadmap", expected: "SK", note: "uncontracted what-is-coming-next" },
  { id: "ho-road-02", query: "what's coming next", lang: "en", topic: "roadmap", expected: "SK", note: "contracted whats-coming-next" },
  { id: "ho-road-03", query: "future plans", lang: "en", topic: "roadmap", expected: "SK", note: "bare future-plans" },
  { id: "ho-road-04", query: "planes futuros", lang: "es", topic: "roadmap", expected: "SK", note: "bare ES future-plans" },

  // ── ADVANTAGES SK ────────────────────────────────────────────────────
  { id: "ho-adv-01", query: "why should i use this app", lang: "en", topic: "advantages", expected: "SK", note: "why-use + this app (full)" },
  { id: "ho-adv-02", query: "what are the benefits of Nido", lang: "en", topic: "advantages", expected: "SK", note: "benefits synonym + brand" },
  { id: "ho-adv-03", query: "por que devo usar este app", lang: "pt", topic: "advantages", expected: "SK", note: "PT why-use + este app" },

  // ── NP: external-product hijack analogues (must NOT intercept) ──────
  { id: "ho-np-01", query: "how to use Excel", lang: "en", topic: "usage-external", expected: "NP", note: "generic how-to-use, external product" },
  { id: "ho-np-02", query: "how do I use a microwave", lang: "en", topic: "usage-external", expected: "NP", note: "generic how-do-I-use, appliance" },
  { id: "ho-np-03", query: "where are the settings on iOS", lang: "en", topic: "usage-external", expected: "NP", note: "settings question about another OS" },
  { id: "ho-np-04", query: "what is deep research in medicine", lang: "en", topic: "usage-external", expected: "NP", note: "deep research as generic AI term" },
  { id: "ho-np-05", query: "como funciona el bluetooth", lang: "es", topic: "usage-external", expected: "NP", note: "generic tech noun, not a NIDO feature anchor" },
  { id: "ho-np-06", query: "what features does Spotify have", lang: "en", topic: "capabilities-external", expected: "NP", note: "third-party capabilities" },
  { id: "ho-np-07", query: "tell me about your new phone", lang: "en", topic: "capabilities-external", expected: "NP", note: "tell-me-about-your without feature noun" },
  { id: "ho-np-08", query: "list your contacts", lang: "en", topic: "capabilities-external", expected: "NP", note: "list-your trap: contacts ≠ tools" },
  { id: "ho-np-09", query: "what's next on HBO", lang: "en", topic: "roadmap-external", expected: "NP", note: "third-party whats-next" },
  { id: "ho-np-10", query: "what is coming to PlayStation", lang: "en", topic: "roadmap-external", expected: "NP", note: "third-party what-is-coming" },
  { id: "ho-np-11", query: "what are you building this weekend", lang: "en", topic: "roadmap-external", expected: "NP", note: "building-trap: deictic 'this' ≠ app attribution" },
  { id: "ho-np-12", query: "what are the advantages of electric cars", lang: "en", topic: "advantages-external", expected: "NP", note: "generic advantages question" },
  { id: "ho-np-13", query: "why use a password manager", lang: "en", topic: "advantages-external", expected: "NP", note: "why-use without you/this/app/brand" },
  { id: "ho-np-14", query: "por que usar o whatsapp", lang: "pt", topic: "advantages-external", expected: "NP", note: "PT why-use, external product" },
  { id: "ho-np-15", query: "como se usa o whatsapp", lang: "pt", topic: "usage-external", expected: "NP", note: "PT 'se' breaks the como-usar pattern" },

  // ── NP: normal conversation (must stay TN) ───────────────────────────
  { id: "ho-np-16", query: "how are you today", lang: "en", topic: "normal", expected: "NP", note: "greeting variant" },
  { id: "ho-np-17", query: "what did you do last weekend", lang: "en", topic: "normal", expected: "NP", note: "past-tense you-question" },
  { id: "ho-np-18", query: "tell me a joke", lang: "en", topic: "normal", expected: "NP", note: "entertainment request" },
  { id: "ho-np-19", query: "como estas", lang: "es", topic: "normal", expected: "NP", note: "ES greeting, no diacritics" },
  { id: "ho-np-20", query: "obrigado", lang: "pt", topic: "normal", expected: "NP", note: "PT thanks" },
  { id: "ho-np-21", query: "what are you doing tonight", lang: "en", topic: "normal", expected: "NP", note: "you-trap: doing ≠ building/planning" },
  { id: "ho-np-22", query: "how do I get to the airport", lang: "en", topic: "normal", expected: "NP", note: "how-do-I without 'use'" },

  // ── NP: hard "nido" negatives + typo/action traps ────────────────────
  { id: "ho-np-23", query: "nido de pájaro", lang: "es", topic: "hard-nido", expected: "NP", note: "'nido' as bird's nest" },
  { id: "ho-np-24", query: "Hotel Nido booking", lang: "en", topic: "hard-nido", expected: "NP", note: "'nido' as part of another entity" },
  { id: "ho-np-25", query: "Nidoqueen stats", lang: "en", topic: "hard-nido", expected: "NP", note: "'nido' inside Pokémon name" },
  { id: "ho-np-26", query: "nido", lang: "en", topic: "hard-nido", expected: "NP", note: "bare brand may be a research query" },
  { id: "ho-np-27", query: "download the nidoo app", lang: "en", topic: "identity-action", expected: "NP", note: "typo must not turn an action query into identity" },
  { id: "ho-np-28", query: "is nido on ios", lang: "en", topic: "identity-adjacent", expected: "NP", note: "identity-adjacent, no identity scaffolding" },
  { id: "ho-np-29", query: "nido app review", lang: "en", topic: "identity-action", expected: "NP", note: "brand+app with trailing content is not bare identity" },
  { id: "ho-np-30", query: "the nido app", lang: "en", topic: "identity-adjacent", expected: "NP", note: "determiner phrase, not a question" },
  { id: "ho-np-31", query: "el niño juega", lang: "es", topic: "hard-nido", expected: "NP", note: "ES 'niño' (boy): 1-edit from brand, no identity scaffolding" },

  // ── AMB: excluded from scoring, manual review only ───────────────────
  { id: "ho-amb-01", query: "what is nidoo milk", lang: "en", topic: "ambiguous", expected: "AMB", note: "typo of the Nestlé NIDO milk brand collision" },
  { id: "ho-amb-02", query: "tell me about nidos", lang: "en", topic: "ambiguous", expected: "AMB", note: "typo boundary: app typo vs Spanish 'nests'" },
  { id: "ho-amb-03", query: "use nido", lang: "en", topic: "ambiguous", expected: "AMB", note: "bare imperative, unknown intent" },
];
