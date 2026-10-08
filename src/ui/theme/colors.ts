/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { ThemeId } from "../../models/settings";

/**
 * NIDO Design System — Tier 2 visual direction (frozen 2026-09-27).
 * 1. Daylight (primary reference — default for new installs)
 * 2. Night Garden (designed dark theme)
 * The pre-Tier-2 terminal themes (Midnight/Amber/Matrix) were removed;
 * stored legacy ids migrate to Night Garden via migrateLegacyThemeId().
 */

/**
 * Tier 2 visual direction (frozen 2026-09-27): Daylight is the primary
 * reference, Night Garden the designed dark theme. Tokens transcribed
 * verbatim from ~/workspace/nido-visual-audit/mockups/tier2/ (TIER2_NOTES.md
 * Part B — all contrast pairs measured PASS). Mapped onto the shared Colors
 * shape so existing semantic slots keep working.
 */
export const daylightTheme = {
  id: "daylight" as ThemeId,
  name: "Daylight",
  icon: "☀️",
  description: "Light theme — the primary NIDO look",
  bg: {
    black: "#F7F5F0",
    terminal: "#F7F5F0",
    surface: "#FFFFFF",
    card: "#FFFFFF",
    cardElevated: "#F0EDE6",
    cardHover: "#EAE6DB",
    input: "#FFFFFF",
    subtle: "rgba(30, 36, 29, 0.04)",
    overlay: "rgba(24, 28, 20, 0.45)",
    modalOverlay: "rgba(24, 28, 20, 0.62)",
  },
  border: {
    subtle: "#EDEAE2",
    default: "#E3E0D6",
    elevated: "#D6D2C6",
    focus: "#4A6B4F",
    emerald: "rgba(74, 107, 79, 0.35)",
    cyan: "rgba(74, 107, 79, 0.35)",
    amber: "rgba(176, 124, 42, 0.4)",
    danger: "rgba(179, 68, 47, 0.4)",
    frontier: "rgba(74, 107, 79, 0.45)",
  },
  text: {
    primary: "#1E241D",
    heading: "#1E241D",
    secondary: "#5A6357",
    muted: "#676C65",
    dim: "#6B7268",
    inverse: "#FFFFFF",
    accentEmerald: "#4A6B4F",
    accentCyan: "#4A6B4F",
    accentAmber: "#B07C2A",
    accentViolet: "#6B5B8E",
  },
  nidoIcon: {
    /** NIDO internal icon system v1 (frozen 2026-09-28): exact frozen values. */
    ink: "#1A201A",
    gold: "#A87F2B",
  },
  emerald: {
    50: "#EEF3EC",
    400: "#5C8263",
    500: "#4A6B4F",
    600: "#3A563F",
    900: "#1E2E22",
    bgSubtle: "rgba(74, 107, 79, 0.12)",
    border: "rgba(74, 107, 79, 0.28)",
  },
  cyan: {
    400: "#5C8263",
    500: "#4A6B4F",
    600: "#3A563F",
    bgSubtle: "rgba(74, 107, 79, 0.12)",
    border: "rgba(74, 107, 79, 0.3)",
  },
  frontier: {
    glow: "#4A6B4F",
    glowCyan: "#4A6B4F",
    badgeBg: "rgba(74, 107, 79, 0.12)",
    badgeBorder: "rgba(74, 107, 79, 0.35)",
    text: "#3A563F",
    gradientStart: "#F0EDE6",
    gradientEnd: "#F7F5F0",
  },
  amber: {
    400: "#C99A4A",
    500: "#B07C2A",
    600: "#8F6420",
    bgSubtle: "rgba(176, 124, 42, 0.12)",
    border: "rgba(176, 124, 42, 0.35)",
  },
  crimson: {
    400: "#C05A44",
    500: "#B3442F",
    600: "#93371F",
    900: "#5C2415",
    bgSubtle: "rgba(179, 68, 47, 0.10)",
    border: "rgba(179, 68, 47, 0.35)",
  },
};

export const nightGardenTheme = {
  id: "nightgarden" as ThemeId,
  name: "Night Garden",
  icon: "🌙",
  description: "Dark theme — designed for low light",
  bg: {
    black: "#10140F",
    terminal: "#10140F",
    surface: "#1A2019",
    card: "#1A2019",
    cardElevated: "#222A21",
    cardHover: "#2A332B",
    input: "#141A14",
    subtle: "rgba(237, 235, 227, 0.04)",
    overlay: "rgba(0, 0, 0, 0.62)",
    modalOverlay: "rgba(0, 0, 0, 0.72)",
  },
  border: {
    subtle: "#242C24",
    default: "#2A332A",
    elevated: "#3A453A",
    focus: "#9DBE8C",
    emerald: "rgba(157, 190, 140, 0.35)",
    cyan: "rgba(157, 190, 140, 0.35)",
    amber: "rgba(224, 178, 95, 0.4)",
    danger: "rgba(224, 128, 108, 0.4)",
    frontier: "rgba(157, 190, 140, 0.45)",
  },
  text: {
    primary: "#EDEBE3",
    heading: "#EDEBE3",
    secondary: "#A8B09F",
    muted: "#8A9185",
    dim: "#7E8878",
    inverse: "#10140F",
    accentEmerald: "#9DBE8C",
    accentCyan: "#9DBE8C",
    accentAmber: "#E0B25F",
    accentViolet: "#B9A8D6",
  },
  nidoIcon: {
    /** NIDO internal icon system v1 (frozen 2026-09-28): exact frozen values. */
    ink: "#F7F5F0",
    gold: "#E8C56B",
  },
  emerald: {
    50: "#1C2620",
    400: "#8FCB9B",
    500: "#7FBF8D",
    600: "#6AAE7C",
    900: "#2A4A33",
    bgSubtle: "rgba(157, 190, 140, 0.15)",
    border: "rgba(157, 190, 140, 0.35)",
  },
  cyan: {
    400: "#9DBE8C",
    500: "#8FB07E",
    600: "#7A9C6D",
    bgSubtle: "rgba(157, 190, 140, 0.15)",
    border: "rgba(157, 190, 140, 0.3)",
  },
  frontier: {
    glow: "#9DBE8C",
    glowCyan: "#9DBE8C",
    badgeBg: "rgba(157, 190, 140, 0.15)",
    badgeBorder: "rgba(157, 190, 140, 0.4)",
    text: "#C9DCC0",
    gradientStart: "#1A2019",
    gradientEnd: "#10140F",
  },
  amber: {
    400: "#E0B25F",
    500: "#D6A24E",
    600: "#B98538",
    bgSubtle: "rgba(224, 178, 95, 0.14)",
    border: "rgba(224, 178, 95, 0.4)",
  },
  crimson: {
    400: "#E0806C",
    500: "#D9705A",
    600: "#B95844",
    900: "#5C2A20",
    bgSubtle: "rgba(224, 128, 108, 0.15)",
    border: "rgba(224, 128, 108, 0.4)",
  },
};

export const THEMES = [daylightTheme, nightGardenTheme] as const;

export function getThemeColors(id: ThemeId = "daylight") {
  switch (id) {
    case "daylight":
      return daylightTheme;
    case "nightgarden":
    default:
      return nightGardenTheme;
  }
}

/** Pre-Tier-2 terminal theme ids migrate to Night Garden (dark stays dark). */
export function migrateLegacyThemeId(id: string | undefined): ThemeId {
  if (id === "daylight") return "daylight";
  if (id === "nightgarden") return "nightgarden";
  return "nightgarden";
}

// Default export matching standard tokens
export const colors = daylightTheme;
export type Colors = typeof daylightTheme;
