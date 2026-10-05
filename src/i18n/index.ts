import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import pt from "./locales/pt.json";
import es from "./locales/es.json";
import { deviceDefaultLanguage } from "../models/settings";

/**
 * UI localization. Entirely local — no network calls. When the user hasn't
 * picked a language explicitly (Settings or the first-run setup wizard),
 * English is the default (NIDO is English-first); English is also the
 * fallback for any missing key so a partial translation never renders blank.
 */
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    pt: { translation: pt },
    es: { translation: es },
  },
  lng: deviceDefaultLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
