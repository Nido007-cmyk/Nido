/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { impact, ImpactFeedbackStyle } from "../../services/haptics";
import {
  ThemeId,
  FontScale,
  getThemeId,
  setThemeId as persistThemeId,
  getFontScale,
  setFontScale as persistFontScale,
} from "../../models/settings";
import { getThemeColors, daylightTheme, Colors } from "./colors";
import { getTypography, Typography } from "./typography";

interface ThemeContextType {
  themeId: ThemeId;
  fontScale: FontScale;
  colors: Colors;
  typography: Typography;
  setTheme: (theme: ThemeId) => Promise<void>;
  setFontScale: (scale: FontScale) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType>({
  themeId: "daylight",
  fontScale: "standard",
  colors: daylightTheme,
  typography: getTypography("standard"),
  setTheme: async () => {},
  setFontScale: async () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeIdState] = useState<ThemeId>("daylight");
  const [fontScale, setFontScaleState] = useState<FontScale>("standard");

  useEffect(() => {
    (async () => {
      const [savedTheme, savedScale] = await Promise.all([
        getThemeId(),
        getFontScale(),
      ]);
      setThemeIdState(savedTheme);
      setFontScaleState(savedScale);
    })();
  }, []);

  const setTheme = useCallback(async (newTheme: ThemeId) => {
    setThemeIdState(newTheme);
    impact(ImpactFeedbackStyle.Light);
    await persistThemeId(newTheme);
  }, []);

  const setFontScale = useCallback(async (newScale: FontScale) => {
    setFontScaleState(newScale);
    impact(ImpactFeedbackStyle.Light);
    await persistFontScale(newScale);
  }, []);

  const currentColors = useMemo(() => getThemeColors(themeId), [themeId]);
  const currentTypography = useMemo(() => getTypography(fontScale), [fontScale]);

  const value = useMemo(
    () => ({
      themeId,
      fontScale,
      colors: currentColors,
      typography: currentTypography,
      setTheme,
      setFontScale,
    }),
    [themeId, fontScale, currentColors, currentTypography, setTheme, setFontScale]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
