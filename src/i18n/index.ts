/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Comprobación estricta de interpolación (i18next 27): fijada de forma
// explícita para que un futuro cambio del valor por defecto no la apague en
// silencio. Sin recursos tipados su superficie es la batería de higiene de
// src/i18n (censo de llamadas fijado por test), no el compilador.
declare module "i18next" {
  interface CustomTypeOptions {
    strictInterpolationChecks: true;
  }
}
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
