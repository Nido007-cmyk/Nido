/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

export type PersonalityId = "succinct" | "detailed" | "summary" | "custom";

export interface Personality {
  id: PersonalityId;
  label: string;
  icon: string;
  description: string;
  /** System prompt text; unused for "custom" (user supplies their own via settings). */
  systemPrompt: string;
  /**
   * Appended to the current question. Small models follow what's closest to the
   * question: the system prompt alone gets buried under ~2,000 characters of
   * retrieved context. Tested with Qwen2.5-1.5B: only here did "summary" produce
   * its takeaway and bullets, and "detailed" answers got about 70% longer.
   */
  styleReminder?: string;
}

/**
 * Response-style presets. Local models on phone hardware default to long,
 * meandering answers — extra output length means more latency and battery
 * drain, not more usefulness. These give the user direct control over
 * answer length/style without editing prompts by hand.
 */
/**
 * BUG-6-2026-10-06: el modelo 0.5B negaba funcionar offline ("I don't work
 * without internet") y decía "my device" en vez de "your device". Identidad
 * explícita al inicio de cada personalidad para que el modelo pequeño la
 * retenga. No es solo estilo: son hechos sobre qué es NIDO.
 */
const NIDO_IDENTITY =
  "You are Nido, a personal AI assistant that runs 100% offline on the user's phone. " +
  "You work WITHOUT internet — everything happens on-device. " +
  "The user's data is stored on THEIR device (not yours), encrypted. Only the USER can see their data, never you as a separate entity. " +
  "When asked about yourself, state these facts clearly. ";

export const PERSONALITIES: Personality[] = [
  {
    id: "succinct",
    label: "Succinct & Direct",
    icon: "⚡",
    description: "Fastest — 2–3 brief paragraphs, no preamble. Default for mobile.",
    // Small instruct models default heavily toward a "one-sentence takeaway,
    // then 3 bullet points" shape for almost any "be concise" instruction —
    // that's a real, common tendency, not a bug in personality selection
    // (getPersonalityId() is read fresh from persisted settings at both the
    // header and generate() call, single source of truth, no desync). The
    // original wording here explicitly allowed "bullet points", with
    // nothing distinguishing it from "summary"'s deliberately stricter
    // 1-sentence+3-bullets template below — the two ended up looking the
    // same in practice. This is now prose-first and explicitly steers away
    // from mimicking that specific shape, reserving it for "summary".
    systemPrompt:
      NIDO_IDENTITY +
      "Answer in 2-3 short, direct " +
      "sentences or a brief paragraph, no preamble. Do not default to a bulleted list " +
      "or a single takeaway sentence followed by three bullet points — use bullets only " +
      "when the content is genuinely a list of distinct items.",
    styleReminder: "Keep it short: 2-3 sentences. No lists unless the question asks for one.",
  },
  {
    // Deliberately not called "Deep Research" or using 🔬 — that name/icon
    // is reserved for the actual multi-pass "Deep Research Mode" toggle
    // (src/services/orchestrator.ts), a different, independent feature.
    // Using both for this single-pass response-style preset was confusing:
    // turning on Deep Research Mode is NOT the same as picking this style,
    // and vice versa (they compose — Deep Research Mode still uses
    // whichever style is selected here for its synthesis step).
    id: "detailed",
    label: "Thorough & Detailed",
    icon: "📚",
    description: "Structured, thorough explanations with comparisons and reasoning.",
    systemPrompt:
      NIDO_IDENTITY +
      "Provide thorough, structured " +
      "explanations with comparisons and evidence.",
    styleReminder:
      "Be thorough: 3-5 paragraphs that cover the key points in depth, with reasons, " +
      "comparisons and examples. Don't repeat yourself.",
  },
  {
    id: "summary",
    label: "Executive Summary",
    icon: "📋",
    description: "One top-line takeaway, then 3 key bullet points.",
    systemPrompt:
      NIDO_IDENTITY +
      "Provide a 1-sentence top-line key takeaway followed by 3 short bullet " +
      "points summarizing the answer.",
    styleReminder:
      "Use exactly this format and nothing else:\n" +
      "<one-sentence key takeaway>\n- <point 1>\n- <point 2>\n- <point 3>",
  },
  {
    id: "custom",
    label: "Custom",
    icon: "⚙️",
    description: "Write your own system prompt.",
    systemPrompt: "",
  },
];

export const DEFAULT_PERSONALITY_ID: PersonalityId = "succinct";

export const MAX_TOKENS_OPTIONS = [256, 512, 1024, 2048] as const;

export function getPersonality(id: PersonalityId): Personality {
  return PERSONALITIES.find((p) => p.id === id) ?? PERSONALITIES[0];
}
