import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from "react";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import i18n from "./index";
import { LanguageId, getLanguageId, setLanguageId as persistLanguageId, deviceDefaultLanguage } from "../models/settings";

export interface LanguageOption {
  id: LanguageId;
  label: string;
  icon: string;
}

export const LANGUAGES: LanguageOption[] = [
  { id: "en", label: "English", icon: "🇺🇸" },
  { id: "es", label: "Español", icon: "🌎" },
  { id: "pt", label: "Português", icon: "🇧🇷" },
];

interface LanguageContextType {
  languageId: LanguageId;
  setLanguage: (id: LanguageId) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextType>({
  // Default only matters without a provider; the provider always resolves
  // the real value (saved preference or English default) on mount.
  languageId: "en",
  setLanguage: async () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [languageId, setLanguageIdState] = useState<LanguageId>(deviceDefaultLanguage());

  useEffect(() => {
    (async () => {
      const saved = await getLanguageId();
      setLanguageIdState(saved);
      await i18n.changeLanguage(saved);
    })();
  }, []);

  const setLanguage = useCallback(async (id: LanguageId) => {
    setLanguageIdState(id);
    impact(ImpactFeedbackStyle.Light);
    await i18n.changeLanguage(id);
    await persistLanguageId(id);
  }, []);

  const value = useMemo(() => ({ languageId, setLanguage }), [languageId, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextType {
  return useContext(LanguageContext);
}
