/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { Platform, TextStyle } from "react-native";
import { FontScale } from "../../models/settings";

export const fontFamilies = {
  mono: Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  }),
  /**
   * 0.1.117 (UI nueva): Atkinson Hyperlegible Next, diseñada para baja
   * visión. Viaja dentro del APK (plugins/withNidoFonts.js); en Android la
   * familia es el nombre del fichero y fontWeight elige normal o negrita.
   */
  sans: Platform.select({
    ios: "System",
    android: "AtkinsonHyperlegibleNext",
    default: "sans-serif",
  }),
  /** Títulos grandes: Source Serif 4 (el fichero ya es el seminegrita). */
  serif: Platform.select({
    ios: "Georgia",
    android: "SourceSerif4",
    default: "serif",
  }),
};

export interface Typography {
  mono: {
    xs: TextStyle;
    sm: TextStyle;
    base: TextStyle;
    md: TextStyle;
    lg: TextStyle;
  };
  ui: {
    micro: TextStyle;
    caption: TextStyle;
    subtext: TextStyle;
    body: TextStyle;
    bodyLg: TextStyle;
    titleSm: TextStyle;
    title: TextStyle;
    titleLg: TextStyle;
    headline: TextStyle;
  };
}

export function getTypography(scale: FontScale = "standard"): Typography {
  // Size delta relative to standard
  const delta = scale === "compact" ? -1.5 : scale === "large" ? 3 : 0;
  const lineDelta = scale === "compact" ? -2 : scale === "large" ? 4 : 0;

  return {
    mono: {
      xs: {
        fontFamily: fontFamilies.mono,
        fontSize: Math.max(9, 10 + delta * 0.5),
        lineHeight: 14 + lineDelta * 0.5,
        letterSpacing: 0.5,
      },
      sm: {
        fontFamily: fontFamilies.mono,
        fontSize: Math.max(10, 12 + delta * 0.75),
        lineHeight: 16 + lineDelta * 0.75,
        letterSpacing: 0.25,
      },
      base: {
        fontFamily: fontFamilies.mono,
        fontSize: Math.max(11, 13 + delta),
        lineHeight: 18 + lineDelta,
      },
      md: {
        fontFamily: fontFamilies.mono,
        fontSize: Math.max(13, 15 + delta),
        lineHeight: 20 + lineDelta,
        fontWeight: "600",
      },
      lg: {
        fontFamily: fontFamilies.mono,
        fontSize: Math.max(15, 18 + delta),
        lineHeight: 24 + lineDelta,
        fontWeight: "700",
      },
    },

    ui: {
      micro: {
        fontFamily: fontFamilies.sans,
        fontSize: Math.max(10, 11 + delta * 0.5),
        lineHeight: 14 + lineDelta * 0.5,
        fontWeight: "600",
      },
      caption: {
        fontFamily: fontFamilies.sans,
        fontSize: Math.max(11, 12 + delta * 0.75),
        lineHeight: 16 + lineDelta * 0.75,
        fontWeight: "500",
      },
      subtext: {
        fontFamily: fontFamilies.sans,
        fontSize: Math.max(12, 13 + delta),
        lineHeight: 18 + lineDelta,
      },
      body: {
        fontFamily: fontFamilies.sans,
        fontSize: Math.max(13, 15 + delta),
        lineHeight: 23 + lineDelta,
      },
      bodyLg: {
        fontFamily: fontFamilies.sans,
        fontSize: Math.max(14, 16 + delta),
        lineHeight: 25 + lineDelta,
      },
      titleSm: {
        fontFamily: fontFamilies.sans,
        fontSize: Math.max(12, 14 + delta),
        lineHeight: 18 + lineDelta,
        fontWeight: "700",
      },
      title: {
        fontFamily: fontFamilies.sans,
        fontSize: Math.max(14, 16 + delta),
        lineHeight: 22 + lineDelta,
        fontWeight: "700",
      },
      // 0.1.117: los títulos grandes van en serifa (el fichero ya es el
      // seminegrita: fontWeight "normal" evita la negrita sintética).
      titleLg: {
        fontFamily: fontFamilies.serif,
        fontSize: Math.max(18, 21 + delta),
        lineHeight: 27 + lineDelta,
        fontWeight: "normal",
      },
      headline: {
        fontFamily: fontFamilies.serif,
        fontSize: Math.max(22, 28 + delta),
        lineHeight: 34 + lineDelta,
        fontWeight: "normal",
        letterSpacing: -0.3,
      },
    },
  };
}

export const FONT_SCALES = [
  { id: "compact" as FontScale, label: "Compact", sample: "A-", desc: "Dense text for high information volume" },
  { id: "standard" as FontScale, label: "Standard", sample: "A", desc: "Default balanced reading experience" },
  { id: "large" as FontScale, label: "Large", sample: "A+", desc: "High legibility for glare, field, & seniors" },
] as const;

export const typography = getTypography("standard");
