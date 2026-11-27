/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { ThemeId } from "../../models/settings";

/**
 * NIDO Design System — Tier 2 visual direction (frozen 2026-09-27),
 * re-tinted in 0.1.117 («UI nueva»): pine #1E5B45 on warm paper #F6F4EF,
 * crimson only for emergencies.
 * 1. Daylight (primary reference — default for new installs)
 * 2. Night Garden (designed dark theme)
 * The pre-Tier-2 terminal themes (Midnight/Amber/Matrix) were removed;
 * stored legacy ids migrate to Night Garden via migrateLegacyThemeId().
 */

/**
 * Tier 2 visual direction (frozen 2026-09-27): Daylight is the primary
 * reference, Night Garden the designed dark theme. Tokens transcribed
 * from ~/workspace/nido-visual-audit/mockups/tier2/ (TIER2_NOTES.md
 * Part B). Mapped onto the shared Colors shape so existing semantic
 * slots keep working.
 *
 * 2026-11-01 (tanda S, S-03): a WCAG recomputation over these tokens
 * found the small-text greys and the Daylight amber text colour below
 * AA on the darker surfaces, so the header no longer claims every pair
 * passes. Corrected in place: text.muted and text.dim in both themes
 * (margin values for the 9–10 px text they carry) and Daylight
 * amber.600 (the colour amber text uses in Daylight). text.accentAmber
 * in Daylight stays the icon, border and large-heading amber and is
 * never body or micro text (3.64 at best as text). Night crimson.600
 * keeps its token value; its named small-text uses take crimson.400 in
 * Night instead (PanicButton label, ChatScreen call buttons).
 */
export const daylightTheme = {
  id: "daylight" as ThemeId,
  name: "Daylight",
  icon: "☀️",
  description: "Light theme — the primary NIDO look",
  bg: {
    black: "#F6F4EF",
    terminal: "#F6F4EF",
    surface: "#FFFFFF",
    card: "#FFFFFF",
    cardElevated: "#EFECE5",
    cardHover: "#E9E5DC",
    input: "#FFFFFF",
    subtle: "rgba(21, 32, 26, 0.04)",
    overlay: "rgba(21, 32, 26, 0.45)",
    modalOverlay: "rgba(21, 32, 26, 0.62)",
  },
  border: {
    subtle: "#EFECE5",
    default: "#E4E0D7",
    elevated: "#D3CEC3",
    focus: "#1E5B45",
    emerald: "rgba(30, 91, 69, 0.30)",
    cyan: "rgba(30, 91, 69, 0.30)",
    amber: "rgba(176, 124, 42, 0.38)",
    danger: "rgba(180, 35, 24, 0.35)",
    frontier: "rgba(30, 91, 69, 0.40)",
  },
  text: {
    primary: "#15201A",
    heading: "#15201A",
    secondary: "#4B564E",
    muted: "#4F5A52",
    dim: "#525C55",
    inverse: "#FFFFFF",
    accentEmerald: "#174A38",
    accentCyan: "#174A38",
    accentAmber: "#8A5A12",
    accentViolet: "#5B4B86",
  },
  nidoIcon: {
    /** NIDO internal icon system v1 (frozen 2026-09-28): exact frozen values. */
    ink: "#1A201A",
    gold: "#A87F2B",
  },
  emerald: {
    50: "#DCEBE3",
    400: "#2F8A63",
    500: "#1E5B45",
    600: "#174A38",
    900: "#143F31",
    bgSubtle: "rgba(30, 91, 69, 0.12)",
    border: "rgba(30, 91, 69, 0.28)",
  },
  cyan: {
    400: "#2F8A63",
    500: "#1E5B45",
    600: "#174A38",
    bgSubtle: "rgba(30, 91, 69, 0.12)",
    border: "rgba(30, 91, 69, 0.30)",
  },
  frontier: {
    glow: "#1E5B45",
    glowCyan: "#1E5B45",
    badgeBg: "rgba(30, 91, 69, 0.12)",
    badgeBorder: "rgba(30, 91, 69, 0.35)",
    text: "#174A38",
    gradientStart: "#EFECE5",
    gradientEnd: "#F6F4EF",
  },
  amber: {
    400: "#B07C2A",
    500: "#9A6A1F",
    600: "#8A5A12",
    bgSubtle: "rgba(176, 124, 42, 0.14)",
    border: "rgba(176, 124, 42, 0.36)",
  },
  crimson: {
    400: "#B42318",
    500: "#B42318",
    600: "#912018",
    900: "#5C1A12",
    bgSubtle: "rgba(180, 35, 24, 0.10)",
    border: "rgba(180, 35, 24, 0.35)",
  },
};

export const nightGardenTheme = {
  id: "nightgarden" as ThemeId,
  name: "Night Garden",
  icon: "🌙",
  description: "Dark theme — designed for low light",
  bg: {
    black: "#0E1411",
    terminal: "#0E1411",
    surface: "#172019",
    card: "#172019",
    cardElevated: "#1F2A23",
    cardHover: "#26322A",
    input: "#121A15",
    subtle: "rgba(238, 241, 236, 0.04)",
    overlay: "rgba(0, 0, 0, 0.62)",
    modalOverlay: "rgba(0, 0, 0, 0.72)",
  },
  border: {
    subtle: "#222C25",
    default: "#2A362E",
    elevated: "#3A473E",
    focus: "#7CC4A2",
    emerald: "rgba(124, 196, 162, 0.35)",
    cyan: "rgba(124, 196, 162, 0.35)",
    amber: "rgba(227, 184, 104, 0.4)",
    danger: "rgba(255, 138, 122, 0.4)",
    frontier: "rgba(124, 196, 162, 0.45)",
  },
  text: {
    primary: "#EEF1EC",
    heading: "#EEF1EC",
    secondary: "#AEB8B0",
    muted: "#A6B0A8",
    dim: "#A2ACA4",
    inverse: "#0E1411",
    accentEmerald: "#9AD6B8",
    accentCyan: "#9AD6B8",
    accentAmber: "#E3B868",
    accentViolet: "#BBAAD9",
  },
  nidoIcon: {
    /** NIDO internal icon system v1 (frozen 2026-09-28): exact frozen values. */
    ink: "#F7F5F0",
    gold: "#E8C56B",
  },
  emerald: {
    50: "#1E3A2E",
    400: "#9AD6B8",
    500: "#7CC4A2",
    600: "#66B08E",
    900: "#1E3A2E",
    bgSubtle: "rgba(124, 196, 162, 0.15)",
    border: "rgba(124, 196, 162, 0.35)",
  },
  cyan: {
    400: "#9AD6B8",
    500: "#7CC4A2",
    600: "#66B08E",
    bgSubtle: "rgba(124, 196, 162, 0.15)",
    border: "rgba(124, 196, 162, 0.3)",
  },
  frontier: {
    glow: "#7CC4A2",
    glowCyan: "#7CC4A2",
    badgeBg: "rgba(124, 196, 162, 0.15)",
    badgeBorder: "rgba(124, 196, 162, 0.4)",
    text: "#C6E6D5",
    gradientStart: "#172019",
    gradientEnd: "#0E1411",
  },
  amber: {
    400: "#E3B868",
    500: "#D6A24E",
    600: "#B98538",
    bgSubtle: "rgba(227, 184, 104, 0.14)",
    border: "rgba(227, 184, 104, 0.4)",
  },
  crimson: {
    400: "#FF8A7A",
    500: "#E5574A",
    600: "#D93D2E",
    900: "#3A1D19",
    bgSubtle: "rgba(255, 138, 122, 0.15)",
    border: "rgba(255, 138, 122, 0.4)",
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
