/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";
import { QUICK_GUIDES } from "../ui/emergency/quickGuides";

/**
 * B-resto B-06: EmergencyScreen compone las claves de las guías rápidas
 * dinámicamente — t(`emergency.guides.${g.key}`) y
 * t(`emergency.questions.${g.key}`) — así que ningún literal las ata:
 * la higiene de i18n solo recoge claves literales t("…"), y con
 * fallbackLng: "en" una clave ausente en es/pt se renderizaría en
 * inglés en silencio (solo si faltara también en en se vería la clave
 * cruda). Esta guarda recorre la fuente viva (QUICK_GUIDES, no una
 * lista copiada) y exige las 12 claves presentes y no vacías en los
 * tres idiomas: 36 aserciones en 1 test. Si QUICK_GUIDES crece, la
 * guarda crece sola.
 */
const locales = { es, en, pt } as const;
const FAMILIES = ["guides", "questions"] as const;

describe("guías rápidas de emergencia — las claves dinámicas existen", () => {
  it("las 12 claves de QUICK_GUIDES están presentes y no vacías en es/en/pt", () => {
    for (const [name, locale] of Object.entries(locales)) {
      const emergency = (
        locale as unknown as Record<string, Record<string, Record<string, unknown>>>
      ).emergency;
      for (const fam of FAMILIES) {
        for (const g of QUICK_GUIDES) {
          const value = emergency?.[fam]?.[g.key];
          expect(typeof value, `${name}.emergency.${fam}.${g.key}`).toBe("string");
          expect(
            (value as string).trim().length,
            `${name}.emergency.${fam}.${g.key} no vacía`
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});
