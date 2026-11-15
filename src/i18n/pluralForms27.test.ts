/**
 * MIT License
 * Copyright (c) 2026 NIDO contributors
 * See LICENSE file for details.
 */

/**
 * Plurales CLDR y cadenas vacías tras la subida a i18next 27 (T-23).
 *
 * Medido contra la 26.7.1 con instancias reales y estos mismos locales
 * (21 claves con count × 11 conteos × 3 idiomas): la única diferencia de
 * salida está en es/pt con conteos de millón exacto (1.000.000, 2.000.000),
 * la categoría CLDR «many», para la que no hay clave propia. Con la 26 esos
 * textos salían EN INGLÉS (la caída al idioma de reserva se llevaba la
 * forma entera); con la 27 salen en su idioma desde la forma _other, que
 * es la forma gramatical correcta para los millones en es/pt. Por eso no
 * se añaden claves _many: su texto sería el de _other. Esta sonda fija el
 * comportamiento para que no vuelva en silencio.
 *
 * Y la otra cara de la 27: un valor vacío ya no se devuelve tal cual
 * (returnEmptyString queda en false); cae al idioma de reserva. En los
 * locales reales no hay ningún valor vacío (lo fija hygiene), así que es
 * un comportamiento elegido y documentado, no sufrido: la última prueba
 * lo demuestra con una instancia aislada.
 */
import { describe, expect, it } from "vitest";
import i18n from "./index";
import en from "./locales/en.json";
import es from "./locales/es.json";
import pt from "./locales/pt.json";

type Locale = Record<string, unknown>;
const LOCALES: Record<string, Locale> = { en, es, pt };
const LINGOS = ["en", "es", "pt"] as const;

const PLURAL_KEYS = [
  "evaluation.subtitle",
  "executionTelemetry.subtitle",
  "licenses.thirdPartyBody",
  "personalDocumentsManager.chunkCount",
  "personalDocumentsManager.docCount",
  "personalDocumentsManager.noTextWarning",
  "personalDocumentsManager.warningAlreadyHere",
  "personalDocumentsManager.warningAlreadyImported",
  "personalDocumentsManager.warningImageNoOcr",
  "personalDocumentsManager.warningOcrEmpty",
  "personalDocumentsManager.warningOcrFailed",
  "personalDocumentsManager.warningSimilarImported",
  "remoteTasks.title",
] as const;

function rawValue(lng: string, key: string): string {
  let node: unknown = LOCALES[lng];
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== "string") throw new Error(`falta ${key} en ${lng}`);
  return node;
}

const VAR_RE = /\{\{\s*([A-Za-z_][\w.]*)\s*(?:,[^}]*)?\}\}/g;

function varsOf(lng: string, key: string): Set<string> {
  const vars = new Set<string>();
  for (const form of ["one", "other"]) {
    for (const m of rawValue(lng, `${key}_${form}`).matchAll(VAR_RE)) vars.add(m[1]);
  }
  return vars;
}

function marker(name: string, count: number): string {
  return name === "count" ? String(count) : `«${name}»`;
}

function optionsFor(lng: string, key: string, count: number): Record<string, unknown> {
  const opts: Record<string, unknown> = { count };
  for (const v of varsOf(lng, key)) if (v !== "count") opts[v] = marker(v, count);
  return opts;
}

function expected(lng: string, key: string, form: "one" | "other", count: number): string {
  return rawValue(lng, `${key}_${form}`).replace(VAR_RE, (_, name: string) => marker(name, count));
}

describe("plurales CLDR (i18next 27)", () => {
  for (const lng of LINGOS) {
    it(`${lng}: el 1 usa la forma _one y el 2 la _other en las 13 claves plurales`, async () => {
      await i18n.changeLanguage(lng);
      for (const key of PLURAL_KEYS) {
        expect(i18n.t(key, optionsFor(lng, key, 1)), `${lng} ${key} count=1`).toBe(expected(lng, key, "one", 1));
        expect(i18n.t(key, optionsFor(lng, key, 2)), `${lng} ${key} count=2`).toBe(expected(lng, key, "other", 2));
      }
    });
  }

  it("los millones en es/pt salen en su idioma desde _other, no en inglés", async () => {
    for (const lng of ["es", "pt"] as const) {
      await i18n.changeLanguage(lng);
      for (const key of PLURAL_KEYS) {
        for (const count of [1_000_000, 2_000_000]) {
          const out = i18n.t(key, optionsFor(lng, key, count));
          expect(out, `${lng} ${key} count=${count}`).toBe(expected(lng, key, "other", count));
          expect(out, `${lng} ${key} count=${count}`).not.toMatch(/\{\{/);
        }
      }
    }
  });
});

describe("cadenas vacías (i18next 27)", () => {
  it("un valor vacío cae al idioma de reserva (returnEmptyString: false)", async () => {
    const inst = i18n.createInstance();
    await inst.init({
      resources: {
        en: { translation: { probe: "EN fallback text" } },
        es: { translation: { probe: "" } },
      },
      lng: "es",
      fallbackLng: "en",
    });
    expect(inst.t("probe")).toBe("EN fallback text");
  });
});
