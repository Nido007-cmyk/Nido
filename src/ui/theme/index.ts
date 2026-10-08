/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { colors, getThemeColors, migrateLegacyThemeId, THEMES, daylightTheme, nightGardenTheme } from "./colors";
import { typography, fontFamilies, getTypography, FONT_SCALES, Typography } from "./typography";
import { spacing, radii, shadows } from "./spacing";
import { ThemeProvider, useTheme } from "./ThemeContext";

export {
  colors,
  getThemeColors,
  migrateLegacyThemeId,
  THEMES,
  daylightTheme,
  nightGardenTheme,
  typography,
  fontFamilies,
  getTypography,
  FONT_SCALES,
  spacing,
  radii,
  shadows,
  ThemeProvider,
  useTheme,
};

export type { Typography };

export const theme = {
  colors,
  typography,
  fontFamilies,
  spacing,
  radii,
  shadows,
  badges: {
    emerald: {
      backgroundColor: colors.emerald.bgSubtle,
      borderColor: colors.emerald.border,
      borderWidth: 1,
      color: colors.text.accentEmerald,
    },
    cyan: {
      backgroundColor: colors.cyan.bgSubtle,
      borderColor: colors.cyan.border,
      borderWidth: 1,
      color: colors.text.accentCyan,
    },
    amber: {
      backgroundColor: colors.amber.bgSubtle,
      borderColor: colors.amber.border,
      borderWidth: 1,
      color: colors.text.accentAmber,
    },
    crimson: {
      backgroundColor: colors.crimson.bgSubtle,
      borderColor: colors.crimson.border,
      borderWidth: 1,
      color: colors.crimson[400],
    },
    frontier: {
      backgroundColor: colors.frontier.badgeBg,
      borderColor: colors.frontier.badgeBorder,
      borderWidth: 1,
      color: colors.frontier.text,
    },
  },
} as const;

export default theme;
