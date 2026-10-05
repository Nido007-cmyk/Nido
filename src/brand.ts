/**
 * Brand module — the SINGLE SOURCE OF TRUTH for the user-facing product
 * identity. Owner directive 2026-09-28: the public product name is
 * UNDECIDED (NIDO is the internal codename and may not be usable
 * publicly), so every USER-VISIBLE string introduced by the
 * self-knowledge lane (identity card, knowledge base answers, new labels)
 * reads the display name — and the tagline — from here instead of
 * hardcoding literals. A future rename is a one-place change.
 *
 * Explicitly OUT of scope: code identifiers (function names, file paths,
 * tool names like nido_send_message) and the app's pre-existing i18n
 * copy, which keeps its own literals. The future-rebrand checklist
 * (see the lane report) covers everything else a rename would touch.
 */

/** Locales the knowledge base answers in. Kept in this module so brand
 * strings and answers share one locale type. */
export type BrandLocale = "en" | "es" | "pt";

/** User-facing display name. "Nido" today; changing this renames the app in
 * every string this lane introduced — including detection patterns, which
 * key off the normalized brand token. */
export const APP_DISPLAY_NAME = "Nido";

/** Marketing tagline per locale, as shown on the About/setup screens.
 * The knowledge base may quote it; the canonical UI copy lives in i18n. */
export const APP_TAGLINE: Record<BrandLocale, string> = {
  en: "Your agent. Your world.",
  es: "Tu agente. Tu mundo.",
  pt: "Seu agente. Seu mundo.",
};
