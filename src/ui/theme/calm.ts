/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Calm Agent Design Tokens
 *
 * Extension of the base theme for the NIDO UI redesign (2026-10-05).
 * "Calm Agent" direction: airy, generous whitespace, soft shapes,
 * subtle motion. Feels like talking to someone who knows you.
 *
 * These tokens sit alongside the existing spacing/radii/shadows -
 * use calm tokens for new "Calm Agent" components, keep the base
 * tokens for existing components during migration.
 */

export const calmSpacing = {
  /** Tight: related elements (4px) */
  tight: 4,
  /** Cozy: within a component (8px) */
  cozy: 8,
  /** Comfortable: between components (16px) */
  comfortable: 16,
  /** Airy: between sections (24px) */
  airy: 24,
  /** Spacious: major sections (32px) */
  spacious: 32,
  /** Generous: screen-level breathing room (48px) */
  generous: 48,
} as const;

export const calmRadii = {
  /** Subtle: small elements (8px) */
  subtle: 8,
  /** Soft: cards, buttons (12px) */
  soft: 12,
  /** Gentle: large cards (16px) */
  gentle: 16,
  /** Bubble: user message bubbles (18pt squircle per research) */
  bubble: 18,
  /** Round: avatars, chips (20px) */
  round: 20,
  /** Pill: fully rounded */
  pill: 9999,
} as const;

export const calmShadows = {
  /** None: flat, calm surfaces */
  none: {
    shadowColor: "transparent",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  /** Whisper: barely-there elevation (1px) */
  whisper: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  /** Soft: gentle lift for cards (4px) */
  soft: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  /** Lifted: modal, floating elements (8px) */
  lifted: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 4,
  },
} as const;

/**
 * Typography scale for Calm Agent.
 * Large, confident headings. Body optimized for reading.
 */
export const calmType = {
  /** Hero: empty states, welcome (28px, bold) */
  hero: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700" as const,
    letterSpacing: -0.5,
  },
  /** Title: screen titles (22px, semibold) */
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "600" as const,
    letterSpacing: -0.3,
  },
  /** Headline: section headers (17px, semibold) */
  headline: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "600" as const,
    letterSpacing: -0.2,
  },
  /** Body: conversation, content (16px, regular) */
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400" as const,
    letterSpacing: 0,
  },
  /** Callout: secondary info (14px, regular) */
  callout: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400" as const,
    letterSpacing: 0,
  },
  /** Caption: metadata, timestamps (12px, regular) */
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "400" as const,
    letterSpacing: 0.2,
  },
  /** Tiny: badges, labels (11px, medium) */
  tiny: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "500" as const,
    letterSpacing: 0.3,
  },
  /** Micro: dense metadata, stats (9px, medium) - use sparingly */
  micro: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "500" as const,
    letterSpacing: 0.4,
  },
  /** Small: compact labels (10px, regular) */
  small: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "400" as const,
    letterSpacing: 0.3,
  },
} as const;
